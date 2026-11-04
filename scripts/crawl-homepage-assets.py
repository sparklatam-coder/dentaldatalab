#!/usr/bin/env python3
"""Inspect registered public homepage URLs once; preserve evidence, never infer ownership.

No credentials, browser state, JS execution, retries after blocking, or private IPs.
Results are candidates for review; this is not a Naver Place data substitute.
Existing results are checkpoints: rerunning skips every previously attempted URL.
"""
import concurrent.futures, hashlib, html, json, re, sys, threading
import urllib.parse, urllib.error
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ddl import store, web

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data/assets/national-homepages.json'
AGENT = web.user_agent('public registered homepage link audit')
safe_url, public_url, kind_of, Links, Redirect, now = web.safe_url, web.resolve_public, web.kind_of, web.Links, web.RevalidatingRedirect, store.now
ROBOTS = web.RobotsCache(agent=AGENT)

locks={}; lock_guard=threading.Lock()
def inspect(item):
    url, clinics=item
    p=urllib.parse.urlsplit(url)
    result={'url':url,'checkedAt':now(),'clinicIds':[c['id'] for c in clinics], 'status':'not_read','links':[],'matches':{}}
    # Platforms are inspected separately from actual observed Place/profile URLs.
    if web.is_platform(url):
        return dict(result,status='platform_separate_review')
    with lock_guard: host_lock=locks.setdefault(p.hostname,threading.Lock())
    with host_lock:
        try:
            public_url(url)
            if not ROBOTS.allowed(url): return dict(result,status='robots_disallowed')
            with web.open_url(url,headers={'Accept':'text/html'},timeout=8,agent=AGENT) as r:
                result['httpStatus']=r.status; result['finalUrl']=r.url
                if 'html' not in (r.headers.get('Content-Type') or '').lower(): return dict(result,status='not_html')
                raw,result['truncated']=web.read_limited(r,1_500_000)
                result['bodySha256']=hashlib.sha256(raw).hexdigest()
                body=web.decode_html(raw,r.headers.get_content_charset())
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
    prior=json.loads(OUT.read_text()) if OUT.exists() else {}
    # Prior rows are evidence: keep every dict row verbatim (even legacy rows without url); only rows with a url count as attempted.
    results=[r for r in prior.get('results',[]) if isinstance(r,dict)]
    attempted={web.canonical(r['url']) for r in results if r.get('url')}
    scheduled=[(url,clinics) for url,clinics in groups.items() if web.canonical(url) not in attempted]
    out={'schemaVersion':1,'startedAt':prior.get('startedAt') or now(),'checkedAt':now(),'scope':'전국 공공데이터에 등록된 홈페이지 URL 1회 점검. 플랫폼 본문은 별도 조사. 링크 발견은 공식 소유 인증이 아님.','unrequestedRegistrations':invalid,'requestPolicy':'HTTP(S), default ports, public IPs only (connection pinned to the validated address); robots.txt honored; one attempt per distinct URL; no retries after failures; known platforms reviewed separately.','results':results}
    # Persist each scheduled intent before any request. A crash leaves not_read
    # records which are skipped, never silently retried, on the next run.
    for url,clinics in scheduled:
        results.append({'url':url,'checkedAt':now(),'clinicIds':[c['id'] for c in clinics],'status':'not_read','detail':'scheduled_before_request','links':[],'matches':{}})
    store.atomic_json(OUT,out)
    positions={r['url']:i for i,r in enumerate(results) if r.get('url')}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures=[pool.submit(inspect,item) for item in scheduled]
        for i,future in enumerate(concurrent.futures.as_completed(futures),1):
            r=future.result(); results[positions[r['url']]]=r; out['checkedAt']=now()
            store.atomic_json(OUT,out)
            if i%100==0: print(json.dumps({'completed':i,'scheduled':len(scheduled),'read':sum(x.get('status')=='read' for x in results)},ensure_ascii=False),flush=True)
    print(json.dumps({'output':str(OUT),'urls':len(results),'newlyScheduled':len(scheduled),'invalid':len(invalid),'read':sum(x.get('status')=='read' for x in results)},ensure_ascii=False),flush=True)

if __name__=='__main__': main()
