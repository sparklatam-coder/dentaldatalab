#!/usr/bin/env python3
"""Collect public Korean Google autocomplete evidence, without inventing demand ranks.

No account, billing, authentication keys, proxies, or access-limit retries.
Autocomplete observations are topic-discovery signals, not search-volume data.
Google Trends is only checked through its ordinary public exploration URL;
no private/token endpoints are used and an HTML shell is not counted as data.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SEEDS = [
    ('implant-1', 'implant', '임플란트'), ('implant-2', 'implant', '임플란트 뼈이식'),
    ('orthodontics-1', 'orthodontics', '치아교정'), ('orthodontics-2', 'orthodontics', '투명교정'),
    ('caries-1', 'caries', '충치치료'), ('caries-2', 'caries', '치과 레진'),
    ('endodontics-1', 'endodontics', '신경치료'), ('endodontics-2', 'endodontics', '치근단절제술'),
    ('extraction-1', 'extraction', '사랑니 발치'), ('extraction-2', 'extraction', '발치 후'),
    ('prosthetics-1', 'prosthetics', '치과 크라운'), ('prosthetics-2', 'prosthetics', '틀니'),
    ('periodontal-1', 'periodontal', '스케일링'), ('periodontal-2', 'periodontal', '잇몸치료'),
    ('cosmetic-1', 'cosmetic', '치아미백'), ('cosmetic-2', 'cosmetic', '라미네이트'),
    ('pediatric-1', 'pediatric', '어린이 충치'), ('pediatric-2', 'pediatric', '불소도포'),
    ('safety-1', 'safety', '치과 수면마취'), ('safety-2', 'safety', '치통'),
]
OFFICIAL_SOURCES = [
    {'id': 'keyword-planner-access', 'title': '키워드 플래너 사용하기', 'url': 'https://support.google.com/google-ads/answer/7337243?hl=ko-KR', 'reviewedOn': '2026-11-01', 'finding': '기본 기능 이용에도 결제 정보를 포함한 계정 설정 완료가 필요하다고 안내. 건강 등 민감한 카테고리는 결과가 제한될 수 있음.'},
    {'id': 'keyword-planner-metrics', 'title': '키워드 플래너의 예측에 대한 정보', 'url': 'https://support.google.com/google-ads/answer/3022575?hl=ko', 'reviewedOn': '2026-11-01', 'finding': '월평균 검색량은 선택 기간·지역·검색 네트워크에 따른 키워드 및 유사 검색어의 평균이며 반올림된 통계. 기본 평균은 언어에 관계없이 12개월 기준. 광고 노출 예측과 검색량은 별개.'},
    {'id': 'trends-data', 'title': 'Google 트렌드 데이터 관련 FAQ', 'url': 'https://support.google.com/trends/answer/4365533?hl=ko', 'reviewedOn': '2026-11-01', 'finding': '지역·기간에 따른 상대 관심도 0~100이며 절대 월검색량이 아님. 다른 비교 묶음의 100을 서로 비교하면 안 됨. 낮은 검색량의 0은 실제 검색이 전혀 없었다는 보장이 아님.'},
    {'id': 'autocomplete-data', 'title': 'Google 자동 완성 예상 검색어의 작동 방식', 'url': 'https://support.google.com/websearch/answer/7368877?hl=ko', 'reviewedOn': '2026-11-01', 'finding': '실제 검색어와 언어·위치·관심사·검색 이력·정책 필터 등의 영향을 받는 예상 검색어. 단순 검색 빈도순이나 가장 인기 있는 검색어 목록이 아님.'},
]


def now():
    return datetime.now(timezone.utc).isoformat()


def normalize(value):
    return ' '.join(unicodedata.normalize('NFC', value).strip().split())


def fetch(url):
    # urllib creates an anonymous public request; no browser cookies are read.
    with urllib.request.urlopen(url, timeout=20) as response:
        body = response.read(2 * 1024 * 1024 + 1)
        if len(body) > 2 * 1024 * 1024:
            raise ValueError('Public response exceeds collection limit')
        return body, response.status, response.url, response.headers.get('Content-Type')


def collect(output, delay):
    started = now()
    observations = []
    restricted = False
    for index, (seed_id, category, query) in enumerate(SEEDS):
        url = 'https://suggestqueries.google.com/complete/search?' + urllib.parse.urlencode({'client': 'firefox', 'hl': 'ko', 'gl': 'kr', 'q': query})
        item = {'id': 'google-autocomplete-' + seed_id, 'seedId': seed_id, 'category': category, 'seed': query, 'observedAt': now(), 'source': 'google_autocomplete', 'requestUrl': url, 'requestedLanguage': 'ko', 'requestedCountry': 'KR', 'period': None, 'suggestions': [], 'searchRank': None, 'avgMonthlySearches': None}
        if restricted:
            item.update(status='not_attempted_after_access_restriction')
        else:
            try:
                body, status, final_url, content_type = fetch(url)
                if '/sorry/' in final_url or (body.lstrip().startswith(b'<') and (b'unusual traffic' in body.lower() or b'captcha' in body.lower())):
                    raise PermissionError('Public endpoint returned an access challenge; stopped')
                raw = json.loads(body.decode('utf8'))
                if not isinstance(raw, list) or len(raw) < 2 or not isinstance(raw[1], list) or not all(isinstance(s, str) for s in raw[1]):
                    raise ValueError('Unexpected autocomplete response shape')
                item.update(status='observed', httpStatus=status, finalUrl=final_url, contentType=content_type, responseSha256=hashlib.sha256(body).hexdigest(), suggestions=raw[1], rawResponse=raw)
            except PermissionError as error:
                item.update(status='access_restricted', error=str(error))
                restricted = True
            except urllib.error.HTTPError as error:
                item.update(status='access_restricted' if error.code in (401, 403, 429) else 'request_failed', httpStatus=error.code, error=str(error))
                restricted = error.code in (401, 403, 429)
            except Exception as error:
                item.update(status='request_failed', error=type(error).__name__ + ': ' + str(error))
        observations.append(item)
        if index + 1 < len(SEEDS) and not restricted:
            time.sleep(delay)
    keywords = {}
    for item in observations:
        for suggestion in item['suggestions']:
            key = normalize(suggestion)
            if key not in keywords:
                keywords[key] = {'keyword': suggestion, 'normalizedKeyword': key, 'sourceObservationIds': [], 'seedIds': [], 'categories': [], 'searchRank': None, 'avgMonthlySearches': None}
            entry = keywords[key]
            for field, value in [('sourceObservationIds', item['id']), ('seedIds', item['seedId']), ('categories', item['category'])]:
                if value not in entry[field]:
                    entry[field].append(value)
    trend_terms = ['임플란트', '치아교정', '신경치료', '스케일링', '사랑니 발치']
    trend_url = 'https://trends.google.com/trends/explore?' + urllib.parse.urlencode({'date': 'today 12-m', 'geo': 'KR', 'q': ','.join(trend_terms), 'hl': 'ko'})
    trends = {'geo': 'KR', 'language': 'ko', 'languageScopeNote': 'hl=ko는 화면 언어이며 한국어 검색만의 별도 표본 필터가 아님. 비교 검색어를 한국어로 지정함.', 'period': 'today 12-m', 'searchProperty': 'web', 'requestedTerms': trend_terms, 'requestUrl': trend_url, 'observedAt': now(), 'values': None, 'absoluteMonthlySearchVolume': None, 'crossBatchComparisonAllowed': False}
    try:
        body, status, final_url, content_type = fetch(trend_url)
        restricted_page = '/sorry/' in final_url or b'unusual traffic' in body.lower()
        trends.update(status='access_restricted' if restricted_page else 'page_received_no_numeric_data_extracted', httpStatus=status, finalUrl=final_url, contentType=content_type, responseSha256=hashlib.sha256(body).hexdigest(), responseBytes=len(body))
        trends['note'] = '본문 수신만으로 추세 수치 확보라 판단하지 않음. 그래프/CSV 수치 미확보; 월검색량 및 순위는 산출하지 않음.'
    except urllib.error.HTTPError as error:
        trends.update(status='access_restricted' if error.code in (401, 403, 429) else 'request_failed', httpStatus=error.code, error=str(error))
    except Exception as error:
        trends.update(status='request_failed', error=type(error).__name__ + ': ' + str(error))
    result = {
        'schemaVersion': 1, 'collectedAt': started, 'completedAt': now(),
        'market': {'country': 'KR', 'language': 'ko', 'regionScopeNote': 'Autocomplete의 hl=ko/gl=kr 요청 문맥. 한국 거주자만의 측정 표본이나 기간별 한국 검색량을 뜻하지 않음.'},
        'methodology': {
            'purpose': '한국어 치과 질문·콘텐츠의 주제 발굴 근거. 검색량 상위 100개 확정 자료가 아님.',
            'seedSelection': '편집자가 정한 치과 10분류별 2개 seed. Google 인기 순위로 선택한 seed가 아님.',
            'autocompletePeriod': None, 'autocompletePeriodNote': '조회 시점의 예상 검색어이며 최근 12개월 집계가 아님.',
            'ranking': '검색량·인기도 순위는 확인하지 못해 모든 searchRank를 null로 둠. 응답 순서를 검색빈도 순서로 해석하지 않음.',
            'monthlySearchVolume': '미확보. 모든 avgMonthlySearches는 null이며 외부 추정치를 대신 넣지 않음.',
            'normalization': 'Unicode NFC + 양끝 공백 제거 + 연속 공백 한 칸. 다른 띄어쓰기나 유사어는 자동 병합하지 않음.',
            'contentMatching': 'normalizedKeyword와 정확히 같은 표현만 exact 관찰. seed 연관성으로 새로 만든 질문은 seed 기반 편집안으로 구분.',
            'medicalTruth': '자동완성의 문구는 의학적 사실·안전성·치료 권고의 근거가 아님. 자극적인 예상 검색어를 진실로 재인용하지 않음.',
            'accessPolicy': '익명 공개 요청, 요청 간 지연, 접근제한 시 중단. 계정/결제/API키 생성·프록시/세션/접근제한 우회 없음.',
        },
        'officialSources': OFFICIAL_SOURCES,
        'keywordPlanner': {'status': 'not_accessed_account_setup_required', 'sourceUrl': OFFICIAL_SOURCES[0]['url'], 'monthlySearchVolume': None, 'searchRank': None, 'accountOrBillingCreated': False, 'note': '사용자 계정에 접근하거나 결제 정보를 입력하지 않음. 계정별 실제 이용 가능 여부는 확인하지 않음.'},
        'googleTrends': trends,
        'autocomplete': {
            'seeds': [{'id': seed_id, 'category': category, 'query': query} for seed_id, category, query in SEEDS],
            'observations': observations, 'keywords': list(keywords.values()),
            'summary': {'requestedSeedCount': len(SEEDS), 'successfulSeedCount': sum(item['status'] == 'observed' for item in observations), 'rawSuggestionCount': sum(len(item['suggestions']) for item in observations), 'uniqueKeywordCount': len(keywords), 'rankedKeywordCount': 0},
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + '.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(output)
    print(json.dumps({'output': str(output), **result['autocomplete']['summary'], 'trendsStatus': trends['status'], 'monthlySearchVolumeAvailable': False}, ensure_ascii=False))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/content/search-evidence.json')
    parser.add_argument('--delay', type=float, default=1.5, help='Seconds between autocomplete requests; minimum 1 second')
    args = parser.parse_args()
    if args.delay < 1:
        parser.error('--delay must be at least 1 second')
    collect(args.output, args.delay)
