"""Shared HTTP guard rails for the public-web collectors (stdlib only).

* ``safe_url`` / ``resolve_public``: syntax and public-DNS validation, fail closed.
* ``build_opener``: urllib opener whose connections are pinned to the address that
  was just validated (no second DNS lookup between check and connect), with the
  original hostname kept for the Host header, SNI and certificate verification.
  Every redirect hop is validated again before it is followed. No proxy, file,
  ftp or data handlers are installed.
* ``read_limited``: chunked body read with a byte cap and a wall-clock deadline.
* ``RobotsCache``: one robots.txt fetch per host through the same pinned opener.
* ``kind_of`` / ``is_platform``: one classification of observed channel links.
"""
import functools
import http.client
import ipaddress
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser

CONTACT = 'https://dentaldatalab.com/about/'
USER_AGENT = 'DentalDataLab/1.0 (+' + CONTACT + ')'
PLATFORM_DOMAINS = ('naver.com', 'naver.me', 'modoo.at', 'instagram.com', 'facebook.com', 'youtube.com', 'kakao.com', 'daum.net')
CHALLENGE_MARKERS = ('cf-chl-', 'challenge-platform', '<title>access denied', '<title>just a moment', '<title>attention required')
READ_DEADLINE = 30.0


def user_agent(note=None):
    """User-Agent with the contact URL; ``note`` describes the specific audit."""
    return 'DentalDataLab/1.0 (+' + CONTACT + ('; ' + note if note else '') + ')'


def safe_url(raw):
    """Normalize to http(s), default port, no credentials; None when not acceptable."""
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    if not re.match(r'^https?://', raw, re.I):
        raw = 'https://' + raw
    try:
        p = urllib.parse.urlsplit(raw)
        if p.scheme not in ('http', 'https') or not p.hostname or '.' not in p.hostname or p.username or p.password or p.port not in (None, 80, 443):
            return None
        return urllib.parse.urlunsplit((p.scheme, p.hostname.encode('idna').decode() + ((':' + str(p.port)) if p.port else ''), urllib.parse.quote(p.path, safe='/%:@'), p.query, ''))
    except (ValueError, UnicodeError):
        return None


def resolve_public(url):
    """Resolve the host and return its addresses; raise unless every one is global."""
    normalized = safe_url(url)
    if not normalized:
        raise ValueError('invalid_public_url')
    p = urllib.parse.urlsplit(normalized)
    addresses = []
    for entry in socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == 'https' else 80), type=socket.SOCK_STREAM):
        address = entry[4][0]
        try:
            if not ipaddress.ip_address(address.split('%')[0]).is_global:
                raise ValueError('non_public_ip')
        except ValueError:
            raise ValueError('non_public_ip') from None
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise ValueError('unresolvable_host')
    return addresses


public_url = resolve_public


def host_key(url):
    return (urllib.parse.urlsplit(url).hostname or '').removeprefix('www.')


def canonical(url):
    p = urllib.parse.urlsplit(url)
    return host_key(url) + (p.path.rstrip('/') or '/') + ('?' + p.query if p.query else '')


def is_platform(url):
    """Known platform hosts whose bodies are reviewed separately, never crawled."""
    host = urllib.parse.urlsplit(url).hostname or ''
    return any(host == domain or host.endswith('.' + domain) for domain in PLATFORM_DOMAINS)


