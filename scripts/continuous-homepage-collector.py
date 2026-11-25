#!/usr/bin/env python3
"""Continuously inspect newly discovered linked clinic homepages, with durable checkpoints.

This does not collect Naver Place or circumvent access controls. The seed generator
only selects URLs visibly linked by an already matched institution. One request at
a time makes a 401/403/429/challenge a global stop. Existing attempted URLs are
never automatically retried, including interrupted requests.

``--candidates`` verifies the homepages the automated web research reported instead:
thousands of independent hosts, so one blocked host is recorded and skipped (never
retried) and only BLOCK_STREAK_LIMIT consecutive blocks stop the run. Every page is
read by this crawler itself and compared with the public record; the rows carry
sourceType 'candidate_homepage' and a dataset-phone count as a directory-page guard.
"""
import argparse
import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ddl import store, web

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('discovered_homepages', ROOT / 'scripts/crawl-discovered-homepages.py')
CRAWLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CRAWLER)
RESULT_FILES = {name: ROOT / 'data/assets' / (name + '.json') for name in
                ('national-homepages', 'discovered-homepages', 'continuous-homepages', 'candidate-homepages')}
MODES = {
    'linked': {'output': RESULT_FILES['continuous-homepages'], 'seeds': ROOT / 'data/research/discovered-homepage-seeds.json',
               'lock': ROOT / 'data/research/continuous-homepages.lock', 'prepare': 'scripts/prepare-discovered-homepages.mjs',
               'sourceType': 'discovered_homepage',
               'scope': '기관에서 연결한 공개 홈페이지 본문 1회 확인. 네이버 등 플랫폼은 접근하지 않음. 자동 일치는 귀속 후보이며 수동 검토 필요.',
               'requestPolicy': '공개 IP/표준 포트 검증, 직렬 처리, 요청당 체크포인트, 401/403/429 또는 challenge 즉시 전체 중단, 자동 재시도 없음.'},
    'candidates': {'output': RESULT_FILES['candidate-homepages'], 'seeds': ROOT / 'data/research/candidate-homepage-seeds.json',
                   'lock': ROOT / 'data/research/candidate-homepages.lock', 'prepare': 'scripts/prepare-candidate-homepages.mjs',
                   'sourceType': 'candidate_homepage',
                   'scope': '자동 웹 조사가 찾은 홈페이지 후보를 이 수집기가 직접 1회 읽고 기관명·전화·주소를 공공 원자료와 대조. 네이버 등 플랫폼은 접근하지 않음. 공공자료 전화번호가 여러 개 보이는 페이지는 목록 페이지로 간주.',
                   'requestPolicy': '공개 IP/표준 포트 검증, robots.txt 준수, 직렬 처리, 요청당 체크포인트. 401/403/429 또는 challenge는 해당 호스트만 차단 기록(재시도 없음)하고 계속 진행, 연속 5회 차단 시 전체 중단. 자동 재시도 없음.'},
}
MODE = MODES['linked']
OUTPUT, SEEDS, LOCK = MODE['output'], MODE['seeds'], MODE['lock']
PREVIOUS = [RESULT_FILES['national-homepages'], RESULT_FILES['discovered-homepages']]
BLOCK_STREAK_LIMIT = 5
STOP = False


def select_mode(name):
    """Point the module-level paths at one collector mode; previous files are every other result file."""
    global MODE, OUTPUT, SEEDS, LOCK, PREVIOUS
    MODE = MODES[name]
    OUTPUT, SEEDS, LOCK = MODE['output'], MODE['seeds'], MODE['lock']
    PREVIOUS = [path for path in RESULT_FILES.values() if path != OUTPUT]
    return MODE


now = store.now
atomic_save = store.atomic_json


def mark_error(path, error):
    """Durable failure marker so a crash never leaves a stale 'running' state."""
    try:
        state = load_output(path)
    except Exception:
        return
    state['state'] = 'error'; state['stopReason'] = 'exception'; state['checkedAt'] = now()
    state['error'] = {'type': type(error).__name__, 'detail': str(error)[:180], 'checkedAt': now()}
    atomic_save(path, state)


def load_output(path, mode=None):
    mode = mode or MODE
    if not path.exists():
        return {'schemaVersion': 1, 'startedAt': now(), 'checkedAt': now(), 'scope': mode['scope'],
                'requestPolicy': mode['requestPolicy'], 'state': 'ready', 'results': []}
    value = json.loads(path.read_text(encoding='utf-8'))
    if value.get('schemaVersion') != 1 or not isinstance(value.get('results'), list):
        raise ValueError('invalid checkpoint file; refusing to overwrite')
    return value


def existing_attempts(paths, current):
    rows = list(current['results'])
    for path in paths:
        if path.exists():
            value = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(value.get('results'), list):
                raise ValueError('invalid previous results: ' + str(path))
            rows += value['results']
    return {CRAWLER.canonical(url) for row in rows for url in (row.get('url'), row.get('finalUrl')) if url}


