"""Offline tests for scripts/ddl/web.py: no DNS, sockets or HTTP are ever used."""
import email
import io
import sys
import unittest
import urllib.error
import urllib.request
import urllib.response
from pathlib import Path
from unittest import mock
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
from ddl import store, web  # noqa: E402

PUBLIC = '93.184.216.34'


def addrinfo(*addresses):
    return [(None, None, None, None, (address, 443)) for address in addresses]


def resolver(table):
    def getaddrinfo(host, port, *args, **kwargs):
        if host not in table:
            raise OSError('unexpected lookup in test: ' + str(host))
        return addrinfo(*table[host])
    return getaddrinfo


def canned(url, code, body=b'', **headers):
    message = email.message_from_string(''.join(k.replace('_', '-') + ': ' + v + '\n' for k, v in headers.items()))
    response = urllib.response.addinfourl(io.BytesIO(body), message, url, code)
    response.msg = 'canned'
    return response


class SafeUrlTests(unittest.TestCase):
    def test_safe_url_normalizes_and_rejects(self):
        self.assertEqual(web.safe_url('Example.COM/a b'), 'https://example.com/a%20b')
        self.assertEqual(web.safe_url('http://example.com:80/x?q=1#frag'), 'http://example.com:80/x?q=1')
        for bad in (None, 'ftp://example.com/', 'https://user:pw@example.com/', 'https://example.com:8443/', 'https://localhost/', 'file:///etc/passwd'):
            self.assertIsNone(web.safe_url(bad), bad)

    def test_resolve_public_fails_closed(self):
        with patch('socket.getaddrinfo', side_effect=resolver({'example.test': [PUBLIC, PUBLIC]})) as lookup:
            self.assertEqual(web.resolve_public('https://example.test/path'), [PUBLIC])
            self.assertEqual(lookup.call_args.args[:2], ('example.test', 443))
        with patch('socket.getaddrinfo', resolver({'example.test': [PUBLIC, '10.0.0.8']})):
            with self.assertRaisesRegex(ValueError, 'non_public_ip'):
                web.resolve_public('https://example.test/')
        with patch('socket.getaddrinfo', resolver({'example.test': ['fe80::1%en0']})):
            with self.assertRaisesRegex(ValueError, 'non_public_ip'):
                web.resolve_public('http://example.test/')
        with patch('socket.getaddrinfo', resolver({'example.test': []})):
            with self.assertRaisesRegex(ValueError, 'unresolvable_host'):
                web.resolve_public('https://example.test/')
        with patch('socket.getaddrinfo') as lookup:
            with self.assertRaisesRegex(ValueError, 'invalid_public_url'):
                web.resolve_public('https://user:pw@example.test/')
            lookup.assert_not_called()


class PinnedConnectionTests(unittest.TestCase):
    def test_connection_uses_validated_address_and_keeps_hostname(self):
        seen = []
        def connect(self):
            seen.append((type(self).__name__, self.host, self.port, self.pinned_ip))
            raise OSError('no sockets in tests')
        with patch('socket.getaddrinfo', resolver({'example.test': [PUBLIC]})), \
                patch.object(web.PinnedHTTPSConnection, 'connect', connect), patch.object(web.PinnedHTTPConnection, 'connect', connect):
            for url in ('https://example.test/a', 'http://example.test/b'):
                with self.assertRaises(urllib.error.URLError):
                    web.open_url(url, timeout=1)
        self.assertEqual(seen, [('PinnedHTTPSConnection', 'example.test', 443, PUBLIC), ('PinnedHTTPConnection', 'example.test', 80, PUBLIC)])

    def test_tls_wraps_pinned_socket_with_original_server_name(self):
        from unittest.mock import MagicMock
        connection = web.PinnedHTTPSConnection('example.test', timeout=3, pinned_ip=PUBLIC)
        plain = MagicMock(name='socket')
        with patch('socket.create_connection', return_value=plain) as create, patch.object(connection, '_context') as context:
            connection.connect()
        self.assertEqual(create.call_args.args[0], (PUBLIC, 443))
        context.wrap_socket.assert_called_once_with(plain, server_hostname='example.test')
        self.assertIs(connection.sock, context.wrap_socket.return_value)

    def test_non_public_answer_never_connects(self):
        with patch('socket.getaddrinfo', resolver({'example.test': ['127.0.0.1']})), patch('socket.create_connection') as create:
            with self.assertRaisesRegex(ValueError, 'non_public_ip'):
                web.open_url('https://example.test/', timeout=1)
            create.assert_not_called()

    def test_opener_has_no_proxy_file_or_ftp_handlers(self):
        names = {type(handler).__name__ for handler in web.build_opener().handlers}
        self.assertTrue({'PinnedHTTPHandler', 'PinnedHTTPSHandler', 'RevalidatingRedirect'} <= names)
        self.assertFalse(names & {'ProxyHandler', 'FileHandler', 'FTPHandler', 'DataHandler'})
        with self.assertRaises(urllib.error.URLError):
            web.build_opener().open('file:///etc/hosts')


