import importlib.util
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('seo_monitor',Path(__file__).resolve().parents[1]/'scripts/seo-monitor.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ORIGIN='https://dentaldatalab.com'

class SeoMonitorTest(unittest.TestCase):
    def healthy(self,url):
        body={'/':'<title>치과데이터랩</title><link rel="canonical" href="https://dentaldatalab.com/"><a href="/clinics/">치과</a>','/robots.txt':'User-agent: *\nAllow: /\nSitemap: https://dentaldatalab.com/sitemap.xml','/sitemap.xml':'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://dentaldatalab.com/</loc></url></urlset>','/clinics/':'<title>치과 목록</title>'}[url[len(ORIGIN):]]
        return {'url':url,'effectiveUrl':url,'ok':True,'status':200,'tlsVerified':True,'headers':{},'body':body}
    def check(self,fetcher):
        with patch.object(socket,'getaddrinfo',return_value=[(None,None,None,None,('203.0.113.1',443))]):return m.check_site(ORIGIN,ORIGIN,fetcher)
    def test_healthy_bounded_requests(self):
        calls=[]
        result=self.check(lambda url:(calls.append(url),self.healthy(url))[1])
        self.assertTrue(result['ok']);self.assertEqual(len(calls),4)
        self.assertTrue(all('body' not in r for r in result['requests']))
    def test_noindex_detected_in_header_and_meta(self):
        for header in (True,False):
            def f(url):
                r=self.healthy(url)
                if url==ORIGIN+'/':
                    if header:r['headers']['x-robots-tag']='noindex, follow'
                    else:r['body']+='<meta name="robots" content="noindex, follow">'
                return r
            r=self.check(f)
            self.assertFalse(next(c['ok'] for c in r['checks'] if c['check']=='index_directive'))
    def test_full_site_robots_block_detected(self):
        def f(url):
            r=self.healthy(url)
            if url.endswith('/robots.txt'):r['body']='User-agent: Googlebot\nDisallow: /\nUser-agent: *\nAllow: /'
            return r
        r=self.check(f);self.assertFalse(next(c['ok'] for c in r['checks'] if c['check']=='robots_crawl_allowed'))
    def test_bad_canonical_sitemap_and_link(self):
        def f(url):
            r=self.healthy(url)
            if url==ORIGIN+'/':r['body']=r['body'].replace('href="https://dentaldatalab.com/"','href="https://wrong.example/"')
            if url.endswith('/sitemap.xml'):r['body']='<html>error</html>'
            if url.endswith('/clinics/'):r['ok']=False;r['status']=404
            return r
        r=self.check(f)
        self.assertTrue({'canonical','sitemap','core_link_http'}.issubset({c['check'] for c in r['checks'] if not c['ok']}))
    def test_transport_failure_remains_failure(self):
        r=self.check(lambda url:{'url':url,'ok':False,'error':'TLS failure'})
        self.assertFalse(r['ok']);self.assertFalse(next(c['ok'] for c in r['checks'] if c['check']=='tls'))
    def test_backoff_and_origin_validation(self):
        self.assertEqual([m.delay(n,3600,300,3600) for n in (0,1,2,8)],[3600,300,600,3600])
        for origin in ['http://dentaldatalab.com','https://user:pass@example.com','https://example.com/path','https://example.com:444']:
            with self.assertRaises(ValueError):m.public_origin(origin)
        self.assertEqual(m.public_origin(ORIGIN+'/'),ORIGIN)

    def test_default_monitors_primary_only_and_marks_metrics_unconnected(self):
        with tempfile.TemporaryDirectory() as work, patch.object(m,'WORK',Path(work)), patch.object(m,'check_site',return_value={'origin':ORIGIN,'checks':[],'requests':[],'ok':True}) as check, patch('sys.argv',['seo-monitor','--once']):
            self.assertEqual(m.main(),0)
            check.assert_called_once_with(ORIGIN,ORIGIN)
            state=m.json.loads((Path(work)/'state.json').read_text())
            self.assertIn('not connected',state['indexing']['google'])
            self.assertNotIn('access required',state['indexing']['google'])

if __name__=='__main__':unittest.main()
