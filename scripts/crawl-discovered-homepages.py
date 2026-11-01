#!/usr/bin/env python3
"""Inspect only the prepared discovered-homepage seeds, once per URL.

Reuses the registered-homepage crawler's public DNS/default-port guards and href
classification. Does not modify the registered-homepage scan or access platforms.
Existing results are checkpoints: rerunning skips every previously attempted URL.
"""
import concurrent.futures
import datetime
import hashlib
import html
import importlib.util
import json
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEEDS = ROOT / 'data/research/discovered-homepage-seeds.json'
OUT = ROOT / 'data/assets/discovered-homepages.json'
SPEC = importlib.util.spec_from_file_location('registered_homepage_crawler', ROOT / 'scripts/crawl-homepage-assets.py')
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)
PLATFORMS = ('naver.com', 'naver.me', 'modoo.at', 'instagram.com', 'facebook.com', 'youtube.com', 'kakao.com', 'daum.net')
PROVINCE_GROUPS = [('서울', '서울특별시'), ('부산', '부산광역시'), ('대구', '대구광역시'),
    ('인천', '인천광역시'), ('광주', '광주광역시'), ('대전', '대전광역시'), ('울산', '울산광역시'),
    ('세종', '세종특별자치시'), ('경기', '경기도'), ('강원', '강원도', '강원특별자치도'),
    ('충북', '충청북도'), ('충남', '충청남도'), ('전북', '전라북도', '전북특별자치도'),
    ('전남', '전라남도'), ('경북', '경상북도'), ('경남', '경상남도'), ('제주', '제주특별자치도'),
    ('전남광주', '전남광주통합특별시')]
locks = {}
lock_guard = threading.Lock()
blocked_hosts = set()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds')


def canonical(url):
    p = urllib.parse.urlsplit(url)
    return (p.hostname or '').removeprefix('www.') + (p.path.rstrip('/') or '/') + ('?' + p.query if p.query else '')


def host_key(url):
    return (urllib.parse.urlsplit(url).hostname or '').removeprefix('www.')


def platform(url):
    host = urllib.parse.urlsplit(url).hostname or ''
    return any(host == domain or host.endswith('.' + domain) for domain in PLATFORMS)


class Redirect(BASE.Redirect):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if platform(newurl):
            raise ValueError('platform_redirect_separate_review')
        if host_key(newurl) in blocked_hosts:
            raise ValueError('previously_blocked_host')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def address_match(address, visible):
    address = unicodedata.normalize('NFC', address or '')
    parts = address.split()
    if not parts:
        return False
    group = next((group for group in PROVINCE_GROUPS if parts[0] in group), None)
    road = re.search(r'(?<!\S)([^\s,]+(?:대로|로|길))\s+(\d+(?:-\d+)?)(?=[\s,()]|$)', address)
    if not group or not road:
        return False
    jurisdiction = []
    for token in address[:road.start()].split()[1:]:
        if re.fullmatch(r'[가-힣A-Za-z0-9]+[시군구]', token):
            jurisdiction.append(token)
        else:
            break
    if not jurisdiction and group[0] != '세종':
        return False
    prefix = '(?:' + '|'.join(re.escape(x) for x in sorted(group, key=len, reverse=True)) + ')'
    locality = ''.join(r'\s*' + re.escape(x) for x in jurisdiction)
    # Keep the province, all jurisdiction tokens, road and number in one short
    # contiguous address span, not independent matches anywhere on the page.
    pattern = prefix + locality + r'\s*(?:[가-힣0-9]+[읍면]\s*)?' + re.escape(road.group(1)) + r'\s*' + re.escape(road.group(2)) + r'(?![\d-])'
    return bool(re.search(pattern, visible))