class RedirectTests(unittest.TestCase):
    def run_opener(self, table, responses, redirect_handler=None):
        calls = []
        def https_open(self, req):
            calls.append(req.full_url)
            return responses.pop(0)(req.full_url)
        with patch('socket.getaddrinfo', resolver(table)), patch.object(web.PinnedHTTPSHandler, 'https_open', https_open):
            return calls, web.build_opener(redirect_handler).open('https://start.test/', timeout=1)

    def test_redirect_to_private_target_is_refused_before_second_request(self):
        responses = [lambda url: canned(url, 302, location='https://internal.test/admin')]
        with self.assertRaisesRegex(ValueError, 'non_public_ip'):
            self.run_opener({'start.test': [PUBLIC], 'internal.test': ['10.1.2.3']}, responses)
        self.assertEqual(responses, [])

    def test_redirect_to_public_target_is_revalidated_then_followed(self):
        responses = [lambda url: canned(url, 301, location='/next'), lambda url: canned(url, 302, location='https://other.test/final'),
                     lambda url: canned(url, 200, b'done')]
        with patch.object(web, 'resolve_public', wraps=web.resolve_public) as validate:
            calls, response = self.run_opener({'start.test': [PUBLIC], 'other.test': ['8.8.8.8']}, responses)
        self.assertEqual(calls, ['https://start.test/', 'https://start.test/next', 'https://other.test/final'])
        self.assertEqual((response.read(), response.url), (b'done', 'https://other.test/final'))
        self.assertEqual([c.args[0] for c in validate.call_args_list], ['https://start.test/next', 'https://other.test/final'])

    def test_permanent_308_redirect_is_followed_like_307(self):
        # Python 3.9 urllib has no 308 support; clinic sites use it for http→https upgrades.
        responses = [lambda url: canned(url, 308, location='https://other.test/final'), lambda url: canned(url, 200, b'done')]
        with patch.object(web, 'resolve_public', wraps=web.resolve_public) as validate:
            calls, response = self.run_opener({'start.test': [PUBLIC], 'other.test': ['8.8.8.8']}, responses)
        self.assertEqual(calls, ['https://start.test/', 'https://other.test/final'])
        self.assertEqual((response.read(), response.url), (b'done', 'https://other.test/final'))
        self.assertEqual([c.args[0] for c in validate.call_args_list], ['https://other.test/final'])
        # A 308 to a private target is still refused before any second request.
        with self.assertRaisesRegex(ValueError, 'non_public_ip'):
            self.run_opener({'start.test': [PUBLIC], 'internal.test': ['10.1.2.3']}, [lambda url: canned(url, 308, location='https://internal.test/')])

    def test_redirect_to_non_http_scheme_is_refused(self):
        responses = [lambda url: canned(url, 302, location='file:///etc/passwd')]
        with self.assertRaises((ValueError, urllib.error.URLError)):
            self.run_opener({'start.test': [PUBLIC]}, responses)

    def test_subclass_hook_runs_before_following(self):
        class Refuse(web.RevalidatingRedirect):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                raise ValueError('platform_redirect_separate_review')
        responses = [lambda url: canned(url, 302, location='https://blog.naver.com/x')]
        with self.assertRaisesRegex(ValueError, 'platform_redirect'):
            self.run_opener({'start.test': [PUBLIC]}, responses, Refuse())


