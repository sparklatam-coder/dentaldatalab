#!/usr/bin/env python3
"""Observe public directory links; create conservative, unread Naver candidates.

Only /regions and its observed two-segment district links are requested. Naver
targets are never fetched. No review, introduction or opening-hours text is kept.
The requests are sequential, paced, never retried, and stop on access blocking.
"""
import argparse
import collections
import datetime
import hashlib
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_URL = 'https://local-dent.com/regions'
AUDIT_PATH = ROOT / 'data/research/naver-national-directory.json'
BATCH_PATH = ROOT / 'data/assets/naver-national-discovery.json'
USER_AGENT = 'DentalDataLabResearch/0.6 (public directory candidate audit)'
PROVINCES = {
    '서울': ('서울', '서울특별시'), '부산': ('부산', '부산광역시'),
    '대구': ('대구', '대구광역시'), '인천': ('인천', '인천광역시'),
    '광주': ('광주', '광주광역시'), '대전': ('대전', '대전광역시'),
    '울산': ('울산', '울산광역시'), '세종': ('세종', '세종시', '세종특별자치시'),
    '경기': ('경기', '경기도'), '강원': ('강원', '강원도', '강원특별자치도'),
    '충북': ('충북', '충청북도'), '충남': ('충남', '충청남도'),
    '전북': ('전북', '전라북도', '전북특별자치도'), '전남': ('전남', '전라남도'),
    '경북': ('경북', '경상북도'), '경남': ('경남', '경상남도'),
    '제주': ('제주', '제주도', '제주특별자치도'),
}
PROVINCE_ALIAS = {alias: province for province, aliases in PROVINCES.items() for alias in aliases}
# These are literal labels in this HIRA snapshot, not a claim about current law.
# Do not fold the separate 광주/전남 labels into the snapshot's combined label.
SNAPSHOT_COMBINED_PROVINCE = '전남광주'
PROVINCE_ALIAS.update({'전남광주': SNAPSHOT_COMBINED_PROVINCE,
                       '전남광주통합특별시': SNAPSHOT_COMBINED_PROVINCE})
SLUG_PROVINCE = dict(zip(
    ['seoul', 'busan', 'daegu', 'incheon', 'gwangju', 'daejeon', 'ulsan', 'sejong',
     'gyeonggi', 'gangwon', 'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam', 'gyeongbuk', 'gyeongnam', 'jeju'],
    ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
     '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']))
VOID_TAGS = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds')


def text(value):
    return ' '.join(unicodedata.normalize('NFC', str(value or '')).split())


def name_key(value):
    # Do not remove 의원/병원, branch names, punctuation or other identity markers.
    return re.sub(r'\s+', '', unicodedata.normalize('NFC', str(value or '')))


def address_key(value):
    value = text(value)
    parts = value.split()
    if not parts or parts[0] not in PROVINCE_ALIAS:
        return None
    province = PROVINCE_ALIAS[parts[0]]
    road = re.search(r'(?<!\S)([^\s,]+(?:대로|로|길))\s+(\d+(?:-\d+)?)(?=[\s,()]|$)', value)
    if not road:
        return None
    before_road = value[:road.start()].split()[1:]
    jurisdiction = []
    for part in before_road:
        if re.fullmatch(r'[가-힣A-Za-z0-9]+[시군구]', part):
            jurisdiction.append(part)
        else:
            break
    if not jurisdiction and province != '세종':
        return None
    return province, tuple(jurisdiction), road.group(1), road.group(2)


def match_key(name, address):
    address_parts = address_key(address)
    return (name_key(name), *address_parts) if name_key(name) and address_parts else None


def naver_place_id(url, directory_only=False):
    try:
        parsed = urllib.parse.urlsplit(url)
        hosts = {'map.naver.com'} if directory_only else {'map.naver.com', 'm.place.naver.com', 'pcmap.place.naver.com'}
        if parsed.scheme not in ('http', 'https') or parsed.hostname not in hosts or parsed.username or parsed.password:
            return None
        found = re.search(r'/(?:place|hospital)/(\d+)(?:/|$)', parsed.path)
        return found.group(1) if found else None
    except (TypeError, ValueError):
        return None


