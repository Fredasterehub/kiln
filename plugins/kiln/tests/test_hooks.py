"""Isolated hook tests: no CLI/model/Herdr process is invoked.

STOP_INPUTS preserve the fields observed in envtest-20261029 (IDs and paths
replaced). SessionStart/PreToolUse extend them with the documented event fields.
"""
import inspect
import contextlib
import io
import json
import os
import runpy
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

HOOKS = Path(__file__).resolve().parents[1] / 'hooks'
STOP_INPUTS = {
    'claude': dict(session_id='claude-session', transcript_path='/recorded/claude.jsonl',
                   cwd='/recorded/project', scratchpad_dir='/recorded/scratchpad',
                   prompt_id='prompt', permission_mode='bypassPermissions', effort={'level': 'low'},
                   hook_event_name='Stop', stop_hook_active=False, last_assistant_message='ok',
                   background_tasks=[], session_crons=[]),
    'codex': dict(session_id='codex-session', turn_id='turn', transcript_path='/recorded/codex.jsonl',
                  cwd='/recorded/project', hook_event_name='Stop', model='gpt-6.1-sol',
                  permission_mode='bypassPermissions', stop_hook_active=False, last_assistant_message='ok'),
}


class HookTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.root = self.home / 'root'
        self.root.mkdir()
        self.extra = self.home / 'run'
        self.extra.mkdir()
        (self.home / 'seats').mkdir()
        self.seatpath = self.home / 'seats/build.json'
        self.seat = dict(address='build', role='manager', family='claude', pane='w4:p1',
                         root=str(self.root), run=str(self.root), extra_roots=[str(self.extra)],
                         inbox=str(self.home / 'inbox/build.json'), tab='build', parent='super',
                         workspace='w4', model='claude-opus-5-5', effort='medium', wait_ms=1800000)
        self.env = dict(os.environ, KILN_HOME=str(self.home), KILN_SEAT=str(self.seatpath), HERDR_PANE_ID='w4:p1', KILN_PLUGIN=str(HOOKS.parent))
        self.save()

    def save(self, **updates):
        self.seat.update(updates)
        self.seatpath.write_text(json.dumps(self.seat))

    def child(self, address, parent='build', pane=None, role='worker'):
        run = self.home / 'runs' / address
        run.mkdir(parents=True, exist_ok=True)
        child = self.seat | dict(address=address, parent=parent, pane=pane or address + '-pane',
                                 role=role, inbox='', run=str(run))
        (self.home / 'seats' / f'{address}.json').write_text(json.dumps(child))
        return run

    def row(self, id='r1', kind='request', to='build', **updates):
        return dict(id=id, kind=kind, to=to, **{'from': 'super'}, task='task',
                    headline='work', path=None, time='2026-10-29T00:00:00+00:00', cites=None) | updates

    def rows(self, *rows, read=()):
        (self.home / 'ledger.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
        (self.home / 'inbox').mkdir(exist_ok=True)
        (self.home / 'inbox/build.json').write_text(json.dumps({'read': list(read)}))

    def run_hook(self, event='stop', family=None, payload=None, env=None):
        if family:
            self.save(family=family)
        data = dict(STOP_INPUTS[self.seat['family']], cwd=str(self.root))
        data['hook_event_name'] = dict(stop='Stop', start='SessionStart', fence='PreToolUse', listen='Stop')[event]
        if event == 'start':
            data['source'] = 'startup'
        data.update(payload or {})
        return subprocess.run(['sh', str(HOOKS / f'{event}.sh')], input=json.dumps(data),
                              text=True, capture_output=True, env=self.env if env is None else env, timeout=5)

    def allowed(self, result):
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))

    def blocked(self, result, event='stop'):
        self.assertEqual((result.returncode, result.stderr), (0, ''))
        data = json.loads(result.stdout)
        if event == 'stop':
            self.assertEqual(data['decision'], 'block')
            return data['reason']
        specific = data['hookSpecificOutput']
        self.assertEqual(specific['hookEventName'], 'PreToolUse')
        self.assertEqual(specific['permissionDecision'], 'deny')
        return specific['permissionDecisionReason']

    def advisory(self, result):
        self.assertEqual((result.returncode, result.stderr), (0, ''))
        data = json.loads(result.stdout)
        self.assertNotIn('decision', data)
        self.assertNotIn('continue', data)
        self.assertNotIn('hookSpecificOutput', data)
        return data['reason']

    def fence(self, tool, data, **kw):
        return self.run_hook('fence', payload=dict(tool_name=tool, tool_input=data), **kw)

    def test_no_seat_no_output_or_state_all_scripts(self):
        for event in ('stop', 'start', 'fence', 'listen'):
            for env in ({}, {'KILN_SEAT': str(self.home / 'missing'), 'KILN_HOME': str(self.home)}):
                with self.subTest(event=event, env=env):
                    self.allowed(self.run_hook(event, env=env))
        self.assertFalse((self.home / 'hooks.log').exists())
        self.assertFalse((self.home / 'ledger.lock').exists())

    def test_pane_mismatch_and_missing_env_are_silent(self):
        for pane in ('other', ''):
            env = dict(self.env, HERDR_PANE_ID=pane)
            for event in ('stop', 'start', 'fence', 'listen'):
                self.allowed(self.run_hook(event, env=env))
        self.assertFalse((self.home / 'hooks.log').exists())
        self.assertFalse((self.home / 'ledger.lock').exists())

    def test_empty_stop_both_families(self):
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family))

    def test_unread_exact_ids_and_no_implicit_receipt(self):
        for family in STOP_INPUTS:
            self.rows(self.row(), self.row('r2', 'update'), self.row('other', to='plan'))
            before = (self.home / 'inbox/build.json').read_bytes()
            reason = self.blocked(self.run_hook(family=family))
            self.assertIn('r1, r2', reason)
            self.assertIn('team inbox --mark', reason)
            self.assertNotIn('other', reason)
            self.assertEqual(before, (self.home / 'inbox/build.json').read_bytes())

    def test_stop_hook_active_never_refuses_twice(self):
        self.rows(self.row())
        marker = self.home / 'inbox/build.json'
        before = marker.read_bytes()
        for family in STOP_INPUTS:
            result = self.run_hook(family=family, payload={'stop_hook_active': True})
            if family == 'codex':
                self.allowed(result)
            else:
                reason = self.advisory(result)
                self.assertIn('Unread rows r1', reason)
                self.assertIn('inbox --mark', reason)
            self.assertEqual(marker.read_bytes(), before)

    def test_workers_always_stop_and_never_start_or_listen(self):
        self.rows(self.row())
        for family in STOP_INPUTS:
            for role in ('worker',):
                self.save(role=role)
                self.child('w')
                for event in ('stop', 'start', 'listen'):
                    self.allowed(self.run_hook(event, family=family))
        self.assertFalse((self.home / 'listeners').exists())

    def test_all_persistent_roles_get_unread_refusal(self):
        self.rows(self.row())
        for role in ('director', 'super', 'manager', 'helper', 'chunkmaster'):
            self.save(role=role)
            self.blocked(self.run_hook())

    def test_pending_question_may_stop(self):
        self.rows(self.row(kind='question', to='plan'), self.row('q2', kind='question'), read=['q2'])
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family))

    def test_received_unfinished_request_may_stop(self):
        self.rows(self.row(), read=['r1'])
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family))

    def test_worker_without_wait_and_with_live_wait(self):
        self.child('build-impl')
        for family in STOP_INPUTS:
            reason = self.blocked(self.run_hook(family=family))
            self.assertIn('build-impl', reason)
            self.assertIn('herdr agent wait build-impl --timeout 1800000', reason)
            self.assertEqual('run_in_background: true' in reason, family == 'claude')
            self.assertFalse(reason.endswith('&'))
        (self.home / 'waits').mkdir()
        (self.home / 'waits/build-impl.pid').write_text(str(os.getpid()))
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family))

    def test_stale_invalid_nonpositive_wait_pid_is_unarmed(self):
        self.child('w')
        (self.home / 'waits').mkdir()
        for value in ('2147483647', 'garbage', '0', '-1'):
            (self.home / 'waits/w.pid').write_text(value)
            self.assertIn('Worker w', self.blocked(self.run_hook()))

    def test_exited_wait_no_longer_armed(self):
        self.child('w')
        (self.home / 'waits').mkdir()
        process = subprocess.Popen(['sh', '-c', 'exit 0'])
        self.addCleanup(lambda: process.wait())
        (self.home / 'waits/w.pid').write_text(str(process.pid))
        time.sleep(0.05)
        self.blocked(self.run_hook())  # Includes zombie, before wait() reaps it.
        process.wait()
        self.blocked(self.run_hook())

    def test_received_finished_result_does_not_require_done(self):
        (self.extra / 'status.txt').write_text('12:34 done: worker proof\n')
        self.rows(self.row(path=str(self.extra)), read=['r1'])
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family))

    def test_received_finished_directory_is_a_card_obligation(self):
        (self.extra / 'status.txt').write_text('12:34 done: worker proof\n')
        self.rows(self.row(path=str(self.extra)), read=['r1'])
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family))

    def test_question_status_or_unreceived_result_never_adds_done_refusal(self):
        status = self.extra / 'status.txt'
        status.write_text('12:34 done: old\n12:35 question: #q1\n')
        self.rows(self.row(path=str(self.extra)), read=['r1'])
        self.allowed(self.run_hook())
        status.write_text('12:36 done:\n')
        self.rows(self.row(path=str(self.extra)))
        reason = self.blocked(self.run_hook())
        self.assertNotIn('Finished request', reason)

    def test_rotation_only_blocks_old_session(self):
        directory = self.home / 'rotations'
        directory.mkdir()
        for family in STOP_INPUTS:
            for old_session, acked, blocks in (('old-session', False, True), ('replacement', False, False), ('old-session', True, False)):
                (directory / 'build.json').write_text(json.dumps(dict(old_session=old_session, old_pane='w4:p1', acked=acked)))
                result = self.run_hook(family=family, payload={'session_id': 'old-session'})
                if blocks:
                    self.assertIn('Rotation of session old-session', self.blocked(result))
                else:
                    self.allowed(result)

    def test_replacement_ignores_old_rotation_but_handles_unread(self):
        (self.home / 'rotations').mkdir()
        (self.home / 'rotations/build.json').write_text(json.dumps(dict(old_pane='old', old_session='old-session', acked=False)))
        self.rows(self.row())
        for family in STOP_INPUTS:
            reason = self.blocked(self.run_hook(family=family))
            self.assertIn('Unread rows r1', reason)
            self.assertNotIn('Rotation', reason)

    def test_start_native_context_card_handoff_pending(self):
        card, handoff = self.home / 'card.md', self.home / 'handoff.md'
        card.write_text('ROLE CARD: build root inbox parent')
        handoff.write_text('HANDOFF open item')
        self.save(card=str(card), handoff=str(handoff))
        self.rows(self.row(), self.row('unread'), self.row('complete'),
                  self.row('d1', kind='answer', to='super', cites='complete'),
                  self.row('update-id', kind='update'), read=['r1', 'complete', 'update-id'])
        for family in STOP_INPUTS:
            result = self.run_hook('start', family=family)
            self.assertEqual((result.returncode, result.stderr), (0, ''))
            output = json.loads(result.stdout)['hookSpecificOutput']
            self.assertEqual(output['hookEventName'], 'SessionStart')
            context = output['additionalContext']
            self.assertIn(card.read_text(), context)
            self.assertIn(handoff.read_text(), context)
            self.assertIn('Pending ids: r1', context)
            self.assertNotIn('unread', context)
            self.assertNotIn('complete', context)
            self.assertNotIn('update-id', context)
            self.assertIn('this is enough; read rules, ledger and panes only where an item points you', context)

    def test_start_missing_optional_files(self):
        self.save(card=str(self.home / 'missing'), handoff=str(self.home / 'missing2'))
        context = json.loads(self.run_hook('start').stdout)['hookSpecificOutput']['additionalContext']
        self.assertIn('Pending ids: none', context)

    def test_wait_timeout_required_in_both_families(self):
        for family in STOP_INPUTS:
            for command in ('herdr agent wait w', 'herdr pane wait-output p'):
                reason = self.blocked(self.fence('Bash', {'command': command}, family=family), 'fence')
                self.assertTrue(reason.startswith('Bash:'))
                self.assertIn('--timeout', reason)
            self.allowed(self.fence('Bash', {'command': 'herdr pane wait-output p --timeout=1800000', 'run_in_background': True}, family=family))

    def test_claude_native_background_waits_codex_foreground(self):
        for wait in ('agent wait w', 'pane wait-output p'):
            command = 'herdr ' + wait + ' --timeout 1800000'
            self.blocked(self.fence('Bash', {'command': command}), 'fence')
            self.blocked(self.fence('Bash', {'command': command + ' &'}), 'fence')
            self.allowed(self.fence('Bash', {'command': command, 'run_in_background': True}))
            self.allowed(self.fence('Bash', {'command': command}, family='codex'))
            self.save(family='claude')

    def test_bash_fence_only_four_roles(self):
        for role in ('director', 'super', 'manager', 'chunkmaster', 'helper', 'worker'):
            self.save(role=role)
            result = self.fence('Bash', {'command': 'herdr agent wait w'})
            if role in ('helper', 'worker'):
                self.allowed(result)
            else:
                self.blocked(result, 'fence')

    def test_typing_only_to_workers_and_never_director(self):
        self.child('build-impl', pane='w4:p3')
        self.child('director', pane='w4:p9')
        for family in STOP_INPUTS:
            for prefix, good, bad in (('herdr agent prompt', 'build-impl', 'director'),
                                       ('herdr pane send-text', 'w4:p3', 'w4:p9'),
                                       ('herdr pane send-keys', 'w4:p3', 'unowned')):
                self.allowed(self.fence('Bash', {'command': f'{prefix} {good} hello'}, family=family))
                reason = self.blocked(self.fence('Bash', {'command': f'{prefix} {bad} hello'}, family=family), 'fence')
                self.assertIn(bad, reason)
                self.assertIn('worker', reason)

    def test_tool_write_roots_for_all_roles_claude(self):
        for role in ('director', 'super', 'manager', 'chunkmaster', 'helper', 'worker'):
            self.save(role=role)
            for tool in ('Edit', 'Write'):
                for path in ('file.txt', str(self.extra / 'file.txt')):
                    self.allowed(self.fence(tool, {'file_path': path}))
                reason = self.blocked(self.fence(tool, {'file_path': str(self.home / 'outside')}), 'fence')
                self.assertTrue(reason.startswith(tool + ':'))

    def test_path_traversal_sibling_prefix_and_symlink_denied(self):
        (self.root / 'escape').symlink_to(self.home, target_is_directory=True)
        for value in ('../outside', str(self.root) + '-other/file', 'escape/outside'):
            self.blocked(self.fence('Write', {'file_path': value}), 'fence')

    def test_codex_apply_patch_all_operations_and_move_target(self):
        for role in ('worker', 'manager'):
            self.save(role=role)
            for operation in ('Add File', 'Update File', 'Delete File'):
                self.allowed(self.fence('apply_patch', {'command': f'*** Begin Patch\n*** {operation}: okay\n*** End Patch'}, family='codex'))
                reason = self.blocked(self.fence('apply_patch', {'command': f'*** Begin Patch\n*** {operation}: ../outside\n*** End Patch'}, family='codex'), 'fence')
                self.assertTrue(reason.startswith('apply_patch:'))
        self.blocked(self.fence('apply_patch', {'command': '*** Begin Patch\n*** Update File: okay\n*** Move to: ../outside\n*** End Patch'}, family='codex'), 'fence')
        self.allowed(self.fence('apply_patch', {'command': f'*** Begin Patch\n*** Add File: {self.extra}/ok\n*** End Patch'}, family='codex'))

    def test_everything_else_allowed_no_poll_or_shell_write_policy(self):
        for family in STOP_INPUTS:
            for command in ('echo herdr agent wait w', "echo 'herdr agent prompt director hi'", 'while true; do sleep 1; done', 'echo text > /outside', 'herdr agent get w'):
                self.allowed(self.fence('Bash', {'command': command}, family=family))
            self.allowed(self.fence('Read', {'file_path': '/outside'}, family=family))

    def test_compound_wait_does_not_borrow_later_timeout(self):
        self.blocked(self.fence('Bash', {'command': 'herdr agent wait w; echo --timeout'}), 'fence')
        self.blocked(self.fence('Bash', {'command': 'true && herdr agent wait w'}), 'fence')
        self.blocked(self.fence('Bash', {'command': 'true\nherdr agent wait w'}), 'fence')
        self.blocked(self.fence('Bash', {'command': 'herdr agent wait w\necho --timeout'}), 'fence')

    def test_errors_fail_open_with_exactly_one_log_line(self):
        for event in ('stop', 'start', 'fence', 'listen'):
            result = subprocess.run(['sh', str(HOOKS / f'{event}.sh')], input='{broken',
                                    capture_output=True, text=True, env=self.env)
            self.allowed(result)
        lines = (self.home / 'hooks.log').read_text().splitlines()
        self.assertEqual(len(lines), 4)
        self.assertTrue(all('error' in json.loads(line)['outcome'] for line in lines))

    def test_bad_ledger_skipped_and_missing_tool_fields_fail_open(self):
        self.rows(self.row())
        with (self.home / 'ledger.jsonl').open('a') as stream:
            stream.write('{broken\n')
        self.assertIn('Unread rows r1', self.blocked(self.run_hook()))
        self.allowed(self.fence('Write', {}))
        lines = [json.loads(line) for line in (self.home / 'hooks.log').read_text().splitlines()]
        self.assertEqual(lines[0]['bad_lines'], 1)
        self.assertIn('error', lines[1]['outcome'])

    def test_allows_are_silent_card_metrics_and_refusals_logged(self):
        self.allowed(self.run_hook())
        self.allowed(self.fence('Read', {'file_path': '/outside'}))
        self.assertFalse((self.home / 'hooks.log').exists())
        self.run_hook('start')
        self.rows(self.row())
        self.blocked(self.run_hook())
        lines = [json.loads(line) for line in (self.home / 'hooks.log').read_text().splitlines()]
        self.assertEqual([line['event'] for line in lines], ['start', 'stop'])
        self.assertIn('card_lines', lines[0])

    def test_listener_existing_unread_exits_two_without_consuming(self):
        self.rows(self.row())
        result = self.run_hook('listen', payload={'hook_event_name': 'SessionStart'})
        self.assertEqual((result.returncode, result.stdout), (2, ''))
        self.assertIn('r1', result.stderr)
        self.assertFalse((self.home / 'listeners/build.pid').exists())
        self.assertEqual(json.loads((self.home / 'inbox/build.json').read_text()), {'read': []})
        self.assertFalse((self.home / 'hooks.log').exists())

    def listener_process(self, payload=None):
        process = subprocess.Popen(['sh', str(HOOKS / 'listen.sh')], env=self.env,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        process.stdin.write(json.dumps(STOP_INPUTS['claude'] | (payload or {})))
        process.stdin.close()
        process.stdin = None
        def cleanup():
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=3)
        self.addCleanup(cleanup)
        deadline = time.monotonic() + 3
        marker = self.home / 'listeners/build.pid'
        while time.monotonic() < deadline:
            if marker.exists() and marker.read_text().strip() == str(process.pid):
                break
            time.sleep(0.01)
        self.assertEqual((self.home / 'listeners/build.pid').read_text().strip(), str(process.pid))
        return process

    def test_listener_catches_row_arriving_after_arm(self):
        process = self.listener_process()
        self.rows(self.row())
        out, err = process.communicate(timeout=3)
        self.assertEqual((process.returncode, out), (2, ''))
        self.assertIn('r1', err)

    def test_listener_retires_on_pane_replacement(self):
        process = self.listener_process()
        self.save(pane='replacement')
        out, err = process.communicate(timeout=3)
        self.assertEqual((process.returncode, out, err), (0, '', ''))
        self.assertFalse((self.home / 'listeners/build.pid').exists())

    def test_rearm_retires_older_listener(self):
        first = self.listener_process()
        token = (self.home / 'listeners/build.json').read_text()
        second = self.listener_process()
        deadline = time.monotonic() + 3
        while (self.home / 'listeners/build.json').read_text() == token and time.monotonic() < deadline:
            time.sleep(0.01)
        out, err = first.communicate(timeout=3)
        self.assertEqual((first.returncode, out, err), (0, '', ''))
        self.assertEqual((self.home / 'listeners/build.pid').read_text().strip(), str(second.pid))
        self.rows(self.row())
        out, err = second.communicate(timeout=3)
        self.assertEqual((second.returncode, out), (2, ''))
        self.assertIn('r1', err)

    def test_codex_listener_is_noop(self):
        self.allowed(self.run_hook('listen', family='codex'))
        self.assertFalse((self.home / 'listeners').exists())

    def test_persistent_children_never_count_as_live_workers(self):
        self.child('helper', role='helper', pane='helper-pane')
        self.child('unrelated', parent='plan', pane='other-pane')
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family))
            self.allowed(self.fence('Bash', {'command': 'herdr pane send-text helper-pane hi'}))
            self.blocked(self.fence('Bash', {'command': 'herdr agent prompt unrelated hi'}), 'fence')
        (self.home / 'seats/helper.json').unlink()
        self.blocked(self.fence('Bash', {'command': 'herdr pane send-text helper-pane hi'}), 'fence')

    def test_custom_receipt_pending_matches_team_for_all_row_kinds(self):
        custom = self.home / 'custom.json'
        self.save(inbox=str(custom))
        self.rows(self.row(), self.row('question', kind='question'), self.row('update', kind='update'),
                  self.row('unread'), self.row('complete'),
                  self.row('answer', kind='answer', to='super', cites='complete'),
                  self.row('elsewhere', to='plan'), read=['unread'])
        custom.write_text(json.dumps({'read': ['r1', 'question', 'update', 'complete', 'elsewhere']}))
        result = subprocess.run([str(HOOKS.parent / 'bin/team'), 'pending'], env=self.env,
                                capture_output=True, text=True, check=True)
        ids = [json.loads(line)['id'] for line in result.stdout.splitlines()]
        self.assertEqual(ids, ['r1', 'question'])
        for family in STOP_INPUTS:
            context = json.loads(self.run_hook('start', family=family).stdout)['hookSpecificOutput']['additionalContext']
            self.assertIn('Pending ids: ' + ', '.join(ids), context)
            self.assertIn('Unread rows unread', self.blocked(self.run_hook()))

    def test_listener_expiry_removes_pid(self):
        listen = runpy.run_path(str(HOOKS / 'lib/core.py'))['listen']
        with patch.object(time, 'monotonic', side_effect=[0, 281]):
            self.assertEqual(listen(self.home, self.seat, {'hook_event_name': 'SessionStart'}, {}), 0)
        self.assertFalse((self.home / 'listeners/build.pid').exists())

    def test_listener_skips_bad_lines_and_still_wakes(self):
        self.rows(self.row())
        with (self.home / 'ledger.jsonl').open('ab') as stream:
            stream.write(b'not-json\n{"torn":')
        result = self.run_hook('listen', payload={'hook_event_name': 'SessionStart'})
        self.assertEqual(result.returncode, 2)
        self.assertIn('r1', result.stderr)
        self.assertFalse((self.home / 'listeners/build.pid').exists())
        self.assertEqual(json.loads((self.home / 'hooks.log').read_text())['bad_lines'], 2)

    def test_listener_termination_removes_pid(self):
        process = self.listener_process()
        process.terminate()
        out, err = process.communicate(timeout=3)
        self.assertEqual((process.returncode, out, err), (0, '', ''))
        self.assertFalse((self.home / 'listeners/build.pid').exists())

    def test_finished_or_question_workers_do_not_require_wait(self):
        run = self.child('impl')
        status = run / 'status.txt'
        for family in STOP_INPUTS:
            for terminal in ('12:34 done: result', '12:35 question: #q1'):
                status.write_text(terminal + '\n')
                self.allowed(self.run_hook(family=family))
            status.write_text('12:34 done: old\n12:35 acting\n')
            self.blocked(self.run_hook())
        (self.home / 'seats/impl.json').unlink()
        self.allowed(self.run_hook())

    def test_latest_fix_round_status_owns_worker_liveness(self):
        run = self.child('impl')
        (run / 'status.txt').write_text('12:30 done: first round\n')
        (run / 'status-fix1.txt').write_text('12:31 done: old fix\n')
        (run / 'status-fix2.txt').write_text('12:32 acting\n')
        self.blocked(self.run_hook())
        (run / 'status-fix2.txt').write_text('12:33 question: #q1\n')
        self.allowed(self.run_hook())

    def test_stop_wait_uses_seat_timeout_and_absolute_team(self):
        self.save(wait_ms=7200000)
        self.child('impl')
        self.rows(self.row())
        reason = self.blocked(self.run_hook())
        self.assertIn('--timeout 7200000', reason)
        self.assertIn('run_in_background: true', reason)
        self.assertIn(str(HOOKS.parent / 'bin/team') + ' inbox --mark', reason)
        self.assertNotIn('( ', reason)

    def test_notebook_and_legacy_multiedit_paths(self):
        self.allowed(self.fence('NotebookEdit', {'notebook_path': str(self.extra / 'book.ipynb')}))
        self.blocked(self.fence('NotebookEdit', {'notebook_path': str(self.home / 'book.ipynb')}), 'fence')
        self.blocked(self.fence('MultiEdit', {'file_path': str(self.home / 'outside'), 'edits': []}), 'fence')

    def test_exact_handoff_and_scratchpad_allowed_card_readonly(self):
        self.save(handoff=str(self.home / 'handoffs' / 'handoff.md'), card=str(self.root / 'card.md'))
        for family, tool, field in (('claude', 'Write', 'file_path'), ('codex', 'apply_patch', 'command')):
            for path, allowed in ((self.seat['handoff'], True), (str(self.home / 'scratch' / 'note'), True),
                                  (self.seat['card'], False), (str(self.home / 'handoffs' / 'other.md'), False)):
                data = {field: path if tool == 'Write' else '*** Begin Patch\n*** Add File: ' + path + '\n*** End Patch'}
                result = self.run_hook('fence', family=family,
                    payload={'tool_name': tool, 'tool_input': data, 'scratchpad_dir': str(self.home / 'scratch')})
                if allowed:
                    self.allowed(result)
                else:
                    self.blocked(result, 'fence')

    def test_old_rotation_pane_fenced_until_ack_only(self):
        directory = self.home / 'rotations'
        directory.mkdir()
        state = dict(old_session='old-session', old_pane='old-pane', acked=False)
        (directory / 'build.json').write_text(json.dumps(state))
        env = dict(self.env, HERDR_PANE_ID='old-pane')
        for family in STOP_INPUTS:
            self.save(family=family)
            self.blocked(self.run_hook('fence', env=env,
                payload={'tool_name': 'Bash', 'tool_input': {'command': 'herdr agent wait w'}}), 'fence')
            self.assertIn('Rotation of session old-session',
                          self.blocked(self.run_hook(env=env, payload={'session_id': 'old-session'})))
        state['acked'] = True
        (directory / 'build.json').write_text(json.dumps(state))
        self.allowed(self.run_hook('fence', env=env,
            payload={'tool_name': 'Bash', 'tool_input': {'command': 'herdr agent wait w'}}))

    def test_expiry_removes_marker_before_final_unread_check(self):
        ns = runpy.run_path(str(HOOKS / 'lib/core.py'))
        marker = self.home / 'listeners/build.pid'
        def expire():
            self.assertTrue(marker.exists())
            self.rows(self.row())
            return 281
        original = ns['listen'].__globals__['records']
        calls = []
        def checked(*args, **kwargs):
            calls.append(marker.exists())
            return original(*args, **kwargs)
        out = io.StringIO()
        ticks = iter([0, 281])
        def clock():
            value = next(ticks)
            if value == 281:
                return expire()
            return value
        with patch.dict(ns['listen'].__globals__, records=checked), patch.object(time, 'monotonic', side_effect=clock):
            with contextlib.redirect_stderr(out):
                self.assertEqual(ns['listen'](self.home, self.seat, {'hook_event_name': 'SessionStart'}, {}), 2)
        self.assertEqual(calls, [False, False])
        self.assertIn('r1', out.getvalue())

    def test_listener_only_reads_appended_bytes_each_second(self):
        ns = runpy.run_path(str(HOOKS / 'lib/core.py'))
        self.rows(self.row('old', to='other'))
        size = (self.home / 'ledger.jsonl').stat().st_size
        original = ns['listen'].__globals__['records']
        offsets = []
        def observed(*args, **kwargs):
            offsets.append(kwargs['stream'].tell())
            return original(*args, **kwargs)
        def append(seconds):
            self.assertEqual(seconds, 1)
            with (self.home / 'ledger.jsonl').open('a') as stream:
                stream.write(json.dumps(self.row()) + '\n')
        with patch.dict(os.environ, self.env), patch.dict(ns['listen'].__globals__, records=observed):
            with patch.object(time, 'monotonic', side_effect=[0, 0, 281]), patch.object(time, 'sleep', side_effect=append):
                with contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(ns['listen'](self.home, self.seat, {'hook_event_name': 'SessionStart'}, {}), 2)
        self.assertEqual(offsets, [0, size, size])

    def test_unread_stop_does_not_rearm_listener(self):
        self.rows(self.row())
        self.blocked(self.run_hook())
        self.allowed(self.run_hook('listen'))
        self.assertFalse((self.home / 'listeners').exists())

    def test_start_skips_bad_rows_generates_metadata_and_warns_budget(self):
        (self.home / 'ledger.jsonl').write_bytes(b'broken\n{"torn":')
        card = self.home / 'card.md'
        card.write_text('open item\n' * 41)
        self.save(card=str(card))
        result = self.run_hook('start')
        context = json.loads(result.stdout)['hookSpecificOutput']['additionalContext']
        for line in ('Role: manager', 'Root: ' + str(self.root), 'Inbox: ' + self.seat['inbox'], 'Parent: super'):
            self.assertIn(line, context)
        record = json.loads((self.home / 'hooks.log').read_text())
        self.assertEqual(record['bad_lines'], 2)
        self.assertEqual(record['card_lines'], len(context.splitlines()))
        self.assertEqual(record['warning'], 'card exceeds 40 lines')

    def test_codex_coverage_is_native_tools_only(self):
        for tool, data in (('Write', {'file_path': '/outside'}), ('Bash', {'command': "apply_patch <<'PATCH'\n*** Add File: /outside\nPATCH"})):
            self.allowed(self.fence(tool, data, family='codex'))

    def test_shlex_errors_fail_open_and_wrapped_commands_unseen(self):
        self.allowed(self.fence('Bash', {'command': "echo don't"}))
        self.assertIn('error ValueError', (self.home / 'hooks.log').read_text())
        for command in ('env herdr agent wait w', "bash -c 'herdr agent wait w'", 'herdr --x agent wait w'):
            self.allowed(self.fence('Bash', {'command': command}))

    def test_missing_plugin_env_is_silent(self):
        env = dict(self.env)
        env.pop('KILN_PLUGIN')
        for event in ('stop', 'start', 'fence', 'listen'):
            self.allowed(self.run_hook(event, env=env))
        self.assertFalse((self.home / 'hooks.log').exists())

    def test_different_pane_outgoing_stop_only_checks_rotation(self):
        directory = self.home / 'rotations'
        directory.mkdir()
        path = directory / 'build.json'
        state = dict(old_session='old-session', old_pane='old-pane', acked=False)
        path.write_text(json.dumps(state))
        self.rows(self.row('replacement-row'))
        self.child('replacement-worker')
        marker = self.home / 'inbox/build.json'
        before = marker.read_bytes()
        env = dict(self.env, HERDR_PANE_ID='old-pane')
        for family in STOP_INPUTS:
            self.save(family=family)
            reason = self.blocked(self.run_hook(env=env, payload={'session_id': 'old-session'}))
            self.assertIn('Rotation of session old-session', reason)
            self.assertNotIn('Unread', reason)
            self.assertNotIn('worker', reason.lower())
            self.assertNotIn('inbox --mark', reason)
            continued = self.run_hook(env=env, payload={'session_id': 'old-session', 'stop_hook_active': True})
            if family == 'codex':
                self.allowed(continued)
            else:
                reason = self.advisory(continued)
                self.assertIn('Rotation of session old-session', reason)
                self.assertNotIn('Unread', reason)
                self.assertNotIn('Worker', reason)
            replacement = self.blocked(self.run_hook(payload={'session_id': 'new-session'}))
            self.assertIn('replacement-row', replacement)
            self.assertNotIn('Rotation', replacement)
        self.assertEqual(marker.read_bytes(), before)
        state['acked'] = True
        path.write_text(json.dumps(state))
        self.allowed(self.run_hook(env=env, payload={'session_id': 'old-session'}))

    def test_same_pane_outgoing_stop_ignores_replacement_work(self):
        directory = self.home / 'rotations'
        directory.mkdir()
        (directory / 'build.json').write_text(json.dumps(dict(old_session='old-session', old_pane='w4:p1', acked=False)))
        self.rows(self.row('replacement-row'))
        self.child('replacement-worker')
        for family in STOP_INPUTS:
            reason = self.blocked(self.run_hook(family=family, payload={'session_id': 'old-session'}))
            self.assertNotIn('Unread', reason)
            self.assertNotIn('Worker', reason)
            self.assertIn('Rotation', reason)
            self.allowed(self.run_hook('listen', payload={'session_id': 'old-session'}))
        self.assertFalse((self.home / 'listeners').exists())

    def test_status_is_only_read_from_own_run(self):
        run = self.child('impl')
        self.child('review')
        other = self.home / 'runs/review'
        (other / 'status.txt').write_text('12:30 done: sibling\n')
        (self.root / 'status.txt').write_text('12:30 done: project\n')
        (self.extra / 'status.txt').write_text('12:30 done: extra root\n')
        for family in STOP_INPUTS:
            reason = self.blocked(self.run_hook(family=family))
            self.assertIn('Worker impl', reason)
            self.assertNotIn('Worker review', reason)
        (run / 'status.txt').write_text('12:31 question: #q1\n')
        self.allowed(self.run_hook())

    def test_missing_legacy_wait_ms_uses_default_without_losing_refusal(self):
        self.seat.pop('wait_ms')
        self.save()
        self.rows(self.row())
        self.child('impl')
        for family in STOP_INPUTS:
            reason = self.blocked(self.run_hook(family=family))
            self.assertIn('Unread rows r1', reason)
            self.assertIn('--timeout 1800000', reason)

    def test_listener_arms_when_stop_policy_errors_with_unread_rows(self):
        self.rows(self.row())
        self.child('broken')
        (self.home / 'seats/broken.json').write_text('{broken')
        self.allowed(self.run_hook())
        result = self.run_hook('listen')
        self.assertEqual(result.returncode, 2)
        self.assertIn('Unread rows r1', result.stderr)
        self.assertFalse((self.home / 'listeners/build.pid').exists())
        logs = [json.loads(line) for line in (self.home / 'hooks.log').read_text().splitlines()]
        self.assertIn('error', logs[0]['outcome'])
        self.assertIn('JSONDecodeError', logs[1]['stop_error'])

    def test_armed_listener_retires_when_same_pane_session_rotates(self):
        process = self.listener_process()
        directory = self.home / 'rotations'
        directory.mkdir()
        (directory / 'build.json').write_text(json.dumps(dict(
            old_session=STOP_INPUTS['claude']['session_id'], old_pane='w4:p1', acked=False)))
        self.rows(self.row('replacement-row'))
        out, err = process.communicate(timeout=3)
        self.assertEqual((process.returncode, out, err), (0, '', ''))
        self.assertFalse((self.home / 'listeners/build.pid').exists())

    def test_listener_recovers_when_stop_rotation_receipt_is_broken(self):
        directory = self.home / 'rotations'
        directory.mkdir()
        (directory / 'build.json').write_text('{broken')
        self.rows(self.row())
        self.allowed(self.run_hook())
        result = self.run_hook('listen')
        self.assertEqual(result.returncode, 2)
        self.assertIn('Unread rows r1', result.stderr)

    def test_herdr_help_is_discovery_for_both_families(self):
        for family in STOP_INPUTS:
            for command in ('herdr --help', 'herdr -h agent prompt',
                            'herdr agent prompt --help', 'herdr agent prompt -h',
                            'herdr pane send-text --help', 'herdr pane send-keys -h',
                            'herdr agent wait -h', 'herdr pane wait-output --help'):
                with self.subTest(family=family, command=command):
                    self.allowed(self.fence('Bash', {'command': command}, family=family))

    def test_typing_fence_requires_a_real_target(self):
        self.child('impl', pane='impl-pane')
        for family in STOP_INPUTS:
            for command in ('herdr agent prompt', 'herdr pane send-text', 'herdr pane send-keys'):
                self.allowed(self.fence('Bash', {'command': command}, family=family))
            self.allowed(self.fence('Bash', {'command': 'herdr agent prompt impl hello'}, family=family))
            for command in ('herdr agent prompt director hi', 'herdr pane send-text unowned hi',
                            'herdr pane send-keys unowned Enter', 'herdr agent prompt director --helpful',
                            'herdr agent prompt --unknown-option', 'herdr agent prompt ""',
                            'herdr agent prompt -- impl hello'):
                self.blocked(self.fence('Bash', {'command': command}, family=family), 'fence')

    def test_help_does_not_exempt_another_herdr_command(self):
        for family in STOP_INPUTS:
            for command in ('herdr agent prompt --help; herdr agent prompt director hi',
                            'echo --help; herdr pane send-keys unowned Enter',
                            'herdr agent wait impl; herdr agent prompt --help'):
                self.blocked(self.fence('Bash', {'command': command}, family=family), 'fence')

    def test_continued_stop_reports_worker_policy_but_allows(self):
        self.child('impl')
        self.rows(self.row())
        for family in STOP_INPUTS:
            result = self.run_hook(family=family, payload={'stop_hook_active': True})
            if family == 'codex':
                self.allowed(result)
            else:
                reason = self.advisory(result)
                self.assertIn('Unread rows r1', reason)
                self.assertIn('Worker impl', reason)
            log = json.loads((self.home / 'hooks.log').read_text().splitlines()[-1])
            self.assertEqual(log['outcome'], 'report')
            self.assertFalse(log['unread_refusal'])

    def test_continued_stop_with_no_obligations_is_silent(self):
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family, payload={'stop_hook_active': True}))

    def test_continued_stop_listener_wakes_only_for_new_unread_ids(self):
        self.rows(self.row('initial-id'))
        self.advisory(self.run_hook(payload={'stop_hook_active': True}))
        process = self.listener_process({'stop_hook_active': True})
        with (self.home / 'ledger.jsonl').open('a') as stream:
            stream.write(json.dumps(self.row('new-id')) + '\n')
        out, err = process.communicate(timeout=3)
        self.assertEqual((process.returncode, out), (2, ''))
        self.assertIn('Unread rows new-id', err)
        self.assertNotIn('initial-id', err)
        self.assertEqual(json.loads((self.home / 'inbox/build.json').read_text()), {'read': []})

    def expire_continued_listener(self, before_expiry=None):
        ns = runpy.run_path(str(HOOKS / 'lib/core.py'))
        ticks = iter([0, 0, 281])
        def clock():
            now = next(ticks)
            if now == 281 and before_expiry:
                before_expiry()
            return now
        payload = dict(hook_event_name='Stop', stop_hook_active=True, session_id='claude-session')
        with patch.dict(os.environ, self.env), patch.object(time, 'monotonic', side_effect=clock):
            with patch.object(time, 'sleep') as sleep, contextlib.redirect_stderr(io.StringIO()) as err:
                result = ns['listen'](self.home, self.seat, payload, {})
                sleep.assert_called_once_with(1)
        return result, err.getvalue()

    def test_continued_listener_delays_initial_unread_wake_until_expiry(self):
        self.rows(self.row('initial-id'))
        result, err = self.expire_continued_listener()
        self.assertEqual(result, 2)
        self.assertIn('Unread rows initial-id', err)
        self.assertEqual(err.count('initial-id'), 1)
        self.assertFalse((self.home / 'listeners/build.pid').exists())
        self.assertEqual(json.loads((self.home / 'inbox/build.json').read_text()), {'read': []})

    def test_continued_listener_does_not_wake_if_initial_rows_read_before_expiry(self):
        self.rows(self.row('initial-id'))
        def read_before_expiry():
            self.assertTrue((self.home / 'listeners/build.pid').exists())
            (self.home / 'inbox/build.json').write_text(json.dumps({'read': ['initial-id']}))
        result, err = self.expire_continued_listener(read_before_expiry)
        self.assertEqual((result, err), (0, ''))
        self.assertFalse((self.home / 'listeners/build.expiry.json').exists())

    def test_second_continued_listener_never_repeats_delayed_ids(self):
        self.rows(self.row('initial-id'))
        self.assertEqual(self.expire_continued_listener()[0], 2)
        result, err = self.expire_continued_listener()
        self.assertEqual((result, err), (0, ''))
        self.assertEqual(json.loads((self.home / 'listeners/build.expiry.json').read_text()),
                         {'woken': ['initial-id']})
        self.assertEqual(json.loads((self.home / 'inbox/build.json').read_text()), {'read': []})

    def test_new_initial_ids_keep_their_own_one_time_expiry_wake(self):
        self.rows(self.row('old-id'))
        self.assertEqual(self.expire_continued_listener()[0], 2)
        self.rows(self.row('old-id'), self.row('another-id'))
        result, err = self.expire_continued_listener()
        self.assertEqual(result, 2)
        self.assertIn('Unread rows another-id', err)
        self.assertNotIn('old-id', err)
        self.assertEqual(self.expire_continued_listener(), (0, ''))

    def test_continued_listener_expiry_combines_new_and_once_delayed_ids(self):
        ns = runpy.run_path(str(HOOKS / 'lib/core.py'))
        self.rows(self.row('initial-id'))
        ticks = iter([0, 281])
        def clock():
            now = next(ticks)
            if now == 281:
                with (self.home / 'ledger.jsonl').open('a') as stream:
                    stream.write(json.dumps(self.row('initial-id')) + '\n')
                    stream.write(json.dumps(self.row('new-id')) + '\n')
            return now
        with patch.object(time, 'monotonic', side_effect=clock):
            with contextlib.redirect_stderr(io.StringIO()) as err:
                result = ns['listen'](self.home, self.seat, {'hook_event_name': 'Stop', 'stop_hook_active': True}, {})
        self.assertEqual(result, 2)
        self.assertIn('new-id', err.getvalue())
        self.assertEqual(err.getvalue().count('initial-id'), 1)

    def test_herdr_probe_target_is_literal_and_later_help_is_not_exempt(self):
        for family in STOP_INPUTS:
            for command, target in (('herdr pane send-keys --timeout 5 X a', '--timeout'),
                                    ('herdr agent prompt --timeout 5 X hi', '--timeout'),
                                    ('herdr pane send-keys X a -h', 'X'),
                                    ('herdr pane send-text X --help', 'X'),
                                    ('herdr agent prompt X hi -h', 'X'),
                                    ('herdr pane send-keys director -- C-c -h', 'director')):
                with self.subTest(family=family, command=command):
                    reason = self.blocked(self.fence('Bash', {'command': command}, family=family), 'fence')
                    self.assertIn('target ' + target + ' is outside my workers', reason)
            self.child('impl', pane='X')
            self.allowed(self.fence('Bash', {'command': 'herdr pane send-keys X a -h'}, family=family))
            self.allowed(self.fence('Bash', {'command': 'herdr pane send-text X --help'}, family=family))
            (self.home / 'seats/impl.json').unlink()


    def test_launcher_registers_claude_listener_only(self):
        from test_launch import load_launcher
        launch = load_launcher()
        for family in STOP_INPUTS:
            for role in ('manager', 'worker'):
                seat = self.seat | dict(family=family, role=role)
                config = launch.hooks(role, family)
                kwargs = {"home": self.home} if "home" in inspect.signature(launch.native).parameters else {}
                flags = launch.native(seat, config, **kwargs)
                if family == 'codex':
                    self.assertNotIn('asyncRewake', json.dumps(config))
                    continue
                settings = json.loads(flags[flags.index('--settings') + 1])
                for event in ('Stop', 'SessionStart') if role == 'manager' else ('Stop',):
                    handlers = settings['hooks'][event][0]['hooks']
                    self.assertEqual(len(handlers), 2 if role == 'manager' else 1)
                    if role == 'manager':
                        self.assertTrue(handlers[1]['asyncRewake'])
                        self.assertEqual(handlers[1]['timeout'], 300)
                        self.assertIn('/listen.sh', handlers[1]['command'])
                        self.assertIn('[ -n "$KILN_SEAT" ]', handlers[1]['command'])


if __name__ == '__main__':
    unittest.main()