class RobotsTests(unittest.TestCase):
    def cache(self, status, body=b'', error=None):
        fetched = []
        def fetch(url):
            fetched.append(url)
            if error:
                raise error
            return status, body
        return web.RobotsCache(agent=web.user_agent('test audit'), fetch=fetch), fetched

    def test_rules_apply_per_host_and_are_fetched_once(self):
        cache, fetched = self.cache(200, b'User-agent: *\nDisallow: /private/\n\nUser-agent: DentalDataLab\nDisallow: /audit-closed/\n')
        self.assertTrue(cache.allowed('https://site.test/clinic'))
        self.assertFalse(cache.allowed('https://site.test/audit-closed/page'))
        self.assertTrue(cache.allowed('https://site.test/private/x'))  # specific group wins over *
        self.assertTrue(cache.allowed('https://other.test/private/x') is True)
        self.assertEqual(fetched, ['https://site.test/robots.txt', 'https://other.test/robots.txt'])

    def test_status_handling(self):
        self.assertTrue(self.cache(404)[0].allowed('https://a.test/'))
        self.assertFalse(self.cache(403)[0].allowed('https://a.test/'))
        self.assertFalse(self.cache(503)[0].allowed('https://a.test/'))
        self.assertTrue(self.cache(0, error=OSError('unreachable'))[0].allowed('https://a.test/'))
        self.assertFalse(self.cache(200, b'User-agent: *\nDisallow: /\n')[0].allowed('https://a.test/anything'))

    def test_default_fetch_uses_pinned_opener_without_network(self):
        cache = web.RobotsCache(timeout=1)
        with patch('socket.getaddrinfo', resolver({'site.test': ['10.0.0.1']})), patch('socket.create_connection') as create:
            self.assertTrue(cache.allowed('https://site.test/page'))  # unreachable robots: attempt proceeds, main request will record the cause
            create.assert_not_called()


class ReadLimitedTests(unittest.TestCase):
    class Body:
        def __init__(self, data, piece=4):
            self.data, self.piece, self.reads = data, piece, 0
        def read(self, n):
            self.reads += 1
            chunk, self.data = self.data[:min(n, self.piece)], self.data[min(n, self.piece):]
            return chunk

    def test_byte_cap_and_truncation_flag(self):
        self.assertEqual(web.read_limited(self.Body(b'x' * 10), 10), (b'x' * 10, False))
        data, truncated = web.read_limited(self.Body(b'y' * 15), 10)
        self.assertEqual((data, truncated), (b'y' * 10, True))

    def test_wall_clock_deadline_stops_slow_trickle(self):
        clock = iter(range(0, 1000, 20))
        with patch.object(web.time, 'monotonic', lambda: next(clock)):
            with self.assertRaisesRegex(TimeoutError, 'read_deadline'):
                web.read_limited(self.Body(b'z' * 100, piece=1), 1000, deadline=30)


