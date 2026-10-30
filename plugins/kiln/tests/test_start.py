import json
import contextlib
import io
import runpy
import re
import shlex
import subprocess
from pathlib import Path
import tomllib
import unittest
from unittest.mock import patch

try:
    from .test_team import PLUGIN, Sandbox
except ImportError:
    from test_team import PLUGIN, Sandbox


class StartTests(Sandbox, unittest.TestCase):
    def test_bridge_cards_and_role_addresses(self):
        for role in ('boss', 'orchestrator', 'gravedigah'):
            self.assertTrue((PLUGIN / 'cards' / f'{role}.md').is_file(), role)
        self.assertTrue((PLUGIN / 'templates/brief.md').is_file())
        self.assertIn('$KILN_PLUGIN/templates/brief.md', (PLUGIN / 'cards/boss.md').read_text())
        for path in (PLUGIN / 'cards').glob('*.md'):
            with self.subTest(card=path.name):
                self.assertLessEqual(len(path.read_text().splitlines()), 20)

    def test_plugin_files_use_current_role_addresses(self):
        retired = re.compile(r'(?<![a-z0-9])(?:director|super(?!\s*\()|helpers?)(?![a-z0-9])', re.I)
        for text in ('director', 'super', 'helper', 'helpers', 'never_director', 'super_manager'):
            self.assertIsNotNone(retired.search(text), text)
        self.assertIsNone(retired.search('super().setUp()'))
        paths = [PLUGIN / 'handoffs.md']
        for folder in ('cards', 'bin', 'config', 'hooks', 'lib', 'templates'):
            paths.extend((PLUGIN / folder).rglob('*'))
        for path in paths:
            if not path.is_file() or '__pycache__' in path.parts:
                continue
            with self.subTest(path=path.relative_to(PLUGIN)):
                self.assertIsNone(retired.search(path.read_text()))

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
        result = self.start('--names', 'boss=Oracle,orchestrator=Robin')
        for name in ('bridge', 'research', 'plan', 'build', 'verify', 'deploy', 'council', 'seats', 'inbox', 'waits', 'listeners'):
            self.assertTrue((self.team / name).is_dir())
        self.assertEqual((self.team / 'ledger.jsonl').read_bytes(), b'')
        config = tomllib.loads((self.team / 'team.toml').read_text())
        defaults = tomllib.loads((PLUGIN / 'config/routing.toml').read_text())
        self.assertEqual(config, dict(lane=defaults['active'], bosses=defaults['bosses'], project=str(self.project), branch='kiln/team-example', trunk=str(self.team / 'build/trunk')))
        trust = json.loads((Path(self.env['HOME']) / '.claude.json').read_text())
        self.assertEqual(trust['projects'], {str(self.team): {'hasTrustDialogAccepted': True}})
        self.assertFalse((Path(self.env['HOME']) / '.claude.json.bak-kiln').exists())
        seats = self.seats()
        self.assertEqual(set(seats), {'boss', 'orchestrator', 'gravedigah'})
        for role, parent, name in (('boss', '', 'Oracle'), ('orchestrator', 'boss', 'Robin'),
                                   ('gravedigah', 'orchestrator', 'Gravedigah')):
            seat = seats[role]
            self.assertEqual((seat['parent'], seat['name'], seat['root'], seat['tab']),
                             (parent, name, str(self.team / 'bridge'), 'bridge'))
            self.assertEqual(seat['card'], str(PLUGIN / 'cards' / f'{role}.md'))
            self.assertIn(f"{role} pane: {seat['pane']}", result.stdout)
        self.assertEqual(len({s['pane'] for s in seats.values()}), 3)
        self.assertIn('boss address: boss', result.stdout)
        calls = self.calls()
        self.assertEqual(calls[:2], [
            ['workspace', 'create', '--label', 'Kiln example', '--cwd', str(self.team / 'bridge'), '--no-focus'],
            ['tab', 'rename', 'w-test:t2', 'bridge']])
        self.assertEqual([c[2] for c in calls if c[:2] == ['agent', 'start']], ['boss', 'orchestrator', 'gravedigah'])
        for call in calls:
            if call[:2] == ['pane', 'split']:
                self.assertIn(f'KILN_HOME={self.team}', call)
        self.assertTrue((Path(self.env['CODEX_HOME']) / 'config.toml').exists())

    def test_lane_and_bosses_apply_to_bootstrap_and_later_launches(self):
        self.start('--lane', 'claude-lean', '--bosses', 'gpt')
        self.assertEqual({r: s['model'] for r, s in self.seats().items()},
                         dict(boss='gpt-6-astra', orchestrator='gpt-6.1-sol', gravedigah='gpt-6.1-sol'))
        self.env['KILN_HOME'] = str(self.team)
        self.run_tool('launch', '--tab', 'build', '--address', 'build', '--role', 'manager',
                      '--root', str(self.team / 'build'), '--parent', 'orchestrator')
        seat = json.loads((self.team / 'seats/build.json').read_text())
        self.assertEqual((seat['lane'], seat['model']), ('claude-lean', 'gpt-6.1-sol'))
        self.assertEqual(seat['card'], str(PLUGIN / 'cards/manager-build.md'))

    def test_dry_run_prints_plan_without_files_or_herdr_calls(self):
        result = self.start('--lane', 'claude-lean', '--bosses', 'gpt', '--dry-run')
        self.assertFalse(self.team.exists())
        self.assertFalse(Path(self.env['HOME']).exists())
        self.assertEqual(self.calls(), [])
        for text in ('team.toml', 'ledger.jsonl', 'workspace create', 'tab rename', 'Gravedigah',
                     'claude-lean', 'gpt', '--address boss', '--address orchestrator', '--address gravedigah'):
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
        for extra in (('--lane', 'other'), ('--bosses', 'other'), ('--names', 'gravedigah=Changed'),
                      ('--names', 'director=X,super=Y'),
                      ('--names', 'boss='), ('--names', 'boss=A,boss=B'),
                      ('--project', str(self.base / 'missing'))):
            self.start(*extra, ok=False)
            self.assertFalse(self.team.exists())
            self.assertEqual(self.calls(), [])

    def test_failed_start_is_reported_and_existing_team_state_is_retained(self):
        self.env['FAKE_FAIL'] = 'agent start'
        result = self.start(ok=False)
        self.assertIn('launch failed for boss', result.stderr)
        self.assertTrue((self.team / 'team.toml').exists())
        self.assertEqual([c[2] for c in self.calls() if c[:2] == ['agent', 'start']], ['boss'])
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
        self.env.update(FAKE_FAIL='agent start', FAKE_FAIL_SEAT='orchestrator')
        result = self.start('--names', 'boss=Oracle,orchestrator=Robin', ok=False)
        self.assertIn('workspace: w-test; bridge tab: w-test:t2', result.stderr)
        self.assertIn('started panes: boss=w-test:p3', result.stderr)
        remaining = result.stderr.split('remaining launch commands:\n')[1].splitlines()[:2]
        parsed = [shlex.split(line) for line in remaining]
        self.assertEqual([command[command.index('--address') + 1] for command in parsed], ['orchestrator', 'gravedigah'])
        for command in parsed:
            self.assertEqual(command[:3], ['env', f'KILN_HOME={self.team}', 'HERDR_WORKSPACE_ID=w-test'])
        self.assertIn('--name Robin', remaining[0])
        self.assertEqual(set(self.seats()), {'boss'})

    def test_workspace_failure_still_reports_remaining_commands(self):
        self.env['FAKE_FAIL'] = 'workspace create'
        result = self.start(ok=False)
        self.assertIn('workspace: <not-created>; bridge tab: <not-created>', result.stderr)
        self.assertIn('started panes: none', result.stderr)
        create = shlex.join(['herdr', 'workspace', 'create', '--label', 'Kiln example', '--cwd', str(self.team / 'bridge'), '--no-focus'])
        rename = shlex.join(['herdr', 'tab', 'rename', '<bridge-tab>', 'bridge'])
        self.assertLess(result.stderr.index(create), result.stderr.index(rename))
        self.assertLess(result.stderr.index(rename), result.stderr.index('remaining launch commands:'))
        self.assertIn(shlex.join(['git', '-C', str(self.project), 'worktree', 'remove', str(self.team / 'build/trunk')]), result.stderr)
        self.assertIn(shlex.join(['git', '-C', str(self.project), 'branch', '-D', 'kiln/team-example']), result.stderr)
        for role in ('boss', 'orchestrator', 'gravedigah'):
            self.assertIn(f'--address {role}', result.stderr)

    def test_team_name_with_spaces_uses_collapsed_slug(self):
        self.team = self.base / 'team  with---spaces!@more'
        self.start()
        config = tomllib.loads((self.team / 'team.toml').read_text())
        self.assertEqual(config['branch'], 'kiln/team-with-spaces-more')
        subprocess.run(['git', 'check-ref-format', '--branch', config['branch']], check=True, capture_output=True)
        branch = subprocess.check_output(['git', '-C', str(self.team / 'build/trunk'), 'branch', '--show-current'], text=True).strip()
        self.assertEqual(branch, config['branch'])
        self.assertIn('[A-Za-z0-9._-]', self.run_tool('kiln', 'start', '--help').stdout)

    def test_failure_after_worktree_before_config_prints_cleanup(self):
        module = runpy.run_path(str(PLUGIN / 'bin/kiln'))
        original_open = Path.open
        def denied(path, *args, **kwargs):
            if path == self.team / 'team.toml' and args[:1] == ('x',):
                raise PermissionError('test config write denied')
            return original_open(path, *args, **kwargs)
        argv = ['kiln', 'start', '--team', str(self.team), '--project', str(self.project), '--workspace', 'Kiln example']
        with patch.dict('os.environ', self.env), patch('sys.argv', argv), patch.object(Path, 'open', new=denied), \
                contextlib.redirect_stderr(io.StringIO()) as errors:
            with self.assertRaises(SystemExit):
                module['main']()
        self.assertTrue((self.team / 'build/trunk/.git').is_file())
        self.assertFalse((self.team / 'team.toml').exists())
        self.assertEqual(self.calls(), [])
        for command in (['git', '-C', str(self.project), 'worktree', 'remove', str(self.team / 'build/trunk')],
                        ['git', '-C', str(self.project), 'branch', '-D', 'kiln/team-example']):
            self.assertIn(shlex.join(command), errors.getvalue())
        self.assertIn('herdr workspace create', errors.getvalue())
        self.assertIn('remaining launch commands:', errors.getvalue())

    def test_route_lookup_uses_shared_resolver_and_team_lane_without_writes(self):
        for key, expected in (('advisor', 'gemini-4-argon-high high'),
                              ('conceptual.0', 'gpt-6-astra medium'),
                              ('research_claude', 'claude-sonnet-5-5 medium')):
            self.assertEqual(self.run_tool('kiln', 'route', key).stdout, expected + '\n')
        (self.home / 'team.toml').write_text('lane="claude-lean"\nbosses="gpt"\n')
        self.assertEqual(self.run_tool('kiln', 'route', 'research_claude').stdout, 'gpt-6.1-sol low\n')
        self.assertEqual(self.run_tool('kiln', 'route', 'conceptual.0').stdout, 'gpt-6-astra medium\n')
        for key in ('missing', 'conceptual.1'):
            result = self.run_tool('kiln', 'route', key, ok=False)
            self.assertIn('invalid routing entry', result.stderr)
        self.assertEqual(self.calls(), [])
        self.assertFalse(Path(self.env['HOME']).exists())
        self.assertFalse(self.team.exists())
        self.assertEqual([p.name for p in self.home.iterdir()], ['team.toml'])

    def test_list_routes_print_every_lane_entry(self):
        self.assertEqual(self.run_tool('kiln', 'route', 'conceptual').stdout.splitlines(),
                         ['gpt-6-astra medium', 'claude-fable-5-1 medium'])
        self.assertEqual(self.run_tool('kiln', 'route', 'operational').stdout.splitlines(),
                         ['gpt-6.1-sol medium', 'claude-opus-5-5 medium'])
        (self.home / 'team.toml').write_text('lane="claude-lean"\n')
        self.assertEqual(self.run_tool('kiln', 'route', 'conceptual').stdout, 'gpt-6-astra medium\n')
        self.assertEqual(self.calls(), [])

    def test_codex_bootstrap_trust_uses_main_root_from_linked_project_and_backup_once(self):
        main = self.project
        linked = self.base / 'linked product'
        subprocess.run(['git', '-C', str(main), 'worktree', 'add', '-qb', 'linked', str(linked)], check=True)
        self.project = linked
        config = Path(self.env['CODEX_HOME']) / 'config.toml'
        config.parent.mkdir()
        original = b'# preserve all bytes\r\nmodel="gpt-6.1-sol"'
        config.write_bytes(original)
        config.chmod(0o640)
        self.start()
        self.assertTrue(config.read_bytes().startswith(original))
        projects = tomllib.loads(config.read_text())['projects']
        self.assertEqual(projects, {str(main): {'trust_level': 'trusted'}})
        backup = config.with_name('config.toml.bak-kiln')
        self.assertEqual(backup.read_bytes(), original)
        self.assertEqual(config.stat().st_mode & 0o777, 0o640)
        trusted = config.read_bytes()
        self.team = self.base / 'second-team'
        self.start()
        self.assertEqual(config.read_bytes(), trusted)
        self.assertEqual(backup.read_bytes(), original)

    def test_codex_existing_project_table_is_untouched_and_bad_config_is_preserved(self):
        config = Path(self.env['CODEX_HOME']) / 'config.toml'
        config.parent.mkdir()
        original = '[projects.' + json.dumps(str(self.project)) + ']\ntrust_level="untrusted"\n'
        config.write_text(original)
        self.start()
        self.assertEqual(config.read_text(), original)
        self.assertFalse(config.with_name('config.toml.bak-kiln').exists())
        self.team = self.base / 'bad-config-team'
        config.write_text('bad = [')
        before = self.calls()
        self.start(ok=False)
        self.assertEqual(config.read_text(), 'bad = [')
        self.assertEqual(self.calls(), before)

    def test_codex_bootstrap_default_home_config_is_private(self):
        self.env.pop('CODEX_HOME')
        self.start()
        path = Path(self.env['HOME']) / '.codex/config.toml'
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(tomllib.loads(path.read_text())['projects'],
                         {str(self.project): {'trust_level': 'trusted'}})

    def test_help_works_without_kiln_environment(self):
        self.env.pop('KILN_HOME')
        self.env.pop('HERDR_WORKSPACE_ID')
        self.run_tool('kiln', '--help')
        self.run_tool('kiln', 'start', '--help')


if __name__ == '__main__':
    unittest.main()
