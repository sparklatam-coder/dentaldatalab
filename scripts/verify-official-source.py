#!/usr/bin/env python3
"""Re-download the official HIRA snapshot and independently compare local fields.

Standard-library Python 3 only. Does not change data/, does not use credentials,
and stops if the portal asks for CAPTCHA. A matching ZIP verifies source
provenance; it does not verify current clinic operations or reported facts.
"""
import argparse
import collections
import csv
import hashlib
import http.cookiejar
import io
import json
from pathlib import Path
import re
import sys
import tempfile
from datetime import datetime, timezone
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PAGE = 'https://www.data.go.kr/data/15051059/fileData.do'
ORIGIN = 'https://www.data.go.kr'
LIMIT = 150 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def request(opener, url, parameters=None):
    data = urllib.parse.urlencode(parameters).encode() if parameters is not None else None
    req = urllib.request.Request(url, data=data, headers={'Referer': PAGE})
    with opener.open(req, timeout=30) as response:
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError('Response exceeds verification size limit')
        return body, {'url': response.url, 'httpStatus': response.status, 'contentType': response.headers.get('Content-Type')}


def archive_name(info):
    return info.filename if info.flag_bits & 0x800 else info.filename.encode('cp437').decode('cp949')


def integer(value):
    return int(value) if value and re.fullmatch(r'-?\d+', value) else None


def clock_time(value):
    if not value or not re.fullmatch(r'\d{3,4}', value):
        return None
    value = value.zfill(4)
    hour, minute = int(value[:2]), int(value[2:])
    if (hour == 0 and minute == 0) or hour > 24 or minute > 59 or (hour == 24 and minute):
        return None
    return value[:2] + ':' + value[2:]


