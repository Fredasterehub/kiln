"""B1 integration tests: temporary Git projects and fake CLIs, no model calls."""
import contextlib
import io
import json
import os
import re
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN))
from lib.adapters import argv_for, parse_output, status_line
from lib.core import main, resolve_role, routing
from lib.ledger import append, records, render


FAKE = '''#!/usr/bin/env python3
import json, os, pathlib, re, sys
cli = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
stdin_data = sys.stdin.read()
packet = args[args.index('-p')+1] if cli == 'agy' else stdin_data
folder = pathlib.Path(re.search(r'Call artifacts: (.+)', packet).group(1))
(folder/'invocation.json').write_text(json.dumps(dict(argv=args, packet=packet, cwd=os.getcwd(), stdin=stdin_data,
    env={k:v for k,v in os.environ.items() if k.startswith(('ANTHROPIC_', 'CLAUDE_CODE_'))})))
mode = os.environ.get('FAKE_MODE', '')
if mode == 'timeout':
    import time
    time.sleep(5)
if mode == 'timeout-tree':
    import subprocess, time
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'])
    (folder/'child.pid').write_text(str(child.pid))
    time.sleep(20)
if mode in ('worker', 'worker-fail'):
    (folder/'result.md').write_text('Worker evidence kept.\\ndone: worker-artifact\\n')
if mode == 'change':
    target = pathlib.Path(re.search(r'Product working directory: (.+)', packet).group(1))
    (target/'changed.txt').write_text('changed')
final = os.environ.get('FAKE_FINAL', 'Final response.\\ndone: final-artifact\\n')
if mode == 'malformed':
    print('not-json')
elif cli == 'codex':
    if mode != 'no-final':
        pathlib.Path(args[args.index('-o')+1]).write_text(final)
    events = [dict(type='thread.started', thread_id='thread-first'),
              dict(type='turn.started'),
              dict(type='item.started', item=dict(id='item_0', type='agent_message')),
              dict(type='item.completed', item=dict(id='item_0', type='agent_message', text=final))]
    if mode != 'incomplete':
        events.append(dict(type='turn.completed', usage=dict(input_tokens=11, cached_input_tokens=5,
            cache_write_input_tokens=0, output_tokens=7, reasoning_output_tokens=2)))
    for event in events: print(json.dumps(event))
elif cli == 'claude':
    print(json.dumps(dict(session_id='session-one', result=final, total_cost_usd=0.125,
        num_turns=2, duration_ms=10, usage={'input_tokens':11},
        modelUsage={'observed-claude':{}}, is_error=mode == 'incomplete')))
else:
    print(json.dumps(dict(status='ERROR' if mode == 'incomplete' else 'SUCCESS',
        conversation_id='conversation-one', response=final, usage={'input_tokens':12})))
print('fake stderr', file=sys.stderr)
sys.exit(9 if mode in ('nonzero', 'worker-fail') else 0)
'''