class PinnedHTTPConnection(http.client.HTTPConnection):
    """Connects to ``pinned_ip`` while ``host`` stays the original hostname."""

    def __init__(self, host, *args, pinned_ip=None, pinned_addresses=None, **kwargs):
        super().__init__(host, *args, **kwargs)
        # Every address here was already checked by resolve_public; keep the multi-address fallback
        # that create_connection(hostname) used to give (dual-stack hosts on IPv4-only networks etc.).
        addresses = list(pinned_addresses or ([] if pinned_ip is None else [pinned_ip]))
        if not addresses:
            raise ValueError('a pinned connection needs at least one validated address')
        self.pinned_addresses = addresses
        self.pinned_ip = addresses[0]

    def connect(self):
        last_error = None
        for address in self.pinned_addresses:
            try:
                self.sock = socket.create_connection((address, self.port), self.timeout, self.source_address)
                self.pinned_ip = address
                break
            except OSError as error:
                last_error = error
        else:
            raise last_error
        try:
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass
        if self._tunnel_host:
            self._tunnel()


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """TLS over a pinned address; SNI and certificate checks use the hostname."""

    def __init__(self, host, *args, pinned_ip=None, pinned_addresses=None, **kwargs):
        super().__init__(host, *args, **kwargs)
        addresses = list(pinned_addresses or ([] if pinned_ip is None else [pinned_ip]))
        if not addresses:
            raise ValueError('a pinned connection needs at least one validated address')
        self.pinned_addresses = addresses
        self.pinned_ip = addresses[0]

    def connect(self):
        PinnedHTTPConnection.connect(self)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self._tunnel_host or self.host)


class PinnedHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        addresses = resolve_public(req.full_url)
        return self.do_open(functools.partial(PinnedHTTPConnection, pinned_addresses=addresses), req)


class PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        addresses = resolve_public(req.full_url)
        return self.do_open(functools.partial(PinnedHTTPSConnection, pinned_addresses=addresses), req, context=self._context)


