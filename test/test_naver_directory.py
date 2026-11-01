"""Offline regressions for conservative third-party map-link discovery."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('naver_directory', ROOT / 'scripts/discover-national-naver.py')
DIRECTORY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DIRECTORY)
CHECKED_AT = '2026-11-01T00:00:00.000+00:00'


def clinic(cid='c-1', name='서울탑치과의원', address='경기도 양주시 옥정로 200'):
    return {'id': cid, 'name': name, 'address': address}


def listing(name='서울탑치과의원', address='경기 양주시 옥정로 200', place_id='123', source_url='https://local-dent.com/gyeonggi/yangju'):
    return {'directoryRecordId': place_id, 'name': name, 'address': address,
            'placeId': place_id, 'mapUrl': f'https://map.naver.com/p/entry/place/{place_id}',
            'sourceUrl': source_url, 'checkedAt': CHECKED_AT, 'pageSha256': 'a' * 64}


def match(clinics, rows, prior=None):
    raw = json.dumps({'clinics': clinics}, ensure_ascii=False).encode()
    audit = {'listings': rows, 'finishedAt': CHECKED_AT, 'requests': [{}]}
    with patch.object(Path, 'read_bytes', return_value=raw), patch.object(DIRECTORY, 'existing_place_owners', return_value=prior or {}):
        batch = DIRECTORY.build_candidates(audit)
    return audit, batch


class NaverDirectoryTests(unittest.TestCase):
    def test_parser_keeps_only_observed_district_and_clinic_identity_links(self):
        regions = DIRECTORY.RegionLinks()
        regions.feed('''<a href="/gyeonggi/yangju">양주</a><a href="/gyeonggi/yangju">중복</a>
          <a href="/stations/yangju">역</a><a href="/gyeonggi/stations">역 목록</a>
          <a href="/gyeonggi/yangju/clinics">깊은 경로</a><a href="/gyeonggi/yangju?q=1">검색</a>
          <a href="https://local-dent.com.evil.test/seoul/jung">다른 호스트</a>''')
        self.assertEqual(regions.urls, ['https://local-dent.com/gyeonggi/yangju'])
        parser = DIRECTORY.ClinicListings()
        parser.feed('''<a href="https://map.naver.com/p/entry/place/999">목록 밖</a>
          <li data-directory-clinic="row-1"><a href="https://map.naver.com/p/entry/place/123"><span>서울탑</span>치과의원</a>
          <span class="maru-directory-address">경기 양주시 옥정로 200</span>
          <small>진료시간 09:00~18:00, 리뷰 원문은 보존하지 않음</small></li>''')
        self.assertEqual(parser.rows, [{'directoryRecordId': 'row-1', 'name': '서울탑치과의원',
            'address': '경기 양주시 옥정로 200', 'mapUrl': 'https://map.naver.com/p/entry/place/123', 'placeId': '123'}])
        self.assertIsNone(DIRECTORY.naver_place_id('https://map.naver.com.evil.test/place/123'))
        self.assertIsNone(DIRECTORY.naver_place_id('https://user@map.naver.com/place/123'))

    def test_name_jurisdiction_road_and_building_must_all_match(self):
        variants = [
            listing(name='서울탑치과'),
            listing(address='강원 양주시 옥정로 200', source_url='https://local-dent.com/gangwon/test'),
            listing(address='경기 의정부시 옥정로 200'),
            listing(address='경기 양주시 옥정로 201'),
            listing(address='경기 양주시 고암로 200'),
            listing(address='경기 양주시 고암동 200'),
        ]
        for row in variants:
            with self.subTest(name=row['name'], address=row['address']):
                self.assertEqual(match([clinic()], [row])[1]['records'], [])
        self.assertNotEqual(DIRECTORY.address_key('경기 수원시 영통구 같은로 10'),
                            DIRECTORY.address_key('경기도 수원시 팔달구 같은로 10'))
        audit, batch = match([clinic()], [listing(name='서울 탑 치과의원')])
        self.assertEqual(audit['matching']['matchedInstitutions'], 1)
        record = batch['records'][0]
        self.assertIs(record['researched'], False)
        self.assertEqual(record['assets'][0]['ownership'], 'candidate')
        self.assertEqual(record['assets'][0]['bodyStatus'], 'not_read')
        self.assertNotIn('naverPlaceObservations', record)
        self.assertEqual(record['assets'][0]['identityEvidence'][1]['sourceUrl'],
                         'https://local-dent.com/gyeonggi/yangju')

    def test_multiple_hira_ids_with_same_name_and_building_are_held(self):
        audit, batch = match([clinic('c-1'), clinic('c-2')], [listing()])
        self.assertEqual(batch['records'], [])
        self.assertEqual(audit['listings'][0]['match']['status'], 'ambiguous_institution')

    def test_combined_snapshot_province_alias_requires_same_literal_scope_and_jurisdiction(self):
        for district, road, page in [('북구', '서양로 139', 'gwangju/buk'),
                                     ('순천시', '중앙로 126', 'jeonnam/suncheon')]:
            with self.subTest(district=district):
                source = clinic(address=f'전남광주통합특별시 {district} {road}')
                row = listing(address=f'전남광주 {district} {road}',
                              source_url=f'https://local-dent.com/{page}')
                _, batch = match([source], [row])
                self.assertEqual(len(batch['records']), 1)
                # This alias does not merge the separate province labels.
                for separate_prefix in ['광주광역시', '전라남도']:
                    separate = listing(address=f'{separate_prefix} {district} {road}',
                                       source_url=f'https://local-dent.com/{page}')
                    self.assertEqual(match([source], [separate])[1]['records'], [])
                wrong_district = listing(address=f'전남광주 다른시 {road}',
                                         source_url=f'https://local-dent.com/{page}')
                self.assertEqual(match([source], [wrong_district])[1]['records'], [])
                wrong_page = listing(address=f'전남광주 {district} {road}',
                                     source_url='https://local-dent.com/gyeonggi/yangju')
                audit, batch = match([source], [wrong_page])
                self.assertEqual(batch['records'], [])
                self.assertEqual(audit['listings'][0]['match']['status'], 'page_province_mismatch')
        # An actual same-name/road match in a separate old province cannot be
        # promoted merely because the directory uses the combined prefix.
        old_source = clinic(address='광주광역시 북구 서양로 139')
        merged_row = listing(address='전남광주 북구 서양로 139',
                             source_url='https://local-dent.com/gwangju/buk')
        self.assertEqual(match([old_source], [merged_row])[1]['records'], [])

    def test_one_place_id_with_different_identities_is_never_assigned(self):
        clinics = [clinic(), clinic('c-2', '다른치과의원', '경기 양주시 옥정로 201')]
        rows = [listing(), listing('다른치과의원', '경기 양주시 옥정로 201')]
        audit, batch = match(clinics, rows)
        self.assertEqual(batch['records'], [])
        self.assertEqual(audit['matching']['conflictingPlaceIds'], ['123'])
        self.assertTrue(all(row['match']['status'] == 'conflicting_place_identity' for row in rows))
        # Even an unmatched directory identity makes a shared map ID unsafe.
        _, batch = match([clinic()], [listing(), listing('미등록치과의원', '경기 양주시 옥정로 201')])
        self.assertEqual(batch['records'], [])

    def test_existing_other_clinic_owner_prevents_new_assignment(self):
        audit, batch = match([clinic()], [listing()], {'123': {'c-other'}})
        self.assertEqual(batch['records'], [])
        self.assertEqual(audit['listings'][0]['match']['status'], 'conflicting_place_identity')
        self.assertEqual(len(match([clinic()], [listing()], {'123': {'c-1'}})[1]['records']), 1)

    def test_multiple_places_for_one_institution_are_held_but_repeat_evidence_deduplicates(self):
        rows = [listing(place_id='123'), listing(place_id='456')]
        audit, batch = match([clinic()], rows)
        self.assertEqual(batch['records'], [])
        self.assertEqual(audit['matching']['statusCounts'], {'multiple_places_for_institution': 2})
        rows = [listing(), listing(source_url='https://local-dent.com/gyeonggi/other')]
        _, batch = match([clinic()], rows)
        self.assertEqual(len(batch['records']), 1)
        self.assertEqual(len(batch['records'][0]['assets']), 1)
        self.assertEqual(len(batch['records'][0]['assets'][0]['evidenceUrls']), 2)


if __name__ == '__main__':
    unittest.main()
