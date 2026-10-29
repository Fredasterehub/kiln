import concurrent.futures
import contextlib
import datetime as dt
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

PLUGIN = Path(__file__).resolve().parents[1]
FAKE = '''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
log = pathlib.Path(os.environ['FAKE_LOG'])
with log.open('a') as f:
    f.write(json.dumps(args) + '\\n')
if (os.environ.get('FAKE_FAIL') == ' '.join(args[:2])
    and (not os.environ.get('FAKE_FAIL_SEAT') or args[2:3] == [os.environ['FAKE_FAIL_SEAT']])):
    print('canned failure', file=sys.stderr)
    sys.exit(1)
result = {}
if args[:2] == ['workspace', 'create']:
    result = {'workspace': {'workspace_id': 'w-test'}, 'tab': {'tab_id': 'w-test:t2'}}
elif args[:2] == ['agent', 'get']:
    count = sum(json.loads(line)[:2] == ['agent', 'get'] for line in log.read_text().splitlines())
    states = os.environ.get('FAKE_STATES', 'idle').split(',')
    result = {'agent': {'agent_status': states[min(count - 1, len(states) - 1)]}}
    if count == 2 and os.environ.get('FAKE_MARK'):
        home = pathlib.Path(os.environ['KILN_HOME'])
        row = json.loads((home / 'ledger.jsonl').read_text().splitlines()[-1])
        path = pathlib.Path(json.loads((home / 'seats' / (args[2] + '.json')).read_text())['inbox'])
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({'read': [row['id']]}))
elif args[:2] == ['tab', 'create']:
    result = {'tab': {'tab_id': 'w-test:t3', 'label': args[args.index('--label') + 1]}, 'root_pane': {'pane_id': 'w-test:p-new'}}
elif args[:2] == ['tab', 'list']:
    result = {'tabs': [{'tab_id': 'w-test:t1', 'label': 'build', 'workspace_id': 'w-test'},
                       {'tab_id': 'w-test:t2', 'label': 'bridge', 'workspace_id': 'w-test'}]}
elif args[:2] == ['pane', 'list']:
    result = {'panes': [{'pane_id': 'w-test:p1', 'tab_id': 'w-test:t1'},
                        {'pane_id': 'w-test:p2', 'tab_id': 'w-test:t2'}]}
elif args[:2] == ['pane', 'split']:
    number = sum(json.loads(line)[:2] == ['pane', 'split'] for line in log.read_text().splitlines()) if os.environ.get('FAKE_BOOTSTRAP') else 1
    result = {'pane': {'pane_id': 'w-test:p' + str(number + 2)}}
print(json.dumps({'result': result}))
'''


class Sandbox:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.home = self.base / 'kiln'
        self.home.mkdir()
        bindir = self.base / 'bin'
        bindir.mkdir()
        fake = bindir / 'herdr'
        fake.write_text(FAKE)
        fake.chmod(0o755)
        self.log = self.base / 'argv.jsonl'
        self.env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH'],
                        KILN_HOME=str(self.home), HERDR_WORKSPACE_ID='w-test', FAKE_LOG=str(self.log))
        for key in ('FAKE_FAIL', 'FAKE_STATES', 'FAKE_MARK', 'FAKE_BOOTSTRAP', 'FAKE_FAIL_SEAT'):
            self.env.pop(key, None)

    def run_tool(self, tool, *args, ok=True):
        result = subprocess.run([str(PLUGIN / 'bin' / tool), *args], env=self.env,
                                capture_output=True, text=True, timeout=10)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []


