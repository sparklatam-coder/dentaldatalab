#!/usr/bin/env python3
"""Low traffic, read-only public SEO availability monitoring (not index verification)."""
import argparse
import datetime
import fcntl
import ipaddress
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'data/research/seo-monitor'
STOP=False
CHILD=None
DIRECT=False

def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    with tmp.open('w',encoding='utf-8') as f:
        json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    tmp.replace(path)

def stop(_sig,_frame):
    global STOP
    STOP=True
    if CHILD and CHILD.poll() is None:
        try: os.killpg(CHILD.pid,signal.SIGTERM)
        except ProcessLookupError: pass

class Page(HTMLParser):
    def __init__(self): super().__init__();self.canonical=[];self.robots=[];self.links=[];self.in_title=False;self.title=''
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='title':self.in_title=True
        if tag=='link' and 'canonical' in a.get('rel','').lower().split():self.canonical.append(a.get('href',''))
        if tag=='meta' and a.get('name','').lower() in ('robots','googlebot','bingbot','yeti'):self.robots.append(a.get('content',''))
        if tag=='a' and a.get('href'):self.links.append(a['href'])
    def handle_endtag(self,tag):
        if tag=='title':self.in_title=False
    def handle_data(self,data):
        if self.in_title:self.title+=data

def public_origin(value):
    u=urllib.parse.urlsplit(value)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.port not in (None,443) or u.path not in ('','/') or u.query or u.fragment:raise ValueError('provide HTTPS origin without path, credentials or custom port')
    if '.' not in u.hostname or u.hostname.endswith(('.localhost','.local')):raise ValueError('provide a public HTTPS origin')
    try:address=ipaddress.ip_address(u.hostname)
    except ValueError:address=None
    if address is not None and not address.is_global:raise ValueError('non-public IP address')
    return 'https://'+u.netloc.rstrip('/')

def fetch(url,timeout=25,direct=None):
    global CHILD
    if STOP:return {'url':url,'ok':False,'error':'operator stop'}
    # Validate request origins even when fetch is invoked independently of CLI.
    try:
        parsed=urllib.parse.urlsplit(url)
        public_origin(urllib.parse.urlunsplit((parsed.scheme,parsed.netloc,'','','')))
    except ValueError:return {'url':url,'ok':False,'error':'public HTTPS URL required'}
    # curl verifies TLS by default. Never -k; separate HTTP/TLS evidence is recorded.
    cmd=['curl','--silent','--show-error','--location','--max-redirs','3','--proto','=https','--proto-redir','=https','--connect-timeout','10','--max-time',str(timeout),'--max-filesize','2097152','--user-agent','DentalDataLab-SEO-Monitor/1.0','--dump-header','-','--write-out','\n__SEO_META__%{json}',url]
    direct_enabled=DIRECT if direct is None else direct
    if direct_enabled:cmd[1:1]=['--noproxy','*']
    CHILD=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    try:out,err=CHILD.communicate(timeout=timeout+5)
    except subprocess.TimeoutExpired:
        os.killpg(CHILD.pid,signal.SIGKILL);CHILD.communicate();return {'url':url,'ok':False,'error':'curl process timeout'}
    if STOP:return {'url':url,'ok':False,'error':'operator stop'}
    if CHILD.returncode:return {'url':url,'ok':False,'error':err.decode('utf-8','replace')[:400],'curlExitCode':CHILD.returncode}
    raw,sep,meta=out.rpartition(b'\n__SEO_META__')
    if not sep:return {'url':url,'ok':False,'error':'curl metadata missing'}
    try:info=json.loads(meta)
    except ValueError:return {'url':url,'ok':False,'error':'invalid curl metadata'}
    # -L includes every response header block. Remove leading blocks only;
    # body contents are never interpreted as headers after the final block.
    headers={}
    while raw.startswith(b'HTTP/'):
        end=raw.find(b'\r\n\r\n');width=4
        if end<0:end=raw.find(b'\n\n');width=2
        if end<0:break
        block=raw[:end].decode('iso-8859-1');raw=raw[end+width:];headers={}
        for line in block.splitlines()[1:]:
            if ':' in line:
                k,v=line.split(':',1);headers[k.lower()]=headers.get(k.lower(),'')+' '+v.strip()
    return {'url':url,'effectiveUrl':info.get('url_effective',url),'status':info.get('http_code',0),'tlsVerified':info.get('ssl_verify_result')==0,'ok':200<=info.get('http_code',0)<300,'headers':headers,'body':raw.decode('utf-8','replace')}

