"""B2 contracts exercised with temporary Git repositories and fake executables."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_kl as b1
from lib.commands import public_section, recommendation, verbatim
from lib.core import find_home
from lib.ledger import append, records
from lib.worktree import worktree_mark

PLUGIN = b1.PLUGIN
BRIEF = '''## Outcome
Serve a greeting.
## Accepted limits
Local only.
## Which error is cheaper
A duplicate greeting costs one glance.
## Constraints
Python, required by operator.
## Post-plan choice
consult
## Done-when
- A greeting appears.
- Exit is clean.
'''
PLAN = '''## Capabilities
### Greeting
Done-when: A greeting appears.
### Exit
Done-when: Exit is clean.
## External facts
- Python is installed; evidence: python3 --version, observed 3.11.
## Seams
Greeting to exit.
## First end-to-end path
Start, greet, exit.
## Size estimate
One small capability per milestone.
'''
COUNCIL_FAKE = b1.FAKE.replace("final = os.environ.get('FAKE_FINAL', 'Final response.\\ndone: final-artifact\\n')", '''seat = folder.name.split('-', 1)[1]
is_resume = '--resume' in args or 'resume' in args or '--conversation' in args
recommend = 'A' if os.environ.get('COUNCIL_AGREE') or cli != 'claude' else 'B'
if os.environ.get('COUNCIL_BARRIER') and not is_resume:
    import time
    barrier = pathlib.Path(os.environ['COUNCIL_BARRIER'])
    (barrier / seat).touch()
    deadline = time.monotonic() + 3
    while len(list(barrier.iterdir())) < 3 and time.monotonic() < deadline:
        time.sleep(0.01)
    if len(list(barrier.iterdir())) < 3:
        sys.exit(8)
if is_resume:
    recommend = 'Revised with evidence: command output'
final = '## Recommendation\\n' + recommend + '\\nEvidence: ' + seat + '\\nLiteral <tag> & **markdown**\\ndone: council\\n'
if os.environ.get('COUNCIL_QUESTION') == cli:
    final = 'question: Which target?\\n'
if os.environ.get('COUNCIL_FAIL') == cli:
    print('failed seat', file=sys.stderr)
    sys.exit(7)
''')


class B2Tests(unittest.TestCase):
    setUp = b1.IntegrationTests.setUp
    run_kl = b1.IntegrationTests.run_kl
    call = b1.IntegrationTests.call

    def write(self, relative, text):
        target = self.home / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        return target

    def accept(self, phase, artifact, *extra):
        return self.run_kl('accept', phase, *extra, '--artifact', str(self.home / artifact))

    def prepare_plan(self):
        self.write('plan/plan.md', PLAN)
        self.write('plan/decisions.md', '## Decisions\n### Python\nReason: installed.\nDropped: shell for maintainability.\n')
        self.write('plan/council/ruling.md', 'council plan: 1 agreed, 0 calls, 0 open\nAGREED verified: Python.')
        self.call('fresh_builder_read')

    def green(self):
        return self.run_kl('gate', '--cwd', str(self.home / 'wt'), '--cmd', 'printf green')

    def test_question_answer_and_dispatch_views(self):
        self.assertEqual(self.run_kl('ask', 'Choose local?'), (0, 'q1\n'))
        self.assertEqual(self.run_kl('ask', 'Choose port?'), (0, 'q2\n'))
        self.assertEqual(self.run_kl('answer', 'q1', 'Local as briefed.')[0], 0)
        self.assertEqual(self.run_kl('dispatch', 'algalon', '--agent-id', 'runner-123', '--packet', '/packet')[0], 0)
        rows = records(self.home)
        self.assertEqual([r['kind'] for r in rows], ['start', 'question', 'question', 'answer', 'dispatch'])
        self.assertEqual(rows[1]['id'], 'q1')
        self.assertEqual(rows[3]['question'], 'q1')
        self.assertEqual(rows[-1]['phase'], 'research')
        self.assertEqual(rows[-1]['packet'], '/packet')
        text = (self.home / 'run.md').read_text()
        self.assertIn('q2: Choose port?', text)
        self.assertIn('q1: Local as briefed.', text)
        self.assertNotIn('q1: Choose local?', text)
        self.assertIn('algalon research runner-123', text)
        self.assertIn(f'algalon research runner-123 since {rows[-1]["time"]}', text)
        self.assertIn('last call: none', text)
        self.call('researcher')
        self.assertIn('last call: 1', (self.home / 'run.md').read_text())
        self.write('research/report.md', 'Attributed findings.')
        self.write('research/sources.md', 'Command: python3 --version')
        self.assertEqual(self.accept('research', 'research/report.md')[0], 0)
        self.assertNotIn('algalon research runner-123', (self.home / 'run.md').read_text())

    def test_dispatch_explicit_phase_and_later_acceptance(self):
        append(self.home, 'accept', artifact_kind='plan', phase='plan', artifact='/earlier')
        self.assertEqual(self.run_kl('dispatch', 'kiln-lite:algalon', '--agent-id', 'custom',
                                     '--phase', 'plan', '--packet', 'plan/packet.md')[0], 0)
        row = records(self.home)[-1]
        self.assertEqual((row['phase'], row['packet']), ('plan', 'plan/packet.md'))
        expected = f'kiln-lite:algalon plan custom since {row["time"]}'
        self.assertIn(expected, (self.home/'run.md').read_text())
        append(self.home, 'accept', artifact_kind='research', phase='research', artifact='/other')
        self.assertIn(expected, (self.home/'run.md').read_text())
        append(self.home, 'accept', phase='plan', artifact='/later')
        self.assertNotIn(expected, (self.home/'run.md').read_text())

    def test_dispatch_optional_packet_and_phase_defaults(self):
        self.assertEqual(self.run_kl('dispatch', 'kiln-lite:pluribus', '--agent-id', 'planner')[0], 0)
        row = records(self.home)[-1]
        self.assertEqual(row['phase'], 'plan')
        self.assertIsNone(row['packet'])

    def test_unknown_question_refuses_without_row(self):
        before = records(self.home)
        self.assertEqual(self.run_kl('answer', 'q99', 'no')[0], 1)
        self.assertEqual(records(self.home), before)

    def test_pointer_and_discovery_with_multiple_runs(self):
        self.assertEqual((self.project / '.kiln-lite-run').read_text().strip(), str(self.home))
        code, output = self.run_kl('start', 'second', '--brief', str(self.brief))
        self.assertEqual(code, 0, output)
        second = Path(output.strip())
        self.assertEqual(find_home(), second)
        nested = self.home / 'wt/sub'
        nested.mkdir()
        self.assertEqual(find_home(cwd=nested), self.home)
        ignored = subprocess.check_output(['git', 'check-ignore', '.kiln-lite-run'], text=True)
        self.assertEqual(ignored.strip(), '.kiln-lite-run')
        exclude = self.project / '.git/info/exclude'
        self.assertEqual(exclude.read_text().splitlines().count('/.kiln-lite-run'), 1)

    def test_claude_can_write_entire_run_home(self):
        code, output, folder, _ = self.call('architect')
        self.assertEqual(code, 0, output)
        argv = json.loads((folder / 'invocation.json').read_text())['argv']
        self.assertEqual(argv[argv.index('--add-dir') + 1], str(self.home))

    def test_gate_green_red_logs_and_sequence(self):
        code, output = self.green()
        self.assertEqual((code, output), (0, f'gate green {worktree_mark(self.home / "wt", self.home)[:8]}\n'))
        self.assertIn('green', (self.home / 'build/gates/1.log').read_text())
        code, output = self.run_kl('gate', '--cwd', str(self.home / 'wt'),
            '--cmd', 'printf first; exit 3', '--cmd', 'printf second')
        self.assertEqual((code, output), (1, 'gate red printf first; exit 3\n'))
        row = records(self.home)[-1]
        self.assertEqual(row['rcs'], [3, 0])
        self.assertEqual(len(row['commands']), 2)
        self.assertEqual(row['status'], 'red')
        self.assertEqual(row['fingerprint'], worktree_mark(self.home / 'wt', self.home))
        log = (self.home / 'build/gates/2.log').read_text()
        self.assertLess(log.index('first'), log.index('second'))
        self.assertIn('rc: 3', log)
        self.assertIn('rc: 0', log)

    def test_gate_rejects_other_directory(self):
        self.assertEqual(self.run_kl('gate', '--cwd', str(self.project), '--cmd', 'true')[0], 1)

    def test_all_phases_refuse_missing_artifacts_in_one_sentence(self):
        for phase in ('brief', 'research', 'plan', 'milestone', 'build', 'verify', 'deploy'):
            with self.subTest(phase=phase):
                code, output = self.accept(phase, 'missing.md', *(['M1'] if phase == 'milestone' else []))
                self.assertEqual(code, 1)
                self.assertEqual(len(output.splitlines()), 1)
        self.assertFalse(any(r['kind'] == 'accept' for r in records(self.home)))

    def test_brief_accept_and_missing_parts(self):
        self.write('brief.md', BRIEF)
        self.assertEqual(self.accept('brief', 'brief.md')[0], 0)
        for section in ('Outcome', 'Accepted limits', 'Which error is cheaper', 'Constraints', 'Post-plan choice', 'Done-when'):
            with self.subTest(section=section):
                self.write('brief.md', BRIEF.replace('## ' + section, '## OMITTED'))
                self.assertEqual(self.accept('brief', 'brief.md')[0], 1)

    def test_brief_template_headings_are_accepted(self):
        text = (PLUGIN / 'templates/brief.md').read_text()
        self.write('brief.md', text)
        self.assertEqual(self.accept('brief', 'brief.md')[0], 0)

    def test_research_requires_sources(self):
        self.write('research/report.md', 'Attribution and evidence.')
        self.assertEqual(self.accept('research', 'research/report.md')[0], 1)
        self.write('research/sources.md', 'https://example.invalid; retrieved today')
        self.assertEqual(self.accept('research', 'research/report.md')[0], 0)

    def test_plan_required_parts_and_receipts(self):
        self.write('plan/plan.md', PLAN)
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)
        self.write('plan/decisions.md', '## Decisions\n### Python\nReason: stdlib.\nDropped: shell.\n')
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)
        self.write('plan/council/ruling.md', 'council plan: 1 agreed, 0 calls, 0 open')
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)
        self.call('fresh_builder_read')
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 0)
        for text in (PLAN.replace('Done-when: Exit is clean.', 'No check.'),
                     PLAN.replace('## External facts', '## Missing'),
                     PLAN.replace('## First end-to-end path', '## Missing'),
                     PLAN.replace('- Python is installed; evidence: python3 --version, observed 3.11.', '- Python is installed.')):
            with self.subTest(text=text):
                self.write('plan/plan.md', text)
                self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)

    def test_plan_failed_fresh_builder_read_is_not_done(self):
        self.prepare_plan()
        rows = records(self.home)
        rows[-1]['status'] = 'blocked'
        (self.home / 'ledger.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows))
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)

    def test_milestone_requires_current_green_gate_and_build_entry(self):
        self.write('build/build.md', 'M1: greeting built, gate and review recorded.\nClose read: call 7, clean.')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)
        self.green()
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 0)
        self.write('wt/product.txt', 'changed')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)
        self.green()
        self.write('build/chunks/C1/report.md', 'Milestone: M1\nblocking: greeting absent')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)
        self.write('build/chunks/C1/report.md', 'Milestone: M1\nblocking closed: greeting now visible\nOpen blocking: none\n')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 0)
        self.run_kl('gate', '--cwd', str(self.home / 'wt'), '--cmd', 'exit 2')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)
        self.green()
        self.write('build/build.md', 'Earlier milestone only.')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)

    def test_milestone_requires_close_read_receipt(self):
        self.green()
        self.write('build/build.md', 'M1: built.')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)
        self.assertIn('Close read', self.accept('milestone', 'build/build.md', 'M1')[1])
        self.write('build/build.md', 'M0: built.\nClose read: call 1, clean.\nM1: built.')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)  # the receipt belongs to M0
        self.write('build/build.md', 'M1: built.\n## M2: built.\nClose read: call 7, clean.')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)  # the receipt belongs to M2
        self.write('build/build.md', 'M1: built.\n### M1 closed\nClose read: call 7, clean.\n## M10: built.\nClose read: skipped (one chunk, no blocking, empty backlog).')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 0)  # M1 closed is still M1; M10 is another entry
        self.write('build/build.md', 'M1: built.\n- Close read: skipped (one chunk, no blocking, empty backlog).')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 0)

    def test_build_accepts_delivery_artifact(self):
        self.write('build/delivery.md', '## Built scope\nGreeting.\n## Deferred\nNone.\n## Trial\nGreeting observed.\n## Branch\nkiln/slice\n')
        self.assertEqual(self.accept('build', 'build/delivery.md')[0], 0)
        self.assertEqual(records(self.home)[-1]['artifact_kind'], 'build')

    def test_verify_requires_each_done_when_with_evidence(self):
        self.write('brief.md', BRIEF)
        self.write('verify/report.md', '- A greeting appears. | pass | evidence: stdout → hello\n')
        self.assertEqual(self.accept('verify', 'verify/report.md')[0], 1)
        self.write('verify/report.md', '- A greeting appears. | pass | evidence: stdout → hello\n- Exit is clean. | pass\n')
        self.assertEqual(self.accept('verify', 'verify/report.md')[0], 1)
        self.write('verify/report.md', '- A greeting appears. | pass | evidence: stdout → hello\n- Exit is clean. | pass | evidence: exit → rc 0\n')
        self.assertEqual(self.accept('verify', 'verify/report.md')[0], 0)

    def test_deploy_receipt_requires_all_parts(self):
        receipt = ''.join(f'## {name}\nObserved {name}.\n' for name in ('Where it runs', 'How it was started', 'How to stop', 'How to roll back', 'Evidence'))
        self.write('deploy/receipt.md', receipt)
        self.assertEqual(self.accept('deploy', 'deploy/receipt.md')[0], 0)
        for name in ('Where it runs', 'How it was started', 'How to stop', 'How to roll back', 'Evidence'):
            self.write('deploy/receipt.md', receipt.replace('## ' + name, '## Missing'))
            self.assertEqual(self.accept('deploy', 'deploy/receipt.md')[0], 1)

    def council(self, *flags, public=True):
        for cli in ('codex', 'claude', 'agy'):
            (self.fake / cli).write_text(COUNCIL_FAKE)
        question = self.write('plan/council/question.md', '# Private\nSECRET-MANDATE\n' +
                              ('## Public\nChoose A or B.\n## Private followup\nSECRET-SECOND\n' if public else 'No public copy.'))
        code, output = self.run_kl('council', str(question), '--lens', 'conceptual', *flags)
        return code, Path(output.strip())

    def test_council_blind_parallel_exchange_and_lossless_result(self):
        self.assertNotEqual(COUNCIL_FAKE, b1.FAKE)
        barrier = self.home / 'parallel-barrier'
        barrier.mkdir()
        with patch.dict(os.environ, {'COUNCIL_BARRIER': str(barrier)}):
            code, folder = self.council()
        self.assertEqual(code, 0, (folder / 'result.md').read_text())
        rows = [r for r in records(self.home) if r['kind'] == 'call']
        self.assertEqual(len(rows), 3)
        self.assertFalse(list(folder.glob('*.exchange.md')))
        self.assertEqual(self.run_kl('council', '--exchange', str(folder))[0], 0)
        self.assertEqual(len([r for r in records(self.home) if r['kind'] == 'call']), 5)
        self.assertEqual(self.run_kl('council', '--exchange', str(folder))[0], 1)
        self.assertEqual({r['role'] for r in rows}, {'conceptual.0', 'conceptual.1', 'advisor'})
        result = (folder / 'result.md').read_text()
        for seat in ('conceptual.0', 'conceptual.1', 'advisor'):
            self.assertIn(f'## {seat}', result)
            answer = (folder / f'{seat}.md').read_text()
            self.assertIn(answer, result)
        for seat in ('conceptual.0', 'conceptual.1'):
            self.assertIn((folder / f'{seat}.exchange.md').read_text(), result)
        self.assertIn('## Failed seats\n\nNone.', result)
        for call in (self.home / 'calls').iterdir():
            if not call.is_dir():
                continue
            invoked = json.loads((call / 'invocation.json').read_text())
            
            argv, packet = invoked['argv'], invoked['packet']
            if 'advisor' in call.name:
                self.assertNotIn('SECRET', packet)
                self.assertIn('Choose A or B.', packet)
            meta = json.loads((call / 'meta.json').read_text())
            self.assertEqual(invoked['cwd'], meta['launch_cwd'])
            if '--resume' in argv or 'resume' in argv:
                self.assertNotEqual(meta['launch_cwd'], str(call))
            else:
                self.assertEqual(meta['launch_cwd'], str(call))
            if '--resume' in argv or 'resume' in argv:
                self.assertIn('keep, revise or withdraw', packet.lower())
                self.assertIn('Other seat:', packet)
                other = 'conceptual.1' if 'conceptual.0' in call.name else 'conceptual.0'
                self.assertIn((folder / f'{other}.md').read_text(), packet)
            else:
                self.assertNotIn('Other seat:', packet)
        self.assertEqual((folder / 'question.md').read_text(), (self.home / 'plan/council/question.md').read_text())

    def test_council_agreement_skips_exchange(self):
        with patch.dict(os.environ, {'COUNCIL_AGREE': '1'}):
            code, folder = self.council()
        self.assertEqual(code, 0)
        self.assertEqual(len([r for r in records(self.home) if r['kind'] == 'call']), 3)
        self.assertFalse(list(folder.glob('*.exchange.md')))

    def test_council_without_public_skips_advisor(self):
        code, folder = self.council(public=False)
        self.assertEqual(code, 0)
        self.assertNotIn('advisor', [r.get('role') for r in records(self.home)])
        self.assertIn('no ## Public section', (folder / 'result.md').read_text())

    def test_council_no_argon_and_overrides(self):
        code, folder = self.council('--no-argon', '--models', 'gpt-test-a,gpt-test-b')
        self.assertEqual(code, 0)
        rows = [r for r in records(self.home) if r['kind'] == 'call']
        self.assertEqual(len(rows), 2)
        self.assertEqual({r['model'] for r in rows}, {'gpt-test-a', 'gpt-test-b'})
        self.assertIn('Advisor disabled', (folder / 'result.md').read_text())

    def test_council_failed_seat_is_named(self):
        with patch.dict(os.environ, {'COUNCIL_FAIL': 'claude'}):
            code, folder = self.council()
        self.assertEqual(code, 1)
        self.assertIn('## Failed seats\n\nconceptual.1', (folder / 'result.md').read_text())
        self.assertEqual(len([r for r in records(self.home) if r['kind'] == 'call']), 3)

    def hook(self, script, event):
        proc = subprocess.run([sys.executable, str(PLUGIN / 'hooks' / script)], input=json.dumps(event),
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)['hookSpecificOutput'] if proc.stdout else None

    def test_pretooluse_denies_all_editor_tools_session_and_runner(self):
        for tool in ('Write', 'Edit', 'NotebookEdit'):
            for agent in (None, 'kiln-lite:chunk-norris'):
                event = dict(hook_event_name='PreToolUse', cwd=str(self.project), tool_name=tool,
                             tool_input={('notebook_path' if tool == 'NotebookEdit' else 'file_path'): str(self.home / 'wt/new.txt')}, agent_type=agent)
                out = self.hook('pretooluse.py', event)
                self.assertEqual(out['permissionDecision'], 'deny')
                self.assertEqual(out['hookEventName'], 'PreToolUse')
                event['cwd'] = str(self.home / 'wt')
                self.assertEqual(self.hook('pretooluse.py', event)['permissionDecision'], 'deny')

    def test_pretooluse_allows_outside_and_no_run(self):
        event = dict(hook_event_name='PreToolUse', cwd=str(self.project), tool_name='Write',
                     tool_input={'file_path': str(self.home / 'build/build.md')})
        self.assertIsNone(self.hook('pretooluse.py', event))
        event['tool_input']['file_path'] = str(self.home / 'wt-sibling/file')
        self.assertIsNone(self.hook('pretooluse.py', event))
        event['cwd'] = str(self.fake)
        event['tool_input']['file_path'] = str(self.home / 'wt/file')
        self.assertIsNone(self.hook('pretooluse.py', event))

    def test_pretooluse_resolves_symlink_targets(self):
        (self.project / 'linked-wt').symlink_to(self.home / 'wt', target_is_directory=True)
        out = self.hook('pretooluse.py', dict(cwd=str(self.project), tool_name='Edit',
                         tool_input={'file_path': str(self.project / 'linked-wt/file')}))
        self.assertEqual(out['permissionDecision'], 'deny')

    def test_sessionstart_injects_status_or_nothing(self):
        for cwd in (self.project, self.home / 'wt'):
            for source in ('startup', 'resume', 'compact'):
                out = self.hook('sessionstart.py', dict(hook_event_name='SessionStart', cwd=str(cwd), source=source, permission_mode='bypassPermissions'))
                self.assertEqual(out['hookEventName'], 'SessionStart')
                self.assertEqual(out['additionalContext'], (self.home / 'run.md').read_text())
        self.assertIsNone(self.hook('sessionstart.py', dict(cwd=str(self.fake), permission_mode='bypassPermissions')))

    def test_concurrent_questions_have_distinct_ids(self):
        from concurrent.futures import ThreadPoolExecutor
        def ask(n):
            return subprocess.run([str(PLUGIN / 'bin/kl'), 'ask', str(n), '--run', str(self.home)],
                                  capture_output=True, text=True)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(ask, range(8)))
        self.assertTrue(all(result.returncode == 0 for result in results))
        self.assertEqual({result.stdout.strip() for result in results}, {f'q{n}' for n in range(1, 9)})
        self.assertEqual(len([r for r in records(self.home) if r['kind'] == 'question']), 8)

    def test_resumed_done_clears_unfinished_call(self):
        with patch.dict(os.environ, {'FAKE_FINAL': 'question: local target?'}):
            code, _, _, meta = self.call()
        self.assertEqual(code, 0)
        self.assertIn('1 implementer: question', (self.home / 'run.md').read_text())
        self.call('implementer', '--resume', meta['ids']['thread_id'])
        view = (self.home / 'run.md').read_text()
        self.assertNotIn('1 implementer: question', view)
        self.assertNotIn('question: local target?', view)
        self.assertEqual(len([r for r in records(self.home) if r['kind'] == 'call']), 2)

    def test_plan_requires_evidence_for_each_fact(self):
        self.prepare_plan()
        self.write('plan/plan.md', PLAN.replace('- Python is installed; evidence: python3 --version, observed 3.11.',
            '- Python is installed; evidence: python3 --version.\n- The network works.'))
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)
        self.write('plan/plan.md', PLAN.replace('### Greeting\nDone-when:', '- Greeting. Done-when:')
                   .replace('### Exit\nDone-when:', '- Exit. Done-when:'))
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)

    def test_recommendation_and_public_section_parsing(self):
        self.assertEqual(recommendation('## Recommendation\n\nA\nEvidence: x'), 'A')
        self.assertEqual(recommendation('## Recommendation: A\nEvidence: x'), 'A')
        self.assertIsNone(recommendation('No recommendation heading.'))
        answer = '## Recommendation\n```python\nprint(1)\n```\n'
        self.assertEqual(verbatim(answer), '````markdown\n' + answer + '````\n')
        self.assertEqual(public_section('# Private\nsecret\n## Public\npublic\n### Detail\nmore\n## Private\nsecret'),
                         'public\n### Detail\nmore\n')
        self.assertIsNone(public_section('## Private\nsecret'))

    def test_operational_council_and_unique_folders(self):
        for cli in ('codex', 'claude', 'agy'):
            (self.fake / cli).write_text(COUNCIL_FAKE)
        question = self.write('operational.md', '## Public\nCan we run it?')
        folders = []
        for _ in range(2):
            code, output = self.run_kl('council', str(question), '--lens', 'operational', '--no-argon')
            self.assertEqual(code, 0, output)
            folders.append(Path(output.strip()))
        self.assertEqual([p.name for p in folders], ['public', 'public-2'])
        self.assertIn('## operational.0', (folders[0] / 'result.md').read_text())
        self.assertIn('## operational.1', (folders[0] / 'result.md').read_text())

    def test_council_invalid_models_launches_nothing(self):
        question = self.write('invalid.md', 'Choose?')
        before = records(self.home)
        code, output = self.run_kl('council', str(question), '--lens', 'conceptual', '--models', 'only-one')
        self.assertEqual(code, 1, output)
        self.assertEqual(records(self.home), before)
        self.assertFalse(list((self.home / 'council').iterdir()))

    def test_resume_uses_newest_matching_launch_and_refuses_unknown(self):
        _, _, first, _ = self.call('architect')
        _, _, second, _ = self.call('architect')
        code, output, third, meta = self.call('architect', '--resume', 'session-one')
        self.assertEqual(code, 0, output)
        self.assertEqual(meta['launch_cwd'], str(second))
        self.assertNotEqual(first, second)
        self.assertNotEqual(third, second)
        before = records(self.home)
        code, output = self.run_kl('call', 'architect', str(self.packet), '--resume', 'unknown-id')
        self.assertEqual(code, 1)
        self.assertEqual(len(output.splitlines()), 1)
        self.assertEqual(records(self.home), before)
        self.assertEqual(len(list((self.home / 'calls').glob('*/meta.json'))), 3)

    def test_fingerprint_ignores_staging_commits_and_ignored_files(self):
        wt = self.home / 'wt'
        self.write('wt/.gitignore', 'ignored.txt\n')
        path = self.write('wt/product.txt', 'hello')
        self.write('build/build.md', 'M1: product built.\nClose read: skipped (one chunk, no blocking, empty backlog).')
        self.green()
        mark = worktree_mark(wt, self.home)
        for args in (['add', '.'], ['commit', '-qm', 'product']):
            subprocess.run(['git', '-C', str(wt), *args], check=True, capture_output=True)
            self.assertEqual(worktree_mark(wt, self.home), mark)
            self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 0)
        gate = next(r for r in records(self.home) if r['kind'] == 'gate')
        current = subprocess.check_output(['git', '-C', str(wt), 'rev-parse', 'HEAD'], text=True).strip()
        self.assertNotEqual(gate['head'], current)
        self.write('wt/ignored.txt', 'noise')
        self.assertEqual(worktree_mark(wt, self.home), mark)
        path.write_text('changed')
        self.assertNotEqual(worktree_mark(wt, self.home), mark)
        path.unlink()
        self.assertNotEqual(worktree_mark(wt, self.home), mark)

    def test_plan_lenient_skeleton_and_evidence(self):
        self.prepare_plan()
        self.write('plan/plan.md', PLAN.replace('## Capabilities', '## Capabilities: build order')
                   .replace('Done-when:', 'Done-when')
                   .replace('## External facts', '## External facts (observed)')
                   .replace('## Seams', '## Seams — agreed')
                   .replace('- Python', 'Prose is not a fact bullet.\n- Python'))
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 0)
        for evidence in ('none', 'None.', '`none`', ''):
            self.write('plan/plan.md', PLAN.replace('python3 --version, observed 3.11.', evidence))
            self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)
        for heading in ('Seams', 'Size estimate'):
            self.write('plan/plan.md', PLAN.replace('## ' + heading, '## Missing'))
            self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)

    def test_plan_requires_latest_read_after_latest_architect(self):
        self.prepare_plan()
        self.call('architect')
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)
        self.call('fresh_builder_read')
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 0)
        with patch.dict(os.environ, FAKE_FINAL='blocked: missing seam'):
            self.call('fresh_builder_read')
        self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)

    def test_plan_decisions_require_each_reason_and_dropped(self):
        self.prepare_plan()
        for decisions in ('Plain prose.', '## Decisions\n### Python\nReason: installed.',
                          '## Decisions\n### Python\nReason: installed.\nDropped: shell.\n### Transport\nReason: local.'):
            self.write('plan/decisions.md', decisions)
            self.assertEqual(self.accept('plan', 'plan/plan.md')[0], 1)

    def test_verify_fail_and_deferred_rules(self):
        self.write('brief.md', BRIEF)
        report = '- A greeting appears. | pass | evidence: run → hello\n- Exit is clean. | pass | evidence: run → rc 0\n'
        for status, evidence, expected in (('fail', 'run → rc 1', 1), ('deferred', 'installation pending', 1),
                                           ('deferred', 'deploy then run → rc 0', 0)):
            self.write('verify/report.md', report.replace('pass | evidence: run → rc 0', status + ' | evidence: ' + evidence))
            self.assertEqual(self.accept('verify', 'verify/report.md')[0], expected)
        self.write('verify/report.md', report.replace('Exit is clean.', 'Exit clean.'))
        self.assertEqual(self.accept('verify', 'verify/report.md')[0], 1)

    def test_milestone_exact_name_and_last_line_only(self):
        self.green()
        self.write('build/build.md', 'M10: C10 built.')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)
        self.write('build/build.md', 'M1: C1 built.\nClose read: call 3, fixed in C2.\nM10: C10 built.')
        self.write('build/chunks/C10/report.md', 'Milestone: M10\nOpen blocking: broken')
        self.write('build/chunks/C1/report.md', 'Milestone: M1\nblocking: historical finding\nOpen blocking: none\n')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 0)
        self.write('build/chunks/C1/report.md', 'Milestone: M1\nOpen blocking: none\nLater unresolved finding')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)
        self.write('build/chunks/C1/report.md', 'Open blocking: none')
        self.assertEqual(self.accept('milestone', 'build/build.md', 'M1')[0], 1)  # a report must name its milestone

    def test_run_relative_paths_and_artifact_boundary(self):
        self.write('packet.md', 'Goal: run relative.')
        code, output = self.run_kl('call', 'architect', 'packet.md')
        self.assertEqual(code, 0, output)
        self.write('brief.md', BRIEF)
        self.assertEqual(self.run_kl('accept', 'brief', '--artifact', 'brief.md')[0], 0)
        external = self.project / 'external.md'
        external.write_text(BRIEF)
        self.assertEqual(self.run_kl('accept', 'brief', '--artifact', str(external))[0], 1)
        (self.home / 'escape.md').symlink_to(external)
        self.assertEqual(self.run_kl('accept', 'brief', '--artifact', 'escape.md')[0], 1)
        from lib.paths import run_path
        local = self.project / 'packet.md'
        local.write_text('Local takes precedence.')
        self.assertEqual(run_path(self.home, 'packet.md'), local)
        for cli in ('codex', 'claude', 'agy'):
            (self.fake / cli).write_text(COUNCIL_FAKE)
        self.write('question.md', '# Relative question\nChoose?')
        code, output = self.run_kl('council', 'question.md', '--lens', 'conceptual', '--no-argon')
        self.assertEqual(code, 0, output)
        self.assertEqual(Path(output.strip()).name, 'relative-question')

    def test_sessionstart_without_permission_field_does_not_warn(self):
        out = self.hook('sessionstart.py', dict(hook_event_name='SessionStart', cwd=str(self.fake), source='startup'))
        self.assertTrue(out is None or 'needs bypassPermissions' not in json.dumps(out))

    def test_sessionstart_permission_warning_with_and_without_run(self):
        for cwd in (self.project, self.fake):
            for mode in ('default', 'acceptEdits', 'plan', 'unknown'):
                out = self.hook('sessionstart.py', dict(cwd=str(cwd), permission_mode=mode))
                self.assertTrue(out['additionalContext'].startswith(
                    f'Kiln-Lite needs bypassPermissions; this session is in {mode}: stop before kl start and tell the operator.'))

    def test_council_advisor_failure_is_nonfatal_and_questions_are_preserved(self):
        with patch.dict(os.environ, COUNCIL_FAIL='agy'):
            code, folder = self.council('--name', 'Named decision')
        self.assertEqual(code, 0)
        self.assertEqual(folder.name, 'named-decision')
        self.assertIn('advisor', (folder / 'result.md').read_text().split('## Failed seats')[1])
        with patch.dict(os.environ, COUNCIL_QUESTION='claude'):
            code, folder = self.council()
        self.assertEqual(code, 0)
        result = (folder / 'result.md').read_text()
        self.assertIn('conceptual.1: question:', result)
        self.assertIn('## Failed seats\n\nNone.', result)
        self.assertLess(result.index('## Recommendations side by side'), result.index('## conceptual.0'))

    def test_answer_hash_phase_and_each_runners_last_call(self):
        self.run_kl('ask', 'Target?')
        self.assertEqual(self.run_kl('answer', '#q1', 'Local.')[0], 0)
        self.run_kl('dispatch', 'algalon', '--agent-id', 'r1')
        self.run_kl('dispatch', 'pluribus', '--agent-id', 'r2')
        self.call('researcher_gpt')
        self.call('architect')
        self.call('researcher_claude')
        view = (self.home / 'run.md').read_text().splitlines()
        self.assertIn('last call: 3', next(line for line in view if 'algalon research r1' in line))
        self.assertIn('last call: 2', next(line for line in view if 'pluribus plan r2' in line))
        self.write('brief.md', BRIEF)
        self.accept('brief', 'brief.md')
        self.assertIn('## Phase\nresearch\n', (self.home / 'run.md').read_text())

    def test_later_done_hides_failed_and_rejected_same_role(self):
        with patch.dict(os.environ, FAKE_MODE='nonzero'):
            self.call('implementer')
        self.assertIn('1 implementer: failed', (self.home / 'run.md').read_text())
        self.call('implementer')
        self.assertNotIn('1 implementer: failed', (self.home / 'run.md').read_text())
        append(self.home, 'call', n=3, role='implementer', status='rejected', result=None)
        self.call('implementer')
        self.assertNotIn('3 implementer: rejected', (self.home / 'run.md').read_text())
        self.assertEqual(len([r for r in records(self.home) if r['kind'] == 'call']), 4)

    def test_stale_pointer_fallback_and_deploy_removes_pointer(self):
        pointer = self.project / '.kiln-lite-run'
        pointer.write_text('/missing/run')
        self.assertEqual(find_home(), self.home)
        pointer.write_text(str(self.home))
        self.write('deploy/receipt.md', ''.join(f'## {name}\nObserved.\n' for name in
            ('Where it runs', 'How it was started', 'How to stop', 'How to roll back', 'Evidence')))
        self.assertEqual(self.accept('deploy', 'deploy/receipt.md')[0], 0)
        self.assertFalse(pointer.exists())
        with self.assertRaises(ValueError):
            find_home()

    def test_fingerprint_tracks_file_replaced_by_directory(self):
        wt = self.home / 'wt'
        path = self.write('wt/product.txt', 'original')
        subprocess.run(['git', '-C', str(wt), 'add', '.'], check=True, capture_output=True)
        mark = worktree_mark(wt, self.home)
        path.unlink()
        path.mkdir()
        nested = path / 'child.txt'
        nested.write_text('replacement')
        changed = worktree_mark(wt, self.home)
        self.assertNotEqual(mark, changed)
        nested.write_text('edited replacement')
        self.assertNotEqual(changed, worktree_mark(wt, self.home))

    def test_build_delivery_requires_each_documented_heading(self):
        delivery = ''.join(f'## {name}\nRecorded.\n' for name in ('Built scope', 'Deferred', 'Trial', 'Branch'))
        for name in ('Built scope', 'Deferred', 'Trial', 'Branch'):
            self.write('build/delivery.md', delivery.replace('## ' + name, '## Missing'))
            self.assertEqual(self.accept('build', 'build/delivery.md')[0], 1)

    def test_cards_state_acceptance_skeletons(self):
        architect = (PLUGIN / 'cards/architect.md').read_text()
        for heading in ('## Capabilities', '### <capability>', 'Done-when', '## External facts',
                        'evidence: <command or URL>', '## Seams', '## First end-to-end path',
                        '## Size estimate', '## Decisions', '### <decision>', 'Reason:', 'Dropped:'):
            self.assertIn(heading, architect)
        fresh = (PLUGIN / 'cards/fresh_builder_read.md').read_text()
        self.assertIn('only when buildable from the plan alone with no defect', fresh)
        self.assertIn('blocked: <defects, one per line>', fresh)
        self.assertIn('- <Done-when text verbatim> | pass|fail|deferred | evidence: <command → output>',
                      (PLUGIN / 'agents/anatomist.md').read_text())
        giant = (PLUGIN / 'agents/giant.md').read_text()
        for name in ('Where it runs', 'How it was started', 'How to stop', 'How to roll back', 'Evidence'):
            self.assertIn('## ' + name, giant)
        chunk = (PLUGIN / 'agents/chunk-norris.md').read_text()
        for token in ('Open blocking: none', 'review_of_gpt', 'review_of_claude',
                      '## Built scope', '## Deferred', '## Trial', '## Branch'):
            self.assertIn(token, chunk)
        skill = (PLUGIN / 'skills/kiln-lite/SKILL.md').read_text()
        self.assertIn('I run only in bypassPermissions; in any other mode I stop before `kl start` and say so.', skill)
        self.assertIn('kl council <run home>/council/brief.md --lens conceptual', skill)
        self.assertIn('~/.cache/kiln-lite/briefs/<slug>.md', skill)
        self.assertNotIn('at most 60 lines', skill)
        self.assertNotIn('≤15 lines', skill)

    def test_plugin_and_drafts(self):
        manifest = json.loads((PLUGIN / '.claude-plugin/plugin.json').read_text())
        self.assertEqual((manifest['name'], manifest['version']), ('kiln-lite', '0.1.0'))
        agents = list((PLUGIN / 'agents').glob('*.md'))
        self.assertEqual(len(agents), 5)
        for agent in agents:
            text = agent.read_text()
            self.assertIn('model: claude-opus-5-5', text)
            self.assertIn('effort: medium', text)
            self.assertIn('background: true', text)
            self.assertIn('tools: Bash, Read, Write, Edit, Glob, Grep', text)
        skill = (PLUGIN / 'skills/kiln-lite/SKILL.md').read_text()
        self.assertIn('disable-model-invocation: true', skill)
        self.assertLessEqual(len(skill.splitlines()), 100)
        hooks = json.loads((PLUGIN / 'hooks/hooks.json').read_text())['hooks']
        self.assertEqual(hooks['SessionStart'][0]['matcher'], 'startup|resume|compact')
        for hook in hooks.values():
            self.assertIn('${CLAUDE_PLUGIN_ROOT}', hook[0]['hooks'][0]['command'])
        self.assertTrue(os.access(PLUGIN / 'bin/kl', os.X_OK))


if __name__ == '__main__':
    unittest.main()
