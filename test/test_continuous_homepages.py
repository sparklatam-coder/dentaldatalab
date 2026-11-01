import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('continuous_collector', ROOT / 'scripts/continuous-homepage-collector.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)

class ContinuousHomepageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.output = self.root / 'output.json'
        self.clinic = {'id': 'c-test', 'name': 'Test Clinic', 'address': 'Test Road 1', 'phone': '12345678'}
        self.clinics = {self.clinic['id']: self.clinic}
        self.seeds = [{'url': 'https://example.com/a', 'clinics': [self.clinic], 'evidenceUrls': ['https://example.com/source']},
                      {'url': 'https://example.org/b', 'clinics': [self.clinic], 'evidenceUrls': ['https://example.org/source']}]
        collector.STOP = False
    def tearDown(self): self.temp.cleanup()

    def test_stops_immediately_and_persists_block_without_retry(self):
        seen = []
        def inspect(seed):
            seen.append(seed['url'])
            state = json.loads(self.output.read_text())
            self.assertEqual(state['results'][-1]['detail'], 'scheduled_before_request')
            return {'url': seed['url'], 'checkedAt': collector.now(), 'clinicIds': ['c-test'], 'status': 'blocked', 'httpStatus': 429, 'links': [], 'matches': {}}
        count, status = collector.run_once(self.output, self.seeds, self.clinics, [], inspect)
        self.assertEqual((count, status), (1, 'blocked'))
        self.assertEqual(seen, ['https://example.com/a'])
        self.assertEqual(collector.run_once(self.output, self.seeds, self.clinics, [], inspect), (0, 'blocked'))
        self.assertEqual(len(seen), 1)

    def test_preserves_attempted_and_skips_platform_or_invalid_identity(self):
        previous = self.root / 'old.json'
        previous.write_text(json.dumps({'results': [{'url': self.seeds[0]['url'], 'status': 'error'}]}))
        bad = [dict(self.seeds[0], url='https://m.place.naver.com/hospital/1/home'),
               dict(self.seeds[0], url='http://127.0.0.1/test'),
               dict(self.seeds[0], clinics=[dict(self.clinic, name='Wrong')]),
               dict(self.seeds[0], evidenceUrls=[])]
        seen = []
        def inspect(seed):
            seen.append(seed['url'])
            return {'url': seed['url'], 'checkedAt': collector.now(), 'clinicIds': ['c-test'], 'status': 'read', 'links': [], 'matches': {}}
        count, status = collector.run_once(self.output, bad + self.seeds, self.clinics, [previous], inspect)
        self.assertEqual((count, status), (1, 'idle'))
        self.assertEqual(seen, ['https://example.org/b'])
        self.assertEqual(collector.run_once(self.output, self.seeds, self.clinics, [previous], inspect), (0, 'idle'))

    def test_interrupted_intent_is_not_automatically_retried(self):
        collector.atomic_save(self.output, {'schemaVersion': 1, 'state': 'running', 'results': [{'url': self.seeds[0]['url'], 'status': 'not_read', 'detail': 'scheduled_before_request'}]})
        seen = []
        def inspect(seed):
            seen.append(seed['url'])
            return {'url': seed['url'], 'checkedAt': collector.now(), 'clinicIds': ['c-test'], 'status': 'read', 'links': [], 'matches': {}}
        collector.run_once(self.output, self.seeds[:1], self.clinics, [], inspect)
        self.assertEqual(seen, [])

    def test_previously_blocked_host_is_not_retried_at_another_path(self):
        previous = self.root / 'old.json'
        previous.write_text(json.dumps({'results': [{'url': 'https://www.example.com/blocked', 'status': 'blocked', 'httpStatus': 403}]}))
        seen = []
        def inspect(seed):
            seen.append(seed['url'])
            return {'url': seed['url'], 'checkedAt': collector.now(), 'clinicIds': ['c-test'], 'status': 'read', 'links': [], 'matches': {}}
        collector.run_once(self.output, self.seeds, self.clinics, [previous], inspect)
        self.assertEqual(seen, ['https://example.org/b'])

    def test_limit_and_signal_have_durable_non_running_state(self):
        def inspect(seed):
            return {'url': seed['url'], 'checkedAt': collector.now(), 'clinicIds': ['c-test'], 'status': 'read', 'links': [], 'matches': {}}
        self.assertEqual(collector.run_once(self.output, self.seeds, self.clinics, [], inspect, 1), (1, 'limit'))
        data = json.loads(self.output.read_text())
        self.assertEqual((data['state'], data['stopReason']), ('stopped', 'request_limit'))
        collector.STOP = True
        self.assertEqual(collector.run_once(self.output, self.seeds, self.clinics, [], inspect), (0, 'stopped'))
        data = json.loads(self.output.read_text())
        self.assertEqual((data['state'], data['stopReason']), ('stopped', 'signal'))

    def test_blocked_manual_asset_host_is_skipped(self):
        (self.root / 'manual.json').write_text(json.dumps({'records': [{'assets': [{'kind':'website', 'bodyStatus':'blocked', 'url':'https://www.example.com/blocked'}]}]}))
        blocked = collector.blocked_hosts_in_batches(self.root)
        seen = []
        def inspect(seed):
            seen.append(seed['url'])
            return {'url': seed['url'], 'checkedAt': collector.now(), 'clinicIds': ['c-test'], 'status': 'read', 'links': [], 'matches': {}}
        collector.run_once(self.output, self.seeds, self.clinics, [], inspect, extra_blocked_hosts=blocked)
        self.assertEqual(seen, ['https://example.org/b'])

if __name__ == '__main__': unittest.main()