class TeamTests(Sandbox, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.seat('sender')
        self.seat('receiver')
        (self.home / 'listeners').mkdir()
        self.listener = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)', 'core.py', 'listen'])
        def cleanup_listener():
            self.listener.terminate()
            self.listener.wait()
        self.addCleanup(cleanup_listener)
        (self.home / 'listeners/receiver.pid').write_text(str(self.listener.pid))
        self.env['KILN_SEAT'] = str(self.home / 'seats/sender.json')

    def seat(self, addr, role='manager', family='claude', parent='', inbox=None):
        path = self.home / 'seats' / f'{addr}.json'
        path.parent.mkdir(exist_ok=True)
        marker = str(self.home / 'inbox' / f'{addr}.json') if inbox is None else str(inbox)
        path.write_text(json.dumps(dict(address=addr, role=role, family=family,
                                       parent=parent, inbox=marker if role != 'worker' else '')))

    def send(self, kind='request', *extra, ok=True):
        return self.run_tool('team', 'send', '--from', 'sender', '--to', 'receiver',
                             '--kind', kind, '--task', 't1', '--headline', 'hello 世界',
                             '--recheck-seconds', '0', *extra, ok=ok)

    def rows(self, result):
        return [json.loads(line) for line in result.stdout.splitlines()]

    def reply(self, row, kind='done', *extra, ok=True):
        self.env['KILN_SEAT'] = str(self.home / 'seats/receiver.json')
        try:
            return self.send(kind, '--from', 'receiver', '--to', 'sender', '--cites', row['id'], *extra, ok=ok)
        finally:
            self.env['KILN_SEAT'] = str(self.home / 'seats/sender.json')

    def test_row_format_and_live_claude_listener_no_nudge(self):
        row = self.rows(self.send())[0]
        self.assertEqual(set(row), {'id', 'from', 'to', 'kind', 'task', 'headline', 'path', 'time', 'cites'})
        self.assertRegex(row['id'], r'^\d{8}T\d{12}Z-[0-9a-f]{4}$')
        self.assertEqual(row['from'], 'sender')
        self.assertEqual(row['headline'], 'hello 世界')
        self.assertIsNone(row['path'])
        self.assertEqual(self.calls(), [])

    def test_claude_absent_or_dead_listener_nudges_once(self):
        marker = self.home / 'listeners/receiver.pid'
        for value, state in ((None, 'idle'), ('2147483647', 'done'), ('invalid', 'idle')):
            with self.subTest(value=value):
                if value is None:
                    marker.unlink()
                else:
                    marker.write_text(value)
                self.env['FAKE_STATES'] = state
                before = len(self.calls())
                self.send()
                self.assertEqual(self.calls()[before:], [['agent', 'get', 'receiver'],
                                                         ['agent', 'prompt', 'receiver', 'inbox']])

    def test_claude_expired_listener_busy_recheck_and_receipt(self):
        (self.home / 'listeners/receiver.pid').unlink()
        self.env['FAKE_STATES'] = 'working,idle'
        self.send()
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver']] * 2 +
                                      [['agent', 'prompt', 'receiver', 'inbox']])
        self.log.unlink()
        self.env['FAKE_MARK'] = '1'
        self.send()
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver']] * 2)

    def test_claude_missing_listener_nudge_failure_never_retried(self):
        (self.home / 'listeners/receiver.pid').unlink()
        self.env['FAKE_FAIL'] = 'agent prompt'
        self.assertIn('nudge failed', self.send().stderr)
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver'], ['agent', 'prompt', 'receiver', 'inbox']])
        self.assertEqual(len(self.rows(self.run_tool('team', 'ledger'))), 1)

    def test_claude_listener_armed_during_busy_recheck_suppresses_nudge(self):
        loader = importlib.machinery.SourceFileLoader('kiln_team', str(PLUGIN / 'bin/team'))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        marker = self.home / 'listeners/receiver.pid'
        marker.unlink()
        receiver = dict(address='receiver', family='claude', inbox=str(self.base / 'marker.json'))
        def arm(_):
            marker.write_text(str(self.listener.pid))
        with patch.object(module, 'herdr', side_effect=[{'agent': {'agent_status': 'working'}},
                                                      {'agent': {'agent_status': 'idle'}}]) as herdr:
            with patch.object(module.time, 'sleep', side_effect=arm):
                module.nudge(self.home, receiver, {'id': 'row'}, 0)
        self.assertEqual(herdr.call_count, 2)

    def test_listener_pid_reused_by_unrelated_process_does_not_suppress_nudge(self):
        (self.home / 'listeners/receiver.pid').write_text(str(os.getpid()))
        self.send()
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver'], ['agent', 'prompt', 'receiver', 'inbox']])

    def test_identity_and_worker_rules(self):
        self.send('update', '--from', 'impostor', ok=False)
        self.seat('sender', role='worker', parent='launcher')
        for kind in ('request', 'done', 'answer', 'update'):
            self.send(kind, ok=False)
        self.send('question')
        self.seat('receiver', role='worker')
        self.send('question', ok=False)
        self.assertEqual(len((self.home / 'ledger.jsonl').read_text().splitlines()), 1)

    def test_missing_seats_identity_and_invalid_address(self):
        self.send('request', '--to', 'missing', ok=False)
        self.send('request', '--to', '../sender', ok=False)
        del self.env['KILN_SEAT']
        self.send(ok=False)
        self.assertFalse((self.home / 'ledger.jsonl').exists())

    def test_completion_requires_request_or_question(self):
        self.send('done', ok=False)
        update = self.rows(self.send('update'))[0]
        self.send('answer', '--cites', update['id'], ok=False)
        self.send('done', '--cites', 'missing', ok=False)
        request = self.rows(self.send())[0]
        self.send('done', '--cites', request['id'], ok=False)
        self.reply(request, 'done', '--path', '/result.md')
        question = self.rows(self.send('question'))[0]
        self.reply(question, 'answer')
        self.assertEqual(self.rows(self.run_tool('team', 'overdue')), [])

    def test_inbox_receipt_does_not_complete_and_new_row_is_unread(self):
        first = self.rows(self.send())[0]
        self.env['KILN_SEAT'] = str(self.home / 'seats/receiver.json')
        self.assertEqual(self.rows(self.run_tool('team', 'inbox')), [first])
        self.assertEqual(self.rows(self.run_tool('team', 'inbox', '--mark')), [first])
        self.assertEqual(self.rows(self.run_tool('team', 'inbox')), [])
        self.assertEqual(self.rows(self.run_tool('team', 'overdue')), [first])
        self.env['KILN_SEAT'] = str(self.home / 'seats/sender.json')
        second = self.rows(self.send())[0]
        self.env['KILN_SEAT'] = str(self.home / 'seats/receiver.json')
        self.assertEqual(self.rows(self.run_tool('team', 'inbox', '--mark')), [second])
        # A replacement using the same address inherits receipt state.
        replacement = self.base / 'replacement.json'
        replacement.write_text((self.home / 'seats/receiver.json').read_text())
        self.env['KILN_SEAT'] = str(replacement)
        self.assertEqual(self.rows(self.run_tool('team', 'inbox')), [])

    def test_overdue_age_and_ledger_tail(self):
        row = self.rows(self.send())[0]
        self.assertEqual(self.rows(self.run_tool('team', 'overdue', '--minutes', '10')), [])
        row['time'] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=11)).isoformat()
        (self.home / 'ledger.jsonl').write_text(json.dumps(row) + '\n')
        latest = self.rows(self.send('update'))[0]
        self.assertEqual(self.rows(self.run_tool('team', 'overdue', '--minutes', '10')), [row])
        self.assertEqual(self.rows(self.run_tool('team', 'ledger', '--tail', '1')), [latest])
        self.assertEqual(self.rows(self.run_tool('team', 'ledger', '--tail', '0')), [])
        self.run_tool('team', 'ledger', '--tail', '-1', ok=False)

    def test_codex_idle_and_done_nudge(self):
        self.seat('receiver', family='codex')
        for state in ('idle', 'done'):
            self.env['FAKE_STATES'] = state
            self.send()
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver'], ['agent', 'prompt', 'receiver', 'inbox']] * 2)

    def test_busy_recheck_once(self):
        self.seat('receiver', family='codex')
        self.env['FAKE_STATES'] = 'working,idle'
        self.send()
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver']] * 2 + [['agent', 'prompt', 'receiver', 'inbox']])

    def test_busy_read_during_delay_no_nudge(self):
        self.seat('receiver', family='codex')
        self.env.update(FAKE_STATES='working,done', FAKE_MARK='1')
        self.send()
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver']] * 2)

    def test_still_working_or_blocked_no_nudge(self):
        self.seat('receiver', family='codex')
        self.env['FAKE_STATES'] = 'working'
        self.send()
        self.assertEqual(len(self.calls()), 2)
        self.env['FAKE_STATES'] = 'blocked'
        self.send()
        self.assertEqual(self.calls()[-1], ['agent', 'get', 'receiver'])
        self.assertEqual(len(self.calls()), 3)

    def test_failed_nudge_reported_without_retry_or_row_loss(self):
        self.seat('receiver', family='codex')
        self.env['FAKE_FAIL'] = 'agent prompt'
        result = self.send()
        self.assertIn('nudge failed', result.stderr)
        self.assertEqual(len(self.calls()), 2)
        self.assertEqual(len(self.rows(self.run_tool('team', 'ledger'))), 1)

    def test_failed_status_check_is_reported_once(self):
        self.seat('receiver', family='codex')
        self.env['FAKE_FAIL'] = 'agent get'
        self.assertIn('nudge failed', self.send().stderr)
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver']])

    def test_stalled_nudge_is_bounded_and_never_retried(self):
        loader = importlib.machinery.SourceFileLoader('kiln_team', str(PLUGIN / 'bin/team'))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        receiver = dict(address='receiver', family='codex', inbox=str(self.base / 'marker.json'))
        ready = subprocess.CompletedProcess([], 0, '{"result":{"agent":{"agent_status":"idle"}}}', '')
        stalled = subprocess.TimeoutExpired(['herdr'], 30)
        errors = io.StringIO()
        with patch.object(module.subprocess, 'run', side_effect=[ready, stalled]) as run:
            with contextlib.redirect_stderr(errors):
                module.nudge(self.home, receiver, {'id': 'saved-row'}, 0)
        self.assertEqual(run.call_count, 2)
        self.assertTrue(all(call.kwargs['timeout'] == 30 for call in run.call_args_list))
        self.assertIn('saved-row saved; nudge failed', errors.getvalue())

    def test_concurrent_appends(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda _: self.send(), range(24)))
        rows = self.rows(self.run_tool('team', 'ledger'))
        self.assertEqual(len(rows), 24)
        self.assertEqual(len({r['id'] for r in rows}), 24)

    def test_reply_recipient_and_non_reply_citations(self):
        row = self.rows(self.send())[0]
        self.seat('third')
        self.reply(row, 'done', '--to', 'third', ok=False)
        for kind in ('request', 'question', 'update'):
            self.send(kind, '--cites', row['id'], ok=False)
        self.assertEqual(len(self.rows(self.run_tool('team', 'ledger'))), 1)

    def test_overdue_includes_unanswered_questions(self):
        question = self.rows(self.send('question'))[0]
        self.assertEqual(self.rows(self.run_tool('team', 'overdue')), [question])
        self.reply(question, 'answer')
        self.assertEqual(self.rows(self.run_tool('team', 'overdue')), [])

    def test_custom_inbox_path_used_for_receipts_and_nudges(self):
        custom = self.base / 'custom' / 'receipts.json'
        self.seat('receiver', inbox=custom)
        row = self.rows(self.send())[0]
        self.env['KILN_SEAT'] = str(self.home / 'seats/receiver.json')
        self.run_tool('team', 'inbox', '--mark')
        self.assertEqual(json.loads(custom.read_text()), {'read': [row['id']]})
        self.assertFalse((self.home / 'inbox/receiver.json').exists())
        self.env['KILN_SEAT'] = str(self.home / 'seats/sender.json')
        # A fake status check marks the new row at the declared path.
        self.seat('receiver', family='codex', inbox=custom)
        self.env.update(FAKE_STATES='working,idle', FAKE_MARK='1')
        self.send()
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver']] * 2)

    def test_pending_is_derived_from_receipts_and_completions(self):
        request = self.rows(self.send())[0]
        question = self.rows(self.send('question'))[0]
        self.env['KILN_SEAT'] = str(self.home / 'seats/receiver.json')
        self.assertEqual(self.rows(self.run_tool('team', 'pending')), [])
        self.run_tool('team', 'inbox', '--mark')
        self.assertEqual(self.rows(self.run_tool('team', 'pending')), [request, question])
        self.reply(request)
        update = self.rows(self.send('update'))[0]
        self.env['KILN_SEAT'] = str(self.home / 'seats/receiver.json')
        self.assertEqual(self.rows(self.run_tool('team', 'pending')), [question])
        self.run_tool('team', 'inbox', '--mark')
        self.assertEqual(self.rows(self.run_tool('team', 'pending')), [question])

    def test_workers_are_seats_with_matching_parent(self):
        self.seat('impl', role='worker', parent='sender')
        self.seat('helper', role='helper', parent='sender')
        self.seat('other', role='worker', parent='receiver')
        rows = self.rows(self.run_tool('team', 'workers'))
        self.assertEqual([r['address'] for r in rows], ['helper', 'impl'])
        path = self.home / 'seats/impl.json'
        path.unlink()
        self.assertEqual([r['address'] for r in self.rows(self.run_tool('team', 'workers'))], ['helper'])

    def test_corrupt_and_torn_lines_are_reported_without_losing_appends(self):
        first = self.rows(self.send())[0]
        with (self.home / 'ledger.jsonl').open('ab') as stream:
            stream.write(b'not-json\n\xff\n{"id":')
        sent = self.send('question')
        self.assertIn('skipping ledger line 2', sent.stderr)
        self.assertIn('skipping ledger line 3', sent.stderr)
        self.assertIn('skipping ledger line 4', sent.stderr)
        latest = self.rows(sent)[0]
        self.assertEqual(self.rows(self.run_tool('team', 'ledger')), [first, latest])

    def test_missing_environment_messages_and_recheck_default(self):
        self.env.pop('KILN_SEAT')
        self.assertIn('KILN_SEAT is required', self.send(ok=False).stderr)
        self.env.pop('KILN_HOME')
        self.assertIn('KILN_HOME is required', self.run_tool('team', 'ledger', ok=False).stderr)
        self.assertIn('default: 5', self.run_tool('team', 'send', '--help').stdout)

    def test_help_without_environment(self):
        self.env.pop('KILN_HOME')
        self.run_tool('team', '--help')

    def test_close_worker_is_idempotent_and_persistent_requires_force(self):
        self.seat('impl', role='worker', parent='sender')
        self.run_tool('team', 'close', 'impl')
        self.run_tool('team', 'close', 'impl')
        self.assertEqual(self.rows(self.run_tool('team', 'workers')), [])
        self.assertFalse((self.home / 'seats/impl.json').exists())
        self.run_tool('team', 'close', 'receiver', ok=False)
        self.assertTrue((self.home / 'seats/receiver.json').exists())
        self.run_tool('team', 'close', 'receiver', '--force')
        self.assertFalse((self.home / 'seats/receiver.json').exists())
        self.run_tool('team', 'close', '../sender', '--force', ok=False)
        self.assertTrue((self.home / 'seats/sender.json').exists())
        self.assertEqual(self.calls(), [])

    def test_workers_tolerate_a_missing_parent(self):
        self.seat('impl', role='worker', parent='sender')
        path = self.home / 'seats/receiver.json'
        data = json.loads(path.read_text())
        del data['parent']
        path.write_text(json.dumps(data))
        self.assertEqual([row['address'] for row in self.rows(self.run_tool('team', 'workers'))], ['impl'])

    def test_headlines_are_one_line_and_length_only_warns(self):
        for headline in ('two\nlines', 'two\rlines', 'trailing\n'):
            self.send('request', '--headline', headline, ok=False)
        self.assertFalse((self.home / 'ledger.jsonl').exists())
        self.assertNotIn('warning', self.send('request', '--headline', 'x' * 100).stderr)
        result = self.send('request', '--headline', 'x' * 101)
        self.assertIn('warning', result.stderr)
        self.assertEqual(self.rows(result)[0]['headline'], 'x' * 101)

    def test_filters_tolerate_missing_row_keys(self):
        rows = [dict(id='no-to', kind='question', time='2026-10-29T00:00:00+00:00'),
                dict(id='no-kind', to='receiver'), dict(id='no-cites', kind='done', to='receiver'), {}]
        (self.home / 'ledger.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows))
        self.assertEqual(self.rows(self.run_tool('team', 'overdue')), [rows[0]])
        self.env['KILN_SEAT'] = str(self.home / 'seats/receiver.json')
        self.assertEqual(self.rows(self.run_tool('team', 'inbox', '--mark')), rows[1:3])
        self.assertEqual(self.rows(self.run_tool('team', 'pending')), [])
        self.env['KILN_SEAT'] = str(self.home / 'seats/sender.json')
        self.send()

    def test_answer_to_worker_question_goes_to_its_parent(self):
        self.seat('sender', role='worker', parent='launcher')
        self.seat('launcher')
        question = self.rows(self.send('question'))[0]
        self.assertEqual(question['via'], 'launcher')
        # Closing or reparenting the worker must not change this row's route.
        self.seat('sender', role='worker', parent='other')
        (self.home / 'seats/sender.json').unlink()
        self.reply(question, 'answer', '--to', 'launcher')
        self.reply(question, 'answer', '--to', 'sender', ok=False)
        self.seat('other')
        self.reply(question, 'answer', '--to', 'other', ok=False)
        self.seat('impostor')
        self.env['KILN_SEAT'] = str(self.home / 'seats/impostor.json')
        self.send('answer', '--from', 'impostor', '--to', 'launcher', '--cites', question['id'], ok=False)
        rows = self.rows(self.run_tool('team', 'ledger'))
        self.assertEqual(len(rows), 2)
        self.assertEqual((rows[-1]['to'], rows[-1]['cites']), ('launcher', question['id']))

    def test_worker_send_never_contacts_herdr_or_reports_nudge_failure(self):
        self.seat('sender', role='worker', parent='launcher')
        self.seat('receiver', family='codex')
        self.env['FAKE_FAIL'] = 'agent get'
        result = self.send('question')
        self.assertEqual(result.stderr, '')
        self.assertEqual(len(self.rows(result)), 1)
        self.assertEqual(self.calls(), [])

    def worker_question(self, to='receiver'):
        self.seat('sender', role='worker', parent='launcher')
        self.seat('launcher')
        question = self.rows(self.send('question', '--to', to))[0]
        self.env['KILN_SEAT'] = str(self.home / 'seats/launcher.json')
        return question

    def test_relay_uses_stored_launcher_and_nudges_once_without_appending(self):
        self.seat('receiver', family='codex')
        question = self.worker_question()
        (self.home / 'seats/sender.json').unlink()
        self.env['FAKE_STATES'] = 'working,idle'
        self.run_tool('team', 'relay', question['id'], '--recheck-seconds', '0')
        self.assertEqual(self.calls(), [['agent', 'get', 'receiver'], ['agent', 'get', 'receiver'],
                                       ['agent', 'prompt', 'receiver', 'inbox']])
        self.assertEqual(self.rows(self.run_tool('team', 'ledger')), [question])

    def test_relay_to_self_is_noop_and_wrong_caller_or_row_is_refused(self):
        question = self.worker_question(to='launcher')
        self.assertIn('no relay needed', self.run_tool('team', 'relay', question['id']).stdout)
        self.env['KILN_SEAT'] = str(self.home / 'seats/sender.json')
        self.assertIn('workers may not relay', self.run_tool('team', 'relay', question['id'], ok=False).stderr)
        self.env['KILN_SEAT'] = str(self.home / 'seats/receiver.json')
        self.run_tool('team', 'relay', question['id'], ok=False)
        self.env['KILN_SEAT'] = str(self.home / 'seats/launcher.json')
        self.run_tool('team', 'relay', 'missing', ok=False)
        self.run_tool('team', 'relay', question['id'], '--recheck-seconds', '-1', ok=False)
        self.assertEqual(self.calls(), [])

    def test_relay_respects_receipts_and_reports_failed_nudge_once(self):
        self.seat('receiver', family='codex')
        question = self.worker_question()
        self.env['FAKE_FAIL'] = 'agent prompt'
        result = self.run_tool('team', 'relay', question['id'])
        self.assertIn('nudge failed', result.stderr)
        self.assertEqual(len(self.calls()), 2)
        inbox = self.home / 'inbox/receiver.json'
        inbox.parent.mkdir(exist_ok=True)
        inbox.write_text(json.dumps({'read': [question['id']]}))
        self.run_tool('team', 'relay', question['id'])
        self.assertEqual(self.calls()[-1], ['agent', 'get', 'receiver'])
        self.assertEqual(len(self.calls()), 3)

    def test_launcher_self_answer_is_received_at_send_and_remains_in_ledger(self):
        question = self.worker_question(to='launcher')
        marker = self.base / 'custom-inbox/launcher.json'
        self.seat('launcher', inbox=str(marker))
        self.assertEqual(self.rows(self.run_tool('team', 'inbox', '--mark')), [question])
        self.assertEqual(self.calls(), [])
        result = self.send('answer', '--from', 'launcher', '--to', 'launcher', '--cites', question['id'])
        answer = self.rows(result)[0]
        self.assertEqual(set(json.loads(marker.read_text())['read']), {question['id'], answer['id']})
        self.assertEqual(self.rows(self.run_tool('team', 'inbox')), [])
        self.assertEqual(self.rows(self.run_tool('team', 'pending')), [])
        self.assertEqual(self.rows(self.run_tool('team', 'ledger')), [question, answer])
        self.assertEqual(self.calls(), [])

    def test_worker_sender_defaults_to_seat_identity(self):
        self.seat('sender', role='worker', parent='launcher')
        result = self.run_tool('team', 'send', '--to', 'receiver', '--kind', 'question',
                               '--task', 't1', '--headline', 'Need a ruling', '--path', '/question.md')
        row = self.rows(result)[0]
        self.assertEqual((row['from'], row['via']), ('sender', 'launcher'))
        self.assertEqual(self.calls(), [])
        self.send('question', '--from', 'impostor', ok=False)


if __name__ == '__main__':
    unittest.main()
