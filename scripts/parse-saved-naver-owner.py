#!/usr/bin/env python3
"""Extract visible owner/business DOM from locally saved Chrome pages; no network.

Uses only saved-from URLs, rendered element text/attributes and file evidence.
Scripts, embedded application state, visitor reviews and image/video files are
never parsed into normalized captures. Unexpanded content stays incomplete.
"""
import argparse
import datetime
import hashlib
import json
import re
import time
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'data/research/yangju-owner-html'
DEST=ROOT/'data/research/yangju-owner-captures'
QUEUE=ROOT/'data/research/yangju-owner-queue.json'
VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
OMIT={'script','style','noscript','template','svg'}
OWNER=['description','representativeKeywords','reservationNotice','businessNotices','noticeBody','notices','directions','visitorPreparation']


class Node:
    def __init__(self,tag='root',attrs=(),parent=None):
        self.tag=tag;self.attrs=dict(attrs);self.children=[];self.parent=parent
    def has(self,cls):return cls in self.attrs.get('class','').split()
    def hidden(self):
        return self.tag in OMIT or 'hidden' in self.attrs or self.attrs.get('aria-hidden')=='true' or bool(re.search(r'(?:display\s*:\s*none|visibility\s*:\s*hidden)',self.attrs.get('style',''),re.I))
    def walk(self):
        if self.hidden():return
        yield self
        for child in self.children:
            if isinstance(child,Node):yield from child.walk()
    def text(self,blind=False):
        if self.hidden() or self.has('place_blind') and not blind:return ''
        parts=[]
        for child in self.children:
            if not isinstance(child,Node):parts.append(child);continue
            value='\n' if child.tag=='br' else child.text(blind)
            parts.append('\n'+value+'\n' if child.tag in ('div','p','li') and value else value)
        return ''.join(parts)
    def first(self,predicate):return next((node for node in self.walk() if predicate(node)),None)


class DOM(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root];self.omitted=0
    def handle_starttag(self,tag,attrs):
        node=Node(tag,attrs,self.stack[-1]);self.stack[-1].children.append(node)
        if tag not in VOID:self.stack.append(node)
    def handle_endtag(self,tag):
        for index in range(len(self.stack)-1,0,-1):
            if self.stack[index].tag==tag:self.stack=self.stack[:index];break
    def handle_data(self,data):
        # Do not retain script/application-state text even in the temporary tree.
        if not any(node.tag in OMIT for node in self.stack):self.stack[-1].children.append(data)


def compact(text):return ' '.join(text.split())
def checked_at(path):return datetime.datetime.fromtimestamp(path.stat().st_mtime,datetime.timezone.utc).isoformat(timespec='milliseconds')
def source_page(raw):
    found=re.search(r'<!--\s*saved from url=\(\d+\)(https?://[^\r\n]+?)\s*-->',raw[:4096])
    if not found:return None
    url=found.group(1);p=urllib.parse.urlsplit(url)
    match=re.fullmatch(r'/(?:hospital|place)/([1-9]\d*)/(home|information)/?',p.path)
    if p.hostname not in ('pcmap.place.naver.com','m.place.naver.com') or not match:return None
    return url,match.group(1),match.group(2)


def channel_kind(url):
    try:
        p=urllib.parse.urlsplit(url);host=(p.hostname or '').removeprefix('www.')
        if p.scheme not in ('http','https') or not host or p.username or p.password or p.port not in (None,80,443):return None
        if host in ('blog.naver.com','m.blog.naver.com'):return 'naverBlog'
        if host in ('instagram.com',):return 'instagram'
        if host in ('youtube.com','m.youtube.com','youtu.be'):return 'youtube'
        if host in ('facebook.com','m.facebook.com'):return 'facebook'
        if host in ('booking.naver.com','m.booking.naver.com') and '/bizes/' in p.path:return 'booking'
        if host=='pf.kakao.com':return 'kakaoChannel'
        if host in ('place.map.kakao.com','map.kakao.com','kko.to'):return 'kakaoMap'
        if host in ('talk.naver.com','naver.me'):return 'other'
        if host.endswith('.tistory.com') or host.endswith('.wordpress.com') or host=='brunch.co.kr':return 'blog'
        if host in ('linktr.ee','litt.ly','instabio.cc'):return 'linkHub'
        if host in ('map.naver.com','pcmap.place.naver.com','m.place.naver.com'):return None
        return 'website'
    except ValueError:return None