class ClassificationTests(unittest.TestCase):
    def test_kind_of_both_modes(self):
        cases = {'https://blog.naver.com/clinic': 'naverBlog', 'https://blog.naver.com/': None,
                 'https://m.place.naver.com/hospital/123/home': 'naverMap', 'https://map.naver.com/p/entry/place/9': 'naverMap', 'https://map.naver.com/': None,
                 'https://www.instagram.com/clinic/': 'instagram', 'https://www.instagram.com/p/abc/': None,
                 'https://www.youtube.com/@clinic': 'youtube', 'https://www.youtube.com/watch?v=1': None, 'https://youtu.be/abc': 'youtube',
                 'https://m.facebook.com/clinic': 'facebook', 'https://www.facebook.com/sharer/sharer.php?u=x': None,
                 'https://pf.kakao.com/_abc': 'kakaoChannel', 'https://place.map.kakao.com/123': 'kakaoMap',
                 'https://booking.naver.com/booking/13/bizes/1': 'booking', 'https://m.booking.naver.com/booking/13/bizes/1': 'booking',
                 'https://x.tistory.com/': 'blog', 'https://x.tistory.com/manage': None, 'https://linktr.ee/clinic': 'linkHub',
                 'https://naver.me/abc': 'other', 'https://talk.naver.com/ct/abc': 'other',
                 'https://user:pw@blog.naver.com/x': None, 'https://blog.naver.com:8080/x': None, 'mailto:a@b.c': None}
        for url, expected in cases.items():
            self.assertEqual(web.kind_of(url), expected, url)
            self.assertEqual(web.kind_of(url, website=True), expected, url)
        for url in ('https://clinic.example.com/', 'https://clinic.modoo.at/', 'http://www.clinic.co.kr/intro'):
            self.assertIsNone(web.kind_of(url), url)
            self.assertEqual(web.kind_of(url, website=True), 'website', url)
        for url in ('https://cafe.naver.com/x', 'https://m.naver.com/', 'https://www.facebook.com/'):
            self.assertIsNone(web.kind_of(url, website=True), url)

    def test_platforms_challenge_and_charset(self):
        self.assertTrue(web.is_platform('https://m.blog.naver.com/x') and web.is_platform('https://clinic.modoo.at/'))
        self.assertFalse(web.is_platform('https://naver.com.evil.test/'))
        self.assertTrue(web.is_challenge('<html><head><title>Just a moment...</title>'))
        self.assertFalse(web.is_challenge('<title>치과</title>'))
        self.assertEqual(web.decode_html('<meta charset="euc-kr">치과'.encode('cp949')), '<meta charset="euc-kr">치과')
        self.assertEqual(web.decode_html('<p>치과</p>'.encode('utf-8'), 'bogus-charset'), '<p>치과</p>')
        self.assertEqual(web.canonical('https://www.Example.com/a/'), 'example.com/a')
        self.assertIn('+https://dentaldatalab.com/about/', web.user_agent('x'))
        self.assertRegex(store.now(), r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$')


class PinnedFallbackTests(unittest.TestCase):
    def test_connect_tries_every_validated_address_in_order(self):
        attempts = []
        def fake_connect(address, timeout=None, source_address=None):
            attempts.append(address[0])
            if address[0] == '2001:db8::1':
                raise OSError(101, 'Network is unreachable')
            return mock.MagicMock()
        connection = web.PinnedHTTPConnection('example.test', timeout=3, pinned_addresses=['2001:db8::1', '93.184.216.34'])
        with mock.patch.object(web.socket, 'create_connection', side_effect=fake_connect):
            connection.connect()
        self.assertEqual(attempts, ['2001:db8::1', '93.184.216.34'])
        self.assertEqual(connection.pinned_ip, '93.184.216.34')

    def test_connect_raises_the_last_error_when_every_address_fails(self):
        connection = web.PinnedHTTPConnection('example.test', timeout=3, pinned_addresses=['2001:db8::1', '93.184.216.34'])
        with mock.patch.object(web.socket, 'create_connection', side_effect=OSError(111, 'refused')):
            with self.assertRaises(OSError):
                connection.connect()
        with self.assertRaises(ValueError):
            web.PinnedHTTPConnection('example.test', pinned_addresses=[])


if __name__ == '__main__':
    unittest.main()
