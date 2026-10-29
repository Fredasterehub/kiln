import argparse
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import unittest
from unittest.mock import patch

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
        return ('sh -c \'[ -n "$KILN_SEAT" ] && [ -f "$KILN_SEAT" ] || exit 0; exec '
                + str(PLUGIN / 'hooks' / f'{script}.sh') + "'")

    def launch(self, *extra, ok=True):
        return self.run_tool('launch', '--tab', 'build', '--address', 'build', '--role', 'manager',
                             '--family', 'claude', '--root', str(self.root), '--parent', 'super', *extra, ok=ok)

    def seat(self, addr='build'):
        return json.loads((self.home / 'seats' / f'{addr}.json').read_text())

    def assert_schema(self, seat):
        schema = json.loads((PLUGIN.parents[1] / 'docs/seat.schema.json').read_text())
        self.assertTrue(set(schema['required']) <= seat.keys())
        self.assertTrue(seat.keys() <= schema['properties'].keys())
        for key, value in seat.items():
            field = schema['properties'][key]
            if field['type'] == 'string':
                self.assertIsInstance(value, str)
            elif field['type'] == 'array':
                self.assertIsInstance(value, list)
                self.assertTrue(all(isinstance(v, str) for v in value))
            if 'enum' in field:
                self.assertIn(value, field['enum'])
            if 'pattern' in field:
                self.assertRegex(value, field['pattern'])

    def flags(self):
        start = self.calls()[-1]
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
        self.assertEqual(seat['card'], str(card))
        self.assertEqual(seat['handoff'], str(handoff))
        self.assertEqual(seat['extra_roots'], [str(extra)])
        split = self.calls()[2]
        self.assertEqual(split[:3], ['pane', 'split', 'w-test:p1'])
        self.assertIn('KILN_SEAT=' + str(self.home / 'seats/build.json'), split)
        self.assertIn('KILN_HOME=' + str(self.home), split)
        self.assertIn('--no-focus', split)
        self.assertEqual(self.calls()[3][:3], ['pane', 'rename', 'w-test:p3'])
        self.assertEqual(self.calls()[3][3], 'Oracle · manager · opus-5.5')
        flags = self.flags()
        self.assertEqual(flags[:6], ['--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'acceptEdits'])
        settings = json.loads(flags[flags.index('--settings') + 1])
        self.assertEqual(settings['fallbackModel'], [])
        self.assertFalse(settings['switchModelsOnFlag'])
        self.assertEqual(settings['permissions']['allow'],
                         [f'Edit(/{self.root}/**)', f'Edit(/{extra}/**)'])
        self.assertEqual(set(settings['hooks']), {'SessionStart', 'PreToolUse', 'Stop'})
        for event, script in [('SessionStart', 'start'), ('PreToolUse', 'fence'), ('Stop', 'stop')]:
            self.assertEqual(settings['hooks'][event][0]['hooks'][0]['command'], self.guard(script))
        self.assertEqual(flags[-2:], ['--add-dir', str(extra)])
        self.assertFalse((self.root / '.codex').exists())

    def test_claude_worker_defaults_to_review_without_start_hook(self):
        self.launch('--role', 'worker')
        self.assert_schema(self.seat())
        flags = self.flags()
        settings = json.loads(flags[flags.index('--settings') + 1])
        self.assertEqual(set(settings['hooks']), {'PreToolUse', 'Stop'})
        self.assertEqual(self.seat()['model'], 'claude-opus-5-5')
        self.assertEqual(self.seat()['inbox'], '')

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
        self.assertIn('--dangerously-bypass-hook-trust', flags)
        self.assertEqual(flags[flags.index('-s') + 1], 'workspace-write')
        self.assertEqual(flags[flags.index('-C') + 1], str(worktree))
        self.assertEqual(flags[-2:], ['--add-dir', str(run)])
        self.assertNotIn('sandbox_workspace_write.network_access=true', flags)
        self.assertEqual(config.read_bytes(), original_bytes)
        self.assertFalse((self.root / '.codex').exists())
        self.assertFalse(Path(self.env['CODEX_HOME']).exists())

    def test_codex_manager_and_explicit_effort(self):
        self.launch('--family', 'codex', '--model', 'gpt-6-astra', '--effort', 'high')
        flags = self.flags()
        self.assertIn('sandbox_workspace_write.network_access=true', flags)
        self.assertIn('approval_policy=never', flags)
        self.assertIn('--dangerously-bypass-hook-trust', flags)
        self.assertIn('model_reasoning_effort=high', flags)
        self.assertEqual(self.seat()['model'], 'gpt-6-astra')

    def test_agy_advisor_one_shot_no_hooks(self):
        self.launch('--family', 'agy', '--role', 'advisor')
        self.assert_schema(self.seat())
        self.assertEqual(self.flags(), ['-p', '--model', 'gemini-4-argon-high', '--effort', 'high',
                                        '--sandbox', '--output-format', 'json'])
        self.assertFalse((self.root / '.codex').exists())

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
                self.assertIn('--dangerously-bypass-hook-trust', lines[-1])
            else:
                settings = json.loads(lines[-1][lines[-1].index('--settings') + 1])
                self.assertEqual(settings['hooks']['Stop'][0]['hooks'][0]['command'], self.guard('stop'))
        self.assertEqual(self.calls(), [])
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse((self.base / 'new-worktree').exists())
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertFalse(Path(self.env['CODEX_HOME']).exists())

    def test_install_idempotent_preserves_foreign_entry_bytes_and_order(self):
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
        self.assertIn((foreign + ',' + second).encode(), installed)
        parsed = json.loads(installed)
        self.assertEqual(set(parsed['hooks']), {'Stop', 'SessionStart', 'PreToolUse'})
        for event, script in [('Stop', 'stop'), ('SessionStart', 'start'), ('PreToolUse', 'fence')]:
            self.assertEqual(parsed['hooks'][event][-1]['hooks'][0]['command'], self.guard(script))
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        self.assertEqual(path.read_bytes(), installed)
        self.run_tool('launch', 'uninstall-hooks', '--family', 'codex')
        self.assertIn((foreign + ',' + second).encode(), path.read_bytes())
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
        self.assertIn(foreign.encode(), path.read_bytes())
        self.assertIn(mcp.encode(), path.read_bytes())
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
        hook_dir = self.base / "hooks with ' quotes"
        hook_dir.mkdir()
        marker = hook_dir / 'marker'
        script = hook_dir / 'stop.sh'
        script.write_text('#!/bin/sh\nprintf fired > ' + shlex.quote(str(marker)) + '\n')
        script.chmod(0o755)
        with patch.object(launch, 'HOOKS', hook_dir):
            command = launch.hooks('manager')['Stop'][0]['hooks'][0]['command']
        env = dict(self.env)
        env.pop('KILN_SEAT', None)
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
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_text(), 'fired')

    def test_tab_id_and_bridge_label_resolution(self):
        self.launch('--tab', 'w-test:t2')
        self.assertEqual(self.calls()[2][2], 'w-test:p2')

    def test_missing_tab_and_start_failure_are_not_retried(self):
        self.launch('--tab', 'missing', ok=False)
        self.assertFalse((self.home / 'seats').exists())
        self.env['FAKE_FAIL'] = 'agent start'
        self.launch(ok=False)
        self.assertEqual(sum(c[:2] == ['agent', 'start'] for c in self.calls()), 1)
        self.assertEqual(self.seat()['pane'], 'w-test:p3')

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
        routing = (PLUGIN.parents[1] / 'routing.toml').read_text()
        (self.base / 'routing.toml').write_text(routing.replace('bosses = "claude"', 'bosses = "gpt"'))
        with patch.object(launch, 'REPO', self.base):
            for role, model in [('director', 'gpt-6-astra'), ('super', 'gpt-6.1-sol'), ('helper', 'gpt-6.1-sol')]:
                args = argparse.Namespace(role=role, family='codex', model=None, effort=None)
                self.assertEqual(launch.routing(args), ('balanced', model, 'medium'))
            args.model, args.effort = 'gpt-6.1-sol', 'low'
            self.assertEqual(launch.routing(args), ('balanced', 'gpt-6.1-sol', 'low'))


if __name__ == '__main__':
    unittest.main()