def parse(path,record):
    path=path.resolve()
    raw_bytes=path.read_bytes();raw=raw_bytes.decode('utf-8',errors='replace');page=source_page(raw)
    if not page:return None
    url,place_id,tab=page;dom=DOM();dom.feed(raw);tree=dom.root
    tabs=[node for node in tree.walk() if node.attrs.get('role')=='tab']
    selected=[compact(node.text()) for node in tabs if node.attrs.get('aria-selected')=='true']
    tabless_home=tab=='home' and not tabs
    if not tabless_home and selected!=[{'home':'홈','information':'정보'}[tab]]:raise ValueError('Saved-from tab and selected visible tab do not agree')
    name_node=tree.first(lambda n:n.has('PbnXW')) or tree.first(lambda n:n.tag=='h1' and n.attrs.get('id')=='_header')
    shown_name=compact(name_node.text()) if name_node else ''
    if not shown_name:raise ValueError('Visible institution header not found')
    known_name=record.get('identity',{}).get('naverRecord',{}).get('name')
    if re.sub(r'\s+','',shown_name) not in {re.sub(r'\s+','',record['name']),re.sub(r'\s+','',known_name or '')}:
        raise ValueError('Visible name does not match this queue institution')
    stamp=checked_at(path)
    capture={'schemaVersion':1,'clinicId':record['clinicId'],'name':record['name'],'sourceUrl':url,'checkedAt':stamp,
        'bodyStatus':'read','captureMethod':'browser_ui_saved_html','captureScope':[],
        'fields':{},'fieldStatus':{},'fieldSources':{},'fieldCheckedAt':{},'fieldCaptureMethod':{},
        'captureNotes':{},'observedChannelLinks':[],
        'metadata':{'savedHtmlPath':str(path.relative_to(ROOT)),'savedHtmlSha256':hashlib.sha256(raw_bytes).hexdigest(),
            'parserVersion':5,'checkedAtBasis':'Chrome Save Page file modification time','tab':tab,'selectedTab':selected[0] if selected else None,
            'tabSelectionStatus':'not_displayed' if tabless_home else 'read','visibleHeader':shown_name,
            'extraction':'Displayed DOM text/attributes only; scripts, embedded state and visitor review sections excluded.'}}
    intended='home' if '-home' in path.parent.name else 'information' if '-information' in path.parent.name else None
    if intended and intended!=tab:capture['metadata']['fileNameTabMismatch']={'fileNameTab':intended,'actualTab':tab}
    if record.get('identity',{}).get('confirmed'):
        reference_at=record['primarySource']['checkedAt']
        # Re-parsing older saved files must not borrow a later identity check.
        if datetime.datetime.fromisoformat(reference_at.replace('Z','+00:00')) < datetime.datetime.fromisoformat(stamp.replace('Z','+00:00')):
            capture['identityReference']={'sourceUrl':record['identity']['naverRecord']['sourceUrl'],'checkedAt':reference_at}

    def put(key,value=None,status='read',note=None):
        if key not in capture['captureScope']:capture['captureScope'].append(key)
        capture['fieldStatus'][key]=status;capture['fieldSources'][key]=url
        capture['fieldCheckedAt'][key]=stamp;capture['fieldCaptureMethod'][key]='browser_ui_saved_html'
        if value is not None and status=='read':capture['fields'][key]=value
        elif value is not None and status=='incomplete':capture.setdefault('incompleteFields',{})[key]=value
        if note:capture['captureNotes'][key]=note

    def links(node):
        for anchor in node.walk():
            if anchor.tag!='a':continue
            href=anchor.attrs.get('href','');kind=channel_kind(href)
            if not kind:continue
            if any(link['url']==href for link in capture['observedChannelLinks']):continue
            label=compact(anchor.text()) or compact(anchor.text(True)) or kind
            capture['observedChannelLinks'].append({'kind':kind,'url':href,'label':label,'sourceUrl':url,'checkedAt':stamp})
            if kind in ('website','naverBlog','blog','instagram','facebook','youtube','booking','kakaoChannel') and kind not in capture['fields']:put(kind,href)

    put('name',shown_name)
    sections={}
    for section in tree.walk():
        if not section.has('place_section'):continue
        heading=section.first(lambda n:n.has('place_section_header_title'))
        if heading:sections.setdefault(compact(heading.text()),[]).append(section)
    if tab=='information':
        expected={'소개':'description','대표 키워드':'representativeKeywords','편의시설 및 서비스':'amenities','주차':'parking','결제수단':'paymentMethods'}
        for heading,field in expected.items():
            groups=sections.get(heading,[])
            if not groups:
                put(field,status='not_displayed',note='저장한 정보 탭 표시 DOM에서 해당 독립 항목이 표시되지 않음. 기관의 실제 서비스 부재를 의미하지 않음.');continue
            if len(groups)!=1:put(field,status='incomplete',note='동일 제목 영역 복수 발견. 자동 선택 보류.');continue
            section=groups[0]
            if field=='description':
                content=section.first(lambda n:n.has('AX_W3'))
                toggles=[n for n in section.walk() if n.attrs.get('data-nlog-area')=='plc_inf.desc']
                expanded=not toggles or all(n.attrs.get('aria-expanded')=='true' for n in toggles)
                if content and expanded:
                    put(field,content.text().strip(),note='소개 DOM과 펼치기 상태 확인. 소개에 포함된 예약·방문·약력 문장을 별도 필드로 추측 분해하지 않음.')
                else:put(field,status='incomplete',note='소개 내용 노드 또는 펼침 확인 불충분. 접힌 DOM의 숨겨진 전체 텍스트는 수록하지 않음.')
            elif field=='representativeKeywords':
                values=[compact(n.text()) for n in section.walk() if n.has('PM0JZ') and compact(n.text())]
                put(field,values if values else None,'read' if values else 'incomplete')
            elif field in ('amenities','paymentMethods'):
                values=[compact(n.text()) for n in section.walk() if n.tag=='li' and n.has('jIxAu') and compact(n.text())]
                put(field,values if values else None,'read' if values else 'incomplete')
            else:
                content=section.first(lambda n:n.has('place_section_content'))
                value=compact(content.text()) if content else ''
                put(field,value or None,'read' if value else 'incomplete')
        for section in sections.get('SNS',[]):links(section)
        extras=[]
        for heading,groups in sections.items():
            if heading in expected or heading=='SNS' or any(word in heading for word in ('리뷰','블로그','사진','진료정보')):continue
            if heading in ('예약 안내','방문 전 준비사항','공지'):continue
            for section in groups:
                content=section.first(lambda n:n.has('place_section_content'))
                value=content.text().strip() if content else ''
                references=[{'url':n.attrs['href'],'label':compact(n.text(True))} for n in section.walk() if n.tag=='a' and channel_kind(n.attrs.get('href',''))]
                observed={'heading':heading,'text':value,'sourceUrl':url,'checkedAt':stamp,'captureMethod':'browser_ui_saved_html',
                    'authorship':'not_separately_verified','providerLinks':references}
                capture['metadata'].setdefault('additionalInfoSections',[]).append(observed)
                if heading=='위생 정보':
                    note='실제 점검월 값은 표시되지 않고 라벨만 있음. 점검 완료나 위생 상태를 추정하지 않음.' if compact(value)=='최근 통합방제 점검월' else '정보 탭에 표시된 위생 관련 원문이며 점검 사실이나 위생 상태를 독립 검증하지 않음.'
                    put('hygieneInformation',value or None,'read' if value else 'incomplete',
                        note=note+' 업체 작성 여부 별도 확인 전.')
                elif '접근성' in heading:put('accessibility',value or None,'read' if value else 'incomplete')
                elif value:extras.append(heading+'\n'+value)
        if extras:put('additionalInformation',extras,note='정보 탭에 실제 표시된 추가 독립 항목. 제3자 제공 또는 업체 작성 여부는 별도 검증하지 않음.')
    else:
        rows={}
        for row in tree.walk():
            if row.has('O8qbU'):
                label=row.first(lambda n:n.has('place_blind'))
                if label:rows[compact(label.text(True))]=row
        for label,field,cls in [('주소','address','pz7wy'),('전화번호','phone','xlx7Q'),('편의','amenities','xPvPE')]:
            if label in rows:
                content=rows[label].first(lambda n:n.has(cls))
                if content and compact(content.text()):put(field,compact(content.text()))
        directions=rows.get('찾아가는길')
        if directions:
            content=directions.first(lambda n:n.has('Nya41'))
            toggle=directions.first(lambda n:n.tag=='a' and n.has('xHaT3'))
            if content and (not toggle or toggle.attrs.get('aria-expanded')=='true'):put('directions',content.text().strip())
            else:put('directions',status='incomplete',note='길안내 펼침 또는 내용 노드 확인 불충분.')
        else:put('directions',status='not_displayed',note='저장한 홈 표시 DOM에 독립 길안내 항목이 표시되지 않음.')
        hours=rows.get('영업시간')
        if hours:
            toggle=hours.first(lambda n:n.tag=='a' and n.has('gKP9i'))
            day_rows=[]
            for item in hours.walk():
                if not item.has('w9QyJ') or item.has('vI8SM') or item.has('yN6TD'):continue
                content=item.first(lambda n:n.has('A_cdD'))
                value=compact(content.text()) if content else ''
                if value:day_rows.append(value)
            if day_rows and toggle and toggle.attrs.get('aria-expanded')=='true':put('hours','\n'.join(day_rows),note='펼친 시간 행의 표시 원문. 평일/공휴일 그룹이나 날짜 조건을 요일별 상시 일정으로 추측 분해하지 않음.')
            else:put('hours',status='incomplete',note='요일 목록의 펼침 상태를 확인하지 못해 시간표 확정 보류.')
            additional=[compact(item.text()) for item in hours.walk() if item.has('w9QyJ') and item.has('yN6TD') and compact(item.text())]
            if additional:put('hoursAdditional','\n'.join(additional))
        if '홈페이지' in rows:links(rows['홈페이지'])
        # Only institution top channel buttons; never review/blog-review hrefs.
        for node in tree.walk():
            if node.tag=='a' and node.attrs.get('data-nlog-area') in ('plc_btp.booking','plc_btp.url','plc_btp.channel','plc_btp.talk'):links(node)
        tab_names=[compact(n.text()) for n in tree.walk() if n.tag=='a' and n.attrs.get('role')=='tab']
        capture['metadata']['displayedTabs']=list(dict.fromkeys(tab_names))
        if set(tab_names)=={'홈','리뷰'}:
            capture['metadata']['informationTabStatus']='not_displayed'
            for field in [*OWNER,'amenities','parking','paymentMethods','accessibility','website','naverBlog','instagram','facebook','youtube']:
                if field not in capture['fieldStatus']:
                    put(field,status='not_displayed',note='저장된 UI 탭이 홈/리뷰뿐이고 정보 탭과 해당 독립 항목이 표시되지 않음. 채널·서비스의 실제 부재를 뜻하지 않음.')
    # Explicitly titled owner notices are collected only as their own sections.
    for heading,field in [('예약 안내','reservationNotice'),('방문 전 준비사항','visitorPreparation'),('공지','businessNotices')]:
        groups=sections.get(heading,[])
        if len(groups)==1:
            content=groups[0].first(lambda n:n.has('place_section_content'))
            if content and compact(content.text()):put(field,content.text().strip(),note='별도 제목으로 실제 표시된 업체 항목만 수록.')
    return capture


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--reparse',action='store_true',help='Re-extract locally saved HTML after parser changes; no network')
    parser.add_argument('--source',type=Path,default=SOURCE)
    parser.add_argument('--dest',type=Path,default=DEST)
    parser.add_argument('--queue',type=Path,default=QUEUE)
    args=parser.parse_args()
    source=args.source.resolve();dest=args.dest.resolve()
    queue=json.loads(args.queue.read_text())['records'];by_place={}
    for record in queue:
        if record.get('placeId'):
            if record['placeId'] in by_place:raise ValueError('Duplicate Place ID in queue')
            by_place[record['placeId']]=record
    dest.mkdir(parents=True,exist_ok=True)
    known={json.loads(path.read_text()).get('metadata',{}).get('savedHtmlSha256') for path in dest.glob('*.json')}
    if args.reparse:known=set()
    imported=[];errors=[];skipped=0
    for path in sorted(source.rglob('*.html')):
        if time.time()-path.stat().st_mtime<3:continue
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest() in known:skipped+=1;continue
        page=source_page(raw.decode('utf-8',errors='replace'))
        if not page:continue
        url,place_id,tab=page
        if place_id not in by_place:errors.append({'file':str(path.relative_to(ROOT)),'error':'Place ID outside supplied queue'});continue
        try:
            capture=parse(path,by_place[place_id])
            stamp=re.sub(r'[^0-9]','',capture['checkedAt'])
            output=dest/f'{place_id}-{tab}-{stamp}.json'
            if output.exists():
                previous=json.loads(output.read_text())
                # Explicit human review belongs to this exact saved document,
                # never to a silently inherited older institution judgement.
                if previous.get('metadata',{}).get('savedHtmlSha256')==capture['metadata']['savedHtmlSha256'] and previous.get('identityReview'):
                    capture['identityReview']=previous['identityReview']
            if not args.dry_run:
                temporary=output.with_suffix('.json.tmp');temporary.write_text(json.dumps(capture,ensure_ascii=False,indent=2)+'\n');temporary.replace(output)
            imported.append({'clinicId':capture['clinicId'],'name':capture['name'],'tab':tab,'output':str(output.relative_to(ROOT)),
                'fields':list(capture['fields']),'incomplete':[key for key,status in capture['fieldStatus'].items() if status=='incomplete'],'links':len(capture['observedChannelLinks'])})
            known.add(capture['metadata']['savedHtmlSha256'])
        except Exception as error:errors.append({'file':str(path.relative_to(ROOT)),'error':str(error)})
    print(json.dumps({'captures':len(imported),'alreadyCaptured':skipped,'results':imported,'errors':errors,'dryRun':args.dry_run},ensure_ascii=False))
    if errors:raise SystemExit(1)


if __name__=='__main__':main()