def check_site(origin,canonical_origin,fetcher=fetch):
    checks=[];evidence=[]
    def record(name,ok,detail):checks.append({'check':name,'ok':bool(ok),'detail':detail})
    def request(path):
        result=fetcher(urllib.parse.urljoin(origin+'/',path))
        evidence.append({k:v for k,v in result.items() if k not in ('body','headers')})
        return result
    try:
        addresses=sorted({x[4][0] for x in socket.getaddrinfo(urllib.parse.urlsplit(origin).hostname,443,type=socket.SOCK_STREAM)})
        record('dns',bool(addresses),addresses)
    except OSError as e:record('dns',False,str(e));addresses=[]
    if STOP:return {'origin':origin,'checks':checks,'requests':evidence,'ok':False}
    home=request('/')
    record('homepage_http',home.get('ok'),home.get('status',home.get('error')))
    record('tls',home.get('tlsVerified'),home.get('error') or 'curl certificate verification result')
    page=Page();page.feed(home.get('body',''))
    record('title',bool(page.title.strip()),page.title.strip()[:200])
    expected=canonical_origin+'/'
    resolved=[urllib.parse.urljoin(home.get('effectiveUrl',origin+'/'),c) for c in page.canonical]
    record('canonical',len(resolved)==1 and resolved[0]==expected,{'expected':expected,'observed':resolved})
    directives=','.join(page.robots+[home.get('headers',{}).get('x-robots-tag','')]).lower()
    record('index_directive','noindex' not in directives and 'none' not in directives,{'directives':directives,'note':'Directive availability is not proof of indexing.'})
    if STOP:return {'origin':origin,'checks':checks,'requests':evidence,'ok':False}
    robots=request('/robots.txt')
    record('robots_http',robots.get('ok'),robots.get('status',robots.get('error')))
    groups=[];agents=[];rules=[];has_rules=False
    for raw in robots.get('body','').splitlines():
        line=raw.split('#',1)[0].strip()
        if ':' not in line:continue
        key,value=(v.strip() for v in line.split(':',1));key=key.lower()
        if key=='user-agent':
            if has_rules:groups.append((agents,rules));agents=[];rules=[];has_rules=False
            agents.append(value.lower())
        elif key in ('allow','disallow'):
            has_rules=True;rules.append((key,value))
    groups.append((agents,rules))
    blocked=[agent for agents,rules in groups for agent in agents if agent in ('*','googlebot','bingbot','yeti') and ('disallow','/') in rules and ('allow','/') not in rules]
    record('robots_crawl_allowed',not blocked,{'blockedAgents':blocked,'note':'Checks full-site blocks; does not emulate complete crawler rule matching.'})
    sitemap=request('/sitemap.xml');locations=[];sitemap_type=''
    if sitemap.get('ok'):
        try:
            tree=ET.fromstring(sitemap.get('body',''));sitemap_type=tree.tag.rsplit('}',1)[-1]
            locations=[e.text.strip() for e in tree.iter() if e.tag.rsplit('}',1)[-1]=='loc' and e.text and e.text.strip()]
        except ET.ParseError:pass
    record('sitemap',sitemap.get('ok') and sitemap_type in ('urlset','sitemapindex') and bool(locations),{'http':sitemap.get('status',sitemap.get('error')),'type':sitemap_type,'locations':len(locations),'sample':locations[:3]})
    links=[]
    for href in page.links:
        target=urllib.parse.urljoin(origin+'/',href);u=urllib.parse.urlsplit(target)
        if u.scheme=='https' and u.netloc==urllib.parse.urlsplit(origin).netloc and u.path not in ('','/') and not u.query and not u.fragment and target not in links:links.append(target)
        if len(links)>=3:break
    record('core_links_present',bool(links),links)
    for target in links:
        if STOP:break
        r=request(target);record('core_link_http',r.get('ok'),{'url':target,'status':r.get('status',r.get('error'))})
    return {'origin':origin,'checks':checks,'requests':evidence,'ok':all(c['ok'] for c in checks)}

