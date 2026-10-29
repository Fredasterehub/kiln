import argparse
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import shlex
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
            self.assertEqual(shlex.split(settings['hooks'][event][0]['hooks'][0]['command']),
                             [str(PLUGIN / 'hooks' / f'{script}.sh')])
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

    def test_codex_worker_worktree_run_and_hooks_merge(self):
        worktree, run = self.base / 'worktree', self.base / 'run'
        worktree.mkdir()
        config = worktree / '.codex/hooks.json'
        config.parent.mkdir()
        original = {'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': 'existing-stop'}]}]}, 'other': True}
        config.write_text(json.dumps(original))
        self.launch('--role', 'worker', '--family', 'codex', '--worktree', str(worktree), '--run', str(run))
        seat = self.seat()
        self.assert_schema(seat)
        self.assertEqual(seat['root'], str(worktree))
        self.assertEqual(seat['extra_roots'], [str(run)])
        self.assertEqual(seat['inbox'], '')
        flags = self.flags()
        self.assertIn('model_reasoning_effort=medium', flags)
        self.assertIn('approval_policy=never', flags)
        self.assertEqual(flags[flags.index('-s') + 1], 'workspace-write')
        self.assertEqual(flags[flags.index('-C') + 1], str(worktree))
        self.assertEqual(flags[-2:], ['--add-dir', str(run)])
        self.assertNotIn('sandbox_workspace_write.network_access=true', flags)
        installed = json.loads(config.read_text())
        self.assertTrue(installed['other'])
        self.assertEqual(installed['hooks']['Stop'][0], original['hooks']['Stop'][0])
        self.assertEqual(set(installed['hooks']), {'Stop', 'PreToolUse'})
        self.launch('--role', 'worker', '--family', 'codex', '--worktree', str(worktree), '--run', str(run))
        self.assertEqual(json.loads(config.read_text()), installed)
        self.assertFalse((self.root / '.codex').exists())

    def test_codex_manager_and_explicit_effort(self):
        self.launch('--family', 'codex', '--model', 'gpt-6-astra', '--effort', 'high')
        flags = self.flags()
        self.assertIn('sandbox_workspace_write.network_access=true', flags)
        self.assertIn('approval_policy=never', flags)
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
        self.assertEqual(self.calls(), [])
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertFalse((self.base / 'new-worktree').exists())
        self.assertEqual(list(self.root.iterdir()), [])

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