class RegionLinks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag != 'a' or not attrs.get('href'):
            return
        url = urllib.parse.urljoin(INDEX_URL, attrs['href'])
        parsed = urllib.parse.urlsplit(url)
        segments = parsed.path.strip('/').split('/')
        if (parsed.scheme == 'https' and parsed.hostname == 'local-dent.com'
                and len(segments) == 2 and segments[0] in SLUG_PROVINCE
                and 'stations' not in segments
                and not parsed.query and not parsed.fragment and url not in self.urls):
            self.urls.append(url)


class ClinicListings(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.active = None
        self.anchor = None
        self.address_depth = None
        self.rows = []
        self.listing_count = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        depth = len(self.stack)
        if tag == 'li' and 'data-directory-clinic' in attrs:
            self.active = {'depth': depth, 'directoryRecordId': attrs['data-directory-clinic'], 'address': [], 'anchors': []}
            self.listing_count += 1
        if self.active is not None:
            if 'maru-directory-address' in attrs.get('class', '').split():
                self.address_depth = depth
            if tag == 'a' and naver_place_id(attrs.get('href'), directory_only=True):
                self.anchor = {'depth': depth, 'url': attrs['href'], 'text': []}
                self.active['anchors'].append(self.anchor)
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_data(self, data):
        if self.active is None:
            return
        if self.anchor is not None:
            self.anchor['text'].append(data)
        if self.address_depth is not None:
            self.active['address'].append(data)

    def handle_endtag(self, tag):
        if tag not in self.stack:
            return
        depth = len(self.stack) - 1 - self.stack[::-1].index(tag)
        if self.anchor is not None and depth <= self.anchor['depth']:
            self.anchor = None
        if self.address_depth is not None and depth <= self.address_depth:
            self.address_depth = None
        if self.active is not None and depth <= self.active['depth']:
            address = text(''.join(self.active['address']))
            for anchor in self.active['anchors']:
                self.rows.append({'directoryRecordId': self.active['directoryRecordId'],
                                  'name': text(''.join(anchor['text'])), 'address': address,
                                  'mapUrl': anchor['url'], 'placeId': naver_place_id(anchor['url'], True)})
            self.active = None
        del self.stack[depth:]


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != 'https' or parsed.hostname != 'local-dent.com':
            raise ValueError('Unexpected off-origin redirect; not followed')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, timeout):
    request = {'url': url, 'checkedAt': now(), 'status': 'error', 'httpStatus': None, 'sha256': None}
    try:
        opener = urllib.request.build_opener(SameOriginRedirect())
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html'})
        with opener.open(req, timeout=timeout) as response:
            raw = response.read(8_000_001)
            request.update(httpStatus=response.status, finalUrl=response.url, byteCount=len(raw),
                           sha256=hashlib.sha256(raw).hexdigest())
            if len(raw) > 8_000_000:
                request['error'] = 'response_too_large'
                return request, None
            if 'html' not in (response.headers.get('Content-Type') or '').lower():
                request['status'] = 'not_html'
                return request, None
            body = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
        if any(marker in body.lower() for marker in ['cf-chl-', 'challenge-platform', '<title>access denied', '<title>just a moment', '<title>attention required']):
            request['status'] = 'blocked'
            request['error'] = 'challenge_or_access_denied_page'
            return request, None
        request['status'] = 'read'
        return request, body
    except urllib.error.HTTPError as error:
        request.update(httpStatus=error.code, status='blocked' if error.code in (401, 403, 429) else 'http_error')
    except Exception as error:
        request['error'] = type(error).__name__ + ': ' + str(error)[:160]
    return request, None


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(path)


