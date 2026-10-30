import argparse
import contextlib
import errno
import hashlib
import importlib.machinery
import importlib.util
import json
import io
import os
import sys
from pathlib import Path
import shlex
import shutil
import subprocess
import tomllib
import unittest
from unittest.mock import patch

try:
    from .test_team import PLUGIN, Sandbox
except ImportError:
    from test_team import PLUGIN, Sandbox


def load_launcher():
    loader = importlib.machinery.SourceFileLoader('kiln_launch', str(PLUGIN / 'bin/launch'))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class LaunchTests(Sandbox, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.root = self.base / 'phase with spaces'
        self.root.mkdir()
        self.env['HOME'] = str(self.base / 'user')
        self.env['CODEX_HOME'] = str(self.base / 'codex home')

    def guard(self, script):
        guard = ('[ -n "$KILN_SEAT" ] && [ -f "$KILN_SEAT" ] && [ -n "$KILN_PLUGIN" ] '
                 f'|| exit 0; exec "$KILN_PLUGIN/hooks/{script}.sh"')
        return 'sh -c ' + shlex.quote(guard)

    def launch(self, *extra, ok=True):
        if '--role' in extra and extra[extra.index('--role') + 1] == 'worker' and '--run' not in extra:
            extra = (*extra, '--run', str(self.base / 'worker-run'))
        return self.run_tool('launch', '--tab', 'build', '--address', 'build', '--role', 'manager',
                             '--root', str(self.root), '--parent', 'orchestrator', *extra, ok=ok)

    def seat(self, addr='build'):
        return json.loads((self.home / 'seats' / f'{addr}.json').read_text())

    def assert_schema(self, seat):
        schema = json.loads((PLUGIN / 'config/seat.schema.json').read_text())
        self.assertTrue(set(schema['required']) <= seat.keys())
        self.assertTrue(seat.keys() <= schema['properties'].keys())
        for key, value in seat.items():
            field = schema['properties'][key]
            if field['type'] == 'string':
                self.assertIsInstance(value, str)
            elif field['type'] == 'boolean':
                self.assertIs(type(value), bool)
            elif field['type'] == 'array':
                self.assertIsInstance(value, list)
                self.assertTrue(all(isinstance(v, str) for v in value))
            if 'enum' in field:
                self.assertIn(value, field['enum'])
            if 'pattern' in field:
                self.assertRegex(value, field['pattern'])

    def flags(self):
        start = next(c for c in reversed(self.calls()) if c[:2] == ['agent', 'start'])
        self.assertEqual(start[:3], ['agent', 'start', self.seat()['address']])
        self.assertEqual(start[start.index('--timeout') + 1], '30000')
        return start[start.index('--') + 1:]

    def test_claude_manager_schema_hooks_env_label(self):
        card = self.base / 'card.md'
        handoff = self.base / 'handoff.md'
        extra = self.base / 'extra'
        self.launch('--name', 'Oracle', '--card', str(card), '--handoff', str(handoff),
                    '--extra-root', str(extra))
        seat = self.seat()
        self.assert_schema(seat)
        self.assertEqual(seat['model'], 'claude-opus-5-5')
        self.assertEqual(seat['effort'], 'medium')
        self.assertEqual(seat['pane'], 'w-test:p3')
        self.assertEqual(seat['workspace'], 'w-test')
        self.assertEqual(seat['inbox'], str(self.home / 'inbox/build.json'))
        self.assertNotIn('workers', seat)
        self.assertNotIn('pending', seat)
        self.assertEqual(seat['card'], str(card))
        self.assertEqual(seat['handoff'], str(handoff))
        self.assertEqual(seat['extra_roots'], [str(extra)])
        self.assertEqual(seat['run'], str(self.root))
        split = self.calls()[2]
        self.assertEqual(split[:3], ['pane', 'split', 'w-test:p1'])
        self.assertIn('KILN_SEAT=' + str(self.home / 'seats/build.json'), split)
        self.assertIn('KILN_HOME=' + str(self.home), split)
        self.assertIn('--no-focus', split)
        self.assertEqual(self.calls()[3][:3], ['pane', 'rename', 'w-test:p3'])
        self.assertEqual(self.calls()[3][3], 'Oracle · build manager · opus-5.5')
        flags = self.flags()
        self.assertEqual(flags[:4], ['--model', 'claude-opus-5-5', '--effort', 'medium'])
        self.assertNotIn('--permission-mode', flags)
        settings = json.loads(flags[flags.index('--settings') + 1])
        self.assertEqual(settings['fallbackModel'], [])
        self.assertFalse(settings['switchModelsOnFlag'])
        self.assertNotIn('permissions', settings)
        self.assertEqual(settings['hooks']['PreToolUse'][0]['matcher'], 'Bash|Edit|Write|NotebookEdit|MultiEdit')
        self.assertEqual(seat['wait_ms'], 1800000)
        self.assertIn('KILN_PLUGIN=' + str(PLUGIN), split)
        self.assertEqual(set(settings['hooks']), {'SessionStart', 'PreToolUse', 'Stop'})
        for event, script in [('SessionStart', 'start'), ('PreToolUse', 'fence'), ('Stop', 'stop')]:
            self.assertEqual(settings['hooks'][event][0]['hooks'][0]['command'], self.guard(script))
        self.assertEqual(flags[-2:], ['--add-dir', str(extra)])
        self.assertFalse((self.root / '.codex').exists())

    def test_claude_worker_defaults_to_review_without_start_hook(self):
        self.launch('--role', 'worker', '--family', 'claude')
        self.assert_schema(self.seat())
        flags = self.flags()
        settings = json.loads(flags[flags.index('--settings') + 1])
        self.assertEqual(set(settings['hooks']), {'PreToolUse', 'Stop'})
        self.assertEqual(self.seat()['model'], 'claude-opus-5-5')
        self.assertEqual(self.seat()['inbox'], '')

    def test_read_only_refused_for_every_non_worker_role(self):
        for role in load_launcher().SCHEMA['properties']['role']['enum']:
            if role != 'worker':
                with self.subTest(role=role):
                    result = self.launch('--role', role, '--read-only', ok=False)
                    self.assertIn('--read-only requires --role worker', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_read_only_record_outside_git_and_builder_unchanged(self):
        self.launch('--role', 'worker', '--read-only')
        seat = self.seat()
        self.assertIs(seat['read_only'], True)
        self.assertNotIn('worktree_mark', seat)
        self.assertEqual(seat['root'], str(self.root))
        self.assert_schema(seat)
        load_launcher().validate(seat)
        self.run_tool('team', 'close', 'build')
        self.assertFalse((self.home / 'seats/build.json').exists())
        self.launch('--role', 'worker')
        self.assertNotIn('read_only', self.seat())
        self.assertNotIn('worktree_mark', self.seat())

    def git(self, root, *args):
        return subprocess.run(['git', '-C', str(root), *args], check=True,
                              capture_output=True).stdout

    def review_worktree(self, name):
        root = self.base / name
        root.mkdir()
        self.git(root, 'init')
        (root / 'tracked').write_text('original\n')
        self.git(root, 'add', 'tracked')
        self.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                 'commit', '-m', 'initial')
        return root

    def test_read_only_mark_and_unchanged_close_with_dirty_baseline(self):
        root = self.review_worktree('review')
        (root / 'tracked').write_text('baseline change\n')
        (root / 'untracked').write_text('baseline file\n')
        nested = root / 'subdir'
        nested.mkdir()
        content = (root / 'untracked').read_bytes()
        expected = hashlib.sha256(self.git(root, 'rev-parse', 'HEAD')
                                  + self.git(root, 'status', '--porcelain=v1', '-z')
                                  + self.git(root, 'diff', 'HEAD', '--binary')
                                  + b'untracked\0' + len(content).to_bytes(8, 'big') + content).hexdigest()
        self.launch('--role', 'worker', '--read-only', '--worktree', str(nested))
        seat = self.seat()
        self.assertEqual(seat['root'], str(nested))
        self.assertEqual(seat['worktree_mark'], expected)
        self.assert_schema(seat)
        load_launcher().validate(seat)
        self.run_tool('team', 'close', 'build')
        self.assertFalse((self.home / 'seats/build.json').exists())
        self.assertEqual(self.calls()[-1], ['pane', 'close', seat['pane']])

    def test_read_only_close_rejects_changes_and_force_closes(self):
        for change in ('tracked', 'untracked', 'staged', 'already-dirty', 'commit', 'untracked-edit'):
            with self.subTest(change=change):
                root = self.review_worktree(change)
                if change == 'already-dirty':
                    (root / 'tracked').write_text('baseline change\n')
                if change == 'untracked-edit':
                    (root / 'new-file').write_text('baseline untracked\n')
                self.launch('--role', 'worker', '--read-only', '--worktree', str(root))
                seatpath = self.home / 'seats/build.json'
                original = seatpath.read_bytes()
                seat = self.seat()
                if change == 'untracked-edit':
                    subprocess.run(['sh', '-c', 'printf "shell edit\\n" >> "$1"',
                                    'review', str(root / 'new-file')], check=True)
                else:
                    (root / ('new-file' if change == 'untracked' else 'tracked')).write_text('review change\n')
                if change == 'staged':
                    self.git(root, 'add', 'tracked')
                if change == 'commit':
                    self.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                             'commit', '-am', 'review change')
                calls = self.calls()
                result = self.run_tool('team', 'close', 'build', ok=False)
                self.assertEqual(result.stderr, 'team: worktree changed since launch: reject this review\n')
                self.assertEqual(seatpath.read_bytes(), original)
                self.assertEqual(self.calls(), calls)
                self.run_tool('team', 'close', 'build', '--force')
                self.assertFalse(seatpath.exists())
                self.assertEqual(self.calls()[-1], ['pane', 'close', seat['pane']])

    def test_read_only_run_inside_worktree_is_excluded_from_every_input(self):
        for tracked in (False, True):
            with self.subTest(tracked=tracked):
                root = self.review_worktree(f'in-tree-run-{tracked}')
                run = root / 'artifacts' / 'review[1]'
                if tracked:
                    run.mkdir(parents=True)
                    (run / 'tracked-result').write_text('old result\n')
                    self.git(root, 'add', '.')
                    self.git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                             'commit', '-m', 'tracked run output')
                nested = root / 'subdir'
                nested.mkdir()
                self.launch('--role', 'worker', '--read-only', '--worktree', str(nested), '--run', str(run))
                run.mkdir(parents=True, exist_ok=True)
                (run / 'result.md').write_text('review output\n')
                if tracked:
                    (run / 'tracked-result').write_text('updated result\n')
                    self.git(root, 'add', str(run / 'tracked-result'))
                # A second launch at the same state must produce the same mark.
                original_mark = self.seat()['worktree_mark']
                self.run_tool('team', 'close', 'build')
                self.launch('--role', 'worker', '--read-only', '--worktree', str(nested), '--run', str(run))
                self.assertEqual(self.seat()['worktree_mark'], original_mark)
                (root / 'artifacts' / 'outside').write_text('must still be detected\n')
                self.assertIn('worktree changed', self.run_tool('team', 'close', 'build', ok=False).stderr)
                self.run_tool('team', 'close', 'build', '--force')

    def test_read_only_gone_worktree_refuses_with_own_message_and_force_closes(self):
        root = self.review_worktree('gone')
        self.launch('--role', 'worker', '--read-only', '--worktree', str(root))
        seatpath = self.home / 'seats/build.json'
        original = seatpath.read_bytes()
        calls = self.calls()
        root.rename(root.with_name('moved'))
        result = self.run_tool('team', 'close', 'build', ok=False)
        self.assertEqual(result.stderr, 'team: worktree gone: cannot check this review; use --force\n')
        self.assertEqual(seatpath.read_bytes(), original)
        self.assertEqual(self.calls(), calls)
        self.run_tool('team', 'close', 'build', '--force')
        self.assertFalse(seatpath.exists())

    def test_read_only_metadata_uses_shipped_schema(self):
        launch = load_launcher()
        self.launch('--role', 'worker', '--read-only')
        self.assertEqual(launch.SCHEMA['properties']['read_only']['type'], 'boolean')
        self.assertEqual(launch.SCHEMA['properties']['worktree_mark']['type'], 'string')
        for key, value in (('read_only', 'true'), ('worktree_mark', 'invalid')):
            with self.subTest(key=key), self.assertRaises(ValueError):
                launch.validate(self.seat() | {key: value})

    def test_read_only_untracked_nested_repository_hashes_head(self):
        for committed in (False, True):
            with self.subTest(committed=committed):
                root = self.review_worktree(f'outer-{committed}')
                nested = root / 'nested'
                nested.mkdir()
                self.git(nested, 'init')
                if committed:
                    self.git(nested, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                             'commit', '--allow-empty', '-m', 'nested initial')
                self.launch('--role', 'worker', '--read-only', '--worktree', str(root))
                self.assertIn('worktree_mark', self.seat())
                self.run_tool('team', 'close', 'build')
                self.launch('--role', 'worker', '--read-only', '--worktree', str(root))
                self.git(nested, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                         'commit', '--allow-empty', '-m', 'nested change')
                calls = self.calls()
                result = self.run_tool('team', 'close', 'build', ok=False)
                self.assertIn('worktree changed since launch', result.stderr)
                self.assertTrue((self.home / 'seats/build.json').exists())
                self.assertEqual(self.calls(), calls)
                self.run_tool('team', 'close', 'build', '--force')

    def test_read_only_repository_without_commit_can_launch_and_close(self):
        root = self.base / 'unborn'
        root.mkdir()
        self.git(root, 'init')
        (root / 'new-file').write_text('initial content\n')
        self.git(root, 'add', 'new-file')
        self.launch('--role', 'worker', '--read-only', '--worktree', str(root))
        self.assertIn('worktree_mark', self.seat())
        self.run_tool('team', 'close', 'build')
        self.launch('--role', 'worker', '--read-only', '--worktree', str(root))
        (root / 'new-file').write_text('changed staged content\n')
        self.git(root, 'add', 'new-file')
        self.assertIn('worktree changed since launch', self.run_tool('team', 'close', 'build', ok=False).stderr)
        self.run_tool('team', 'close', 'build', '--force')

    def test_codex_worker_worktree_run_leaves_hook_files_untouched(self):
        worktree, run = self.base / 'worktree', self.base / 'run'
        worktree.mkdir()
        config = worktree / '.codex/hooks.json'
        config.parent.mkdir()
        original = {'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'existing-stop'}]}]}, 'other': True}
        config.write_text(json.dumps(original))
        original_bytes = config.read_bytes()
        self.launch('--role', 'worker', '--family', 'codex', '--worktree', str(worktree), '--run', str(run))
        seat = self.seat()
        self.assert_schema(seat)
        self.assertEqual(seat['root'], str(worktree))
        self.assertEqual(seat['extra_roots'], [str(run)])
        self.assertEqual(seat['inbox'], '')
        flags = self.flags()
        self.assertIn('model_reasoning_effort=medium', flags)
        self.assertIn('approval_policy=never', flags)
        self.assertIn(str(self.home), [flags[i + 1] for i, flag in enumerate(flags) if flag == '--add-dir'])
        self.assertFalse(any('bypass-hook-trust' in flag for flag in flags))
        self.assertEqual(flags[flags.index('-s') + 1], 'danger-full-access')
        self.assertEqual(flags[flags.index('-C') + 1], str(worktree))
        self.assertEqual(flags[-2:], ['--add-dir', str(run)])
        self.assertFalse(any('network_access' in flag for flag in flags))
        self.assertEqual(config.read_bytes(), original_bytes)
        self.assertFalse((self.root / '.codex').exists())
        self.assertFalse((Path(self.env['CODEX_HOME']) / 'hooks.json').exists())

    def test_codex_manager_and_explicit_effort(self):
        self.launch('--family', 'codex', '--model', 'gpt-6-astra', '--effort', 'high')
        flags = self.flags()
        self.assertEqual(flags[flags.index('-s') + 1], 'danger-full-access')
        self.assertIn('approval_policy=never', flags)
        self.assertIn(str(self.home), [flags[i + 1] for i, flag in enumerate(flags) if flag == '--add-dir'])
        self.assertFalse(any('bypass-hook-trust' in flag for flag in flags))
        self.assertIn('model_reasoning_effort=high', flags)
        self.assertEqual(self.seat()['model'], 'gpt-6-astra')

    def advisor(self, *extra, ok=True):
        return self.run_tool('launch', '--address', 'q-advisor', '--role', 'advisor',
                             '--route', 'advisor', '--run', str(self.base / 'argon run'),
                             '--parent', 'build', *extra, ok=ok)

    def test_advisor_requires_packet_before_any_herdr_call(self):
        result = self.advisor(ok=False)
        self.assertIn('--packet is required', result.stderr)
        self.assertEqual(self.calls(), [])
        self.assertEqual(list(self.home.iterdir()), [])

    def test_advisor_runs_in_parent_tab_without_agent_hooks_or_inbox(self):
        self.env['FAKE_BOOTSTRAP'] = '1'
        self.launch()
        parent = self.seat()
        packet = self.base / "packet ' with spaces.md"
        packet.write_text('same sanitized facts; no other answers')
        before = len(self.calls())
        self.advisor('--packet', str(packet))
        seat = self.seat('q-advisor')
        self.assert_schema(seat)
        self.assertEqual((seat['role'], seat['family'], seat['tab']), ('advisor', 'agy', 'build'))
        self.assertEqual((seat['model'], seat['effort']), ('gemini-4-argon-high', 'high'))
        self.assertEqual(seat['inbox'], '')
        self.assertNotIn('hooks', seat)
        self.assertNotIn('card', seat)
        self.assertFalse((self.home / 'inbox').exists())
        self.assertEqual(seat['root'], seat['run'])
        calls = self.calls()[before:]
        split = next(c for c in calls if c[:2] == ['pane', 'split'])
        self.assertEqual((split[2], split[split.index('--direction') + 1]), (parent['pane'], 'right'))
        self.assertFalse(any(c[0] == 'agent' for c in calls))
        self.assertIn(['pane', 'rename', seat['pane'], 'argon · advisor · argon-high'], calls)
        command = next(c for c in calls if c[:2] == ['pane', 'run'])
        self.assertEqual(command[2], seat['pane'])
        self.assertIn('--model gemini-4-argon-high --effort high', command[3])
        self.assertIn('--output-format text --print-timeout 15m', command[3])
        self.assertNotIn('--sandbox', command[3])
        # Execute the actual pane command against a fake agy, including a failed turn.
        fake = self.base / 'bin/agy'
        fake.write_text('#!/usr/bin/env python3\nimport json, sys\n'
                        'print(json.dumps(sys.argv[1:]))\n'
                        'print("diagnostic", file=sys.stderr)\nsys.exit(7)\n')
        fake.chmod(0o755)
        subprocess.run(['sh', '-c', command[3]], env=self.env, check=True)
        run = Path(seat['run'])
        self.assertEqual(json.loads((run / 'result.md').read_text()),
                         ['-p', packet.read_text(), '--model', 'gemini-4-argon-high',
                          '--effort', 'high', '--output-format', 'text', '--print-timeout', '15m'])
        self.assertEqual((run / 'rc').read_text(), '7\n')
        self.assertEqual((run / 'stderr.log').read_text(), 'diagnostic\n')
        # Advisors participate in the same live child pane chain as workers.
        self.worker('after-advisor', 'build')
        split = next(c for c in reversed(self.calls()) if c[:2] == ['pane', 'split'])
        self.assertEqual((split[2], split[split.index('--direction') + 1]), (seat['pane'], 'down'))
        self.run_tool('team', 'close', 'q-advisor')
        self.assertFalse((self.home / 'seats/q-advisor.json').exists())
        self.assertEqual(self.calls()[-1], ['pane', 'close', seat['pane']])

    def test_advisor_splits_down_from_last_live_worker(self):
        self.env['FAKE_BOOTSTRAP'] = '1'
        self.launch()
        self.worker('first', 'build')
        packet = self.base / 'packet.md'
        packet.write_text('sanitized facts')
        self.advisor('--packet', str(packet))
        split = next(c for c in reversed(self.calls()) if c[:2] == ['pane', 'split'])
        self.assertEqual((split[2], split[split.index('--direction') + 1]),
                         (self.seat('first')['pane'], 'down'))
        self.assertEqual(self.seat('q-advisor')['tab'], 'build')

    def test_advisor_dry_run_prints_pane_command_without_side_effects(self):
        packet = self.base / 'packet.md'
        packet.write_text('sanitized packet')
        result = self.advisor('--packet', str(packet), '--dry-run')
        lines = [shlex.split(line) for line in result.stdout.splitlines() if not line.startswith('#')]
        self.assertEqual([line[1:3] for line in lines],
                         [['tab', 'list'], ['pane', 'list'], ['pane', 'split'],
                          ['pane', 'rename'], ['pane', 'run']])
        self.assertIn(str(packet), lines[-1][4])
        self.assertIn('agy -p', lines[-1][4])
        self.assertEqual(self.calls(), [])
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse((self.base / 'argon run').exists())

    def test_dry_run_no_writes_or_herdr_and_full_commands(self):
        for extra in [[], ['--family', 'codex', '--role', 'worker', '--worktree', str(self.base / 'new-worktree'),
                           '--run', str(self.base / 'run')]]:
            result = self.launch('--dry-run', *extra)
            lines = [shlex.split(line) for line in result.stdout.splitlines() if not line.startswith('#')]
            self.assertEqual([line[1:3] for line in lines],
                             [['tab', 'list'], ['pane', 'list'], ['pane', 'split'], ['pane', 'rename'], ['agent', 'start']])
            self.assertIn('--env', lines[2])
            self.assertIn('--settings' if not extra else '--add-dir', lines[-1])
            if extra:
                self.assertFalse(any('bypass-hook-trust' in flag for flag in lines[-1]))
            else:
                settings = json.loads(lines[-1][lines[-1].index('--settings') + 1])
                self.assertEqual(settings['hooks']['Stop'][0]['hooks'][0]['command'], self.guard('stop'))
        self.assertEqual(self.calls(), [])
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse((self.base / 'new-worktree').exists())
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertFalse(Path(self.env['CODEX_HOME']).exists())

    def test_install_idempotent_preserves_foreign_entry_contents_and_order(self):
        path = Path(self.env['CODEX_HOME']) / 'hooks.json'
        path.parent.mkdir()
        foreign = '{ "matcher" : "startup",\r\n "hooks" : [{ "command" : "echo \\u263a", "type":"command" }] }'
        second = '{"hooks":[{"type":"command", "command":"echo KILN_HOME"}]}'
        path.write_bytes(('{\r\n "description":"keep me", "hooks":{"SessionStart":['
                          + foreign + ',' + second + ']}\r\n}\r\n').encode())
        sentinels = [path.parent / 'config.toml', Path(self.env['HOME']) / '.claude/settings.json',
                     self.root / '.claude/settings.json']
        for sentinel in sentinels:
            sentinel.parent.mkdir(parents=True, exist_ok=True)
            sentinel.write_bytes(b'untouched\r\n')
        self.env.pop('KILN_HOME')  # Setup is independent of seat launches.
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        installed = path.read_bytes()
        self.assertEqual(json.loads(installed)['hooks']['SessionStart'][:2], [json.loads(foreign), json.loads(second)])
        self.assertEqual(list(json.loads(installed)), ['description', 'hooks'])
        parsed = json.loads(installed)
        self.assertEqual(set(parsed['hooks']), {'Stop', 'SessionStart', 'PreToolUse'})
        for event, script in [('Stop', 'stop'), ('SessionStart', 'start'), ('PreToolUse', 'fence')]:
            self.assertEqual(parsed['hooks'][event][-1]['hooks'][0]['command'], self.guard(script))
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        self.assertEqual(path.read_bytes(), installed)
        self.run_tool('launch', 'uninstall-hooks', '--family', 'codex')
        self.assertEqual(json.loads(path.read_bytes())['description'], 'keep me')
        self.assertEqual(json.loads(path.read_bytes())['hooks']['SessionStart'],
                         [json.loads(foreign), json.loads(second)])
        uninstalled = path.read_bytes()
        self.run_tool('launch', 'uninstall-hooks', '--family', 'codex')
        self.assertEqual(path.read_bytes(), uninstalled)
        self.assertTrue(all(p.read_bytes() == b'untouched\r\n' for p in sentinels))
        self.assertEqual(self.calls(), [])

    def test_uninstall_mixed_group_removes_only_matching_commands(self):
        path = Path(self.env['CODEX_HOME']) / 'hooks.json'
        path.parent.mkdir()
        foreign = '{ "type":"command", "command":"echo keep", "timeout": 1 }'
        mcp = '{"type":"mcp_tool", "server":"keep", "tool":"KILN_SEAT"}'
        kiln = json.dumps({'type': 'command', 'command': self.guard('stop')})
        group = '{"matcher":"KILN_SEAT", "hooks":[' + kiln + ',' + foreign + ',' + mcp + ']}'
        path.write_text('{"hooks":{"Stop":[' + group + '],"SessionEnd":[{"hooks":[' + kiln + ']}]}}')
        self.run_tool('launch', 'uninstall-hooks', '--family', 'codex')
        data = json.loads(path.read_bytes())
        self.assertEqual(data['hooks']['Stop'], [{'matcher': 'KILN_SEAT', 'hooks': [json.loads(foreign), json.loads(mcp)]}])
        self.assertEqual(data['hooks']['SessionEnd'], [])

    def test_setup_default_home_dry_run_and_absent_uninstall(self):
        del self.env['CODEX_HOME']
        path = Path(self.env['HOME']) / '.codex/hooks.json'
        self.run_tool('launch', 'uninstall-hooks', '--family', 'codex')
        self.assertFalse(path.parent.exists())
        dry = self.run_tool('launch', 'install-hooks', '--family', 'codex', '--dry-run')
        self.assertIn(str(path), dry.stdout)
        self.assertFalse(path.parent.exists())
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        before = path.read_bytes()
        self.run_tool('launch', 'uninstall-hooks', '--family', 'codex', '--dry-run')
        self.assertEqual(path.read_bytes(), before)

    def test_guards_exit_silently_without_a_seat_and_execute_with_one(self):
        launch = load_launcher()
        hook_dir = self.base / "plugin with ' quotes" / "hooks"
        hook_dir.mkdir(parents=True)
        marker = hook_dir / 'marker'
        script = hook_dir / 'stop.sh'
        script.write_text('#!/bin/sh\nprintf fired > ' + shlex.quote(str(marker)) + '\n')
        script.chmod(0o755)
        with patch.object(launch, 'HOOKS', hook_dir):
            command = launch.hooks('manager')['Stop'][0]['hooks'][0]['command']
        env = dict(self.env)
        env.pop('KILN_SEAT', None)
        env.pop('KILN_PLUGIN', None)
        for seat in (None, '', str(self.base / 'missing.json')):
            if seat is not None:
                env['KILN_SEAT'] = seat
            result = subprocess.run(shlex.split(command), env=env, capture_output=True, text=True)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))
            self.assertFalse(marker.exists())
        seat = self.base / 'seat.json'
        seat.write_text('{}')
        env['KILN_SEAT'] = str(seat)
        result = subprocess.run(shlex.split(command), env=env, capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))
        self.assertFalse(marker.exists())
        env['KILN_PLUGIN'] = str(hook_dir.parent)
        result = subprocess.run(shlex.split(command), env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_text(), 'fired')

    def test_tab_id_and_bridge_label_resolution(self):
        self.launch('--tab', 'w-test:t2', '--role', 'gravedigah')
        self.assertEqual(self.calls()[2][2], 'w-test:p2')
        self.assertEqual(self.seat()['tab'], 'bridge')

    def test_workers_default_to_parent_tab_and_live_worker_chain(self):
        self.env['FAKE_BOOTSTRAP'] = '1'
        self.launch()
        parent = self.seat()
        for address in ('first', 'second'):
            self.run_tool('launch', '--address', address, '--role', 'worker',
                          '--parent', 'build', '--root', str(self.root),
                          '--run', str(self.base / address))
            self.assertEqual(self.seat(address)['tab'], 'build')
        splits = [c for c in self.calls() if c[:2] == ['pane', 'split']]
        self.assertEqual([(c[2], c[c.index('--direction') + 1]) for c in splits],
                         [('w-test:p1', 'down'), (parent['pane'], 'right'),
                          (self.seat('first')['pane'], 'down')])
        self.assertFalse(any(c[:2] == ['tab', 'create'] for c in self.calls()))

    def test_worker_ignores_closed_worker_and_honors_explicit_split_controls(self):
        self.launch()
        parent = self.seat()
        stale = dict(parent, address='stale', role='worker', pane='w-test:gone')
        (self.home / 'seats/stale.json').write_text(json.dumps(stale))
        self.run_tool('launch', '--address', 'first', '--role', 'worker', '--parent', 'build',
                      '--root', str(self.root), '--run', str(self.base / 'first'))
        split = [c for c in self.calls() if c[:2] == ['pane', 'split']][-1]
        self.assertEqual((split[2], split[split.index('--direction') + 1]), (parent['pane'], 'right'))
        self.launch('--from', 'w-test:p2', '--direction', 'right', '--ratio', '0.78')
        split = [c for c in self.calls() if c[:2] == ['pane', 'split']][-1]
        self.assertEqual((split[2], split[split.index('--ratio') + 1]), ('w-test:p2', '0.78'))

    def worker(self, address='first', parent='build', *extra, ok=True):
        return self.run_tool('launch', '--address', address, '--role', 'worker',
                             '--parent', parent, '--root', str(self.root),
                             '--run', str(self.base / address), *extra, ok=ok)

    def test_bridge_workers_use_bridge_work_tab_and_chain_down(self):
        self.env['FAKE_BOOTSTRAP'] = '1'
        self.launch('--tab', 'bridge', '--role', 'orchestrator', '--address', 'orchestrator')
        self.worker('first', 'orchestrator')
        first = self.seat('first')
        self.worker('second', 'orchestrator')
        self.assertEqual((first['tab'], self.seat('second')['tab']), ('bridge-work', 'bridge-work'))
        splits = [c for c in self.calls() if c[:2] == ['pane', 'split']]
        self.assertEqual([(c[2], c[c.index('--direction') + 1]) for c in splits[1:]],
                         [('w-test:p-new', 'down'), (first['pane'], 'down')])
        created = [c for c in self.calls() if c[:2] == ['tab', 'create']]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0][created[0].index('--label') + 1], 'bridge-work')
        self.assertIn(['pane', 'close', 'w-test:p-new'], self.calls())

    def test_worker_explicit_different_tab_is_honored(self):
        self.launch()
        self.worker('first', 'build', '--tab', 'other-workers')
        self.assertEqual(self.seat('first')['tab'], 'other-workers')
        split = [c for c in self.calls() if c[:2] == ['pane', 'split']][-1]
        self.assertEqual(split[2], 'w-test:p-new')

    def test_worker_without_parent_tab_and_manager_without_tab_fail(self):
        (self.home / 'seats').mkdir()
        (self.home / 'seats/build.json').write_text(json.dumps({'pane': 'w-test:p1'}))
        result = self.worker(ok=False)
        self.assertIn('parent seat tab', result.stderr)
        result = self.run_tool('launch', '--address', 'plan', '--role', 'manager',
                               '--parent', 'build', '--root', str(self.root), ok=False)
        self.assertIn('--tab is required', result.stderr)
        self.assertEqual(self.calls(), [])
        self.assertFalse((self.home / 'seats/first.json').exists())

    def test_dry_worker_unknown_parent_and_split_plan(self):
        for content in (None, '{broken', '[]', '{}'):
            with self.subTest(content=content):
                path = self.home / 'seats/build.json'
                if content is not None:
                    path.parent.mkdir(exist_ok=True)
                    path.write_text(content)
                result = self.worker('first', 'build', '--dry-run')
                self.assertIn("# parent tab unknown in dry-run; using build's tab", result.stdout)
                self.assertEqual(result.stdout.count('herdr pane list'), 1)
                self.assertLess(result.stdout.index('herdr agent start'), result.stdout.index('close its root'))
        result = self.worker('first', 'build', '--dry-run', '--from', 'w-test:p1')
        self.assertNotIn('herdr pane close', result.stdout)
        self.assertEqual(self.calls(), [])

    def test_corrupt_worker_seats_warn_and_do_not_block_launch(self):
        self.launch()
        for name, content in (('bad', '{broken'), ('array', '[]')):
            (self.home / f'seats/{name}.json').write_text(content)
        result = self.worker()
        self.assertIn('ignoring corrupt seat bad', result.stderr)
        self.assertIn('ignoring corrupt seat array', result.stderr)
        split = [c for c in self.calls() if c[:2] == ['pane', 'split']][-1]
        self.assertEqual(split[2], self.seat()['pane'])

    def test_ratio_rejected_before_any_seat_write_or_herdr_call(self):
        for ratio in ('0', '1', '-0.1', '1.1', 'nan', 'inf'):
            with self.subTest(ratio=ratio):
                self.assertIn('--ratio must be', self.launch('--ratio', ratio, ok=False).stderr)
        self.assertFalse((self.home / 'seats/build.json').exists())
        self.assertEqual(self.calls(), [])

    def test_created_tab_split_failure_closes_root_and_restores_seat(self):
        self.env['FAKE_FAIL'] = 'pane split'
        result = self.launch('--tab', 'plan', ok=False)
        self.assertIn('canned failure', result.stderr)
        self.assertEqual(self.calls()[-1], ['pane', 'close', 'w-test:p-new'])
        self.assertFalse((self.home / 'seats/build.json').exists())
        self.assertFalse(any(c[:2] == ['agent', 'start'] for c in self.calls()))

    def test_agent_start_failure_reads_tail_closes_panes_and_restores_seat(self):
        previous = {'address': 'build', 'pane': 'old-pane'}
        path = self.home / 'seats/build.json'
        path.parent.mkdir()
        path.write_text(json.dumps(previous))
        self.env['FAKE_FAIL'] = 'agent start'
        result = self.launch('--tab', 'plan', ok=False)
        self.assertIn('fake pane tail: native startup failed', result.stderr)
        self.assertIn('canned failure', result.stderr)
        calls = self.calls()
        started = next(i for i, c in enumerate(calls) if c[:2] == ['agent', 'start'])
        self.assertEqual(calls[started + 1:], [['pane', 'read', 'w-test:p3', '--lines', '20'],
                                             ['pane', 'close', 'w-test:p3'],
                                             ['pane', 'close', 'w-test:p-new']])
        self.assertEqual(json.loads(path.read_text()), previous)

    def test_root_close_failure_warns_and_keeps_running_seat(self):
        self.env['FAKE_FAIL'] = 'pane close'
        result = self.launch('--tab', 'plan')
        self.assertIn('warning: could not close pane w-test:p-new', result.stderr)
        self.assertEqual(self.seat()['pane'], 'w-test:p3')
        self.assertEqual(self.calls()[-1], ['pane', 'close', 'w-test:p-new'])
        self.assertEqual(sum(c[:2] == ['agent', 'start'] for c in self.calls()), 1)

    def test_missing_tab_is_created_and_start_failure_is_not_retried(self):
        self.launch('--tab', 'plan')
        self.assertIn(['tab', 'create', '--workspace', 'w-test', '--label', 'plan',
                       '--cwd', str(self.root), '--no-focus'], self.calls())
        self.assertEqual(self.seat()['tab'], 'plan')
        calls = self.calls()
        split = next(i for i, c in enumerate(calls) if c[:2] == ['pane', 'split'])
        started = next(i for i, c in enumerate(calls) if c[:2] == ['agent', 'start'])
        self.assertLess(split, started)
        self.assertEqual(calls[started + 1], ['pane', 'close', 'w-test:p-new'])
        self.assertIn(['pane', 'split', 'w-test:p-new'], [c[:3] for c in self.calls()])
        previous = self.seat()
        self.env['FAKE_FAIL'] = 'agent start'
        self.launch(ok=False)
        self.assertEqual(sum(c[:2] == ['agent', 'start'] for c in self.calls()), 2)
        self.assertEqual(self.seat(), previous)

    def test_invalid_values_fail_before_herdr(self):
        for extra in [ ['--address', '../escape'], ['--family', 'codex'], ['--model', 'haiku'],
                       ['--effort', 'max'], ['--family', 'agy', '--model', 'gemini-4-argon-high'] ]:
            self.launch(*extra, ok=False)
        self.assertEqual(self.calls(), [])
        self.assertEqual(list(self.home.iterdir()), [])

    def test_help_without_environment(self):
        self.env.pop('KILN_HOME')
        self.run_tool('launch', '--help')

    def test_routing_boss_override_and_defaults(self):
        launch = load_launcher()
        routing = (PLUGIN / 'config/routing.toml').read_text()
        (self.base / 'routing.toml').write_text(routing.replace('bosses = "claude"', 'bosses = "gpt"'))
        with patch.object(launch, 'CONFIG', self.base):
            for role, model in [('boss', 'gpt-6-astra'), ('orchestrator', 'gpt-6.1-sol'), ('gravedigah', 'gpt-6.1-sol')]:
                args = argparse.Namespace(role=role, family='codex', model=None, effort=None)
                self.assertEqual(launch.routing(args), ('balanced', model, 'medium'))
            args.model, args.effort = 'gpt-6.1-sol', 'low'
            self.assertEqual(launch.routing(args), ('balanced', 'gpt-6.1-sol', 'low'))

    def copy_plugin(self):
        target = self.base / 'installed copy'
        (target / 'bin').mkdir(parents=True)
        shutil.copy2(PLUGIN / 'bin/launch', target / 'bin/launch')
        shutil.copytree(PLUGIN / 'config', target / 'config')
        shutil.copytree(PLUGIN / 'lib', target / 'lib')
        shutil.copytree(PLUGIN / 'hooks', target / 'hooks')
        shutil.copytree(PLUGIN / 'cards', target / 'cards')
        return target

    def test_installed_copy_has_config_and_infers_gpt_boss_family(self):
        target = self.copy_plugin()
        routing = target / 'config/routing.toml'
        routing.write_text(routing.read_text().replace('bosses = "claude"', 'bosses = "gpt"'))
        subprocess.run([str(target / 'bin/launch'), '--help'], env=self.env,
                       capture_output=True, text=True, check=True)
        args = [str(target / 'bin/launch'), '--tab', 'bridge', '--address', 'boss',
                '--role', 'boss', '--root', str(self.root), '--parent', '', '--dry-run']
        result = subprocess.run(args, env=self.env, capture_output=True, text=True, check=True)
        self.assertIn('--kind codex', result.stdout)
        self.assertIn('--model gpt-6-astra', result.stdout)
        self.assertNotIn('bypass-hook-trust', result.stdout)
        self.assertIn('--add-dir ' + str(self.home), result.stdout)
        self.assertEqual(self.calls(), [])

    def test_reinstall_from_another_copy_replaces_old_kiln_commands(self):
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        target = self.copy_plugin()
        subprocess.run([str(target / 'bin/launch'), 'install-hooks', '--family', 'codex'],
                       env=self.env, capture_output=True, text=True, check=True)
        data = json.loads((Path(self.env['CODEX_HOME']) / 'hooks.json').read_text())
        for groups in data['hooks'].values():
            self.assertEqual(len(groups), 1)
            command = groups[0]['hooks'][0]['command']
            self.assertNotIn(str(PLUGIN), command)
            self.assertIn('$KILN_PLUGIN/hooks/', shlex.split(command)[2])

    def test_malformed_hook_json_is_reported_without_writing(self):
        path = Path(self.env['CODEX_HOME']) / 'hooks.json'
        path.parent.mkdir()
        for original in ('broken', '{"hooks": []}', '{"hooks":{"Stop":false}}', '{"hooks":{"Stop":[3]}}'):
            for operation in ('install-hooks', 'uninstall-hooks'):
                path.write_text(original)
                result = self.run_tool('launch', operation, '--family', 'codex', ok=False)
                self.assertNotIn('Traceback', result.stderr)
                self.assertEqual(path.read_text(), original)

    def test_nonobject_handlers_survive_uninstall_without_a_traceback(self):
        path = Path(self.env['CODEX_HOME']) / 'hooks.json'
        path.parent.mkdir()
        foreign = ['keep', None, 1, {'type': 'command', 'command': 'keep'}]
        handlers = foreign + [{'type': 'command', 'command': self.guard('stop')}]
        path.write_text(json.dumps({'hooks': {'Stop': [{'hooks': handlers}]}}))
        self.run_tool('launch', 'uninstall-hooks', '--family', 'codex')
        self.assertEqual(json.loads(path.read_text())['hooks']['Stop'][0]['hooks'], foreign)

    def test_install_and_uninstall_write_through_a_symlink(self):
        path = Path(self.env['CODEX_HOME']) / 'hooks.json'
        path.parent.mkdir()
        target = self.base / 'shared-hooks.json'
        target.write_text('{"description":"keep","hooks":{}}')
        target.chmod(0o640)
        path.symlink_to(target)
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        self.assertTrue(path.is_symlink())
        self.assertEqual(target.stat().st_mode & 0o777, 0o640)
        self.assertIn('Stop', json.loads(target.read_text())['hooks'])
        self.run_tool('launch', 'uninstall-hooks', '--family', 'codex')
        self.assertTrue(path.is_symlink())
        self.assertEqual(json.loads(target.read_text())['description'], 'keep')

    def test_failed_split_removes_seat_without_start_or_retry(self):
        self.env['FAKE_FAIL'] = 'pane split'
        self.launch(ok=False)
        self.assertFalse((self.home / 'seats/build.json').exists())
        self.assertEqual(sum(c[:2] == ['pane', 'split'] for c in self.calls()), 1)
        self.assertFalse(any(c[:2] == ['agent', 'start'] for c in self.calls()))

    def test_replacing_a_different_pane_warns_but_same_pane_does_not(self):
        self.launch()
        path = self.home / 'seats/build.json'
        seat = self.seat()
        seat['pane'] = 'old-pane'
        path.write_text(json.dumps(seat))
        self.assertIn('replacing build from pane old-pane', self.launch().stderr)
        self.assertNotIn('replacing', self.launch().stderr)

    def test_worktree_without_root_and_parent_validation(self):
        self.run_tool('launch', '--tab', 'build', '--address', 'impl', '--role', 'worker',
                      '--worktree', str(self.root), '--parent', 'build', '--run', str(self.base / 'impl-run'))
        self.assertEqual(self.seat('impl')['root'], str(self.root))
        self.assertEqual(self.seat('impl')['family'], 'codex')
        before = self.calls()
        self.launch('--parent', '../bad', ok=False)
        self.assertEqual(self.calls(), before)
        self.assertTrue((self.home / 'seats/impl.json').exists())

    def test_claude_lean_routing_and_boss_override(self):
        launch = load_launcher()
        routing = (PLUGIN / 'config/routing.toml').read_text().replace('active = "balanced"', 'active = "claude-lean"')
        for bosses in ('claude', 'gpt'):
            (self.base / 'routing.toml').write_text(routing.replace('bosses = "claude"', f'bosses = "{bosses}"'))
            with patch.object(launch, 'CONFIG', self.base):
                for role, model in (('manager', 'claude-opus-5-5'),
                                    ('boss', 'claude-opus-5-5' if bosses == 'claude' else 'gpt-6-astra'),
                                    ('orchestrator', 'claude-opus-5-5' if bosses == 'claude' else 'gpt-6.1-sol')):
                    args = argparse.Namespace(role=role, family=None, model=None, effort=None)
                    self.assertEqual(launch.routing(args), ('claude-lean', model, 'medium'))

    def test_team_routing_overrides_plugin_and_explicit_model_still_wins(self):
        project = self.base / 'repo'
        subprocess.run(['git', 'init', '-q', str(project)], check=True)
        (self.home / 'team.toml').write_text('lane="claude-lean"\nbosses="gpt"\nproject=' + json.dumps(str(project)) + '\n')
        for role, model in (('manager', 'claude-opus-5-5'), ('boss', 'gpt-6-astra'), ('orchestrator', 'gpt-6.1-sol')):
            self.launch('--role', role)
            self.assertEqual((self.seat()['lane'], self.seat()['model']), ('claude-lean', model))
        self.launch('--role', 'boss', '--model', 'claude-opus-5-5', '--effort', 'low')
        self.assertEqual((self.seat()['model'], self.seat()['effort']), ('claude-opus-5-5', 'low'))
        for content in ('lane="missing"', 'bosses="missing"', 'invalid = ['):
            (self.home / 'team.toml').write_text(content)
            before = self.calls()
            self.launch(ok=False)
            self.assertEqual(self.calls(), before)

    def test_default_role_cards_resolve_tab_label_and_workers_get_none(self):
        for role in ('boss', 'orchestrator', 'gravedigah', 'chunkmaster'):
            self.launch('--role', role)
            self.assertEqual(self.seat()['card'], str(PLUGIN / 'cards' / f'{role}.md'))
        self.launch('--tab', 'w-test:t1')
        self.assertEqual(self.seat()['card'], str(PLUGIN / 'cards/manager-build.md'))
        for tab in ('research', 'plan', 'build', 'verify', 'deploy', 'council'):
            # Dry-run needs no live tab and still maps every shipped manager card.
            result = self.launch('--tab', tab, '--dry-run')
            self.assertIn(str(PLUGIN / 'cards' / f'manager-{tab}.md'), result.stdout)
        self.launch('--role', 'worker')
        self.assertNotIn('card', self.seat())

    def test_parent_workspace_fallback_and_environment_precedence(self):
        self.env.pop('HERDR_WORKSPACE_ID')
        path = self.home / 'seats/orchestrator.json'
        path.parent.mkdir()
        path.write_text(json.dumps({'workspace': 'parent-workspace'}))
        self.launch('--tab', 'verify')
        self.assertEqual(self.seat()['workspace'], 'parent-workspace')
        self.assertIn(['tab', 'create', '--workspace', 'parent-workspace', '--label', 'verify',
                       '--cwd', str(self.root), '--no-focus'], self.calls())
        self.env['HERDR_WORKSPACE_ID'] = 'env-workspace'
        self.launch()
        self.assertEqual(self.seat()['workspace'], 'env-workspace')

    def test_retired_roles_refused_before_pane_creation(self):
        for role in ('director', 'super', 'helper'):
            with self.subTest(role=role):
                result = self.launch('--role', role, ok=False)
                self.assertIn('invalid choice', result.stderr)
                self.assertEqual(self.calls(), [])
                self.assertFalse((self.home / 'seats').exists())

    def test_missing_default_card_refuses_before_split(self):
        target = self.copy_plugin()
        (target / 'cards/boss.md').unlink()
        result = subprocess.run([str(target / 'bin/launch'), '--tab', 'bridge', '--address', 'boss',
                                 '--role', 'boss', '--model', 'gpt-6-astra', '--parent', '',
                                 '--root', str(self.root)], env=self.env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('default card not found', result.stderr)
        self.assertFalse(any(c[:2] == ['pane', 'split'] for c in self.calls()))

    def test_routes_select_lane_entries_and_explicit_overrides(self):
        for route, model, effort in [('research_gpt', 'gpt-6.1-sol', 'medium'),
                                     ('conceptual.0', 'gpt-6-astra', 'medium'),
                                     ('conceptual.1', 'claude-fable-5-1', 'medium')]:
            self.launch('--role', 'worker', '--route', route)
            self.assertEqual((self.seat()['model'], self.seat()['effort']), (model, effort))
        self.launch('--role', 'boss', '--route', 'research_gpt', '--model', 'gpt-6-astra', '--effort', 'high')
        self.assertEqual((self.seat()['model'], self.seat()['effort']), ('gpt-6-astra', 'high'))
        module = load_launcher()
        args = argparse.Namespace(role='worker', route='advisor', family=None, model=None, effort=None)
        with patch.dict('os.environ', self.env):
            self.assertEqual(module.routing(args), ('balanced', 'gemini-4-argon-high', 'high'))
        self.assertIn('--packet is required', self.launch('--route', 'advisor', ok=False).stderr)
        for route in ('missing', 'conceptual', 'conceptual.9', 'conceptual.-1'):
            before = self.calls()
            self.launch('--route', route, ok=False)
            self.assertEqual(self.calls(), before)

    def test_codex_product_tabs_add_git_common_dir_as_root(self):
        project = self.base / 'repo'
        subprocess.run(['git', 'init', '-q', str(project)], check=True)
        (self.home / 'team.toml').write_text('project=' + json.dumps(str(project)) + '\n')
        common = subprocess.check_output(['git', '-C', str(project), 'rev-parse', '--path-format=absolute',
                                          '--git-common-dir'], text=True).strip()
        for tab in ('build', 'verify', 'deploy'):
            self.launch('--tab', tab, '--role', 'worker')
            self.assertIn(common, self.seat()['extra_roots'])
            flags = self.flags()
            self.assertIn(common, [flags[i + 1] for i, flag in enumerate(flags) if flag == '--add-dir'])
        self.launch('--tab', 'research', '--role', 'worker')
        self.assertNotIn(common, self.seat()['extra_roots'])

    def test_claude_lean_complete_lane(self):
        import tomllib
        config = tomllib.loads((PLUGIN / 'config/routing.toml').read_text())
        lane = config['lanes']['claude-lean']
        self.assertEqual(set(lane), set(config['lanes']['balanced']))
        self.assertEqual(lane['manager'], dict(model='claude-opus-5-5', effort='medium'))
        for role in ('gravedigah', 'chunkmaster', 'implementer', 'investigator'):
            self.assertEqual(lane[role], dict(model='gpt-6.1-sol', effort='medium'))
        for role in ('mechanical', 'research_gpt', 'research_claude'):
            self.assertEqual(lane[role], dict(model='gpt-6.1-sol', effort='low'))
        for role, model in (('review_of_gpt', 'claude-opus-5-5'), ('review_of_claude', 'gpt-6-astra'),
                            ('ui_plan', 'gpt-6-astra'), ('ui_build', 'gpt-6.1-sol'), ('ui_review', 'claude-opus-5-5')):
            self.assertEqual(lane[role], dict(model=model, effort='medium'))
        self.assertEqual(lane['conceptual'], [dict(model='gpt-6-astra', effort='medium')])
        self.assertEqual(lane['operational'], [dict(model='gpt-6.1-sol', effort='medium'),
                                               dict(model='claude-opus-5-5', effort='medium')])
        self.assertEqual(lane['advisor'], dict(model='gemini-4-argon-high', effort='high'))

    def test_wait_ms_and_recorded_card_handoff_paths(self):
        card = self.base / 'cards' / 'build.md'
        handoff = self.base / 'handoff' / 'build.md'
        self.launch('--wait-ms', '7200000', '--card', str(card), '--handoff', str(handoff))
        seat = self.seat()
        self.assertEqual(seat['wait_ms'], 7200000)
        self.assertEqual(seat['extra_roots'], [])
        self.assertEqual(seat['card'], str(card))
        self.assertEqual(seat['handoff'], str(handoff))
        self.assertIn('KILN_PLUGIN=' + str(PLUGIN), self.calls()[2])
        self.launch('--wait-ms', '0', ok=False)

    def test_codex_matcher_and_plugin_env(self):
        self.launch('--role', 'gravedigah')
        self.assertIn('KILN_PLUGIN=' + str(PLUGIN), self.calls()[2])
        launch = load_launcher()
        self.assertEqual(launch.hooks('manager')['PreToolUse'][0]['matcher'], 'Bash|apply_patch')
        self.assertNotIn(str(PLUGIN), launch.hooks('manager')['Stop'][0]['hooks'][0]['command'])

    def test_required_run_and_wait_ms_schema(self):
        launch = load_launcher()
        self.launch()
        seat = self.seat()
        self.assertEqual(seat['run'], str(self.root))
        for key in ('run', 'wait_ms'):
            self.assertIn(key, launch.SCHEMA['required'])
            incomplete = dict(seat)
            incomplete.pop(key)
            with self.assertRaises(ValueError):
                launch.validate(incomplete)
        before = self.calls()
        result = self.run_tool('launch', '--tab', 'build', '--address', 'impl', '--role', 'worker',
                              '--root', str(self.root), '--parent', 'build', ok=False)
        self.assertIn('--run is required', result.stderr)
        self.assertEqual(self.calls(), before)
        self.launch('--role', 'worker', '--run', str(self.base / 'impl-run'))
        self.assertEqual(self.seat()['run'], str(self.base / 'impl-run'))

    def test_codex_card_handoff_paths_do_not_add_writable_directories(self):
        card, handoff = self.base / 'cards/build.md', self.base / 'handoffs/build.md'
        self.launch('--family', 'codex', '--role', 'gravedigah', '--card', str(card), '--handoff', str(handoff))
        self.assertEqual(self.seat()['extra_roots'], [])
        flags = self.flags()
        self.assertNotIn(str(card.parent), flags)
        self.assertNotIn(str(handoff.parent), flags)
        self.assertNotIn('--dangerously-bypass-hook-trust', flags)

    def test_routing_defaults_and_pane_role_words(self):
        launch = load_launcher()
        for role, model in [('manager', 'claude-opus-5-5'), ('gravedigah', 'gpt-6.1-sol'),
                            ('chunkmaster', 'gpt-6.1-sol')]:
            args = argparse.Namespace(role=role, family=None, model=None, effort=None)
            self.assertEqual(launch.routing(args), ('balanced', model, 'medium'))
        for role, label in [('boss', 'boss'), ('orchestrator', 'orchestrator'), ('manager', 'build manager'),
                            ('gravedigah', 'gravedigah'), ('chunkmaster', 'chunk master'), ('worker', 'worker')]:
            self.launch('--role', role)
            self.assertEqual(self.calls()[-2][3].split(' · ')[1], label)

    def test_dry_run_without_home_and_plain_missing_env_message(self):
        self.env.pop('KILN_HOME')
        self.assertIn('KILN_HOME is required', self.launch(ok=False).stderr)
        result = self.launch('--role', 'worker', '--dry-run')
        self.assertIn('<KILN_HOME>', result.stdout)
        self.assertIn('--add-dir', result.stdout)
        self.assertEqual(self.calls(), [])

    def test_missing_hooks_warn_without_refusal_and_install_clears_warning(self):
        result = self.launch('--role', 'gravedigah')
        self.assertIn('warning: Codex Kiln hooks are not installed', result.stderr)
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        self.assertNotIn('not installed', self.launch('--role', 'gravedigah').stderr)

    def test_failed_relaunch_restores_the_previous_record(self):
        self.launch()
        path = self.home / 'seats/build.json'
        previous = self.seat() | {'pane': 'previous-pane'}
        for failure in ('pane split', 'agent start'):
            path.write_text(json.dumps(previous))
            self.env['FAKE_FAIL'] = failure
            self.launch(ok=False)
            self.assertEqual(self.seat(), previous)

    def test_corrupt_previous_record_warns_and_does_not_block_launch(self):
        path = self.home / 'seats/build.json'
        path.parent.mkdir()
        for corrupt in ('broken json', '[]'):
            path.write_text(corrupt)
            result = self.launch()
            self.assertIn('previous seat', result.stderr)
            self.assertIn('warning', result.stderr)
            self.assertEqual(self.seat()['pane'], 'w-test:p3')

    def test_hook_setup_skips_unchanged_writes(self):
        launch = load_launcher()
        path = self.base / 'hooks.json'
        path.write_text('{ "description" : "foreign" }\n')
        original = path.read_bytes()
        with patch.object(launch, 'hooks_path', return_value=path), patch('builtins.print'):
            launch.manage_hooks(False, False)
            self.assertEqual(path.read_bytes(), original)
            launch.manage_hooks(True, False)
            with patch.object(launch, 'write_json') as write:
                launch.manage_hooks(True, False)
                write.assert_not_called()
            launch.manage_hooks(False, False)
            with patch.object(launch, 'write_json') as write:
                launch.manage_hooks(False, False)
                write.assert_not_called()

    def test_schema_includes_agy_advisor_and_argon_seats(self):
        schema = load_launcher().SCHEMA
        self.assertIn('agy', schema['properties']['family']['enum'])
        self.assertIn('advisor', schema['properties']['role']['enum'])
        self.assertIn('gemini-4-argon-high', schema['properties']['model']['enum'])

    def test_install_prints_review_and_exact_keys_with_foreign_indexes(self):
        path = Path(self.env['CODEX_HOME']) / 'hooks.json'
        path.parent.mkdir()
        path.write_text(json.dumps({'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'foreign'}]}]}}))
        result = self.run_tool('launch', 'install-hooks', '--family', 'codex')
        self.assertIn(load_launcher().REVIEW_STEPS, result.stdout)
        self.assertIn('codex --no-daemon --no-alt-screen -s read-only -C /absolute/empty-folder', result.stdout)
        self.assertIn('Esc then Ctrl-D', result.stdout)
        for suffix in ('stop:1:0', 'pre_tool_use:0:0', 'session_start:0:0'):
            self.assertIn(str(path.resolve()) + ':' + suffix, result.stdout.splitlines())
        self.assertFalse((path.parent / 'config.toml').exists())

    def test_codex_trust_config_present_absent_and_malformed_never_refuses(self):
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        path = Path(self.env['CODEX_HOME']) / 'hooks.json'
        config = path.parent / 'config.toml'
        keys = [str(path.resolve()) + ':' + suffix for suffix in
                ('stop:0:0', 'pre_tool_use:0:0', 'session_start:0:0')]
        def trusted(key):
            return '[hooks.state.' + json.dumps(key) + ']\ntrusted_hash = "sha256:reviewed"\n'
        cases = [None, 'invalid = [', 'model = "gpt-6.1-sol"\n', 'hooks = []\n',
                 'hooks.state = []\n', '[hooks.state.' + json.dumps(keys[0]) + ']\nenabled = true\n',
                 ''.join(trusted(key) for key in keys), ''.join(trusted(key) for key in keys[:2])]
        for source in cases:
            with self.subTest(config=source):
                if source is None:
                    config.unlink(missing_ok=True)
                else:
                    config.write_text(source)
                errors = io.StringIO()
                with patch.dict('os.environ', self.env), contextlib.redirect_stderr(errors):
                    load_launcher().warn_missing_hooks()
                warnings = [line for line in errors.getvalue().splitlines() if 'need /hooks review' in line]
                if source == cases[-2]:
                    self.assertEqual(warnings, [])
                else:
                    self.assertEqual(len(warnings), 1)
                    expected = keys[-1:] if source == cases[-1] else keys
                    for key in expected:
                        self.assertIn(key, warnings[0])
                if source is None:
                    self.assertFalse(config.exists())
                else:
                    self.assertEqual(config.read_text(), source)

    def test_trust_keys_use_the_source_path_when_hooks_file_is_a_symlink(self):
        path = Path(self.env['CODEX_HOME']) / 'hooks.json'
        path.parent.mkdir()
        target = self.base / 'shared-hooks.json'
        target.write_text('{}')
        path.symlink_to(target)
        result = self.run_tool('launch', 'install-hooks', '--family', 'codex')
        keys = [str(path) + ':' + suffix for suffix in ('stop:0:0', 'pre_tool_use:0:0', 'session_start:0:0')]
        self.assertTrue(all(key in result.stdout.splitlines() for key in keys))
        config = path.parent / 'config.toml'
        config.write_text(''.join('[hooks.state.' + json.dumps(key) + ']\ntrusted_hash = "sha256:reviewed"\n' for key in keys))
        self.assertNotIn('need /hooks review', self.launch('--role', 'gravedigah').stderr)
        self.assertTrue(path.is_symlink())

    def test_split_direction_defaults_down_and_accepts_right(self):
        self.launch()
        split = self.calls()[2]
        self.assertEqual(split[split.index('--direction') + 1], 'down')
        self.launch('--direction', 'right')
        split = self.calls()[-3]
        self.assertEqual(split[split.index('--direction') + 1], 'right')
        self.launch('--direction', 'left', ok=False)

    def test_codex_launch_never_creates_or_changes_profile_files(self):
        profile = Path(self.env['CODEX_HOME'])
        self.launch('--role', 'gravedigah')
        self.assertFalse(profile.exists())
        profile.mkdir()
        config = profile / 'config.toml'
        config.write_text('broken = [')
        original = config.read_bytes()
        profile.chmod(0o500)
        try:
            self.launch('--role', 'gravedigah')
            self.assertEqual(config.read_bytes(), original)
            self.assertEqual(list(profile.iterdir()), [config])
        finally:
            profile.chmod(0o700)

    def test_trusted_claude_root_or_ancestor_needs_no_lock_write_or_backup(self):
        path = Path(self.env['HOME']) / '.claude.json'
        path.parent.mkdir()
        for ancestor in (self.root, self.root.parent, Path('/')):
            original = json.dumps({'projects': {str(ancestor): {'hasTrustDialogAccepted': True}}})
            path.write_text(original)
            inode = path.stat().st_ino
            path.parent.chmod(0o500)
            try:
                self.launch()
                self.assertEqual(path.read_text(), original)
                self.assertEqual(path.stat().st_ino, inode)
                self.assertEqual(list(path.parent.iterdir()), [path])
            finally:
                path.parent.chmod(0o700)

    def test_claude_ancestor_keys_are_exact_resolved_paths_and_boolean_true(self):
        module = load_launcher()
        def content(key, flag=True):
            return json.dumps({'projects': {key: {'hasTrustDialogAccepted': flag}}})
        for key in (str(self.root) + '-other', str(self.root.parent) + '/.', 'relative'):
            self.assertFalse(module.trust_flag(content(key), str(self.root)))
        for flag in (1, 'true', False):
            self.assertFalse(module.trust_flag(content(str(self.root.parent), flag), str(self.root)))
        alias = self.base / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        self.assertTrue(module.trust_flag(content(str(self.root)), str(alias / 'child')))

    def test_readonly_claude_directory_refuses_before_any_herdr_call(self):
        path = Path(self.env['HOME']) / '.claude.json'
        path.parent.mkdir()
        path.write_text('{}')
        path.parent.chmod(0o500)
        try:
            result = self.launch(ok=False)
            self.assertIn(str(self.root), result.stderr)
            self.assertIn('put seat roots under a folder Claude already trusts', result.stderr)
            self.assertEqual(len(result.stderr.splitlines()), 1)
            self.assertEqual(path.read_text(), '{}')
            self.assertEqual(list(path.parent.iterdir()), [path])
            self.assertFalse((self.home / 'seats').exists())
            self.assertEqual(self.calls(), [])
        finally:
            path.parent.chmod(0o700)

    def test_claude_permission_errors_name_root_and_remedy_before_split(self):
        path = Path(self.env['HOME']) / '.claude.json'
        path.parent.mkdir()
        path.write_text('{}')
        for stage in ('trust_lock', 'backup_once', 'atomic_bytes'):
            for code in (errno.EACCES, errno.EPERM, errno.EROFS):
                module = load_launcher()
                args = ['launch', '--tab', 'build', '--address', 'build', '--role', 'manager',
                        '--root', str(self.root), '--parent', 'orchestrator']
                with patch.dict('os.environ', self.env), patch('sys.argv', args), \
                        patch.object(module, stage, side_effect=OSError(code, 'denied')), \
                        patch.object(module, 'herdr') as herdr, contextlib.redirect_stderr(io.StringIO()) as errors:
                    with self.assertRaises(SystemExit):
                        module.main()
                    herdr.assert_not_called()
                    self.assertEqual(len(errors.getvalue().splitlines()), 1)
                    self.assertIn(str(self.root), errors.getvalue())
                    self.assertIn('put seat roots under a folder Claude already trusts', errors.getvalue())
                self.assertEqual(path.read_text(), '{}')

    def test_prestart_recheck_accepts_newly_trusted_ancestor_without_lock(self):
        module = load_launcher()
        original = module.herdr
        path = Path(self.env['HOME']) / '.claude.json'
        def checked(args, dry_run):
            if args[:2] == ['pane', 'rename']:
                path.write_text(json.dumps({'projects': {str(self.root.parent): {'hasTrustDialogAccepted': True}}}))
            return original(args, dry_run)
        args = ['launch', '--tab', 'build', '--address', 'build', '--role', 'manager',
                '--root', str(self.root), '--parent', 'orchestrator']
        with patch.dict('os.environ', self.env), patch('sys.argv', args), \
                patch.object(module, 'trust_lock', wraps=module.trust_lock) as lock, \
                patch.object(module, 'herdr', side_effect=checked):
            module.main()
            self.assertEqual(lock.call_count, 1)
        self.assertTrue(module.trust_flag(path.read_bytes(), str(self.root)))
        self.assertNotIn(str(self.root), json.loads(path.read_text())['projects'])

    def test_claude_pretrust_minimal_merge_and_backup_once(self):
        path = Path(self.env['HOME']) / '.claude.json'
        path.parent.mkdir()
        original = {'account': 'keep', 'projects': {'/existing': {'hasTrustDialogAccepted': True},
                    str(self.root): {'hasTrustDialogAccepted': False, 'allowedTools': ['keep']}}}
        path.write_text(json.dumps(original))
        path.chmod(0o600)
        preimage = path.read_bytes()
        self.launch()
        expected = json.loads(preimage)
        expected['projects'][str(self.root)]['hasTrustDialogAccepted'] = True
        self.assertEqual(json.loads(path.read_text()), expected)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        backup = path.with_name('.claude.json.bak-kiln')
        self.assertEqual(backup.read_bytes(), preimage)
        trusted = path.read_bytes()
        self.launch()
        self.assertEqual(path.read_bytes(), trusted)
        self.launch('--root', str(self.base / 'second'))
        self.assertEqual(backup.read_bytes(), preimage)

    def test_claude_new_state_and_corrupt_state_preservation(self):
        path = Path(self.env['HOME']) / '.claude.json'
        self.launch()
        self.assertTrue(json.loads(path.read_text())['projects'][str(self.root)]['hasTrustDialogAccepted'])
        self.assertFalse(path.with_name('.claude.json.bak-kiln').exists())
        for source in ('invalid', '{"projects":[]}'):
            path.write_text(source)
            self.launch(ok=False)
            self.assertEqual(path.read_text(), source)
            self.assertFalse(path.with_name('.claude.json.bak-kiln').exists())

    def test_dry_run_describes_pretrust_and_backup_once_without_changes(self):
        path = Path(self.env['HOME']) / '.claude.json'
        path.parent.mkdir()
        original = '{"keep":true,"private":"private-canary"}'
        path.write_text(original)
        result = self.launch('--dry-run')
        self.assertIn(str(path), result.stdout)
        self.assertEqual(result.stdout.count('# backup'), 1)
        self.assertEqual(result.stdout.count('# set'), 1)
        self.assertIn('hasTrustDialogAccepted', result.stdout)
        self.assertNotIn('private-canary', result.stdout)
        self.assertEqual(path.read_text(), original)
        self.assertEqual(list(path.parent.iterdir()), [path])
        self.assertEqual(self.calls(), [])

    def test_pretrust_is_completed_before_agent_start(self):
        module = load_launcher()
        original = module.herdr
        def checked(args, dry_run):
            if args[:2] in (['pane', 'split'], ['agent', 'start']):
                data = json.loads((Path(self.env['HOME']) / '.claude.json').read_text())
                self.assertTrue(data['projects'][str(self.root)]['hasTrustDialogAccepted'])
            return original(args, dry_run)
        args = ['launch', '--tab', 'build', '--address', 'build', '--role', 'manager',
                '--root', str(self.root), '--parent', 'orchestrator']
        with patch.dict('os.environ', self.env), patch('sys.argv', args), patch.object(module, 'herdr', side_effect=checked):
            module.main()

    def test_pretrust_concurrent_processes_preserve_both_roots(self):
        script = ("import runpy, sys; m = runpy.run_path(sys.argv[1]); "
              "sys.stdin.readline(); m['pretrust'](sys.argv[2], False)")
        processes = [subprocess.Popen([sys.executable, '-c', script, str(PLUGIN / 'bin/launch'), root],
                     env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                     text=True) for root in ('/first', '/second')]
        try:
            for process in processes:
                process.stdin.write('go\n')
                process.stdin.flush()
            for process in processes:
                out, err = process.communicate(timeout=10)
                self.assertEqual(process.returncode, 0, out + err)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
        path = Path(self.env['HOME']) / '.claude.json'
        module = load_launcher()
        for root in ('/first', '/second'):
            self.assertTrue(module.trust_flag(path.read_bytes(), root))
        self.assertTrue(path.with_name(path.name + '.kiln.lock').exists())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_rechecks_and_reapplies_trust_just_before_start(self):
        module = load_launcher()
        original = module.herdr
        path = Path(self.env['HOME']) / '.claude.json'
        calls = []
        def checked(args, dry_run):
            calls.append(args[:2])
            if args[:2] == ['pane', 'rename']:
                path.write_text('{}')
            if args[:2] == ['agent', 'start']:
                self.assertTrue(module.trust_flag(path.read_bytes(), str(self.root)))
            return original(args, dry_run)
        args = ['launch', '--tab', 'build', '--address', 'build', '--role',
                'manager', '--root', str(self.root), '--parent', 'orchestrator']
        with patch.dict('os.environ', self.env), patch('sys.argv', args), patch.object(module, 'herdr', side_effect=checked):
            module.main()
        self.assertEqual(calls[-1], ['agent', 'start'])

    def test_post_write_verification_refuses_lost_trust_and_leaves_no_pane(self):
        module = load_launcher()
        def lost(path, content, mode):
            path.write_bytes(b'{}')
        args = ['launch', '--tab', 'build', '--address', 'build', '--role',
                'manager', '--root', str(self.root), '--parent', 'orchestrator']
        with patch.dict('os.environ', self.env), patch('sys.argv', args), patch.object(module, 'atomic_bytes', side_effect=lost), \
                patch.object(module, 'herdr') as herdr, contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(SystemExit):
                module.main()
            herdr.assert_not_called()
            self.assertIn('refusing launch', errors.getvalue())

    def test_failed_last_minute_reapply_refuses_start_after_one_attempt(self):
        module = load_launcher()
        original_herdr, original_write = module.herdr, module.atomic_bytes
        path = Path(self.env['HOME']) / '.claude.json'
        writes = []
        closed = []
        seat_path = self.home / 'seats/build.json'
        seat_path.parent.mkdir(exist_ok=True)
        previous = {'pane': 'old-pane', 'address': 'build'}
        seat_path.write_text(json.dumps(previous))
        def checked(args, dry_run):
            if args[:2] == ['pane', 'rename']:
                path.write_text('{}')
            self.assertNotEqual(args[:2], ['agent', 'start'])
            if args[:2] == ['pane', 'close']:
                closed.append(args)
            return original_herdr(args, dry_run)
        def lost_again(target, content, mode):
            original_write(target, content, mode)
            writes.append(target)
            if len(writes) == 2:
                target.write_bytes(b'{}')
        args = ['launch', '--tab', 'build', '--address', 'build', '--role',
                'manager', '--root', str(self.root), '--parent', 'orchestrator']
        with patch.dict('os.environ', self.env), patch('sys.argv', args), \
                patch.object(module, 'atomic_bytes', side_effect=lost_again), \
                patch.object(module, 'herdr', side_effect=checked), contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(SystemExit):
                module.main()
            self.assertIn('after re-apply; refusing launch', errors.getvalue())
        self.assertEqual(len(writes), 2)
        self.assertEqual(closed, [['pane', 'close', 'w-test:p3']])
        self.assertEqual(json.loads(seat_path.read_text()), previous)

    def test_atomic_trust_temp_is_private_and_fsynced_before_replace(self):
        module = load_launcher()
        path = self.base / 'private.json'
        real_replace = os.replace
        def checked(source, target):
            self.assertEqual(Path(source).parent, path.parent)
            self.assertEqual(Path(source).stat().st_mode & 0o777, 0o600)
            fsync.assert_called_once()
            real_replace(source, target)
        with patch.object(module.os, 'fsync', wraps=os.fsync) as fsync, patch.object(module.os, 'replace', side_effect=checked):
            module.atomic_bytes(path, b'private', 0o600)
        self.assertEqual(path.read_bytes(), b'private')
        self.assertEqual(list(self.base.glob('tmp*')), [])

    def test_backup_uses_parsed_snapshot_and_publishes_only_complete_bytes(self):
        module = load_launcher()
        path = self.base / 'config'
        path.write_bytes(b'changed after read')
        backup = path.with_name(path.name + '.bak-kiln')
        original_link = os.link
        def checked(source, target):
            self.assertFalse(backup.exists())
            self.assertEqual(Path(source).read_bytes(), b'parsed snapshot')
            self.assertEqual(Path(source).stat().st_mode & 0o777, 0o640)
            original_link(source, target)
        with patch.object(module.os, 'link', side_effect=checked):
            module.backup_once(path, b'parsed snapshot', 0o640, False)
        module.backup_once(path, b'later snapshot', 0o640, False)
        self.assertEqual(backup.read_bytes(), b'parsed snapshot')
        self.assertEqual(list(self.base.glob('tmp*')), [])

    def test_handoff_defaults_are_per_address_and_explicit_path_wins(self):
        self.launch()
        self.assertEqual(self.seat()['handoff'], str(self.root / 'handoff-build.md'))
        self.launch('--address', 'second')
        self.assertEqual(self.seat('second')['handoff'], str(self.root / 'handoff-second.md'))
        explicit = self.base / 'chosen.md'
        self.launch('--handoff', str(explicit))
        self.assertEqual(self.seat()['handoff'], str(explicit))
        self.assertFalse(explicit.exists())

    def test_start_prompts_unread_rows_once_and_does_not_prompt_received_rows(self):
        row = {'id': 'existing', 'to': 'build', 'kind': 'request'}
        (self.home / 'ledger.jsonl').write_text(json.dumps(row) + '\n')
        self.launch()
        self.assertEqual(self.calls()[-1], ['agent', 'prompt', 'build', 'inbox'])
        self.assertEqual(self.calls()[-2][:2], ['agent', 'start'])
        inbox = self.home / 'inbox/build.json'
        inbox.parent.mkdir()
        inbox.write_text(json.dumps({'read': ['existing']}))
        before = len(self.calls())
        self.launch()
        self.assertFalse(any(c[:2] == ['agent', 'prompt'] for c in self.calls()[before:]))

    def test_failed_startup_nudge_is_not_retried_and_seat_stays_started(self):
        (self.home / 'ledger.jsonl').write_text(json.dumps({'id': 'unread', 'to': 'build'}) + '\n')
        self.env['FAKE_FAIL'] = 'agent prompt'
        result = self.launch()
        self.assertIn('seat started; inbox nudge failed', result.stderr)
        self.assertEqual(self.seat()['pane'], 'w-test:p3')
        self.assertEqual(sum(c[:2] == ['agent', 'prompt'] for c in self.calls()), 1)


if __name__ == '__main__':
    unittest.main()
