"""B4 operator intent, compaction receipts and superseded call regressions."""
import json
import os
import subprocess
import sys
import unittest

import test_kl as b1
from lib.ledger import append, records, render


class B4Tests(unittest.TestCase):
    setUp = b1.IntegrationTests.setUp
    run_kl = b1.IntegrationTests.run_kl

    def precompact(self, event):
        env = os.environ.copy()
        env.pop('KILN_LITE_RUN', None)
        result = subprocess.run(
            [sys.executable, str(b1.PLUGIN / 'hooks/precompact.py')],
            input=event if isinstance(event, str) else json.dumps(event),
            text=True, capture_output=True, env=env)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))
        return result

    def test_note_receipt_intent_status_and_follow(self):
        text = '  Keep the operator\'s words.\nThen do this.  '
        code, output = self.run_kl('note', text, '--run', str(self.home))
        self.assertEqual((code, output), (0, ''))
        row = records(self.home)[-1]
        self.assertEqual(set(row), {'time', 'kind', 'text'})
        self.assertEqual((row['kind'], row['text']), ('note', text))
        view = (self.home / 'run.md').read_text()
        self.assertIn('## Phase\nbrief\n## Intent\n' + text.replace('\n', ' ') + '\n## Accepted', view)
        self.assertEqual(self.run_kl('status', '--run', str(self.home)), (0, view))
        self.assertIn(f'{row["time"]} note    {text.replace(chr(10), " ")}\n',
                      self.run_kl('follow')[1])

    def test_intent_keeps_latest_four_in_ledger_order(self):
        for n in range(6):
            self.assertEqual(self.run_kl('note', f'Intent {n}')[0], 0)
        intent = (self.home / 'run.md').read_text().split('## Intent\n')[1].split('## Accepted')[0]
        self.assertEqual(intent, 'Intent 2\nIntent 3\nIntent 4\nIntent 5\n(2 earlier entries in ledger.jsonl)\n')
        self.assertEqual(len([r for r in records(self.home) if r['kind'] == 'note']), 6)

    def test_note_refuses_empty_and_whitespace_without_writes(self):
        before = (self.home / 'ledger.jsonl').read_bytes(), (self.home / 'run.md').read_bytes()
        for text in ('', '  \t\n'):
            code, output = self.run_kl('note', text)
            self.assertEqual(code, 1)
            self.assertEqual(output, 'kl: note text must not be empty or whitespace-only.\n')
            self.assertEqual(before, ((self.home / 'ledger.jsonl').read_bytes(),
                                      (self.home / 'run.md').read_bytes()))

    def test_precompact_receipt_from_pointer_and_run_home(self):
        for cwd, trigger in ((self.project, 'manual'), (self.home, 'auto')):
            before = records(self.home)
            self.precompact(dict(cwd=str(cwd), hook_event_name='PreCompact',
                                 session_id='session-b4', trigger=trigger, custom_instructions=None))
            after = records(self.home)
            self.assertEqual(after[:-1], before)
            row = after[-1]
            self.assertEqual(set(row), {'time', 'kind', 'trigger', 'session_id'})
            self.assertEqual((row['kind'], row['trigger'], row['session_id']),
                             ('compact', trigger, 'session-b4'))
            self.assertIn(f'{row["time"]} compact   {trigger} \n', self.run_kl('follow')[1])

    def test_precompact_no_run_is_silent_noop(self):
        before = (self.home / 'ledger.jsonl').read_bytes()
        self.precompact(dict(cwd=str(self.fake), trigger='auto', session_id='other'))
        self.assertEqual((self.home / 'ledger.jsonl').read_bytes(), before)
        self.assertFalse((self.fake / 'ledger.jsonl').exists())

    def test_precompact_missing_metadata_is_null(self):
        self.precompact(dict(cwd=str(self.project)))
        row = records(self.home)[-1]
        self.assertEqual(row['kind'], 'compact')
        self.assertIsNone(row['trigger'])
        self.assertIsNone(row['session_id'])

    def test_precompact_bad_input_is_silent(self):
        before = (self.home / 'ledger.jsonl').read_bytes()
        for event in ('{bad json', '', 'null', '[]', dict(cwd=['invalid'])):
            self.precompact(event)
        self.assertEqual((self.home / 'ledger.jsonl').read_bytes(), before)

    def test_precompact_oserror_is_silent(self):
        # A failed run-view replacement must not make the hook fail compaction.
        (self.home / 'run.md').unlink()
        (self.home / 'run.md').mkdir()
        self.precompact(dict(cwd=str(self.project), trigger='auto'))

    def test_hook_registration(self):
        hooks = json.loads((b1.PLUGIN / 'hooks/hooks.json').read_text())['hooks']
        self.assertEqual(hooks['PreCompact'], [{
            'matcher': 'manual|auto',
            'hooks': [{'type': 'command',
                       'command': 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/precompact.py"'}]}])

    def test_later_done_supersedes_unparsed_same_role_only(self):
        for n, role, status in ((1, 'implementer', 'unparsed'), (2, 'architect', 'unparsed'),
                                (3, 'implementer', 'question'), (4, 'implementer', 'done'),
                                (5, 'implementer', 'unparsed')):
            append(self.home, 'call', n=n, role=role, status=status, result=None)
        view = render(records(self.home))
        self.assertNotIn('1 implementer: unparsed', view)
        for line in ('2 architect: unparsed', '3 implementer: question', '5 implementer: unparsed'):
            self.assertIn(line, view)
        self.assertEqual(len([r for r in records(self.home) if r['kind'] == 'call']), 5)


if __name__ == '__main__':
    unittest.main()