def compare_csv(archive, local):
    z = zipfile.ZipFile(io.BytesIO(archive))
    entries = {archive_name(info): info for info in z.infolist()}
    def rows(key):
        found = [info for name, info in entries.items() if key in name]
        if len(found) != 1:
            raise ValueError('Expected one CSV for ' + key)
        return [{k: v.strip() for k, v in row.items()} for row in csv.DictReader(io.StringIO(z.read(found[0]).decode('cp949')))]
    base = rows('병원정보서비스')
    dental = [row for row in base if row['종별코드'] in ('41', '51')]
    keys = {row['암호화요양기호'] for row in dental}
    def grouped(key):
        result = collections.defaultdict(list)
        for row in rows(key):
            if row['암호화요양기호'] in keys:
                result[row['암호화요양기호']].append(row)
        return result
    specs, equipment, details = grouped('03_진료과목정보'), grouped('05_의료장비정보'), grouped('02_세부정보')
    local_by_id = {clinic['id']: clinic for clinic in local['clinics']}
    fields = {'name': '요양기관명', 'typeCode': '종별코드', 'sidoCode': '시도코드', 'sido': '시도코드명', 'cityCode': '시군구코드', 'city': '시군구코드명', 'address': '주소', 'phone': '전화번호', 'website': '병원홈페이지', 'openedOn': '개설일자', 'dong': '읍면동', 'postalCode': '우편번호'}
    doctor_fields = {'general': '치과일반의 인원수', 'intern': '치과인턴 인원수', 'resident': '치과레지던트 인원수', 'specialist': '치과전문의 인원수', 'total': '총의사수'}
    days = {'mon': '월요일', 'tue': '화요일', 'wed': '수요일', 'thu': '목요일', 'fri': '금요일', 'sat': '토요일', 'sun': '일요일'}
    errors, ids = [], set()
    for row in dental:
        key = row['암호화요양기호']
        clinic_id = 'c-' + sha(key.encode())[:12]
        if clinic_id in ids:
            errors.append({'id': clinic_id, 'field': 'duplicate_source_id'})
        ids.add(clinic_id)
        clinic = local_by_id.get(clinic_id)
        if not clinic:
            errors.append({'id': clinic_id, 'field': 'missing_local_record'})
            continue
        expected = {field: row[column] or None for field, column in fields.items()}
        doctors = {field: integer(row[column]) for field, column in doctor_fields.items()}
        # Preserve the importer's documented derived-total fallback.
        components = [doctors[k] for k in ('general', 'intern', 'resident', 'specialist')]
        if doctors['total'] is None and all(n is not None for n in components):
            doctors['total'] = sum(components)
        for field, value in doctors.items():
            if clinic['doctors'][field] != value:
                errors.append({'id': clinic_id, 'field': 'doctors.' + field})
        expected['specialties'] = [{'code': r['진료과목코드'] or None, 'name': r['진료과목코드명'] or None, 'specialists': integer(r['과목별 전문의수'])} for r in specs[key]]
        expected['equipment'] = [{'code': r['장비코드'] or None, 'name': r['장비코드명'] or None, 'count': integer(r['장비대수'])} for r in equipment[key]]
        if len(details[key]) > 1:
            errors.append({'id': clinic_id, 'field': 'duplicate_detail_rows'})
        detail = details[key][0] if details[key] else {}
        hours, unclear = {}, []
        for day, ko in days.items():
            start, end = clock_time(detail.get('진료시작시간_' + ko)), clock_time(detail.get('진료종료시간_' + ko))
            hours[day] = {'open': start, 'close': end} if start and end and end > start else {'open': None, 'close': None}
            if start and end and end <= start:
                unclear.append({'day': day, 'open': start, 'close': end, 'reason': '종료가 시작보다 늦지 않음. 날짜 넘김 여부 미확인.'})
        expected['hours'] = hours
        if clinic['hoursNotes']['unclearHours'] != unclear:
            errors.append({'id': clinic_id, 'field': 'hoursNotes.unclearHours'})
        for field, column in [('lat', '좌표(Y)'), ('lon', '좌표(X)')]:
            expected[field] = float(row[column]) if row[column] else None
        expected['sourceIds'] = ['hira-base'] + (['hira-detail'] if detail else []) + (['hira-specialties'] if expected['specialties'] else []) + (['hira-equipment'] if expected['equipment'] else [])
        for field, value in expected.items():
            if clinic[field] != value:
                errors.append({'id': clinic_id, 'field': field})
    extra = sorted(set(local_by_id) - ids)
    return {'method': 'Independent Python zipfile/CP949 csv parsing; no project importer used', 'allInstitutionRows': len(base), 'dentalRows': len(dental), 'localRows': len(local['clinics']), 'byType': dict(collections.Counter(r['종별코드명'] for r in dental)), 'comparedFields': list(fields) + ['doctors.' + k for k in doctor_fields] + ['specialties', 'equipment', 'hours.mon..sun', 'hoursNotes.unclearHours', 'lat', 'lon', 'sourceIds'], 'mismatchCount': len(errors) + len(extra), 'mismatchExamples': errors[:30], 'extraLocalIds': extra[:30], 'sourceRegion360000Names': dict(collections.Counter(r['시도코드명'] for r in dental if r['시도코드'] == '360000')), 'sourceRegion240000Names': dict(collections.Counter(r['시도코드명'] for r in dental if r['시도코드'] == '240000')), 'archiveEntries': [{'name': name, 'size': info.file_size, 'sha256': sha(z.read(info))} for name, info in entries.items()]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/source-verification-recheck.json')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'data/source-manifest.json').read_text())
    local = json.loads((ROOT / 'data/clinics.json').read_text())
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    report = {'schemaVersion': 1, 'checkedAt': now(), 'expectedSnapshotDate': manifest['snapshotDate'], 'status': 'not_completed', 'currentInstitutionFacts': 'not_verified', 'originalLocalFilesOverwritten': False}
    try:
        body, response = request(opener, PAGE)
        text = body.decode('utf8')
        metadata = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', text, re.S).group(1))
        report['catalog'] = {**response, 'name': metadata['alternateName'], 'dateCreated': metadata['dateCreated'], 'dateModified': metadata['dateModified'], 'license': metadata['license']['name'], 'sha256': sha(body)}
        call = re.search(r"fn_fileDataDown\('([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'", text)
        if not call:
            raise ValueError('Official download button metadata not found; manual review needed')
        public_id, detail_id, attachment, file_sn = call.groups()
        body, _ = request(opener, ORIGIN + '/tcs/dss/selectFileDataDownload.do', {'publicDataPk': public_id, 'publicDataDetailPk': detail_id, 'atchFileId': attachment, 'fileDetailSn': file_sn, 'publicDataTyCode': 'PR0051', 'url': '/tcs/dss/selectFileDataDownload.do'})
        download_metadata = json.loads(body)
        if download_metadata.get('status') is not True:
            raise ValueError('Official metadata endpoint did not authorize a download')
        params = {'atchFileId': download_metadata['atchFileId'], 'fileDetailSn': download_metadata['fileDetailSn']}
        body, _ = request(opener, ORIGIN + '/cmm/cmm/check-limit.json', params)
        access = json.loads(body)
        report['downloadAccessCheck'] = access
        if access.get('needCaptcha') is not False:
            raise ValueError('Download access requires CAPTCHA or is unclear; stopped without downloading')
        params['dataNm'] = download_metadata['dataSetFileDetailInfo']['dataNm']
        url = ORIGIN + '/cmm/cmm/fileDownload.do?' + urllib.parse.urlencode(params)
        body, response = request(opener, url)
        if not zipfile.is_zipfile(io.BytesIO(body)):
            raise ValueError('Official download response is not a ZIP')
        folder = Path(tempfile.mkdtemp(prefix='ddl-official-source-'))
        archive_path = folder / 'official-hira.zip'
        archive_path.write_bytes(body)
        matched = sha(body) == manifest['archive']['sha256'] and len(body) == manifest['archive']['size']
        report['download'] = {**response, 'checkedAt': now(), 'officialOriginalFileName': download_metadata['fileDataRegistVO'].get('orginlFileNm'), 'size': len(body), 'sha256': sha(body), 'expectedSha256': manifest['archive']['sha256'], 'archiveMatchesManifest': matched, 'downloadPath': str(archive_path), 'apiKeyUsed': False, 'loginUsed': False}
        report['comparison'] = compare_csv(body, local)
        report['status'] = 'official_snapshot_matched' if matched and report['comparison']['mismatchCount'] == 0 else 'official_snapshot_differs_review_required'
    except Exception as error:
        report['status'] = 'verification_incomplete'
        report['error'] = {'type': type(error).__name__, 'message': str(error)}
    report['completedAt'] = now()
    report['meaning'] = '공식 분기 원본과 로컬 가공 결과의 일치 여부만 검사합니다. 현재 영업·진료·전화·홈페이지 운영의 사실 확인이 아닙니다.'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + '.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(args.output)
    print(json.dumps({'status': report['status'], 'report': str(args.output), 'currentInstitutionFacts': report['currentInstitutionFacts']}, ensure_ascii=False))
    return 0 if report['status'] == 'official_snapshot_matched' else 1


if __name__ == '__main__':
    sys.exit(main())