def existing_place_owners():
    owners = collections.defaultdict(set)
    for directory in ['data/assets', 'data/research']:
        for path in (ROOT / directory).glob('*.json'):
            if path in (AUDIT_PATH, BATCH_PATH):
                continue
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
            except (json.JSONDecodeError, OSError):
                continue
            for record in data.get('records', []) if isinstance(data, dict) else []:
                clinic_id = record.get('clinicId')
                if not clinic_id:
                    continue
                urls = [asset.get('url') for asset in record.get('assets', []) if asset.get('ownership') != 'third_party']
                urls += [channel.get('url') for channel in record.get('channels', {}).values()]
                urls += [item.get('sourceUrl') for item in record.get('naverPlaceObservations', [])]
                for url in urls:
                    place_id = naver_place_id(url)
                    if place_id:
                        owners[place_id].add(clinic_id)
    return owners


def build_candidates(audit):
    source_bytes = (ROOT / 'data/clinics.json').read_bytes()
    source = json.loads(source_bytes)
    clinics = {clinic['id']: clinic for clinic in source['clinics']}
    index = collections.defaultdict(list)
    for clinic in clinics.values():
        key = match_key(clinic['name'], clinic.get('address'))
        if key:
            index[key].append(clinic['id'])
    prior = existing_place_owners()
    place_signatures = collections.defaultdict(set)
    clinic_places = collections.defaultdict(set)
    rows = audit['listings']
    for row in rows:
        key = match_key(row['name'], row['address'])
        signature = key or (name_key(row['name']), text(row['address']))
        place_signatures[row['placeId']].add(signature)
        candidates = index.get(key, [])
        page_province = SLUG_PROVINCE.get(urllib.parse.urlsplit(row['sourceUrl']).path.strip('/').split('/')[0])
        # Permit the directory's two legacy region paths only when an exact
        # HIRA candidate itself uses the combined snapshot address prefix.
        combined_snapshot_match = bool(key and key[1] == SNAPSHOT_COMBINED_PROVINCE
                                       and page_province in ('광주', '전남') and candidates)
        if not key:
            row['match'] = {'status': 'incomplete_identity'}
        elif not candidates:
            row['match'] = {'status': 'no_exact_match'}
        elif key[1] != page_province and not combined_snapshot_match:
            row['match'] = {'status': 'page_province_mismatch'}
        elif len(candidates) > 1:
            row['match'] = {'status': 'ambiguous_institution', 'clinicIds': candidates}
        else:
            clinic_id = candidates[0]
            row['match'] = {'status': 'matched', 'clinicId': clinic_id}
            clinic_places[clinic_id].add(row['placeId'])
    conflicts = set()
    for row in rows:
        if row['match']['status'] != 'matched':
            continue
        clinic_id, place_id = row['match']['clinicId'], row['placeId']
        if len(place_signatures[place_id]) > 1 or any(owner != clinic_id for owner in prior.get(place_id, set())):
            row['match']['status'] = 'conflicting_place_identity'
            conflicts.add(place_id)
        elif len(clinic_places[clinic_id]) > 1:
            row['match']['status'] = 'multiple_places_for_institution'
    records = {}
    for row in rows:
        if row['match']['status'] != 'matched':
            continue
        clinic = clinics[row['match']['clinicId']]
        record = records.setdefault(clinic['id'], {'clinicId': clinic['id'], 'name': clinic['name'],
            'checkedAt': row['checkedAt'], 'researched': False, 'automaticDiscovery': True,
            'searches': [], 'assets': []})
        if record['assets']:
            candidate = record['assets'][0]
            if row['sourceUrl'] not in candidate['evidenceUrls']:
                candidate['evidenceUrls'].append(row['sourceUrl'])
            if row['mapUrl'] not in candidate['observedUrls']:
                candidate['observedUrls'].append(row['mapUrl'])
            continue
        record['assets'].append({'kind': 'naverMap', 'label': '공개 디렉토리에서 찾은 네이버지도 후보',
            'url': row['mapUrl'], 'placeId': row['placeId'], 'ownership': 'candidate', 'bodyStatus': 'not_read',
            'checkedAt': row['checkedAt'], 'discoveryUrl': row['sourceUrl'], 'evidenceUrls': [row['sourceUrl']],
            'observedUrls': [row['mapUrl']],
            'identityEvidence': [{'field': 'name', 'value': row['name'], 'sourceUrl': row['sourceUrl']},
                                 {'field': 'address', 'value': row['address'], 'sourceUrl': row['sourceUrl']}],
            'notes': '제3자 디렉토리의 실제 링크입니다. 공백 정리한 기관명, 시도·시군구 관할, 도로명·건물번호가 심평원 한 기관과만 일치해 후보로 연결했습니다. 네이버 본문·운영시간·현재 운영 또는 채널 소유는 확인하지 않았습니다.',
            'provenance': [{'type': 'third_party_directory_discovery', 'sourceUrl': row['sourceUrl'],
                            'checkedAt': row['checkedAt'], 'pageSha256': row['pageSha256'],
                            'matchingRule': 'exact_name_whitespace_and_province_municipality_road_building_unique'}]})
    counts = collections.Counter(row['match']['status'] for row in rows)
    by_province = collections.Counter(address_key(clinics[cid]['address'])[0] for cid in records)
    audit['matching'] = {'sourceFile': 'data/clinics.json', 'sourceSha256': hashlib.sha256(source_bytes).hexdigest(),
        'rule': 'NFC/whitespace-only clinic name + normalized province + all city/county/district address tokens + exact road/building; unique HIRA match required.',
        'snapshotProvinceAlias': {'aliases': ['전남광주통합특별시', '전남광주'], 'normalized': SNAPSHOT_COMBINED_PROVINCE,
            'basis': 'The HIRA snapshot uses address prefix 전남광주통합특별시 and sido 전남광주. Only these literal labels are equivalent; separate 광주/전남 labels remain distinct.',
            'directoryPageScope': 'gwangju/jeonnam paths allowed only if an exact name/jurisdiction/road/building HIRA candidate uses this same combined address prefix.'},
        'statusCounts': dict(counts), 'conflictingPlaceIds': sorted(conflicts), 'matchedInstitutions': len(records),
        'matchedByProvince': dict(sorted(by_province.items()))}
    batch = {'schemaVersion': 1, 'checkedAt': audit['finishedAt'], 'sourceType': 'third_party_directory_discovery',
        'automaticDiscovery': True, 'researched': False,
        'scope': {'sourceUrl': INDEX_URL, 'regionPagesAttempted': len(audit['requests']) - 1,
                  'source': 'local-dent.com 공개 지역 디렉토리',
                  'limitations': '전국 원자료의 일부 기관에 대한 자동 링크 후보입니다. 네이버지도 본문 조사·시간 확보·기관 소유 확인이 아니며, 미매칭은 기관이나 채널 부재를 뜻하지 않습니다.'},
        'records': sorted(records.values(), key=lambda item: item['clinicId'])}
    return batch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=250)
    parser.add_argument('--interval', type=float, default=0.4)
    parser.add_argument('--timeout', type=float, default=20)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--rematch', action='store_true', help='Recompute matching from saved observations without any network requests')
    mode.add_argument('--resume', action='store_true', help='Continue only unattempted URLs in the saved scope; blocked runs cannot resume')
    args = parser.parse_args()
    if not 0.3 <= args.interval <= 0.5 or not 1 <= args.limit <= 250:
        parser.error('interval must be 0.3–0.5 seconds and limit must be 1–250')
    if args.rematch:
        audit = json.loads(AUDIT_PATH.read_text(encoding='utf-8'))
    else:
        if args.resume:
            if not AUDIT_PATH.exists():
                parser.error('No saved directory observation exists')
            audit = json.loads(AUDIT_PATH.read_text(encoding='utf-8'))
            if audit.get('scanStatus') == 'stopped_blocked' or any(r.get('status') == 'blocked' for r in audit['requests']):
                parser.error('A blocked run cannot resume; use --rematch for local-only processing')
            if not audit.get('selectedRegionUrls'):
                parser.error('No previously observed district scope exists; the index will not be retried')
            audit.setdefault('resumeEvents', []).append(now())
            audit['scanStatus'] = 'in_progress'
            can_scan = True
        else:
            audit = {'schemaVersion': 1, 'sourceUrl': INDEX_URL, 'startedAt': now(), 'finishedAt': None,
                'scanStatus': 'in_progress', 'maxRegionPages': args.limit, 'intervalSeconds': args.interval,
                'method': 'Sequential ordinary GET; only district hrefs observed on /regions; no retries; stop on 401/403/429 or challenge; no Naver target requests.',
                'retainedFields': ['directory record ID', 'institution name', 'address', 'actual Naver map href', 'request status/time/hash', 'matching evidence'],
                'requests': [], 'observedRegionUrls': [], 'selectedRegionUrls': [], 'listings': []}
            request, body = fetch(INDEX_URL, args.timeout)
            audit['requests'].append(request)
            can_scan = body is not None
        if not args.resume and can_scan:
            links = RegionLinks(); links.feed(body)
            audit['observedRegionUrls'] = links.urls
            audit['selectedRegionUrls'] = links.urls[:args.limit]
        if can_scan:
            attempted = {request['url'] for request in audit['requests']}
            remaining = [url for url in audit['selectedRegionUrls'] if url not in attempted]
            for url in remaining:
                time.sleep(args.interval)
                # Record intent first: an interrupted/in-flight request is never retried by --resume.
                audit['requests'].append({'url': url, 'checkedAt': now(), 'status': 'in_progress', 'httpStatus': None, 'sha256': None})
                atomic_json(AUDIT_PATH, audit)
                request, page = fetch(url, args.timeout)
                audit['requests'][-1] = request
                if page is not None:
                    listings = ClinicListings(); listings.feed(page)
                    request['directoryListingCount'] = listings.listing_count
                    request['naverMapLinkCount'] = len(listings.rows)
                    for row in listings.rows:
                        row.update(sourceUrl=url, checkedAt=request['checkedAt'], pageSha256=request['sha256'])
                        audit['listings'].append(row)
                if request['status'] == 'blocked':
                    audit['scanStatus'] = 'stopped_blocked'
                    break
                atomic_json(AUDIT_PATH, audit)
                page_number = len(audit['requests']) - 1
                if page_number % 25 == 0:
                    print(json.dumps({'pagesAttempted': page_number, 'selected': len(audit['selectedRegionUrls']),
                                      'observedMapLinks': len(audit['listings'])}), flush=True)
            else:
                audit['scanStatus'] = 'completed_selected_pages'
        else:
            audit['scanStatus'] = 'stopped_blocked' if request['status'] == 'blocked' else 'index_unavailable'
        audit['finishedAt'] = now()
    batch = build_candidates(audit)
    audit['summary'] = {'regionLinksObserved': len(audit['observedRegionUrls']),
        'regionPagesAttempted': len(audit['requests']) - 1,
        'requestStatuses': dict(collections.Counter(r['status'] for r in audit['requests'])),
        'directoryRowsObserved': len(audit['listings']),
        'uniquePlaceIdsObserved': len({r['placeId'] for r in audit['listings']}),
        'candidateInstitutions': len(batch['records']), 'byProvince': audit['matching']['matchedByProvince']}
    atomic_json(AUDIT_PATH, audit)
    atomic_json(BATCH_PATH, batch)
    print(json.dumps({'scanStatus': audit['scanStatus'], **audit['summary'],
                      'matchingStatuses': audit['matching']['statusCounts']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