def previously_blocked_hosts(paths, current):
    rows = list(current['results'])
    for path in paths:
        if path.exists():
            value = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(value.get('results'), list):
                raise ValueError('invalid previous results: ' + str(path))
            rows += value['results']
    return {CRAWLER.host_key(url) for row in rows
            if row.get('status') == 'blocked' or row.get('httpStatus') in (401, 403, 429)
            for url in (row.get('url'), row.get('finalUrl')) if url}


def blocked_hosts_in_batches(directory):
    """Honor manual website-access blocks from other asset batches too."""
    hosts = set()
    for path in directory.glob('*.json'):
        if path.name in ('national-homepages.json', 'discovered-homepages.json', 'continuous-homepages.json', 'candidate-homepages.json'):
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        for record in data.get('records', []):
            for asset in record.get('assets', []):
                if asset.get('kind') == 'website' and asset.get('bodyStatus') == 'blocked' and asset.get('url'):
                    hosts.add(CRAWLER.host_key(asset['url']))
    return hosts


def seed_ok(seed, clinics):
    """Require generated linkage evidence, correct clinic identities and safe URL syntax."""
    if not isinstance(seed, dict):
        return False
    raw = seed.get('url'); url = web.safe_url(raw)
    if not url or CRAWLER.platform(url) or not seed.get('evidenceUrls'):
        return False
    # Reject DNS literals and localhost before any network request; inspect() also
    # resolves every address and redirect through web.resolve_public.
    import ipaddress, urllib.parse
    host = urllib.parse.urlsplit(url).hostname or ''
    try:
        if not ipaddress.ip_address(host).is_global:
            return False
    except ValueError:
        if host.lower() == 'localhost' or host.lower().endswith('.localhost'):
            return False
    members = seed.get('clinics')
    if not isinstance(members, list) or not members:
        return False
    for c in members:
        actual = clinics.get(c.get('id')) if isinstance(c, dict) else None
        if not actual or any(c.get(k) != actual.get(k) for k in ('name', 'address', 'phone')):
            return False
    return True


def run_once(output, seeds, clinics, previous, inspect, max_requests=0, extra_blocked_hosts=None, block_streak_limit=1, source_type=None):
    """Process one seed generation; return request count and durable stop reason.

    ``block_streak_limit`` 1 (linked homepages) stops on the first blocked result. A higher
    limit (candidate verification) records the blocked host, skips it for good and keeps
    going until that many consecutive results are blocked.
    """
    state = load_output(output)
    if state.get('state') == 'blocked':
        return 0, 'blocked'
    attempts = existing_attempts(previous, state)
    blocked_hosts = previously_blocked_hosts(previous, state) | (extra_blocked_hosts or set())
    CRAWLER.blocked_hosts.update(blocked_hosts)
    source_type = source_type or MODE['sourceType']
    count = streak = 0
    for seed in seeds:
        if STOP:
            state['state'] = 'stopped'; state['stopReason'] = 'signal'; state['checkedAt'] = now()
            atomic_save(output, state)
            return count, 'stopped'
        if not seed_ok(seed, clinics):
            continue
        if CRAWLER.host_key(seed['url']) in blocked_hosts:
            continue
        key = CRAWLER.canonical(seed['url'])
        if key in attempts:
            continue
        # Persist scheduled intent before network I/O. On crash this URL remains
        # attempted until a human inspects the checkpoint; no hidden retry.
        row = {'url': seed['url'], 'checkedAt': now(), 'clinicIds': [c['id'] for c in seed['clinics']],
               'status': 'not_read', 'detail': 'scheduled_before_request', 'links': [], 'matches': {},
               'sourceType': source_type, 'discoveryEvidenceUrls': seed['evidenceUrls']}
        if isinstance(seed.get('hostClinicCount'), int):
            row['hostClinicCount'] = seed['hostClinicCount']
        state['results'].append(row)
        state.pop('stopReason', None); state.pop('error', None)
        state['state'] = 'running'; state['checkedAt'] = now()
        atomic_save(output, state)
        attempts.add(key)
        try:
            result = inspect({**seed, 'sourceType': source_type})
        except Exception as error:
            result = {**row, 'status': 'error', 'error': type(error).__name__, 'detail': str(error)[:180]}
        result.setdefault('sourceType', source_type)
        if 'hostClinicCount' in row:
            result.setdefault('hostClinicCount', row['hostClinicCount'])
        state['results'][-1] = result
        count += 1
        is_blocked = result.get('status') == 'blocked' or result.get('httpStatus') in (401, 403, 429)
        streak = streak + 1 if is_blocked else 0
        stop_blocked = is_blocked and streak >= block_streak_limit
        state['state'] = 'blocked' if stop_blocked else 'running'
        if is_blocked:
            # The host is never requested again in this run or any later one (the row keeps status 'blocked').
            for url in (seed['url'], result.get('finalUrl')):
                if url:
                    blocked_hosts.add(CRAWLER.host_key(url)); CRAWLER.blocked_hosts.add(CRAWLER.host_key(url))
            state.setdefault('blockedHosts', []).append({'url': seed['url'], 'httpStatus': result.get('httpStatus'),
                                                         'detail': result.get('detail'), 'checkedAt': result.get('checkedAt')})
        if stop_blocked:
            state['blocked'] = {'url': seed['url'], 'httpStatus': result.get('httpStatus'), 'detail': result.get('detail'),
                                'checkedAt': result.get('checkedAt'), 'consecutive': streak}
        state['checkedAt'] = now()
        atomic_save(output, state)
        print(json.dumps({'url': seed['url'], 'status': result.get('status'), 'httpStatus': result.get('httpStatus')}, ensure_ascii=False), flush=True)
        if stop_blocked:
            return count, 'blocked'
        if max_requests and count >= max_requests:
            state['state'] = 'stopped'; state['stopReason'] = 'request_limit'; state['checkedAt'] = now()
            atomic_save(output, state)
            return count, 'limit'
    state.pop('stopReason', None)
    state['state'] = 'idle'; state['checkedAt'] = now(); atomic_save(output, state)
    return count, 'idle'


