"""Isolated hook tests: no CLI/model/Herdr process is invoked.

STOP_INPUTS preserve the fields observed in envtest-20261029 (IDs and paths
replaced). SessionStart/PreToolUse extend them with the documented event fields.
"""
import inspect
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
                         root=str(self.root), extra_roots=[str(self.extra)],
                         inbox=str(self.home / 'inbox/build.json'), tab='build', parent='super',
                         workspace='w4', model='claude-opus-5-5', effort='medium')
        self.env = dict(os.environ, KILN_HOME=str(self.home), KILN_SEAT=str(self.seatpath), HERDR_PANE_ID='w4:p1')
        self.save()

    def save(self, **updates):
        self.seat.update(updates)
        self.seatpath.write_text(json.dumps(self.seat))

    def child(self, address, parent='build', pane=None, role='worker'):
        child = self.seat | dict(address=address, parent=parent, pane=pane or address + '-pane',
                                 role=role, inbox='')
        (self.home / 'seats' / f'{address}.json').write_text(json.dumps(child))

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
        for family in STOP_INPUTS:
            self.allowed(self.run_hook(family=family, payload={'stop_hook_active': True}))

    def test_workers_and_advisors_always_stop_and_never_start_or_listen(self):
        self.rows(self.row())
        for family in STOP_INPUTS:
            for role in ('worker', 'advisor'):
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
            self.assertIn('herdr agent wait build-impl --timeout 30000', reason)
            self.assertEqual(reason.endswith('&'), family == 'claude')
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

    def test_finished_request_result_or_sibling_status_needs_done(self):
        result = self.extra / 'result.md'
        for source in (result, self.extra / 'status.txt'):
            source.write_text('details\n12:34 done: proof\n\n')
            self.rows(self.row(path=str(result)), read=['r1'])
            for family in STOP_INPUTS:
                reason = self.blocked(self.run_hook(family=family))
                self.assertIn('Finished request r1', reason)
                self.assertIn('--cites r1', reason)
                self.assertIn('--kind done', reason)
            source.unlink()

    def test_finished_directory_and_done_citation(self):
        (self.extra / 'status.txt').write_text('12:34 done:\n')
        self.rows(self.row(path=str(self.extra)), read=['r1'])
        self.blocked(self.run_hook())
        self.rows(self.row(path=str(self.extra)), self.row('d1', kind='done', to='super', cites='r1'), read=['r1'])
        self.allowed(self.run_hook())

    def test_question_status_or_unreceived_result_never_adds_done_refusal(self):
        status = self.extra / 'status.txt'
        status.write_text('12:34 done: old\n12:35 question: #q1\n')
        self.rows(self.row(path=str(self.extra)), read=['r1'])
        self.allowed(self.run_hook())
        status.write_text('12:36 done:\n')
        self.rows(self.row(path=str(self.extra)))
        reason = self.blocked(self.run_hook())
        self.assertNotIn('Finished request', reason)

    def test_rotation_only_blocks_own_unacked_pane(self):
        directory = self.home / 'rotations'
        directory.mkdir()
        for family in STOP_INPUTS:
            for pane, acked, blocks in (('w4:p1', False, True), ('old', False, False), ('w4:p1', True, False)):
                (directory / 'build.json').write_text(json.dumps(dict(pane=pane, acked=acked, id='rotate-1')))
                result = self.run_hook(family=family)
                if blocks:
                    self.assertIn('Rotation rotate-1', self.blocked(result))
                else:
                    self.allowed(result)

    def test_replacement_ignores_old_rotation_but_handles_unread(self):
        (self.home / 'rotations').mkdir()
        (self.home / 'rotations/build.json').write_text(json.dumps(dict(pane='old', acked=False, id='rot')))
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
            self.allowed(self.fence('Bash', {'command': 'herdr pane wait-output p --timeout=30000'}, family=family))

    def test_claude_wait_must_end_in_ampersand_codex_may_foreground(self):
        command = 'herdr agent wait w --timeout 30000'
        self.blocked(self.fence('Bash', {'command': command}), 'fence')
        self.allowed(self.fence('Bash', {'command': command + ' &'}))
        self.allowed(self.fence('Bash', {'command': command}, family='codex'))

    def test_bash_fence_only_four_roles(self):
        for role in ('director', 'super', 'manager', 'chunkmaster', 'helper', 'worker', 'advisor'):
            self.save(role=role)
            result = self.fence('Bash', {'command': 'herdr agent wait w'})
            if role in ('helper', 'worker', 'advisor'):
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
        for role in ('director', 'super', 'manager', 'chunkmaster', 'helper', 'worker', 'advisor'):
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
        for role in ('worker', 'advisor', 'manager'):
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

    def test_bad_ledger_and_missing_tool_fields_fail_open(self):
        (self.home / 'ledger.jsonl').write_text('{broken\n')
        self.allowed(self.run_hook())
        self.allowed(self.fence('Write', {}))
        self.assertEqual(len((self.home / 'hooks.log').read_text().splitlines()), 2)

    def test_each_seated_invocation_logs_once(self):
        self.allowed(self.run_hook())
        self.run_hook('start')
        self.allowed(self.fence('Read', {'file_path': '/outside'}))
        self.assertEqual([json.loads(line)['event'] for line in (self.home / 'hooks.log').read_text().splitlines()], ['stop', 'start', 'fence'])

    def test_listener_existing_unread_exits_two_without_consuming(self):
        self.rows(self.row())
        result = self.run_hook('listen')
        self.assertEqual((result.returncode, result.stdout), (2, ''))
        self.assertIn('r1', result.stderr)
        self.assertFalse((self.home / 'listeners/build.pid').exists())
        self.assertEqual(json.loads((self.home / 'inbox/build.json').read_text()), {'read': []})
        self.assertEqual(len((self.home / 'hooks.log').read_text().splitlines()), 1)

    def listener_process(self):
        process = subprocess.Popen(['sh', str(HOOKS / 'listen.sh')], env=self.env,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        process.stdin.write(json.dumps(STOP_INPUTS['claude']))
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

    def test_workers_derived_by_parent_for_stop_and_typing(self):
        self.child('helper', role='helper', pane='helper-pane')
        self.child('unrelated', parent='plan', pane='other-pane')
        for family in STOP_INPUTS:
            reason = self.blocked(self.run_hook(family=family))
            self.assertIn('Worker helper', reason)
            self.assertNotIn('unrelated', reason)
            self.allowed(self.fence('Bash', {'command': 'herdr pane send-text helper-pane hi'}))
            self.blocked(self.fence('Bash', {'command': 'herdr agent prompt unrelated hi'}), 'fence')
        (self.home / 'seats/helper.json').unlink()
        self.allowed(self.run_hook())
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
            self.assertEqual(listen(self.home, self.seat), 0)
        self.assertFalse((self.home / 'listeners/build.pid').exists())

    def test_listener_error_removes_pid_and_fails_open(self):
        (self.home / 'ledger.jsonl').write_text('{broken')
        self.allowed(self.run_hook('listen'))
        self.assertFalse((self.home / 'listeners/build.pid').exists())

    def test_listener_termination_removes_pid(self):
        process = self.listener_process()
        process.terminate()
        out, err = process.communicate(timeout=3)
        self.assertEqual((process.returncode, out, err), (0, '', ''))
        self.assertFalse((self.home / 'listeners/build.pid').exists())

    def test_launcher_registers_claude_listener_only(self):
        from test_launch import load_launcher
        launch = load_launcher()
        for family in STOP_INPUTS:
            for role in ('manager', 'worker'):
                seat = self.seat | dict(family=family, role=role)
                config = launch.hooks(role)
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
