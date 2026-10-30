"""B2 runner receipts, deterministic acceptance, gates and blind councils."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import fcntl
import json
from itertools import count
from pathlib import Path
import re
import subprocess

from lib.ledger import append, records
from lib.worktree import head_sha, worktree_mark
from lib.paths import run_path


def add_parsers(sub):
    ask = sub.add_parser('ask')
    ask.add_argument('text')
    answer = sub.add_parser('answer')
    answer.add_argument('id')
    answer.add_argument('text')
    dispatch = sub.add_parser('dispatch')
    dispatch.add_argument('runner')
    dispatch.add_argument('--agent-id', required=True)
    dispatch.add_argument('--packet')
    dispatch.add_argument('--phase')
    accept = sub.add_parser('accept')
    accept.add_argument('phase', choices=['brief', 'research', 'plan', 'milestone', 'build', 'verify', 'deploy'])
    accept.add_argument('milestone', nargs='?')
    accept.add_argument('--artifact', required=True)
    gate = sub.add_parser('gate')
    gate.add_argument('--cwd', required=True)
    gate.add_argument('--cmd', action='append', required=True)
    council = sub.add_parser('council')
    council.add_argument('question', nargs='?')
    council.add_argument('--exchange')
    council.add_argument('--name')
    council.add_argument('--lens', choices=['conceptual', 'operational'])
    council.add_argument('--models')
    council.add_argument('--no-argon', action='store_true')
    for cmd in (ask, answer, dispatch, accept, gate, council):
        cmd.add_argument('--run')


def content(path):
    if not path.is_file() or not path.read_text(encoding='utf-8').strip():
        raise ValueError(f'required artifact is missing or empty: {path}')
    return path.read_text(encoding='utf-8')


def sections(text):
    """Preserve nested heading bodies; normalize spelling, allow heading suffixes."""
    found = {}
    matches = list(re.finditer(r'^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$', text, re.M))
    for i, match in enumerate(matches):
        name = re.sub(r'[-_\s]+', ' ', match[2].strip().lower())
        end = next((m.start() for m in matches[i+1:] if len(m[1]) <= len(match[1])), len(text))
        found[name] = text[match.end():end].strip()
    return found


def subsections(text):
    return [m[1] for m in re.finditer(r'^###[ \t]+[^\n]+\n(.*?)(?=^#{1,3}[ \t]|\Z)', text, re.M | re.S)]


def require_parts(text, names):
    parts = sections(text)
    for name in names:
        key = next((key for key in parts if key.startswith(name)), None)
        if key is None or not parts[key]:
            raise ValueError(f'artifact requires a nonempty {name} section')
        parts[name] = parts[key]
    return parts


def done_checks(text):
    part = require_parts(text, ['done when'])['done when']
    return [re.sub(r'^\s*(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)+', '', line).strip()
            for line in part.splitlines() if line.strip() and not line.lstrip().startswith('<!--')]


def accept_artifact(args, home):
    path = run_path(home, args.artifact)
    if not path.is_relative_to(home.resolve()):
        raise ValueError('accepted artifact must be inside the run home')
    text = content(path)
    rows = records(home)
    phase = args.phase
    if (phase == 'milestone') != bool(args.milestone):
        raise ValueError('only milestone acceptance requires a milestone name')
    if phase == 'brief':
        require_parts(text, ['outcome', 'accepted limits', 'which error is cheaper',
                             'constraints', 'post plan choice', 'done when'])
    elif phase == 'research':
        content(home / 'research/sources.md')
    elif phase == 'plan':
        parts = require_parts(text, ['capabilities', 'external facts', 'seams',
                                     'first end to end path', 'size estimate'])
        entries = subsections(parts['capabilities'])
        if not entries or any(not re.search(r'^Done[- ]when\b[ \t]*:?[ \t]*\S+', entry, re.M | re.I) for entry in entries):
            raise ValueError('each ### capability requires a Done-when line')
        for fact in re.findall(r'^[ \t]*[-*+][ \t]+(.+)$', parts['external facts'], re.M):
            evidence = re.search(r'\bevidence\s*:\s*(.+)', fact, re.I)
            tokens = re.findall(r'\S+', evidence[1]) if evidence else []
            if not any(token.strip('`.,;').casefold() != 'none' for token in tokens):
                raise ValueError('each external fact bullet requires evidence: <command or URL>')
        decisions = require_parts(content(home / 'plan/decisions.md'), ['decisions'])['decisions']
        entries = subsections(decisions)
        if not entries or any(not all(re.search(r'^' + name + r'\b[ \t]*:?[ \t]*\S+', entry, re.M | re.I)
                                      for name in ('Reason', 'Dropped')) for entry in entries):
            raise ValueError('each ### decision requires Reason and Dropped lines')
        content(home / 'plan/council/ruling.md')
        reads = [i for i, r in enumerate(rows) if r['kind'] == 'call' and r.get('role') == 'fresh_builder_read']
        architect = max((i for i, r in enumerate(rows) if r['kind'] == 'call' and r.get('role') == 'architect'), default=-1)
        if not reads or reads[-1] <= architect or rows[reads[-1]].get('status') != 'done':
            raise ValueError('plan requires the newest fresh_builder_read done after the newest architect call')
    elif phase == 'milestone':
        gates = [r for r in rows if r['kind'] == 'gate']
        if not gates or gates[-1]['status'] != 'green' or gates[-1]['fingerprint'] != worktree_mark(home / 'wt', home):
            raise ValueError('milestone requires the last gate green on the current worktree fingerprint')
        build = content(home / 'build/build.md')
        exact = r'(?<![\w.-])' + re.escape(args.milestone) + r'(?![\w.-])'
        if not re.search(exact, build):
            raise ValueError('build/build.md requires an exact milestone entry')
        # Reports name their milestone explicitly; legacy reports can be mapped
        # by chunk id on the milestone's build entry, never by substring M1/M10.
        for report in (home / 'build/chunks').glob('*/report.md'):
            report_text = report.read_text()
            named = re.search(r'^Milestone\s*:\s*(\S+)', report_text, re.M | re.I)
            if named is None:
                raise ValueError(f'chunk report must name its milestone with a Milestone: line: {report}')
            belongs = named[1] == args.milestone
            if belongs and report_text.rstrip().splitlines()[-1].strip().casefold() != 'open blocking: none':
                raise ValueError(f'chunk report must end with Open blocking: none: {report}')
    elif phase == 'build':
        require_parts(text, ['built scope', 'deferred', 'trial', 'branch'])
    elif phase == 'verify':
        lines = []
        for line in text.splitlines():
            match = re.match(r'^\s*[-*+]\s+(.+?)\s*\|\s*(pass|fail|deferred)\s*\|\s*evidence\s*:\s*(\S.*)$', line, re.I)
            if match:
                lines.append((match[1].strip(), match[2].lower(), match[3]))
        if any(status == 'fail' for _, status, _ in lines):
            raise ValueError('verify failures go back to build')
        if any(status == 'deferred' and not re.search(r'\bdeploy\b', evidence, re.I) for _, status, evidence in lines):
            raise ValueError('deferred verification requires deploy in the evidence')
        for check in done_checks(content(home / 'brief.md')):
            if not any(check == name for name, _, _ in lines):
                raise ValueError(f'verify requires a result and evidence line for Done-when: {check}')
    elif phase == 'deploy':
        require_parts(text, ['where it runs', 'how it was started', 'how to stop', 'how to roll back', 'evidence'])
    append(home, 'accept', phase=phase, artifact_kind=phase, artifact=str(path), milestone=args.milestone)
    if phase == 'deploy':
        project = next((r.get('project') for r in rows if r['kind'] == 'start'), None)
        pointer = Path(project) / '.kiln-lite-run' if project else None
        if pointer and pointer.is_file() and pointer.read_text().strip() == str(home):
            pointer.unlink()
    print(f'accepted {phase}' + (f' {args.milestone}' if args.milestone else ''))
    return 0


def gate(args, home):
    cwd = Path(args.cwd).resolve()
    if cwd != (home / 'wt').resolve():
        raise ValueError('gate cwd must be the run worktree')
    folder = home / 'build/gates'
    with (folder / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        n = max((int(p.stem) for p in folder.glob('*.log') if p.stem.isdigit()), default=0) + 1
        log = folder / f'{n}.log'
        codes = []
        before = worktree_mark(cwd, home)
        with log.open('wb') as output:
            for command in args.cmd:
                output.write(f'$ {command}\n'.encode())
                output.flush()
                rc = subprocess.run(command, shell=True, cwd=cwd, stdin=subprocess.DEVNULL,
                                    stdout=output, stderr=subprocess.STDOUT).returncode
                codes.append(rc)
                output.write(f'\nrc: {rc}\n'.encode())
        fingerprint = worktree_mark(cwd, home)
        status = 'green' if not any(codes) else 'red'
        append(home, 'gate', n=n, cwd=str(cwd), fingerprint=fingerprint, fingerprint_before=before,
               commands=args.cmd, rcs=codes, status=status, result=str(log), head=head_sha(cwd))
    print(f'gate green {fingerprint[:8]}' if status == 'green' else
          f'gate red {args.cmd[next(i for i, rc in enumerate(codes) if rc)]}')
    return 0 if status == 'green' else 1


def public_section(text):
    match = re.search(r'^## Public\s*\n(.*?)(?=^#{1,2}\s|\Z)', text, re.M | re.S)
    return match[1] if match else None


def recommendation(text):
    match = re.search(r'^## Recommendation[^\S\n]*(?::[^\S\n]*(.+)|\n[ \t\n]*([^\n]+))', text, re.M)
    return (match[1] or match[2]).strip() if match else None


def verbatim(text):
    # Keep answer headings and embedded fences inside their attributed seat section.
    fence = '`' * max(3, 1 + max((len(run) for run in re.findall(r'`+', text)), default=0))
    return fence + 'markdown\n' + text + ('' if text.endswith('\n') else '\n') + fence + '\n'


def council_call(home, folder, seat, model, text, suffix='', resume=None):
    from lib.core import call_worker
    packet = folder / f'{seat}{suffix}.packet.md'
    packet.write_text(text + '\n\nUse a ## Recommendation heading followed by your recommendation on one line.\n')
    try:
        row = call_worker(argparse.Namespace(run=str(home), role=seat, packet=str(packet),
            model=model, effort=None, cwd=None, read_only=True, resume=resume, call_cwd=True), emit=False)
        answer = Path(row['result']).read_text() if row.get('result') else ''
        row.pop('meta', None)
    except (OSError, ValueError, KeyError, IndexError) as exc:
        row, answer = dict(status='failed', headline=str(exc), ids={}), ''
    (folder / f'{seat}{suffix}.md').write_text(answer)
    return dict(row=row, answer=answer)


def council_result(folder, state):
    def cell(text):
        return (text or '(no recommendation)').replace('|', '\\|').replace('\n', ' ')
    experts = [seat for seat in state['seats'] if seat != 'advisor']
    pieces = ['# Council result\n', state['note'] + '\n', '## Recommendations side by side\n',
              '| ' + ' | '.join(experts) + ' |', '| ' + ' | '.join('---' for _ in experts) + ' |',
              '| ' + ' | '.join(cell(recommendation(state['initial'][seat]['answer'])) for seat in experts) + ' |', '']
    exchanges = state.get('exchanges', {})
    failures, questions = [], []
    for seat in state['seats']:
        initial = state['initial'][seat]
        row = initial['row']
        pieces += [f'## {seat}\n', f'Status: {row["status"]}; {row.get("headline", "")}\n',
                   f'Call: {row.get("folder", "unavailable")}\n', '### Blind answer (verbatim)\n', verbatim(initial['answer'])]
        for label, result in [('blind', initial), ('exchange', exchanges.get(seat))]:
            if result is None:
                continue
            status = result['row']['status']
            if status in ('failed', 'rejected', 'unparsed'):
                failures.append(seat + (' exchange' if label == 'exchange' else ''))
            elif status == 'question':
                questions.append(seat + ': ' + result['row'].get('headline', 'question'))
        if seat in exchanges:
            changed = exchanges[seat]
            pieces += ['### Exchange changes (verbatim)\n', f'Status: {changed["row"]["status"]}\n',
                       f'Call: {changed["row"].get("folder", "unavailable")}\n', verbatim(changed['answer'])]
    pieces += ['## Questions\n', '\n'.join(questions) if questions else 'None.',
               '## Failed seats\n', '\n'.join(failures) if failures else 'None.']
    (folder / 'result.md').write_text('\n'.join(pieces) + '\n')
    return 1 if any(not failure.startswith('advisor') for failure in failures) else 0


def council(args, home):
    from lib.core import routing
    if args.exchange:
        if args.question or args.lens or args.models or args.name or args.no_argon:
            raise ValueError('--exchange takes only the council folder and optional --run')
        folder = run_path(home, args.exchange)
        if not folder.is_relative_to((home / 'council').resolve()):
            raise ValueError('exchange folder must be inside this run council directory')
        with (folder / '.exchange.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = json.loads(content(folder / 'council.json'))
            if state.get('exchange_started'):
                raise ValueError('this council already used its one exchange round')
            state['exchange_started'] = True
            (folder / 'council.json').write_text(json.dumps(state, indent=2))
            seats = [seat for seat in state['seats'] if seat != 'advisor']
            def exchange(seat):
                initial = state['initial'][seat]
                row = initial['row']
                resume = next((v for v in row.get('ids', {}).values() if v), None)
                if not resume:
                    return dict(row=dict(status='failed', headline='no resume id'), answer='')
                others = '\n\n'.join(f'## Other seat: {other}\n' + state['initial'][other]['answer']
                                         for other in seats if other != seat)
                return council_call(home, folder, seat, row.get('model'),
                    others + '\n\nKeep, revise or withdraw your recommendation with evidence. One exchange only.',
                    '.exchange', resume)
            with ThreadPoolExecutor(max_workers=len(seats)) as pool:
                state['exchanges'] = dict(zip(seats, pool.map(exchange, seats)))
            (folder / 'council.json').write_text(json.dumps(state, indent=2, default=str))
    else:
        if not args.question or not args.lens:
            raise ValueError('blind council requires a question path and --lens')
        question = content(run_path(home, args.question))
        lane = (home / 'lane.txt').read_text().strip()
        seats = [f'{args.lens}.{i}' for i in range(len(routing()[lane][args.lens]))]
        models = [model.strip() for model in args.models.split(',')] if args.models else [None] * len(seats)
        if len(models) != len(seats) or any(model == '' for model in models):
            raise ValueError('--models must name one model per lens seat')
        heading = re.search(r'^#{1,6}[ \t]+(.+)', question, re.M)
        name = args.name or (heading[1].strip(' #') if heading else Path(args.question).stem)
        slug = re.sub(r'[^a-z0-9._-]+', '-', name.lower()).strip('.-') or 'question'
        for n in count(1):
            folder = home / 'council' / (slug if n == 1 else f'{slug}-{n}')
            try:
                folder.mkdir()
                break
            except FileExistsError:
                continue
        (folder / 'question.md').write_text(question)
        public = public_section(question)
        note = 'Advisor disabled.' if args.no_argon else 'Advisor skipped: no ## Public section.'
        if public is not None and not args.no_argon:
            seats.append('advisor')
            models.append(None)
            note = 'Advisor: public section only, no vote.'
        with ThreadPoolExecutor(max_workers=len(seats)) as pool:
            futures = [pool.submit(council_call, home, folder, seat, model,
                                   public if seat == 'advisor' else question) for seat, model in zip(seats, models)]
            initial = dict(zip(seats, (future.result() for future in futures)))
        state = dict(seats=seats, initial=initial, note=note)
        (folder / 'council.json').write_text(json.dumps(state, indent=2, default=str))
    rc = council_result(folder, state)
    print(folder)
    return rc


def execute(args):
    from lib.core import find_home
    home = find_home(args.run)
    if args.command == 'ask':
        print(append(home, 'question', text=args.text)['id'])
    elif args.command == 'answer':
        args.id = args.id.removeprefix('#')
        if not any(r['kind'] == 'question' and r.get('id') == args.id for r in records(home)):
            raise ValueError(f'unknown question {args.id}')
        append(home, 'answer', question=args.id, text=args.text)
    elif args.command == 'dispatch':
        append(home, 'dispatch', runner=args.runner, agent_id=args.agent_id, packet=args.packet, phase=args.phase)
    elif args.command == 'accept':
        return accept_artifact(args, home)
    elif args.command == 'gate':
        return gate(args, home)
    elif args.command == 'council':
        return council(args, home)
    return 0