def stop_handler(_signal, _frame):
    global STOP
    STOP = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true', help='Exit after the current seed batch')
    parser.add_argument('--interval', type=int, default=300, help='Idle recheck interval, minimum 60 seconds (default 300)')
    parser.add_argument('--max-requests', type=int, default=0, help='Exit after this many attempts; 0 means no limit')
    parser.add_argument('--resume-after-block', action='store_true', help='Acknowledge a previous stop; blocked URL is never retried')
    parser.add_argument('--candidates', action='store_true', help='Verify research-found candidate homepages (data/assets/candidate-homepages.json) instead of linked ones')
    args = parser.parse_args()
    mode = select_mode('candidates' if args.candidates else 'linked')
    streak_limit = BLOCK_STREAK_LIMIT if args.candidates else 1
    if args.interval < 60 or args.max_requests < 0:
        parser.error('interval must be >= 60 seconds; max-requests must be >= 0')
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        print('Another collector is running or the lock is stale: ' + str(LOCK), file=sys.stderr)
        return 1
    os.write(fd, (str(os.getpid()) + '\n').encode()); os.close(fd)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, stop_handler)
    try:
        state = load_output(OUTPUT)
        if state.get('state') == 'blocked':
            if not args.resume_after_block:
                print('중단된 요청 제한 기록을 확인하세요: ' + json.dumps(state.get('blocked'), ensure_ascii=False), file=sys.stderr)
                return 2
            state.setdefault('blockHistory', []).append(state.pop('blocked', {}))
            state['state'] = 'ready'; atomic_save(OUTPUT, state)
        data = json.loads((ROOT / 'data/clinics.json').read_text(encoding='utf-8'))
        clinics = {c['id']: c for c in data['clinics']}
        CRAWLER.DATASET_PHONES = {digits for digits in (CRAWLER.re.sub(r'\D', '', c.get('phone') or '') for c in data['clinics']) if len(digits) >= 8}
        total = 0
        while not STOP:
            proc = subprocess.run(['node', mode['prepare']], cwd=ROOT, check=False,
                                  capture_output=True, text=True)
            if proc.returncode:
                print(proc.stderr, file=sys.stderr)
                print('Seed refresh failed; stopping.', file=sys.stderr); return 1
            print(proc.stdout.strip(), flush=True)
            try:
                # prepare-discovered-homepages intentionally keeps old seed files
                # when it finds zero new links. Never treat that stale file as current.
                summary = json.loads(proc.stdout)
                seeds = json.loads(SEEDS.read_text(encoding='utf-8')).get('seeds', []) if summary['newUrls'] and SEEDS.exists() else []
                remaining = max(0, args.max_requests - total) if args.max_requests else 0
                count, reason = run_once(OUTPUT, seeds, clinics, PREVIOUS, CRAWLER.inspect, remaining,
                                         blocked_hosts_in_batches(ROOT / 'data/assets'), streak_limit)
            except Exception as error:
                # Malformed seed summary, checkpoint or asset batch JSON: record a
                # durable error state rather than exiting while 'running'.
                mark_error(OUTPUT, error)
                print(json.dumps({'state': 'error', 'error': type(error).__name__, 'detail': str(error)[:180]}, ensure_ascii=False), file=sys.stderr, flush=True)
                return 1
            total += count
            print(json.dumps({'cycleRequests': count, 'totalRequests': total, 'state': reason}, ensure_ascii=False), flush=True)
            if reason == 'blocked': return 2
            if reason in ('limit', 'stopped') or args.once: return 0
            # Signal-aware idle wait; no repeated Naver/platform requests.
            deadline = time.monotonic() + args.interval
            while not STOP and time.monotonic() < deadline:
                time.sleep(max(0, min(1, deadline - time.monotonic())))
        return 0
    finally:
        if STOP and OUTPUT.exists():
            last = load_output(OUTPUT)
            if last.get('state') != 'blocked':
                last['state'] = 'stopped'; last['stopReason'] = 'signal'; last['checkedAt'] = now()
                atomic_save(OUTPUT, last)
        try: LOCK.unlink()
        except FileNotFoundError: pass


if __name__ == '__main__':
    sys.exit(main())
