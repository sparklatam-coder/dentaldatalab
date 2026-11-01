#!/usr/bin/env python3
"""Inspect registered public homepage URLs once; preserve evidence, never infer ownership.

No credentials, browser state, JS execution, retries after blocking, or private IPs.
Results are candidates for review; this is not a Naver Place data substitute.
"""
import concurrent.futures, datetime, hashlib, html, ipaddress, json, re, socket, threading
import urllib.request, urllib.parse, urllib.error
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data/assets/national-homepages.json'
AGENT = 'DentalDataLabResearch/0.6 (public registered homepage link audit)'

def safe_url(raw):
    if not isinstance(raw, str): return None
    raw = raw.strip()
    if not re.match(r'^https?://', raw, re.I): raw = 'https://' + raw
    try:
        p = urllib.parse.urlsplit(raw)
        if p.scheme not in ('http', 'https') or not p.hostname or '.' not in p.hostname or p.username or p.password or p.port not in (None, 80, 443): return None
        return urllib.parse.urlunsplit((p.scheme, p.hostname.encode('idna').decode() + ((':'+str(p.port)) if p.port else ''), urllib.parse.quote(p.path, safe='/%:@'), p.query, ''))
    except (ValueError, UnicodeError): return None

def public_url(url):
    p = urllib.parse.urlsplit(url)
    if not safe_url(url): raise ValueError('invalid_public_url')
    for address in socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme=='https' else 80), type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(address[4][0]).is_global: raise ValueError('non_public_ip')

class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]; self.text=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'): self.skip+=1
        a=dict(attrs)
        if tag=='a' and a.get('href'): self.links.append(a['href'])
    def handle_endtag(self, tag):
        if tag in ('script','style'): self.skip=max(0,self.skip-1)
    def handle_data(self, text):
        if not self.skip: self.text.append(text)

def kind_of(url):
    p=urllib.parse.urlsplit(url); h=p.hostname or ''; path=p.path
    if h in ('blog.naver.com','m.blog.naver.com') and path not in ('','/'): return 'naverBlog'
    if h in ('map.naver.com','m.place.naver.com','pcmap.place.naver.com') and (re.search(r'/(?:place|hospital)/\d+',path) or 'entry/place' in path): return 'naverMap'
    if h in ('naver.me',) and path not in ('','/'): return 'other'
    if (h=='instagram.com' or h.endswith('.instagram.com')) and path not in ('','/') and not re.match(r'^/(accounts|explore|developer|about|legal|reel|p)/',path): return 'instagram'
    if h in ('youtube.com','www.youtube.com','m.youtube.com') and re.match(r'^/(?:@|channel/|c/|user/)',path): return 'youtube'
    if h in ('facebook.com','www.facebook.com','m.facebook.com') and path not in ('','/') and not re.search('sharer|dialog|plugins|share.php|login',path): return 'facebook'
    if h=='pf.kakao.com' and path not in ('','/'): return 'kakaoChannel'
    if h in ('place.map.kakao.com','kko.to'): return 'kakaoMap'
    if h=='booking.naver.com' and '/bizes/' in path: return 'booking'
    if (h.endswith('.tistory.com') or h.endswith('.wordpress.com') or h=='brunch.co.kr') and not re.search(r'/manage|/login',path): return 'blog'
    if h in ('linktr.ee','litt.ly','instabio.cc') and path not in ('','/'): return 'linkHub'
    return None

locks={}; lock_guard=threading.Lock()
def inspect(item):
    url, clinics=item
    p=urllib.parse.urlsplit(url)
    stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
    result={'url':url,'checkedAt':stamp,'clinicIds':[c['id'] for c in clinics], 'status':'not_read','links':[],'matches':{}}
    # Platforms are inspected separately from actual observed Place/profile URLs.
    if any(p.hostname==d or p.hostname.endswith('.'+d) for d in ('naver.com','naver.me','modoo.at','instagram.com','facebook.com','youtube.com','kakao.com','daum.net')):
        return dict(result,status='platform_separate_review')
    with lock_guard: host_lock=locks.setdefault(p.hostname,threading.Lock())
    with host_lock:
        try:
            public_url(url)
            opener=urllib.request.build_opener(Redirect())
            req=urllib.request.Request(url,headers={'User-Agent':AGENT,'Accept':'text/html'})
            with opener.open(req,timeout=8) as r:
                result['httpStatus']=r.status; result['finalUrl']=r.url
                if 'html' not in (r.headers.get('Content-Type') or '').lower(): return dict(result,status='not_html')
                raw=r.read(1_500_001)
                result['truncated']=len(raw)>1_500_000; raw=raw[:1_500_000]
                result['bodySha256']=hashlib.sha256(raw).hexdigest()
                declared=r.headers.get_content_charset()
                meta=re.search(br'charset\s*=\s*["\']?([\w-]+)',raw[:8192],re.I)
                codec=declared or (meta.group(1).decode() if meta else 'utf-8')
                try: body=raw.decode(codec,errors='replace')
                except LookupError: body=raw.decode('utf-8',errors='replace')
            parser=Links(); parser.feed(body)
            visible=' '.join(parser.text); compact=re.sub(r'\s+','',' '.join(parser.text)); digits=re.sub(r'\D','',visible)
            result['status']='read'
            found={}
            for href in parser.links:
                link=safe_url(urllib.parse.urljoin(result['finalUrl'],html.unescape(href)))
                if link and kind_of(link): found[link]={'kind':kind_of(link),'url':link}
            result['links']=list(found.values())
            for c in clinics:
                phone=re.sub(r'\D','',c.get('phone') or '')
                name=re.sub(r'\s+','',''.join((c['name'].replace('의원',''),)))
                result['matches'][c['id']]={'phone':bool(phone and len(phone)>=8 and phone in digits),'name':bool(name and name in compact)}
        except urllib.error.HTTPError as e: result.update(status='blocked' if e.code in (401,403,429) else 'http_error',httpStatus=e.code)
        except Exception as e: result.update(status='error',error=type(e).__name__,detail=str(e)[:180])
    return result

def main():
    data=json.loads((ROOT/'data/clinics.json').read_text()); groups={}; invalid=[]
    for c in data['clinics']:
        if not c.get('website'): continue
        url=safe_url(c['website'])
        if url: groups.setdefault(url,[]).append(c)
        else:
            try: port=urllib.parse.urlsplit(c['website']).port
            except ValueError: port=None
            invalid.append({'clinicId':c['id'],'rawValue':c['website'],'reason':'non_standard_port_not_requested' if port not in (None,80,443) else 'invalid_public_url'})
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for i,r in enumerate(pool.map(inspect,groups.items()),1):
            results.append(r)
            if i%100==0: print(json.dumps({'completed':i,'total':len(groups),'read':sum(x['status']=='read' for x in results)},ensure_ascii=False),flush=True)
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps({'schemaVersion':1,'startedAt':started,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'전국 공공데이터에 등록된 홈페이지 URL 1회 점검. 플랫폼 본문은 별도 조사. 링크 발견은 공식 소유 인증이 아님.','unrequestedRegistrations':invalid,'requestPolicy':'HTTP(S), default ports, public IPs only; one attempt per distinct URL; no retries after failures; known platforms reviewed separately.','results':results},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'output':str(OUT),'urls':len(results),'invalid':len(invalid),'read':sum(x['status']=='read' for x in results)},ensure_ascii=False),flush=True)

if __name__=='__main__': main()
