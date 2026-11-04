"""Offline tests for checkpointing and error-state behaviour of the collectors."""
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import urllib.request
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from ddl import store  # noqa: E402


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RegisteredHomepageCheckpointTests(unittest.TestCase):
    def setUp(self):
        self.module = load('registered_crawler', 'scripts/crawl-homepage-assets.py')
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / 'data').mkdir()
        (root / 'data/clinics.json').write_text(json.dumps({'clinics': [
            {'id': 'c-1', 'name': 'A치과의원', 'website': 'https://a.example/'},
            {'id': 'c-2', 'name': 'B치과의원', 'website': 'b.example/intro'},
            {'id': 'c-3', 'name': 'C치과의원', 'website': 'https://c.example:9000/'}]}))
        self.module.ROOT = root
        self.module.OUT = root / 'data/assets/national-homepages.json'

    def tearDown(self):
        self.temp.cleanup()

    def run_main(self, inspect):
        with patch.object(self.module, 'inspect', inspect), patch('sys.stdout', new=io.StringIO()):
            self.module.main()
        return json.loads(self.module.OUT.read_text())

    def test_intent_first_checkpoint_is_resumable_and_never_retries(self):
        seen = []
        def inspect(item):
            url, clinics = item
            seen.append(url)
            scheduled = json.loads(self.module.OUT.read_text())['results']
            self.assertTrue(all(r['status'] == 'not_read' and r['detail'] == 'scheduled_before_request' for r in scheduled if r['url'] == url))
            return {'url': url, 'checkedAt': store.now(), 'clinicIds': [c['id'] for c in clinics], 'status': 'read', 'links': [], 'matches': {}}
        out = self.run_main(inspect)
        self.assertEqual(sorted(seen), ['https://a.example/', 'https://b.example/intro'])
        self.assertEqual({r['url']: r['status'] for r in out['results']}, {'https://a.example/': 'read', 'https://b.example/intro': 'read'})
        self.assertEqual([x['reason'] for x in out['unrequestedRegistrations']], ['non_standard_port_not_requested'])
        self.assertNotIn(self.module.OUT.with_name(self.module.OUT.name + '.tmp').name, [p.name for p in self.module.OUT.parent.iterdir()])
        started = out['startedAt']
        out = self.run_main(lambda item: self.fail('already attempted URL must not be requested again'))
        self.assertEqual((len(out['results']), out['startedAt']), (2, started))

    def test_prior_rows_without_url_are_preserved_verbatim(self):
        self.module.OUT.parent.mkdir(parents=True, exist_ok=True)
        legacy = {'note': 'hand-edited legacy row without url', 'checkedAt': '2026-10-01T00:00:00.000Z'}
        self.module.OUT.write_text(json.dumps({'schemaVersion': 1, 'startedAt': 's', 'results': [legacy, {'url': 'https://a.example/', 'status': 'read', 'clinicIds': ['c-1'], 'links': [], 'matches': {}}]}))
        out = self.run_main(lambda item: {'url': item[0], 'checkedAt': store.now(), 'clinicIds': [c['id'] for c in item[1]], 'status': 'read', 'links': [], 'matches': {}})
        self.assertEqual(out['results'][0], legacy)
        self.assertEqual([r.get('url') for r in out['results']], [None, 'https://a.example/', 'https://b.example/intro'])

    def test_crash_leaves_scheduled_rows_that_are_not_retried(self):
        def inspect(item):
            url, clinics = item
            if url.startswith('https://a.'):
                raise RuntimeError('worker crashed')
            return {'url': url, 'checkedAt': store.now(), 'clinicIds': ['c-2'], 'status': 'read', 'links': [], 'matches': {}}
        with self.assertRaises(RuntimeError):
            self.run_main(inspect)
        out = json.loads(self.module.OUT.read_text())
        self.assertEqual({r['url']: r['status'] for r in out['results']}['https://a.example/'], 'not_read')
        out = self.run_main(lambda item: self.fail('interrupted URL must not be retried'))
        self.assertEqual(len(out['results']), 2)


class OfficialSourceGuardTests(unittest.TestCase):
    def setUp(self):
        self.module = load('verify_official', 'scripts/verify-official-source.py')

    def test_redirect_off_portal_is_refused(self):
        handler = self.module.PortalRedirect()
        req = urllib.request.Request('https://www.data.go.kr/data/x')
        for target in ('https://evil.test/x', 'http://www.data.go.kr/x', 'https://data.go.kr.evil.test/'):
            with self.assertRaises(ValueError):
                handler.redirect_request(req, None, 302, 'Found', {}, target)
        self.assertIsNotNone(handler.redirect_request(req, None, 302, 'Found', {}, 'https://api.data.go.kr/x'))

    def test_oversized_zip_members_are_refused_before_extraction(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as z:
            z.writestr('a.csv', 'x')
        z = zipfile.ZipFile(io.BytesIO(buffer.getvalue()))
        self.module.check_members(z)
        z.infolist()[0].file_size = self.module.MEMBER_LIMIT + 1
        with self.assertRaisesRegex(ValueError, 'member exceeds'):
            self.module.check_members(z)

    def test_report_has_no_temp_path_and_handles_missing_metadata(self):
        source = Path(self.module.__file__).read_text()
        self.assertNotIn("'downloadPath'", source)
        self.assertIn('shutil.rmtree(folder', source)


class ContinuousCollectorErrorStateTests(unittest.TestCase):
    def test_mark_error_replaces_running_state(self):
        collector = load('continuous_collector_guard', 'scripts/continuous-homepage-collector.py')
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'out.json'
            store.atomic_json(output, {'schemaVersion': 1, 'state': 'running', 'results': []})
            collector.mark_error(output, ValueError('bad json'))
            state = json.loads(output.read_text())
            self.assertEqual((state['state'], state['stopReason'], state['error']['type']), ('error', 'exception', 'ValueError'))
            (Path(temp) / 'bad.json').write_text('{not json')
            with self.assertRaises(ValueError):
                collector.blocked_hosts_in_batches(Path(temp))


class DiscoveredHomepageLegacyRowTests(unittest.TestCase):
    def test_legacy_rows_without_url_or_status_do_not_crash(self):
        crawler = load('discovered_crawler_guard', 'scripts/crawl-discovered-homepages.py')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            crawler.SEEDS = root / 'seeds.json'
            crawler.OUT = root / 'out.json'
            crawler.SEEDS.write_text(json.dumps({'seeds': [{'url': 'https://new.example/', 'clinics': [{'id': 'c-1', 'name': 'A'}], 'evidenceUrls': []}]}))
            crawler.OUT.write_text(json.dumps({'schemaVersion': 1, 'results': [{'note': 'legacy row without url'}, {'url': 'https://old.example/'}]}))
            with patch.object(crawler, 'inspect', lambda seed: {**seed, 'checkedAt': store.now(), 'clinicIds': ['c-1'], 'status': 'read', 'links': [], 'matches': {}}), patch('sys.stdout', new=io.StringIO()):
                crawler.main()
            results = json.loads(crawler.OUT.read_text())['results']
            self.assertEqual([r.get('url') for r in results], [None, 'https://old.example/', 'https://new.example/'])
            self.assertEqual(results[-1]['status'], 'read')


if __name__ == '__main__':
    unittest.main()