class RevalidatingRedirect(urllib.request.HTTPRedirectHandler):
    """Validate every redirect target before the next (pinned) connection."""
    max_redirections = 5

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        resolve_public(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def build_opener(redirect_handler=None):
    """Opener with pinned http/https handlers only; redirects are re-validated."""
    opener = urllib.request.OpenerDirector()
    for handler in (PinnedHTTPHandler(), PinnedHTTPSHandler(), urllib.request.UnknownHandler(),
                    urllib.request.HTTPDefaultErrorHandler(), urllib.request.HTTPErrorProcessor(),
                    redirect_handler or RevalidatingRedirect()):
        opener.add_handler(handler)
    return opener


def open_url(url, headers=None, timeout=8, redirect_handler=None, agent=USER_AGENT, data=None):
    """Open ``url`` through the pinned opener; the response is a context manager."""
    request = urllib.request.Request(url, data=data, headers={'User-Agent': agent, **(headers or {})})
    return build_opener(redirect_handler).open(request, timeout=timeout)


def read_limited(response, limit, deadline=READ_DEADLINE, chunk_size=65536):
    """Read at most ``limit`` bytes in chunks; return (data, truncated).

    Raises TimeoutError once ``deadline`` seconds of wall clock have passed, so a
    slow trickle cannot hold a worker beyond roughly deadline + socket timeout.
    """
    end = time.monotonic() + deadline
    parts, size = [], 0
    while size <= limit:
        if time.monotonic() > end:
            raise TimeoutError('read_deadline_exceeded')
        chunk = response.read(min(chunk_size, limit + 1 - size))
        if not chunk:
            break
        parts.append(chunk)
        size += len(chunk)
    data = b''.join(parts)
    return data[:limit], len(data) > limit


def decode_html(raw, declared=None):
    """Decode with the declared charset, else a <meta charset> sniff, else UTF-8."""
    meta = re.search(br'charset\s*=\s*["\']?([\w-]+)', raw[:8192], re.I)
    codec = declared or (meta.group(1).decode('ascii', 'replace') if meta else 'utf-8')
    try:
        return raw.decode(codec, errors='replace')
    except LookupError:
        return raw.decode('utf-8', errors='replace')


def is_challenge(body):
    lowered = body.lower()
    return any(marker in lowered for marker in CHALLENGE_MARKERS)


class RobotsCache:
    """robots.txt decisions, fetched once per scheme/host through the pinned opener.

    401/403 and 5xx answers disallow everything (fail closed); other 4xx allow
    everything; a transport failure allows the attempt so the main request records
    the real cause. ``fetch`` may be injected for tests: url -> (status, bytes).
    """
    LIMIT = 512 * 1024

    def __init__(self, agent=USER_AGENT, timeout=8, fetch=None):
        self.agent, self.timeout = agent, timeout
        self.fetch = fetch or self._fetch
        self.parsers, self.locks, self.guard = {}, {}, threading.Lock()

    def _fetch(self, robots_url):
        try:
            with open_url(robots_url, headers={'Accept': 'text/plain'}, timeout=self.timeout, agent=self.agent) as response:
                return response.status, read_limited(response, self.LIMIT, deadline=self.timeout * 2)[0]
        except urllib.error.HTTPError as error:
            return error.code, b''

    def parser(self, url):
        p = urllib.parse.urlsplit(url)
        host = (p.hostname or '').lower()
        key = (p.scheme, host, p.port)
        with self.guard:
            lock = self.locks.setdefault(key, threading.Lock())
        with lock:
            if key in self.parsers:
                return self.parsers[key]
            robots_url = urllib.parse.urlunsplit((p.scheme, host + (':' + str(p.port) if p.port else ''), '/robots.txt', '', ''))
            parser = urllib.robotparser.RobotFileParser(robots_url)
            try:
                status, data = self.fetch(robots_url)
            except Exception:
                status, data = None, b''
            if status is None:
                parser.allow_all = True
            elif status in (401, 403) or status >= 500:
                parser.disallow_all = True
            elif status >= 400:
                parser.allow_all = True
            else:
                parser.parse(data.decode('utf-8', errors='replace').splitlines())
            self.parsers[key] = parser
            return parser

    def allowed(self, url):
        return bool(self.parser(url).can_fetch(self.agent, url))


class Links(HTMLParser):
    """Collect hrefs and visible text (script/style excluded)."""

    def __init__(self):
        super().__init__()
        self.links, self.text, self.skip = [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        a = dict(attrs)
        if tag == 'a' and a.get('href'):
            self.links.append(a['href'])

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, text):
        if not self.skip:
            self.text.append(text)


def kind_of(url, website=False):
    """Classify an observed link into a channel kind.

    Platform profile shapes return their kind; platform hosts without a profile
    shape return None. Any other host returns 'website' when ``website`` is true
    (saved Naver Place pages) and None otherwise (homepage crawls, which only keep
    platform links).
    """
    try:
        p = urllib.parse.urlsplit(url)
        host = (p.hostname or '').removeprefix('www.')
        if p.scheme not in ('http', 'https') or not host or p.username or p.password or p.port not in (None, 80, 443):
            return None
    except ValueError:
        return None
    path = p.path
    deep = path not in ('', '/')
    if host in ('blog.naver.com', 'm.blog.naver.com'):
        return 'naverBlog' if deep else None
    if host in ('map.naver.com', 'm.place.naver.com', 'pcmap.place.naver.com'):
        return 'naverMap' if re.search(r'/(?:place|hospital)/\d+', path) or 'entry/place' in path else None
    if host in ('naver.me', 'talk.naver.com'):
        return 'other' if deep else None
    if host == 'instagram.com' or host.endswith('.instagram.com'):
        return 'instagram' if deep and not re.match(r'^/(accounts|explore|developer|about|legal|reel|p)/', path) else None
    if host in ('youtube.com', 'm.youtube.com'):
        return 'youtube' if re.match(r'^/(?:@|channel/|c/|user/)', path) else None
    if host == 'youtu.be':
        return 'youtube' if deep else None
    if host in ('facebook.com', 'm.facebook.com'):
        return 'facebook' if deep and not re.search('sharer|dialog|plugins|share.php|login', path) else None
    if host == 'pf.kakao.com':
        return 'kakaoChannel' if deep else None
    if host in ('place.map.kakao.com', 'map.kakao.com', 'kko.to'):
        return 'kakaoMap'
    if host in ('booking.naver.com', 'm.booking.naver.com'):
        return 'booking' if '/bizes/' in path else None
    if host.endswith('.tistory.com') or host.endswith('.wordpress.com') or host == 'brunch.co.kr':
        return 'blog' if not re.search(r'/manage|/login', path) else None
    if host in ('linktr.ee', 'litt.ly', 'instabio.cc'):
        return 'linkHub' if deep else None
    if website and not any(host == d or host.endswith('.' + d) for d in ('naver.com', 'daum.net', 'kakao.com', 'instagram.com', 'facebook.com', 'youtube.com')):
        return 'website'
    return None
