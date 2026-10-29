import json
import shlex
import subprocess
from pathlib import Path
import tomllib
import unittest

try:
    from .test_team import PLUGIN, Sandbox
except ImportError:
    from test_team import PLUGIN, Sandbox


class StartTests(Sandbox, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.env['HOME'] = str(self.base / 'operator')
        self.env['CODEX_HOME'] = str(self.base / 'codex')
        self.env['FAKE_BOOTSTRAP'] = '1'
        self.team = self.base / 'team-example'
        self.project = self.base / 'product repo'
        self.project.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.project)], check=True)
        (self.project / 'tracked').write_text('original')
        subprocess.run(['git', '-C', str(self.project), 'add', 'tracked'], check=True)
        subprocess.run(['git', '-C', str(self.project), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                        'commit', '--allow-empty', '-qm', 'Initial'], check=True)

    def start(self, *extra, ok=True):
        return self.run_tool('kiln', 'start', '--team', str(self.team), '--project', str(self.project),
                             '--workspace', 'Kiln example', *extra, ok=ok)

    def seats(self):
        return {p.stem: json.loads(p.read_text()) for p in (self.team / 'seats').glob('*.json')}

    def test_layout_bootstrap_trust_names_and_only_three_bridge_seats(self):
        result = self.start('--names', 'director=Oracle,super=Robin')
        for name in ('bridge', 'research', 'plan', 'build', 'verify', 'deploy', 'council', 'seats', 'inbox'):
            self.assertTrue((self.team / name).is_dir())
        self.assertEqual((self.team / 'ledger.jsonl').read_bytes(), b'')
        config = tomllib.loads((self.team / 'team.toml').read_text())
        defaults = tomllib.loads((PLUGIN / 'config/routing.toml').read_text())
        self.assertEqual(config, dict(lane=defaults['active'], bosses=defaults['bosses'], project=str(self.project), branch='kiln/team-example', trunk=str(self.team / 'build/trunk')))
        trust = json.loads((Path(self.env['HOME']) / '.claude.json').read_text())
        self.assertEqual(trust['projects'], {str(self.team): {'hasTrustDialogAccepted': True}})
        self.assertFalse((Path(self.env['HOME']) / '.claude.json.bak-kiln').exists())
        seats = self.seats()
        self.assertEqual(set(seats), {'director', 'super', 'helper'})
        for role, parent, name in (('director', '', 'Oracle'), ('super', 'director', 'Robin'),
                                   ('helper', 'super', 'Gravedigger')):
            seat = seats[role]
            self.assertEqual((seat['parent'], seat['name'], seat['root'], seat['tab']),
                             (parent, name, str(self.team / 'bridge'), 'bridge'))
            self.assertEqual(seat['card'], str(PLUGIN / 'cards' / f'{role}.md'))
            self.assertIn(f"{role} pane: {seat['pane']}", result.stdout)
        self.assertEqual(len({s['pane'] for s in seats.values()}), 3)
        self.assertIn('director address: director', result.stdout)
        calls = self.calls()
        self.assertEqual(calls[:2], [
            ['workspace', 'create', '--label', 'Kiln example', '--cwd', str(self.team / 'bridge'), '--no-focus'],
            ['tab', 'rename', 'w-test:t2', 'bridge']])
        self.assertEqual([c[2] for c in calls if c[:2] == ['agent', 'start']], ['director', 'super', 'helper'])
        for call in calls:
            if call[:2] == ['pane', 'split']:
                self.assertIn(f'KILN_HOME={self.team}', call)
        self.assertFalse(Path(self.env['CODEX_HOME']).exists())

    def test_lane_and_bosses_apply_to_bootstrap_and_later_launches(self):
        self.start('--lane', 'claude-lean', '--bosses', 'gpt')
        self.assertEqual({r: s['model'] for r, s in self.seats().items()},
                         dict(director='gpt-6-astra', super='gpt-6.1-sol', helper='gpt-6.1-sol'))
        self.env['KILN_HOME'] = str(self.team)
        self.run_tool('launch', '--tab', 'build', '--address', 'build', '--role', 'manager',
                      '--root', str(self.team / 'build'), '--parent', 'super')
        seat = json.loads((self.team / 'seats/build.json').read_text())
        self.assertEqual((seat['lane'], seat['model']), ('claude-lean', 'gpt-6.1-sol'))
        self.assertEqual(seat['card'], str(PLUGIN / 'cards/manager-build.md'))

    def test_dry_run_prints_plan_without_files_or_herdr_calls(self):
        result = self.start('--lane', 'claude-lean', '--bosses', 'gpt', '--dry-run')
        self.assertFalse(self.team.exists())
        self.assertFalse(Path(self.env['HOME']).exists())
        self.assertEqual(self.calls(), [])
        for text in ('team.toml', 'ledger.jsonl', 'workspace create', 'tab rename', 'Gravedigger',
                     'claude-lean', 'gpt', '--address director', '--address super', '--address helper'):
            self.assertIn(text, result.stdout)
        self.assertEqual(result.stdout.count('# set '), 1)

    def test_existing_team_is_preserved_and_not_launched_again(self):
        self.start()
        ledger = self.team / 'ledger.jsonl'
        ledger.write_text('keep this row\n')
        original = (self.team / 'team.toml').read_bytes()
        calls = self.calls()
        self.assertIn('already configured', self.start(ok=False).stderr)
        self.assertEqual(self.calls(), calls)
        self.assertEqual(ledger.read_text(), 'keep this row\n')
        self.assertEqual((self.team / 'team.toml').read_bytes(), original)

    def test_invalid_inputs_fail_before_creating_team(self):
        for extra in (('--lane', 'other'), ('--bosses', 'other'), ('--names', 'helper=Changed'),
                      ('--names', 'director='), ('--names', 'director=A,director=B'),
                      ('--project', str(self.base / 'missing'))):
            self.start(*extra, ok=False)
            self.assertFalse(self.team.exists())
            self.assertEqual(self.calls(), [])

    def test_failed_start_is_reported_and_existing_team_state_is_retained(self):
        self.env['FAKE_FAIL'] = 'agent start'
        result = self.start(ok=False)
        self.assertIn('launch failed for director', result.stderr)
        self.assertTrue((self.team / 'team.toml').exists())
        self.assertEqual([c[2] for c in self.calls() if c[:2] == ['agent', 'start']], ['director'])
        self.assertEqual(self.seats(), {})

    def test_integration_worktree_is_from_head_and_checkout_is_unchanged(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.project), *args], text=True).strip()
        head, branch = git('rev-parse', 'HEAD'), git('symbolic-ref', 'HEAD')
        (self.project / 'operator-data').write_text('keep')
        (self.project / 'tracked').write_text('operator edit')
        self.start()
        trunk = self.team / 'build/trunk'
        self.assertEqual(subprocess.check_output(['git', '-C', str(trunk), 'rev-parse', 'HEAD'], text=True).strip(), head)
        self.assertEqual(subprocess.check_output(['git', '-C', str(trunk), 'branch', '--show-current'], text=True).strip(), 'kiln/team-example')
        self.assertEqual((git('rev-parse', 'HEAD'), git('symbolic-ref', 'HEAD')), (head, branch))
        self.assertEqual((self.project / 'operator-data').read_text(), 'keep')
        self.assertEqual((self.project / 'tracked').read_text(), 'operator edit')
        self.assertEqual((trunk / 'tracked').read_text(), 'original')
        self.assertEqual(set(git('status', '--porcelain').splitlines()), {'M tracked', '?? operator-data'})

    def test_partial_failure_prints_ids_started_panes_and_only_remaining_commands(self):
        self.env.update(FAKE_FAIL='agent start', FAKE_FAIL_SEAT='super')
        result = self.start('--names', 'director=Oracle,super=Robin', ok=False)
        self.assertIn('workspace: w-test; bridge tab: w-test:t2', result.stderr)
        self.assertIn('started panes: director=w-test:p3', result.stderr)
        remaining = result.stderr.split('remaining launch commands:\n')[1].splitlines()[:2]
        parsed = [shlex.split(line) for line in remaining]
        self.assertEqual([command[command.index('--address') + 1] for command in parsed], ['super', 'helper'])
        for command in parsed:
            self.assertEqual(command[:3], ['env', f'KILN_HOME={self.team}', 'HERDR_WORKSPACE_ID=w-test'])
        self.assertIn('--name Robin', remaining[0])
        self.assertEqual(set(self.seats()), {'director'})

    def test_workspace_failure_still_reports_remaining_commands(self):
        self.env['FAKE_FAIL'] = 'workspace create'
        result = self.start(ok=False)
        self.assertIn('workspace: <not-created>; bridge tab: <not-created>', result.stderr)
        self.assertIn('started panes: none', result.stderr)
        for role in ('director', 'super', 'helper'):
            self.assertIn(f'--address {role}', result.stderr)

    def test_help_works_without_kiln_environment(self):
        self.env.pop('KILN_HOME')
        self.env.pop('HERDR_WORKSPACE_ID')
        self.run_tool('kiln', '--help')
        self.run_tool('kiln', 'start', '--help')


if __name__ == '__main__':
    unittest.main()