def inspect(seed):
    url, clinics = seed['url'], seed['clinics']
    result = {'url': url, 'checkedAt': now(), 'clinicIds': [c['id'] for c in clinics],
        'status': 'not_read', 'links': [], 'matches': {}, 'sourceType': 'discovered_homepage',
        'discoveryEvidenceUrls': seed.get('evidenceUrls', [])}
    if platform(url):
        return dict(result, status='platform_separate_review')
    host = host_key(url)
    with lock_guard:
        lock = locks.setdefault(host, threading.Lock())
    with lock:
        if host in blocked_hosts:
            return dict(result, status='skipped_blocked_host')
        time.sleep(0.4)
        try:
            BASE.public_url(url)
            opener = urllib.request.build_opener(Redirect())
            req = urllib.request.Request(url, headers={'User-Agent': 'DentalDataLabResearch/0.6 (discovered homepage link audit)', 'Accept': 'text/html'})
            with opener.open(req, timeout=8) as response:
                result.update(httpStatus=response.status, finalUrl=response.url)
                if 'html' not in (response.headers.get('Content-Type') or '').lower():
                    return dict(result, status='not_html')
                raw = response.read(1_500_001)
                result['truncated'] = len(raw) > 1_500_000
                raw = raw[:1_500_000]
                result['bodySha256'] = hashlib.sha256(raw).hexdigest()
                declared = response.headers.get_content_charset()
                meta = re.search(br'charset\s*=\s*["\']?([\w-]+)', raw[:8192], re.I)
                codec = declared or (meta.group(1).decode() if meta else 'utf-8')
                try:
                    body = raw.decode(codec, errors='replace')
                except LookupError:
                    body = raw.decode('utf-8', errors='replace')
            if any(marker in body.lower() for marker in ('cf-chl-', 'challenge-platform', '<title>access denied', '<title>just a moment', '<title>attention required')):
                blocked_hosts.add(host)
                blocked_hosts.add(host_key(result['finalUrl']))
                return dict(result, status='blocked', detail='challenge_or_access_denied_page')
            parser = BASE.Links()
            parser.feed(body)
            visible = unicodedata.normalize('NFC', ' '.join(parser.text))
            compact = re.sub(r'\s+', '', visible)
            for clinic in clinics:
                name = re.sub(r'\s+', '', unicodedata.normalize('NFC', clinic['name'].replace('의원', '')))
                phone = re.sub(r'\D', '', clinic.get('phone') or '')
                phone_pattern = r'(?<!\d)' + r'[\s().-]*'.join(re.escape(digit) for digit in phone) + r'(?!\d)'
                result['matches'][clinic['id']] = {
                    'name': bool(name and name in compact),
                    'phone': bool(len(phone) >= 8 and re.search(phone_pattern, visible)),
                    'address': address_match(clinic.get('address'), visible)}
            found = {}
            for href in parser.links:
                link = BASE.safe_url(urllib.parse.urljoin(result['finalUrl'], html.unescape(href)))
                if link and BASE.kind_of(link):
                    found[link] = {'kind': BASE.kind_of(link), 'url': link}
            result['observedLinkCount'] = len(found)
            if any(match['name'] or match['phone'] for match in result['matches'].values()):
                result['links'] = list(found.values())
            else:
                result['withheldLinkCount'] = len(found)
                result['linkAssignmentNote'] = 'No clinic name or phone matched; external links withheld.'
            result['status'] = 'read'
        except urllib.error.HTTPError as error:
            result.update(status='blocked' if error.code in (401, 403, 429) else 'http_error', httpStatus=error.code,
                          finalUrl=error.geturl())
            if result['status'] == 'blocked':
                blocked_hosts.add(host)
                blocked_hosts.add(host_key(error.geturl()))
        except Exception as error:
            result.update(status='platform_separate_review' if str(error) == 'platform_redirect_separate_review' else 'error',
                          error=type(error).__name__, detail=str(error)[:180])
    return result


def atomic_save(value):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(OUT)


def main():
    seed_bytes = SEEDS.read_bytes()
    source = json.loads(seed_bytes)
    prior = json.loads(OUT.read_text()) if OUT.exists() else {}
    results = prior.get('results', [])
    attempted = {canonical(row['url']) for row in results}
    blocked_hosts.update(host_key(row['url']) for row in results if row['status'] == 'blocked')
    blocked_hosts.update(host_key(row['finalUrl']) for row in results if row['status'] == 'blocked' and row.get('finalUrl'))
    seeds, excluded, seen = [], [], set()
    for item in source['seeds']:
        url = BASE.safe_url(item.get('url'))
        if not url or not item.get('clinics') or any(not c.get('id') or not c.get('name') for c in item.get('clinics', [])):
            excluded.append({'url': item.get('url'), 'reason': 'invalid_url_or_clinic_identity'})
            continue
        key = canonical(url)
        if key in seen or key in attempted:
            excluded.append({'url': url, 'reason': 'duplicate_or_already_attempted'})
            continue
        seen.add(key)
        seeds.append({**item, 'url': url})
    out = {'schemaVersion': 1, 'startedAt': prior.get('startedAt') or now(), 'checkedAt': now(),
        'scope': '기관 페이지에서 발견된 새 홈페이지 seed만 1회 확인. 플랫폼 본문과 이전 실패 URL 재요청 제외. 자동 대조와 실제 href는 검토 후보이며 공식 소유 인증이 아님.',
        'seedSource': 'data/research/discovered-homepage-seeds.json', 'seedSha256': hashlib.sha256(seed_bytes).hexdigest(),
        'requestPolicy': 'Public DNS and standard ports; 3 workers, per-host lock and delay; no retries; platform redirects not followed; all prior attempts skipped; no browser or credentials.',
        'unrequestedRegistrations': excluded, 'results': results}
    # Persist each scheduled intent before starting requests. A crash leaves
    # not_read records which are skipped rather than retried on the next run.
    pending = {seed['url']: {'url': seed['url'], 'checkedAt': now(), 'clinicIds': [c['id'] for c in seed['clinics']],
        'status': 'not_read', 'detail': 'scheduled_before_request', 'links': [], 'matches': {},
        'sourceType': 'discovered_homepage', 'discoveryEvidenceUrls': seed.get('evidenceUrls', [])} for seed in seeds}
    results.extend(pending.values())
    atomic_save(out)
    positions = {row['url']: index for index, row in enumerate(results)}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(inspect, seed): seed for seed in seeds}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            result = future.result()
            results[positions[result['url']]] = result
            out['checkedAt'] = now()
            atomic_save(out)
            print(json.dumps({'completed': index, 'scheduled': len(seeds), 'status': result['status'], 'links': len(result['links'])}), flush=True)
    print(json.dumps({'output': str(OUT), 'totalResults': len(results), 'newlyScheduled': len(seeds),
        'read': sum(r['status'] == 'read' for r in results), 'links': sum(len(r['links']) for r in results)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
