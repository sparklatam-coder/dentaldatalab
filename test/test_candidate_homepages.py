"""Offline tests for the research-candidate homepage verification mode (no network)."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


collector = load('candidate_collector', 'scripts/continuous-homepage-collector.py')
crawler = collector.CRAWLER


def blocked(seed, status=403):
    return {'url': seed['url'], 'checkedAt': collector.now(), 'clinicIds': ['c-test'], 'status': 'blocked',
            'httpStatus': status, 'links': [], 'matches': {}}


def read(seed):
    return {'url': seed['url'], 'checkedAt': collector.now(), 'clinicIds': ['c-test'], 'status': 'read',
            'httpStatus': 200, 'links': [], 'matches': {}, 'sourceType': seed.get('sourceType')}


class DatasetPhoneCountTests(unittest.TestCase):
    PHONES = {'0212345678', '0311234567', '0553647600', '15881234'}

    def test_counts_distinct_dataset_phones_in_any_common_format(self):
        page = '대표전화 02-123-4567 / 분원 031)123-4567 · 0212345678 · 1588-1234 · 02.123.4567'
        self.assertEqual(crawler.dataset_phone_count(page, self.PHONES), 3)
        self.assertEqual(crawler.dataset_phone_count('문의 055-364-7600', self.PHONES), 1)
        self.assertEqual(crawler.dataset_phone_count('문의 055-364-7600 사업자 123-45-67890', self.PHONES), 1)

    def test_unknown_numbers_and_empty_dataset_do_not_count(self):
        self.assertEqual(crawler.dataset_phone_count('02-999-9999 010-1234-5678', self.PHONES), 0)
        self.assertEqual(crawler.dataset_phone_count('02-123-4567', set()), 0)
        self.assertEqual(crawler.dataset_phone_count('12345 02-123-45678', self.PHONES), 0)


class AddressSpanTests(unittest.TestCase):
    RECORD = '충청북도 청주시 상당구 청남로 2196, (석교동)'

    def test_province_is_optional_when_jurisdiction_road_and_number_are_contiguous(self):
        self.assertTrue(crawler.address_match(self.RECORD, '주소 : 청주시 상당구 청남로 2196 1층'))
        self.assertTrue(crawler.address_match(self.RECORD, '충북 청주시 상당구 청남로 2196'))
        self.assertTrue(crawler.address_match('서울특별시 강남구 테헤란로 10, 3층', '서울시 강남구 테헤란로 10'))

    def test_road_and_number_alone_or_wrong_number_do_not_match(self):
        self.assertFalse(crawler.address_match(self.RECORD, '청남로 2196'))
        self.assertFalse(crawler.address_match(self.RECORD, '청주시 상당구 청남로 21960'))
        self.assertFalse(crawler.address_match(self.RECORD, '상당구 청남로 2196'))
        self.assertFalse(crawler.address_match('세종특별자치시 한누리대로 2130', '한누리대로 2130'))

    def test_a_different_province_before_the_span_rejects_a_same_name_branch(self):
        record = '대구광역시 중구 중앙대로 400'
        self.assertTrue(crawler.address_match(record, '대구광역시 중구 중앙대로 400'))
        self.assertTrue(crawler.address_match(record, '주소: 중구 중앙대로 400 2층'))
        self.assertFalse(crawler.address_match(record, '부산광역시 중구 중앙대로 400'))
        self.assertFalse(crawler.address_match(record, '부산 중구 중앙대로 400'))
        # A merged-province record still accepts the older province label on the page.
        self.assertTrue(crawler.address_match('전남광주통합특별시 북구 금남로 1', '광주광역시 북구 금남로 1'))
        self.assertTrue(crawler.address_match('전남광주통합특별시 순천시 중앙로 1', '전라남도 순천시 중앙로 1'))
        self.assertTrue(crawler.address_match('세종특별자치시 한누리대로 2130', '세종 한누리대로 2130'))


class CandidateModeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = Path(self.temp.name) / 'candidate.json'
        self.clinic = {'id': 'c-test', 'name': 'Test Clinic', 'address': 'Test Road 1', 'phone': '12345678'}
        self.clinics = {self.clinic['id']: self.clinic}
        self.seeds = [{'url': 'https://example%d.com/' % i, 'clinics': [self.clinic], 'evidenceUrls': ['https://search.example/%d' % i],
                       'hostClinicCount': 1} for i in range(8)]
        collector.STOP = False
        crawler.blocked_hosts.clear()

    def tearDown(self):
        self.temp.cleanup()

    def run_candidates(self, inspect, seeds=None):
        return collector.run_once(self.output, seeds or self.seeds, self.clinics, [], inspect,
                                  block_streak_limit=collector.BLOCK_STREAK_LIMIT, source_type='candidate_homepage')

    def test_single_blocked_host_is_recorded_skipped_and_run_continues(self):
        seen = []
        def inspect(seed):
            seen.append(seed['url'])
            return blocked(seed) if seed['url'] == self.seeds[0]['url'] else read(seed)
        same_host_again = dict(self.seeds[0], url='https://example0.com/other')
        count, status = self.run_candidates(inspect, self.seeds[:3] + [same_host_again])
        self.assertEqual((count, status), (3, 'idle'))
        self.assertNotIn(same_host_again['url'], seen)
        state = json.loads(self.output.read_text())
        self.assertEqual(state['state'], 'idle')
        self.assertNotIn('blocked', state)
        self.assertEqual([b['url'] for b in state['blockedHosts']], [self.seeds[0]['url']])
        self.assertTrue(all(r['sourceType'] == 'candidate_homepage' and r['hostClinicCount'] == 1 for r in state['results']))
        # A later run never retries the blocked host.
        count, status = self.run_candidates(inspect, [same_host_again])
        self.assertEqual((count, status), (0, 'idle'))

    def test_five_consecutive_blocks_stop_the_run_durably(self):
        seen = []
        def inspect(seed):
            seen.append(seed['url'])
            return blocked(seed, 429)
        count, status = self.run_candidates(inspect)
        self.assertEqual((count, status), (5, 'blocked'))
        state = json.loads(self.output.read_text())
        self.assertEqual(state['state'], 'blocked')
        self.assertEqual(state['blocked']['consecutive'], 5)
        self.assertEqual(self.run_candidates(inspect), (0, 'blocked'))
        self.assertEqual(len(seen), 5)

    def test_streak_resets_after_a_readable_page(self):
        pattern = iter(['b', 'b', 'b', 'b', 'r', 'b', 'b', 'r'])
        def inspect(seed):
            return blocked(seed) if next(pattern) == 'b' else read(seed)
        count, status = self.run_candidates(inspect)
        self.assertEqual((count, status), (8, 'idle'))

    def test_linked_mode_still_stops_on_first_block(self):
        count, status = collector.run_once(self.output, self.seeds, self.clinics, [], blocked, block_streak_limit=1)
        self.assertEqual((count, status), (1, 'blocked'))
        self.assertEqual(json.loads(self.output.read_text())['state'], 'blocked')

    def test_select_mode_points_at_separate_files_and_excludes_own_output(self):
        try:
            mode = collector.select_mode('candidates')
            self.assertEqual(collector.OUTPUT.name, 'candidate-homepages.json')
            self.assertEqual(collector.LOCK.name, 'candidate-homepages.lock')
            self.assertEqual(collector.SEEDS.name, 'candidate-homepage-seeds.json')
            self.assertNotIn(collector.OUTPUT, collector.PREVIOUS)
            self.assertEqual(len(collector.PREVIOUS), 3)
            self.assertEqual(mode['sourceType'], 'candidate_homepage')
            self.assertIn('연속 5회', mode['requestPolicy'])
            fresh = collector.load_output(Path(self.temp.name) / 'missing.json')
            self.assertEqual(fresh['scope'], mode['scope'])
        finally:
            collector.select_mode('linked')
        self.assertEqual(collector.OUTPUT.name, 'continuous-homepages.json')
        self.assertNotIn(collector.OUTPUT, collector.PREVIOUS)
        self.assertEqual(len(collector.PREVIOUS), 3)


class SeedGeneratorTests(unittest.TestCase):
    """Drive the exported buildSeeds() of prepare-candidate-homepages.mjs with a fixture inventory."""

    def seeds(self, records, attempted=()):
        script = ("import {buildSeeds} from %s;let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=JSON.parse(s);"
                  "console.log(JSON.stringify(buildSeeds(i.records,new Set(i.attempted))));});"
                  % json.dumps(str(ROOT / 'scripts/prepare-candidate-homepages.mjs')))
        proc = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps({'records': records, 'attempted': list(attempted)}),
                              capture_output=True, text=True, cwd=ROOT, check=True)
        return json.loads(proc.stdout)

    @staticmethod
    def asset(url, provenance=('automated_web_research',), ownership='candidate', kind='website'):
        return {'url': url, 'kind': kind, 'ownership': ownership, 'evidenceUrls': ['https://search.example/' + url.split('//')[1]],
                'provenance': [{'type': t} for t in provenance]}

    def record(self, clinic_id, *assets):
        return {'clinicId': clinic_id, 'name': 'N' + clinic_id, 'address': 'A', 'phone': '02-1', 'assets': list(assets)}

    def test_selects_only_research_candidates_and_skips_platforms_and_attempts(self):
        records = [self.record('c-1', self.asset('https://one.example/'),
                               self.asset('https://two.example/', provenance=('hira_registration', 'homepage_scan')),
                               self.asset('https://three.example/', ownership='linked'),
                               self.asset('https://blog.naver.com/x', kind='naverBlog'),
                               self.asset('https://four.modoo.at/'),
                               self.asset('https://www.five.example/'))]
        seeds = self.seeds(records, attempted=['five.example/'])
        self.assertEqual([s['url'] for s in seeds], ['https://one.example/'])
        self.assertEqual(seeds[0]['clinics'], [{'id': 'c-1', 'name': 'Nc-1', 'address': 'A', 'phone': '02-1'}])
        self.assertEqual(seeds[0]['evidenceUrls'], ['https://search.example/one.example/'])
        self.assertEqual(seeds[0]['hostClinicCount'], 1)

    def test_host_clinic_count_spans_all_clinics_on_the_host(self):
        records = [self.record('c-1', self.asset('https://group.example/seoul')),
                   self.record('c-2', self.asset('https://group.example/busan')),
                   self.record('c-3', self.asset('https://group.example/seoul'))]
        seeds = {s['url']: s for s in self.seeds(records)}
        self.assertEqual(set(seeds), {'https://group.example/seoul', 'https://group.example/busan'})
        self.assertEqual(seeds['https://group.example/seoul']['hostClinicCount'], 3)
        self.assertEqual([c['id'] for c in seeds['https://group.example/seoul']['clinics']], ['c-1', 'c-3'])


if __name__ == '__main__':
    unittest.main()