def delay(failures,healthy_seconds,failure_seconds,max_backoff):
    return healthy_seconds if not failures else min(max_backoff,failure_seconds*(2**min(failures-1,10)))

def main():
    global DIRECT
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--once',action='store_true');p.add_argument('--site',action='append',help='HTTPS origin; may repeat')
    p.add_argument('--direct',action='store_true',help='connect directly to public HTTPS sites without environment proxy routing')
    p.add_argument('--canonical-origin',default='https://dentaldatalab.com')
    p.add_argument('--healthy-seconds',type=int,default=3600);p.add_argument('--failure-seconds',type=int,default=300);p.add_argument('--max-backoff-seconds',type=int,default=3600)
    args=p.parse_args()
    DIRECT=args.direct
    if args.healthy_seconds<3600 or args.failure_seconds<300 or args.max_backoff_seconds<args.failure_seconds:p.error('healthy interval must be >=3600s, failure interval >=300s, max backoff >=failure interval')
    try:sites=[public_origin(s) for s in args.site or ['https://dentaldatalab.com']];canonical=public_origin(args.canonical_origin)
    except ValueError as e:p.error(str(e))
    WORK.mkdir(parents=True,exist_ok=True)
    lock=(WORK/'worker.lock').open('a+')
    try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:print('SEO monitor is already running',file=sys.stderr);lock.close();return 2
    lock.seek(0);lock.truncate();lock.write(str(os.getpid()));lock.flush()
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,stop)
    previous={}
    try:previous=json.loads((WORK/'state.json').read_text())
    except (FileNotFoundError,ValueError):pass
    failures=previous.get('consecutiveFailures',0)
    try:
        while not STOP:
            report={'checkedAt':stamp(),'pid':os.getpid(),'sites':[],'indexing':{'google':'unverified: Search Console metrics API not connected','naver':'unverified: Naver Search Advisor metrics not connected','bing':'unverified: Bing Webmaster Tools metrics API not connected'},'readOnly':True,'networkMode':'direct' if args.direct else 'environment'}
            for origin in sites:
                if STOP:break
                report['sites'].append(check_site(origin,canonical))
            report['ok']=len(report['sites'])==len(sites) and all(s['ok'] for s in report['sites'])
            failures=0 if report['ok'] else failures+1
            wait=delay(failures,args.healthy_seconds,args.failure_seconds,args.max_backoff_seconds)
            report.update(consecutiveFailures=failures,state='stopped' if STOP else 'checked',nextCheckAfterSeconds=None if args.once or STOP else wait)
            save(WORK/'state.json',report)
            with (WORK/'history.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(report,ensure_ascii=False)+'\n')
            print(json.dumps({'checkedAt':report['checkedAt'],'ok':report['ok'],'failedChecks':{s['origin']:[c['check'] for c in s['checks'] if not c['ok']] for s in report['sites']},'nextCheckAfterSeconds':report['nextCheckAfterSeconds']},ensure_ascii=False),flush=True)
            if args.once:return 0 if report['ok'] else 1
            deadline=time.monotonic()+wait
            while not STOP and time.monotonic()<deadline:time.sleep(max(0,min(1,deadline-time.monotonic())))
        if (WORK/'state.json').exists():
            final=json.loads((WORK/'state.json').read_text());final.update(state='stopped',stoppedAt=stamp(),nextCheckAfterSeconds=None);save(WORK/'state.json',final)
        return 0
    finally:
        # Keep the inode so another process cannot acquire an unlinked lock race.
        lock.seek(0);lock.truncate();lock.flush();fcntl.flock(lock.fileno(),fcntl.LOCK_UN);lock.close()

if __name__=='__main__':sys.exit(main())