class ArgvTests(unittest.TestCase):
    def setUp(self):
        self.cwd, self.call, self.card = Path('/work tree'), Path('/call'), Path('/card.md')

    def build(self, cli, resume=None):
        return argv_for(dict(cli=cli, model='exact-model', effort='medium', timeout_s=61),
                        self.cwd, self.call, self.card, 'packet $() "quoted"', resume)

    def test_codex_fresh_exact(self):
        self.assertEqual(self.build('codex'), ['codex','exec','-m','exact-model','-c',
            'model_reasoning_effort="medium"','-s','danger-full-access','-C','/work tree',
            '--skip-git-repo-check','--json','-o','/call/final.md','-'])

    def test_codex_resume_exact(self):
        self.assertEqual(self.build('codex', 'thread'), ['codex','exec','resume','-m','exact-model',
            '-c','model_reasoning_effort="medium"','-c','sandbox_mode="danger-full-access"',
            '-c','approval_policy="never"','--skip-git-repo-check','--json','-o','/call/final.md','thread','-'])

    def claude_expected(self):
        return ['env','-u','ANTHROPIC_API_KEY','-u','ANTHROPIC_AUTH_TOKEN','-u','CLAUDE_CODE_USE_BEDROCK',
            '-u','CLAUDE_CODE_USE_VERTEX','-u','CLAUDE_CODE_USE_FOUNDRY','-u','ANTHROPIC_BASE_URL',
            '-u','ANTHROPIC_PROFILE','-u','ANTHROPIC_MODEL','-u','CLAUDE_CODE_EFFORT_LEVEL',
            '-u','ANTHROPIC_SMALL_FAST_MODEL','-u','CLAUDE_CODE_SUBAGENT_MODEL',
            '-u','CLAUDE_CODE_SUBAGENT_MODEL_FORCE','ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-sonnet-5-5',
            'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1','claude','-p','--model','exact-model',
            '--effort','medium','--permission-mode','bypassPermissions','--append-system-prompt-file',
            '/card.md','--strict-mcp-config','--settings','{"fallbackModel":[],"switchModelsOnFlag":false}',
            '--output-format','json','--add-dir','/call']

    def test_claude_fresh_exact(self):
        self.assertEqual(self.build('claude'), self.claude_expected())

    def test_claude_resume_exact(self):
        self.assertEqual(self.build('claude', 'session'), self.claude_expected()+['--resume','session'])

    def test_agy_fresh_exact(self):
        self.assertEqual(self.build('agy'), ['agy','-p','packet $() "quoted"','--model','exact-model',
            '--sandbox','--disable-slash-commands','--dangerously-skip-permissions','--output-format',
            'json','--print-timeout','1s'])

    def test_agy_resume_exact(self):
        self.assertEqual(self.build('agy','conversation'), ['agy','-p','packet $() "quoted"','--model',
            'exact-model','--sandbox','--disable-slash-commands','--dangerously-skip-permissions',
            '--output-format','json','--print-timeout','1s','--conversation','conversation'])

    def test_status_contract(self):
        for text, expected in [('done: file\n\n','done'),('question: choose?','question'),
                               ('blocked: missing','blocked'),('12:00 done: x','unparsed'),
                               ('done: x\nafterword','unparsed'),('done: ','unparsed'),('', 'unparsed')]:
            with self.subTest(text=text):
                self.assertEqual(status_line(text)[0], expected)

    def test_all_routes_have_cards_and_defaults(self):
        for lane, routes in routing().items():
            for key, values in routes.items():
                for i, value in enumerate(values if isinstance(values, list) else [values]):
                    role = f'{key}.{i}' if isinstance(values,list) else key
                    route, card = resolve_role(lane, role)
                    self.assertEqual(route, value)
                    self.assertTrue(card.is_file())
                    self.assertEqual(card.name, key+'.md')
                    self.assertGreaterEqual(len(card.read_text().splitlines()), 5)
                    self.assertIn('result.md', card.read_text())
                    self.assertIsInstance(route['read_only'], bool)
                    self.assertGreater(route['timeout_s'], 0)

    def test_alias_cards_are_resolved_routes_and_runner_is_not_callable(self):
        for alias, target in {'researcher':'researcher_gpt', 'reviewer':'review_of_gpt',
                              'verifier':'verifier_claude', 'council_expert':'conceptual.0'}.items():
            for lane in routing():
                self.assertEqual(resolve_role(lane,alias),resolve_role(lane,target))
            self.assertFalse((PLUGIN/'cards'/f'{alias}.md').exists())
        for lane in routing():
            with self.assertRaises(KeyError):
                resolve_role(lane,'runner')
        self.assertFalse((PLUGIN/'cards/runner.md').exists())


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.project = root/'project'
        self.project.mkdir()
        self.fake = root/'fake-bin'
        self.fake.mkdir()
        for cli in ('codex','claude','agy'):
            path = self.fake/cli
            path.write_text(FAKE)
            path.chmod(0o755)
        self.env = patch.dict(os.environ, {'HOME':str(root), 'PATH':str(self.fake)+os.pathsep+os.environ['PATH'],
            'ANTHROPIC_API_KEY':'fake-secret', 'ANTHROPIC_MODEL':'bad-override'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.oldcwd = Path.cwd()
        os.chdir(self.project)
        self.addCleanup(os.chdir, self.oldcwd)
        for args in (['init','-q'], ['config','user.email','test@example.invalid'],
                     ['config','user.name','Test'], ['commit','--allow-empty','-qm','initial']):
            subprocess.run(['git',*args], check=True, capture_output=True)
        self.brief = root/'brief.md'
        self.brief.write_text('## Outcome\nBuild B1.\n')
        self.packet = root/'packet.md'
        self.packet.write_text('Goal: fake only.\nLiteral $(touch SHOULD_NOT_EXIST)\n')
        code, output = self.run_kl('start','slice','--brief',str(self.brief))
        self.assertEqual(code, 0, output)
        self.home = Path(output.strip())

    def run_kl(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            code = main(list(args))
        return code, output.getvalue()

    def call(self, role='implementer', *args):
        code, output = self.run_kl('call',role,str(self.packet),'--run',str(self.home),*args)
        folders = [p for p in (self.home/'calls').iterdir() if p.is_dir() and re.match(r'^\d+-',p.name)]
        call = max(folders, key=lambda p:int(p.name.split('-')[0]))
        return code, output, call, json.loads((call/'meta.json').read_text())

    def test_start(self):
        self.assertEqual(self.home, Path.home()/'.cache/kiln-lite/project-slice')
        self.assertEqual((self.home/'brief.md').read_bytes(), self.brief.read_bytes())
        self.assertEqual((self.home/'lane.txt').read_text(), 'balanced\n')
        branch = subprocess.check_output(['git','-C',str(self.home/'wt'),'branch','--show-current'],text=True)
        self.assertEqual(branch.strip(),'kiln/slice')
        self.assertEqual([r['kind'] for r in records(self.home)], ['start'])
        self.assertTrue((self.home/'run.md').exists())
        self.assertTrue((self.home/'build/gates').is_dir())

    def test_codex_receipts_and_resume(self):
        code, output, call, meta = self.call()
        self.assertEqual(code,0,output)
        self.assertEqual(meta['ids'],{'thread_id':'thread-first'})
        self.assertIsNone(meta['observed_model'])
        self.assertEqual(meta['usage'], dict(input_tokens=11, cached_input_tokens=5,
            cache_write_input_tokens=0, output_tokens=7, reasoning_output_tokens=2))
        self.assertIsNone(meta['cost'])
        self.assertEqual(meta['requested_model'],'gpt-6.1-sol')
        self.assertEqual(meta['requested_effort'],'medium')
        self.assertGreaterEqual(meta['wall_seconds'],0)
        self.assertFalse(meta['read_only'])
        self.assertEqual((call/'final.md').read_bytes(),(call/'result.md').read_bytes())
        self.assertIn('result-from-final',(call/'status.txt').read_text())
        invocation = json.loads((call/'invocation.json').read_text())
        self.assertTrue(invocation['packet'].startswith((PLUGIN/'cards/implementer.md').read_text().rstrip()+'\n\n'))
        self.assertEqual(invocation['cwd'],str(self.home/'wt'))
        self.assertEqual(meta['launch_cwd'],invocation['cwd'])
        self.assertEqual(meta['product_cwd'],str(self.home/'wt'))
        self.assertFalse((self.home/'wt/SHOULD_NOT_EXIST').exists())
        for name in ('packet.md','result.md','final.md','status.txt','events.jsonl','stderr.log','rc','meta.json'):
            self.assertTrue((call/name).is_file(),name)
        row = records(self.home)[-1]
        self.assertEqual((row['kind'],row['n'],row['status'],row['rc']),('call',1,'done',0))
        self.assertEqual(row['ids'],meta['ids'])
        code, _, second, resumed = self.call('implementer','--resume','thread-first')
        self.assertEqual(code,0)
        self.assertEqual(second.name,'2-implementer')
        self.assertEqual(resumed['argv'][-2:],['thread-first','-'])
        self.assertTrue((second/'packet.md').read_text().startswith('Goal:'))

    def test_claude_receipts_environment_and_resume(self):
        code, output, call, meta = self.call('researcher_claude')
        self.assertEqual(code,0,output)
        self.assertEqual(meta['ids'],{'session_id':'session-one'})
        self.assertEqual(meta['cost'],0.125)
        self.assertEqual(meta['observed_model'],'observed-claude')
        self.assertEqual(meta['usage'],{'input_tokens':11})
        self.assertTrue(meta['read_only'])
        self.assertEqual(meta['fingerprint_before'],meta['fingerprint_after'])
        invocation = json.loads((call/'invocation.json').read_text())
        self.assertNotIn('ANTHROPIC_API_KEY',invocation['env'])
        self.assertNotIn('ANTHROPIC_MODEL',invocation['env'])
        self.assertEqual(invocation['env']['ANTHROPIC_DEFAULT_HAIKU_MODEL'],'claude-sonnet-5-5')
        self.assertTrue(invocation['packet'].startswith('Goal:'))
        self.assertNotIn('--cwd',invocation['argv'])
        self.assertEqual(invocation['cwd'],str(call))
        self.assertEqual(meta['launch_cwd'],str(call))
        self.assertEqual(meta['product_cwd'],str(self.home/'wt'))
        self.assertEqual(records(self.home)[-1]['cost'],0.125)
        code, _, _, meta = self.call('researcher_claude','--resume','session-one')
        self.assertEqual(code,0)
        self.assertEqual(meta['argv'][-2:],['--resume','session-one'])

    def test_agy_receipts_and_resume(self):
        code, output, call, meta = self.call('advisor')
        self.assertEqual(code,0,output)
        self.assertEqual(meta['ids'],{'conversation_id':'conversation-one'})
        self.assertIsNone(meta['observed_model'])
        invocation = json.loads((call/'invocation.json').read_text())
        self.assertEqual(invocation['cwd'],str(call))
        self.assertEqual(invocation['stdin'],'')
        self.assertEqual(meta['launch_cwd'],str(call))
        self.assertEqual(meta['product_cwd'],str(self.home/'wt'))
        self.assertIsNone(meta['requested_effort'])
        self.assertEqual(invocation['packet'],(call/'packet.md').read_text())
        code, _, call, meta = self.call('advisor','--resume','conversation-one')
        self.assertEqual(code,0)
        self.assertEqual(meta['argv'][-2:],['--conversation','conversation-one'])
        self.assertTrue((call/'packet.md').read_text().startswith('Goal:'))

    def test_worker_written_result_preserved_all_families(self):
        with patch.dict(os.environ,FAKE_MODE='worker'):
            for role in ('implementer','architect','advisor'):
                with self.subTest(role=role):
                    code, output, call, _ = self.call(role)
                    self.assertEqual(code,0,output)
                    self.assertEqual((call/'result.md').read_text(),'Worker evidence kept.\ndone: worker-artifact\n')
                    self.assertIn('Final response.',(call/'final.md').read_text())
                    self.assertNotIn('result-from-final',(call/'status.txt').read_text())

    def test_read_only_rejects_changes(self):
        with patch.dict(os.environ,FAKE_MODE='change'):
            code, output, call, meta = self.call('implementer','--read-only')
        self.assertEqual(code,1)
        self.assertIn('rejected worktree-changed',output)
        self.assertEqual(meta['status'],'rejected')
        self.assertNotEqual(meta['fingerprint_before'],meta['fingerprint_after'])
        self.assertEqual(records(self.home)[-1]['status'],'rejected')
        self.assertTrue((self.home/'wt/changed.txt').exists())

    def test_read_only_custom_cwd(self):
        with patch.dict(os.environ,FAKE_MODE='change'):
            code, _, _, meta = self.call('implementer','--read-only','--cwd',str(self.project))
        self.assertEqual(code,1)
        self.assertEqual(meta['cwd'],str(self.project))
        self.assertTrue((self.project/'changed.txt').exists())

    def test_read_only_plain_directory_cwd(self):
        plain = Path(self.temp.name)/'plain'
        plain.mkdir()
        code, output, _, meta = self.call('implementer','--read-only','--cwd',str(plain))
        self.assertEqual(code,0,output)
        self.assertEqual(meta['fingerprint_before'],meta['fingerprint_after'])
        with patch.dict(os.environ,FAKE_MODE='change'):
            code, output, _, meta = self.call('implementer','--read-only','--cwd',str(plain))
        self.assertEqual(code,1,output)
        self.assertEqual(meta['status'],'rejected')

    def test_question_blocked_unparsed(self):
        for final, status, expected in [('question: choose?','question',0),('blocked: dependency','blocked',0),('hello','unparsed',1)]:
            with self.subTest(status=status), patch.dict(os.environ,FAKE_FINAL=final):
                code, _, _, meta = self.call()
                self.assertEqual(code,expected)
                self.assertEqual(meta['status'],status)
                if status == 'question':
                    self.assertIn('question: choose?',(self.home/'run.md').read_text())

    def test_failures_record_receipts_all_families(self):
        for mode in ('nonzero','incomplete','malformed'):
            for role in ('implementer','architect','advisor'):
                with self.subTest(mode=mode,role=role), patch.dict(os.environ,FAKE_MODE=mode):
                    code, _, call, meta = self.call(role)
                    self.assertEqual(code,1)
                    self.assertEqual(meta['status'],'failed')
                    self.assertTrue((call/'rc').exists())
                    self.assertFalse((call/'result.md').exists())
                    self.assertIn('result-absent: CLI did not finish successfully',(call/'status.txt').read_text())
                    self.assertIsNone(records(self.home)[-1]['result'])
                    self.assertEqual(records(self.home)[-1]['status'],'failed')

    def test_missing_cli_receipt(self):
        (self.fake/'codex').unlink()
        with patch.dict(os.environ,PATH=str(self.fake)):
            code, _, _, meta = self.call()
        self.assertEqual(code,1)
        self.assertEqual(meta['rc'],127)
        self.assertIn('No such file',meta['error'])

    def test_timeout_receipt(self):
        route, card = resolve_role('balanced','implementer')
        route['timeout_s'] = 0.05
        with patch('lib.core.resolve_role',return_value=(route,card)), patch.dict(os.environ,FAKE_MODE='timeout'):
            code, _, _, meta = self.call()
        self.assertEqual(code,1)
        self.assertEqual(meta['rc'],124)
        self.assertEqual(meta['error'],'timeout')

    def test_timeout_kills_helper_process_group(self):
        route, card = resolve_role('balanced','implementer')
        route['timeout_s'] = 0.5
        with patch('lib.core.resolve_role',return_value=(route,card)), patch.dict(os.environ,FAKE_MODE='timeout-tree'):
            code, _, call, meta = self.call()
        self.assertEqual((code,meta['rc']),(1,124))
        pid = int((call/'child.pid').read_text())
        try:
            # An orphan can briefly remain as a zombie until init reaps it.
            stat = Path(f'/proc/{pid}/stat')
            self.assertTrue(not stat.exists() or stat.read_text().rsplit(')',1)[1].split()[0] == 'Z')
        finally:
            try:
                os.kill(pid,signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.assertFalse((call/'result.md').exists())

    def test_empty_final_does_not_fabricate_result(self):
        for role in ('implementer','architect','advisor'):
            with self.subTest(role=role), patch.dict(os.environ,FAKE_FINAL=''):
                code, _, call, meta = self.call(role)
                self.assertEqual((code,meta['status']),(1,'unparsed'))
                self.assertFalse((call/'result.md').exists())
                self.assertIn('result-absent: final.md is empty',(call/'status.txt').read_text())

    def test_absent_final_does_not_fabricate_result(self):
        with patch.dict(os.environ,FAKE_MODE='no-final'):
            code, _, call, _ = self.call()
        self.assertEqual(code,1)
        self.assertFalse((call/'result.md').exists())
        self.assertIn('result-absent: final.md is empty',(call/'status.txt').read_text())

    def test_failed_worker_result_is_preserved(self):
        for role in ('implementer','architect','advisor'):
            with self.subTest(role=role), patch.dict(os.environ,FAKE_MODE='worker-fail'):
                code, _, call, meta = self.call(role)
                self.assertEqual((code,meta['status']),(1,'failed'))
                self.assertEqual((call/'result.md').read_text(),'Worker evidence kept.\ndone: worker-artifact\n')
                self.assertNotIn('result-from-final',(call/'status.txt').read_text())

    def test_call_numbers_ignore_unrelated_folders(self):
        for name in ('notes','999','archive-900','4not-a-call'):
            (self.home/'calls'/name).mkdir()
        (self.home/'calls/7-prior').mkdir()
        (self.home/'calls/100-file').touch()
        code, output, call, _ = self.call()
        self.assertEqual(code,0,output)
        self.assertEqual(call.name,'8-implementer')

    def test_read_only_launch_directories(self):
        for role in ('researcher','architect','fresh_builder_read','conceptual.0','conceptual.1',
                     'operational.0','operational.1','advisor','verifier','implementer'):
            with self.subTest(role=role):
                code, output, call, meta = self.call(role,'--read-only')
                self.assertEqual(code,0,output)
                invocation = json.loads((call/'invocation.json').read_text())
                self.assertEqual(invocation['cwd'],str(call))
                self.assertEqual(meta['launch_cwd'],str(call))
                self.assertEqual(meta['product_cwd'],str(self.home/'wt'))
                self.assertIn(f'Product working directory: {self.home / "wt"}',invocation['packet'])
                if meta['cli']=='codex':
                    self.assertEqual(invocation['argv'][invocation['argv'].index('-C')+1],str(call))
        for role in ('reviewer','review_of_gpt','review_of_claude'):
            with self.subTest(role=role):
                code, output, call, meta = self.call(role)
                self.assertEqual(code,0,output)
                invocation = json.loads((call/'invocation.json').read_text())
                self.assertEqual(invocation['cwd'],str(self.home/'wt'))
                self.assertEqual(meta['launch_cwd'],meta['product_cwd'])
        for role in ('researcher_gpt','researcher_claude','advisor'):
            with self.subTest(explicit=role):
                code, output, call, meta = self.call(role,'--cwd',str(self.project))
                self.assertEqual(code,0,output)
                self.assertEqual(meta['launch_cwd'],str(call if role=='advisor' else self.project))
                self.assertEqual(meta['product_cwd'],str(self.project))

    def test_milestones_and_all_sections_are_bounded(self):
        rows=[]
        for n in range(10):
            rows.extend([dict(kind='accept',artifact_kind='milestone',milestone=f'M{n}',artifact=f'/m/{n}'),
                dict(kind='dispatch',runner=f'runner{n}',agent_id=str(n),time='now'),
                dict(kind='call',n=n,role='reviewer',status='question',result=f'/c/{n}',headline=f'question: Q{n}'),
                dict(kind='question',id=str(n),text=f'Q{n}'),
                dict(kind='answer',question=str(n),text=f'A{n}')])
        rows.append(dict(kind='accept',artifact_kind='plan',artifact='/plan'))
        text=render(rows)
        self.assertLessEqual(len(text.splitlines()),60)
        milestones=text.split('## Milestones done\n')[1].split('## ')[0]
        self.assertIn('M9 /m/9',milestones)
        self.assertNotIn('M5 /m/5',milestones)
        self.assertNotIn('/plan',milestones)
        for section in text.split('## ')[1:]:
            entries=[line for line in section.splitlines()[1:] if not line.startswith('(')]
            self.assertLessEqual(len(entries),4)

    def test_unreported_model_stays_null(self):
        _, _, _, meta = self.call()
        self.assertIsNone(meta['observed_model'])

    def test_model_override_switches_family_and_effort(self):
        code, _, _, meta = self.call('researcher','--model','claude-sonnet-5-5','--effort','low')
        self.assertEqual(code,0)
        self.assertEqual((meta['cli'],meta['requested_effort']),('claude','low'))

    def test_status_follow_and_run_discovery(self):
        self.call()
        code, text = self.run_kl('status')
        self.assertEqual(code,0)
        self.assertEqual(text,(self.home/'run.md').read_text())
        self.assertIn('## Phase\nbrief\n',text)
        code, text = self.run_kl('follow')
        self.assertEqual(code,0)
        self.assertEqual(len(text.splitlines()),len(records(self.home))+1)
        self.assertIn('call implementer gpt-6.1-sol done',text)
        code, text = self.run_kl('status','--json')
        self.assertEqual(len(json.loads(text)),2)
        os.chdir(self.home/'wt')
        self.assertEqual(self.run_kl('status')[0],0)

    def test_duplicate_start_preserves_existing(self):
        before = (self.home/'ledger.jsonl').read_bytes()
        code, _ = self.run_kl('start','slice','--brief',str(self.brief))
        self.assertEqual(code,1)
        self.assertEqual(before,(self.home/'ledger.jsonl').read_bytes())

    def test_executable_entrypoint(self):
        proc = subprocess.run([str(PLUGIN/'bin/kl'),'status','--run',str(self.home)],
                              text=True,capture_output=True)
        self.assertEqual(proc.returncode,0,proc.stderr)
        self.assertEqual(proc.stdout,(self.home/'run.md').read_text())

    def test_claude_lean_lane(self):
        code, output = self.run_kl('start','lean','--brief',str(self.brief),'--lane','claude-lean')
        self.assertEqual(code,0,output)
        lean = Path(output.strip())
        self.assertEqual((lean/'lane.txt').read_text(),'claude-lean\n')
        code, output = self.run_kl('call','researcher_claude',str(self.packet),'--run',str(lean))
        self.assertEqual(code,0,output)
        self.assertEqual(records(lean)[-1]['cli'],'codex')
        self.assertEqual(records(lean)[-1]['effort'],'low')

    def test_run_view_is_bounded_and_from_ledger(self):
        for n in range(80):
            append(self.home,'call',n=n,role='reviewer',status='blocked',result=f'/result/{n}')
        text = (self.home/'run.md').read_text()
        self.assertLessEqual(len(text.splitlines()),60)
        self.assertEqual(text,render(records(self.home)))
        self.assertIn('79 reviewer',text)
        for name in ('Run','Phase','Accepted','Live runners','Unfinished calls','Questions','Answers','Milestones done','Next action'):
            self.assertIn('## '+name,text)


if __name__ == '__main__':
    unittest.main()
