import argparse
import contextlib
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
                             '--root', str(self.root), '--parent', 'super', *extra, ok=ok)

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
        self.assertEqual(flags[flags.index('-s') + 1], 'workspace-write')
        self.assertEqual(flags[flags.index('-C') + 1], str(worktree))
        self.assertEqual(flags[-2:], ['--add-dir', str(run)])
        self.assertNotIn('sandbox_workspace_write.network_access=true', flags)
        self.assertEqual(config.read_bytes(), original_bytes)
        self.assertFalse((self.root / '.codex').exists())
        self.assertFalse((Path(self.env['CODEX_HOME']) / 'hooks.json').exists())

    def test_codex_manager_and_explicit_effort(self):
        self.launch('--family', 'codex', '--model', 'gpt-6-astra', '--effort', 'high')
        flags = self.flags()
        self.assertIn('sandbox_workspace_write.network_access=true', flags)
        self.assertIn('approval_policy=never', flags)
        self.assertIn(str(self.home), [flags[i + 1] for i, flag in enumerate(flags) if flag == '--add-dir'])
        self.assertFalse(any('bypass-hook-trust' in flag for flag in flags))
        self.assertIn('model_reasoning_effort=high', flags)
        self.assertEqual(self.seat()['model'], 'gpt-6-astra')

    def test_advisor_is_a_plain_command_not_a_seat(self):
        self.launch('--family', 'agy', '--role', 'advisor', ok=False)
        self.launch('--model', 'gemini-4-argon-high', ok=False)
        self.assertEqual(self.calls(), [])

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
        self.launch('--tab', 'w-test:t2')
        self.assertEqual(self.calls()[2][2], 'w-test:p2')
        self.assertEqual(self.seat()['tab'], 'bridge')

    def test_missing_tab_and_start_failure_are_not_retried(self):
        self.launch('--tab', 'missing', ok=False)
        self.assertFalse((self.home / 'seats').exists())
        self.env['FAKE_FAIL'] = 'agent start'
        self.launch(ok=False)
        self.assertEqual(sum(c[:2] == ['agent', 'start'] for c in self.calls()), 1)
        self.assertFalse((self.home / 'seats/build.json').exists())

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
            for role, model in [('director', 'gpt-6-astra'), ('super', 'gpt-6.1-sol'), ('helper', 'gpt-6.1-sol')]:
                args = argparse.Namespace(role=role, family='codex', model=None, effort=None)
                self.assertEqual(launch.routing(args), ('balanced', model, 'medium'))
            args.model, args.effort = 'gpt-6.1-sol', 'low'
            self.assertEqual(launch.routing(args), ('balanced', 'gpt-6.1-sol', 'low'))

    def copy_plugin(self):
        target = self.base / 'installed copy'
        (target / 'bin').mkdir(parents=True)
        shutil.copy2(PLUGIN / 'bin/launch', target / 'bin/launch')
        shutil.copytree(PLUGIN / 'config', target / 'config')
        return target

    def test_installed_copy_has_config_and_infers_gpt_boss_family(self):
        target = self.copy_plugin()
        routing = target / 'config/routing.toml'
        routing.write_text(routing.read_text().replace('bosses = "claude"', 'bosses = "gpt"'))
        subprocess.run([str(target / 'bin/launch'), '--help'], env=self.env,
                       capture_output=True, text=True, check=True)
        args = [str(target / 'bin/launch'), '--tab', 'bridge', '--address', 'director',
                '--role', 'director', '--root', str(self.root), '--parent', '', '--dry-run']
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
                for role, model in (('manager', 'gpt-6.1-sol'),
                                    ('director', 'claude-opus-5-5' if bosses == 'claude' else 'gpt-6-astra'),
                                    ('super', 'claude-opus-5-5' if bosses == 'claude' else 'gpt-6.1-sol')):
                    args = argparse.Namespace(role=role, family=None, model=None, effort=None)
                    self.assertEqual(launch.routing(args), ('claude-lean', model, 'medium'))

    def test_claude_lean_complete_lane(self):
        import tomllib
        config = tomllib.loads((PLUGIN / 'config/routing.toml').read_text())
        lane = config['lanes']['claude-lean']
        self.assertEqual(set(lane), set(config['lanes']['balanced']))
        for role in ('manager', 'helper', 'chunkmaster', 'implementer', 'investigator'):
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
        self.launch('--role', 'helper')
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
        self.launch('--family', 'codex', '--role', 'helper', '--card', str(card), '--handoff', str(handoff))
        self.assertEqual(self.seat()['extra_roots'], [])
        flags = self.flags()
        self.assertNotIn(str(card.parent), flags)
        self.assertNotIn(str(handoff.parent), flags)
        self.assertNotIn('--dangerously-bypass-hook-trust', flags)

    def test_routing_defaults_and_pane_role_words(self):
        launch = load_launcher()
        for role, model in [('manager', 'claude-opus-5-5'), ('helper', 'gpt-6.1-sol'),
                            ('chunkmaster', 'gpt-6.1-sol')]:
            args = argparse.Namespace(role=role, family=None, model=None, effort=None)
            self.assertEqual(launch.routing(args), ('balanced', model, 'medium'))
        for role, label in [('director', 'director'), ('super', 'super manager'), ('manager', 'build manager'),
                            ('helper', 'helper'), ('chunkmaster', 'chunk master'), ('worker', 'worker')]:
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
        result = self.launch('--role', 'helper')
        self.assertIn('warning: Codex Kiln hooks are not installed', result.stderr)
        self.run_tool('launch', 'install-hooks', '--family', 'codex')
        self.assertNotIn('not installed', self.launch('--role', 'helper').stderr)

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

    def test_schema_excludes_agy_and_argon_seats(self):
        schema = load_launcher().SCHEMA
        self.assertNotIn('agy', schema['properties']['family']['enum'])
        self.assertNotIn('gemini-4-argon-high', schema['properties']['model']['enum'])

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
        self.assertNotIn('need /hooks review', self.launch('--role', 'helper').stderr)
        self.assertTrue(path.is_symlink())

    def test_split_direction_defaults_down_and_accepts_right(self):
        self.launch()
        split = self.calls()[2]
        self.assertEqual(split[split.index('--direction') + 1], 'down')
        self.launch('--direction', 'right')
        split = self.calls()[-3]
        self.assertEqual(split[split.index('--direction') + 1], 'right')
        self.launch('--direction', 'left', ok=False)

    def test_codex_pretrust_appends_preserves_content_and_backs_up_once(self):
        config = Path(self.env['CODEX_HOME']) / 'config.toml'
        config.parent.mkdir()
        original = b'# keep comments\r\nmodel = "gpt-6.1-sol"\r\n[notice]\r\nhide = true # no final newline'
        config.write_bytes(original)
        config.chmod(0o600)
        self.launch('--role', 'helper')
        backup = config.with_name('config.toml.bak-kiln')
        self.assertEqual(backup.read_bytes(), original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.assertTrue(config.read_bytes().startswith(original))
        self.assertEqual(tomllib.loads(config.read_text())['projects'][str(self.root)]['trust_level'], 'trusted')
        trusted = config.read_bytes()
        self.launch('--role', 'helper')
        self.assertEqual(config.read_bytes(), trusted)
        second = self.base / 'quoted " root 😀'
        self.launch('--role', 'helper', '--root', str(second))
        self.assertTrue(config.read_bytes().startswith(trusted))
        self.assertEqual(tomllib.loads(config.read_text())['projects'][str(second)]['trust_level'], 'trusted')
        self.assertEqual(backup.read_bytes(), original)

    def test_codex_already_trusted_is_untouched_and_default_home_is_used(self):
        del self.env['CODEX_HOME']
        config = Path(self.env['HOME']) / '.codex/config.toml'
        config.parent.mkdir(parents=True)
        original = '[projects.' + json.dumps(str(self.root)) + ']\ntrust_level="trusted" # keep\n'
        config.write_text(original)
        self.launch('--role', 'helper')
        self.assertEqual(config.read_text(), original)
        self.assertFalse(config.with_name('config.toml.bak-kiln').exists())

    def test_unappendable_codex_config_is_preserved_without_start(self):
        config = Path(self.env['CODEX_HOME']) / 'config.toml'
        config.parent.mkdir()
        sources = ['broken = [', 'projects = []',
                   '[projects.' + json.dumps(str(self.root)) + ']\ntrust_level="untrusted"\n']
        for source in sources:
            config.write_text(source)
            before = len(self.calls())
            result = self.launch('--role', 'helper', ok=False)
            self.assertNotIn('Traceback', result.stderr)
            self.assertEqual(config.read_text(), source)
            self.assertFalse(config.with_name('config.toml.bak-kiln').exists())
            self.assertFalse(any(call[:2] in (['pane', 'split'], ['agent', 'start']) for call in self.calls()[before:]))

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

    def test_dry_run_describes_pretrust_and_backup_without_changes(self):
        codex = Path(self.env['CODEX_HOME']) / 'config.toml'
        claude = Path(self.env['HOME']) / '.claude.json'
        for path, original in ((codex, 'model="gpt-6.1-sol"\n'), (claude, '{"keep":true,"private":"private-canary"}')):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(original)
        for role, path in (('helper', codex), ('manager', claude)):
            original = path.read_bytes()
            result = self.launch('--role', role, '--dry-run')
            self.assertIn(str(path), result.stdout)
            self.assertEqual(result.stdout.count('# backup'), 1)
            self.assertEqual(result.stdout.count('# append' if role == 'helper' else '# set'), 1)
            self.assertIn('trust_level' if role == 'helper' else 'hasTrustDialogAccepted', result.stdout)
            self.assertNotIn('private-canary', result.stdout)
            self.assertEqual(path.read_bytes(), original)
            self.assertFalse(path.with_name(path.name + '.bak-kiln').exists())
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
                '--root', str(self.root), '--parent', 'super']
        with patch.dict('os.environ', self.env), patch('sys.argv', args), patch.object(module, 'herdr', side_effect=checked):
            module.main()

    def test_pretrust_concurrent_processes_preserve_both_roots(self):
        script = ("import runpy, sys; m = runpy.run_path(sys.argv[1]); "
                  "sys.stdin.readline(); m['pretrust'](sys.argv[2], sys.argv[3], False)")
        for family in ('claude', 'codex'):
            processes = [subprocess.Popen([sys.executable, '-c', script, str(PLUGIN / 'bin/launch'), root, family],
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
            path = (Path(self.env['CODEX_HOME']) / 'config.toml' if family == 'codex'
                    else Path(self.env['HOME']) / '.claude.json')
            module = load_launcher()
            for root in ('/first', '/second'):
                self.assertTrue(module.trust_flag(path.read_bytes(), root, family))
            self.assertTrue(path.with_name(path.name + '.kiln.lock').exists())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_rechecks_and_reapplies_trust_just_before_start(self):
        for family in ('claude', 'codex'):
            module = load_launcher()
            original = module.herdr
            path = (Path(self.env['CODEX_HOME']) / 'config.toml' if family == 'codex'
                    else Path(self.env['HOME']) / '.claude.json')
            calls = []
            def checked(args, dry_run):
                calls.append(args[:2])
                if args[:2] == ['pane', 'rename']:
                    path.write_text('' if family == 'codex' else '{}')
                if args[:2] == ['agent', 'start']:
                    self.assertTrue(module.trust_flag(path.read_bytes(), str(self.root), family))
                return original(args, dry_run)
            args = ['launch', '--tab', 'build', '--address', 'build', '--role',
                    'helper' if family == 'codex' else 'manager', '--root', str(self.root), '--parent', 'super']
            with patch.dict('os.environ', self.env), patch('sys.argv', args), patch.object(module, 'herdr', side_effect=checked):
                module.main()
            self.assertEqual(calls[-1], ['agent', 'start'])

    def test_post_write_verification_refuses_lost_trust_and_leaves_no_pane(self):
        for family in ('claude', 'codex'):
            module = load_launcher()
            def lost(path, content, mode):
                path.write_bytes(b'' if family == 'codex' else b'{}')
            args = ['launch', '--tab', 'build', '--address', 'build', '--role',
                    'helper' if family == 'codex' else 'manager', '--root', str(self.root), '--parent', 'super']
            with patch.dict('os.environ', self.env), patch('sys.argv', args), patch.object(module, 'atomic_bytes', side_effect=lost), \
                    patch.object(module, 'herdr') as herdr, contextlib.redirect_stderr(io.StringIO()) as errors:
                with self.assertRaises(SystemExit):
                    module.main()
                herdr.assert_not_called()
                self.assertIn('refusing launch', errors.getvalue())

    def test_failed_last_minute_reapply_refuses_start_after_one_attempt(self):
        for family in ('claude', 'codex'):
            module = load_launcher()
            original_herdr, original_write = module.herdr, module.atomic_bytes
            path = (Path(self.env['CODEX_HOME']) / 'config.toml' if family == 'codex'
                    else Path(self.env['HOME']) / '.claude.json')
            writes = []
            closed = []
            seat_path = self.home / 'seats/build.json'
            seat_path.parent.mkdir(exist_ok=True)
            previous = {'pane': 'old-pane', 'address': 'build'}
            seat_path.write_text(json.dumps(previous))
            def checked(args, dry_run):
                if args[:2] == ['pane', 'rename']:
                    path.write_text('' if family == 'codex' else '{}')
                self.assertNotEqual(args[:2], ['agent', 'start'])
                if args[:2] == ['pane', 'close']:
                    closed.append(args)
                return original_herdr(args, dry_run)
            def lost_again(target, content, mode):
                original_write(target, content, mode)
                writes.append(target)
                if len(writes) == 2:
                    target.write_bytes(b'' if family == 'codex' else b'{}')
            args = ['launch', '--tab', 'build', '--address', 'build', '--role',
                    'helper' if family == 'codex' else 'manager', '--root', str(self.root), '--parent', 'super']
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


if __name__ == '__main__':
    unittest.main()
