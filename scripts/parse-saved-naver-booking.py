#!/usr/bin/env python3
"""Parse only public rendered booking DOM saved through Chrome UI. No network."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import time
import urllib.parse
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'data/research/yangju-booking-html'
DEST=ROOT/'data/research/yangju-booking-captures'
spec=importlib.util.spec_from_file_location('owner_dom',ROOT/'scripts/parse-saved-naver-owner.py')
owner=importlib.util.module_from_spec(spec);spec.loader.exec_module(owner)


def cls(node,prefix):return any(value.startswith(prefix) for value in node.attrs.get('class','').split())
def service_title_text(node):
    # The navigator button lives inside the heading and has an accessibility
    # label; it is not part of the service name.
    title=node.first(lambda n:n.has('title'))
    if title:return owner.compact(title.text())
    return owner.compact(''.join(child if isinstance(child,str) else child.text() if child.tag!='button' else '' for child in node.children))
def source_page(raw):
    match=re.search(r'<!--\s*saved from url=\(\d+\)(https?://[^\r\n]+?)\s*-->',raw[:4096])
    if not match:return None
    url=match.group(1);parsed=urllib.parse.urlsplit(url)
    bid=re.search(r'/bizes/([1-9]\d*)(?:/|$)',parsed.path)
    if parsed.hostname not in ('booking.naver.com','m.booking.naver.com') or parsed.username or parsed.password or parsed.port is not None or not bid:return None
    return url,bid.group(1)


def parse(path,record,asset,known_names):
    raw=path.read_bytes();page=source_page(raw.decode('utf-8',errors='replace'))
    if not page:return None
    url,bid=page
    if source_page('<!-- saved from url=(1)'+asset['url']+' -->')[1]!=bid:raise ValueError('Saved booking page differs from verified booking bizes')
    dom=owner.DOM();dom.feed(raw.decode('utf-8',errors='replace'));tree=dom.root
    title=tree.first(lambda n:cls(n,'HomeSummary__detail_title__'))
    header=tree.first(lambda n:n.tag=='h1' and (cls(n,'HeaderBookingHome__title__') or cls(n,'BizItemHeader__title__')))
    shown=owner.compact((title or header).text()) if title or header else ''
    if not shown or re.sub(r'\s+','',shown) not in {re.sub(r'\s+','',v) for v in known_names}:raise ValueError('Booking business header does not match observed institution names')
    stamp=owner.checked_at(path);sections=[];parts=[]
    item_match=re.search(r'/items/([1-9]\d*)(?:/|$)',urllib.parse.urlsplit(url).path)
    content_kind='home';service_title='';selected_tab=None
    if item_match:
        selected=[n for n in tree.walk() if n.attrs.get('role')=='tab' and n.attrs.get('aria-selected')=='true']
        if len(selected)!=1:raise ValueError('Exactly one visible service tab must be selected')
        selected_tab=selected[0].attrs.get('data-click-code')
        if selected_tab not in ('tab.details','tab.book'):raise ValueError('Only public service details and pre-booking notices are in scope')
        content_kind='service_detail' if selected_tab=='tab.details' else 'service_notice'
        service_title_node=tree.first(lambda n:n.has('info_title'))
        service_title=service_title_text(service_title_node) if service_title_node else ''
    def section(kind,label,text=None,status='read',note=None):
        item={'kind':kind,'label':label,'status':status,'sourceUrl':url,'checkedAt':stamp}
        if text and status=='read':item['text']=text;parts.append(label+'\n'+text)
        if note:item['notes']=note
        sections.append(item)
    summary=tree.first(lambda n:cls(n,'HomeSummary__detail_sub__'))
    if summary and summary.text().strip():section('summary','업체 요약',summary.text().strip())
    service_titles=[]
    for item in tree.walk():
        if not cls(item,'HomeBookingList__booking_item__'):continue
        name=item.first(lambda n:cls(n,'HomeBookingList__desc_title__'))
        if name and name.text().strip():service_titles.append(name.text().strip())
    if service_titles:section('serviceTitles','예약 목록 항목명','\n'.join(service_titles))
    descriptions=[n for n in tree.walk() if cls(n,'HomeBookingList__desc_detail__') and n.text().strip()]
    if descriptions:section('serviceDescriptions','예약 목록 카드 설명',status='incomplete',note='목록 카드 설명에는 CSS 줄 수 제한이 적용됩니다. 표시 밖 DOM 문장을 전문으로 수록하지 않았으며 서비스 상세 화면은 별도 확인이 필요합니다.')
    modal=tree.first(lambda n:n.has('common_modal') and n.has('show') and cls(n,'Information__home_detail_modal__'))
    intro=modal.first(lambda n:cls(n,'Information__modal_inner__')) if modal else None
    if intro and intro.text().strip():
        section('introduction','업체 소개 및 추가 설명',intro.text().strip())
    else:
        original=tree.first(lambda n:cls(n,'Information__root__'))
        if original:
            more=cls(original,'Information__type_more__') or any(n.tag=='button' and owner.compact(n.text())=='소개 더보기' for n in tree.walk())
            if more:section('introduction','업체 소개 및 추가 설명',status='incomplete',note='소개 더보기의 열린 모달이 저장되지 않았습니다. 접힌 영역의 전체 DOM 문장은 수록하지 않았습니다.')
            elif original.text().strip():section('introduction','업체 소개 및 추가 설명',original.text().strip(),note='저장된 소개 영역에 더보기 제한 표기가 없는 짧은 표시 원문입니다.')
    if content_kind=='service_detail':
        detail=tree.first(lambda n:n.has('section_detail'))
        if not detail:raise ValueError('Selected details tab has no supported detail section')
        if detail.has('hidden'):section('serviceDescription','예약 서비스 상세 설명',status='incomplete',note='상세정보 영역이 높이 제한 상태입니다. 펼친 상세 영역 저장이 필요합니다.')
        else:
            values=[n.text().strip() for n in detail.walk() if n.has('detail_info') and n.text().strip()]
            if values:section('serviceDescription','예약 서비스 상세 설명','\n\n'.join(dict.fromkeys(values)))
            else:raise ValueError('Detail section exists but supported publisher detail_info body is missing')
    elif content_kind=='service_notice':
        notices=[n for n in tree.walk() if n.has('section_notice')]
        if not notices:section('serviceNotice','예약 전 알립니다',status='not_displayed',note='실제 선택된 예약하기 탭에 알립니다 구획이 표시되지 않음. 다른 경로의 안내 부재는 의미하지 않음.')
        for notice in notices:
            closed=[n for n in notice.walk() if n.has('notice_item') and not n.has('open')]
            content=notice.first(lambda n:n.has('section_content'))
            if closed:section('serviceNotice','예약 전 알립니다',status='incomplete',note='닫힌 안내 아코디언이 있어 원문 완료 판정을 보류했습니다.')
            elif content and content.text().strip():section('serviceNotice','예약 전 알립니다',content.text().strip())
            else:raise ValueError('Notice section exists but supported section_content body is missing')
    if not sections:raise ValueError('No supported public publisher DOM section; review markup before importing')
    incomplete=[item['kind'] for item in sections if item['status']=='incomplete']
    notes='공개 예약 화면에서 실제 표시된 업체 문구만 수록. 예약자 리뷰, 업체의 리뷰 답글, 계정·예약내역·달력·시간대별 예약 가능 여부·선택값·예약 제출·네이버 회사 푸터 및 화면 밖에 잘린 카드 설명 제외.'
    if incomplete:notes+=' 이번 화면에서 전문 미확보 항목: '+', '.join(incomplete)+'.'
    reference=asset.get('ownershipReference') or {'url':asset['url'],'checkedAt':asset.get('ownershipEvidenceAt') or asset['checkedAt'],'ownership':asset['ownership']}
    result={'schemaVersion':1,'clinicId':record['clinicId'],'name':record['name'],'url':asset['url'],'sourceUrl':url,'checkedAt':stamp,
        'bodyStatus':'read','captureMethod':'browser_ui_saved_html','ownershipReference':reference,
        'contentKind':content_kind,'publisherContentStatus':'read' if parts else 'incomplete' if incomplete else 'not_displayed','notes':notes,
        'metadata':{'savedHtmlPath':str(path.relative_to(ROOT)),'savedHtmlSha256':hashlib.sha256(raw).hexdigest(),'parserVersion':1,
            'checkedAtBasis':'Chrome Save Page file modification time','visibleBusinessHeader':shown,'bizesId':bid,'itemId':item_match.group(1) if item_match else None,'selectedTab':selected_tab,
            'captureScope':[s['kind'] for s in sections],'declaredScopeComplete':not incomplete,'sections':sections,
            'extraction':'Displayed publisher DOM only; scripts, embedded state, reviews/replies and truncated card descriptions excluded.'}}
    if parts:result['publisherContent']={'title':{'home':'공개 예약 목록·업체 소개','service_detail':service_title+' · 서비스 상세','service_notice':service_title+' · 예약 전 알립니다'}[content_kind],'contentKind':content_kind,'text':'\n\n'.join(parts),'sourceUrl':url,'checkedAt':stamp}
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--dry-run',action='store_true');parser.add_argument('--reparse',action='store_true');args=parser.parse_args()
    if not SOURCE.exists():print(json.dumps({'captures':0,'reason':'source_directory_not_created'}));return
    queue=json.loads((ROOT/'data/research/yangju-owner-queue.json').read_text())['records'];by_place={str(r['placeId']):r for r in queue if r.get('placeId')}
    js="import fs from 'node:fs';import {loadAssetInventory} from './scripts/clinic-assets.mjs';const data=JSON.parse(fs.readFileSync('data/clinics.json'));const ids=new Set(data.clinics.filter(c=>c.sidoCode==='310000'&&c.cityCode==='312700').map(c=>c.id));console.log(JSON.stringify(loadAssetInventory(process.cwd(),data).records.filter(r=>ids.has(r.clinicId)).map(r=>({clinicId:r.clinicId,assets:r.assets.filter(a=>a.kind==='booking'&&['official','linked'].includes(a.ownership))}))));"
    inventory={r['clinicId']:r for r in json.loads(subprocess.check_output(['node','--input-type=module','-e',js],cwd=ROOT,text=True))}
    names={r['clinicId']:{r['name']} for r in queue}
    for path in (ROOT/'data/research/yangju-owner-captures').glob('*.json'):
        cap=json.loads(path.read_text());value=cap.get('fields',{}).get('name')
        if value:names.setdefault(cap['clinicId'],set()).add(value)
    DEST.mkdir(parents=True,exist_ok=True)
    known=set() if args.reparse else {json.loads(p.read_text()).get('metadata',{}).get('savedHtmlSha256') for p in DEST.glob('*.json')}
    results=[];errors=[];skipped=0
    for path in sorted(SOURCE.rglob('*.html')):
        if time.time()-path.stat().st_mtime<3:continue
        raw=path.read_bytes();sha=hashlib.sha256(raw).hexdigest()
        if sha in known:skipped+=1;continue
        page=source_page(raw.decode('utf-8',errors='replace'))
        if not page:continue
        match=re.match(r'([1-9]\d*)-booking',path.name) or re.match(r'([1-9]\d*)-booking',path.parent.name)
        try:
            if not match or match.group(1) not in by_place:raise ValueError('Saved filename must identify an existing Yangju Place ID')
            record=by_place[match.group(1)];bid=page[1]
            assets=[a for a in inventory.get(record['clinicId'],{}).get('assets',[]) if source_page('<!-- saved from url=(1)'+a['url']+' -->') and source_page('<!-- saved from url=(1)'+a['url']+' -->')[1]==bid]
            if len(assets)!=1:raise ValueError('Exactly one existing verified booking asset is required')
            cap=parse(path,record,assets[0],names[record['clinicId']])
            name=match.group(1)+'-booking-'+re.sub(r'\D','',cap['checkedAt'])+'.json';target=DEST/name
            if not args.dry_run:
                temp=target.with_suffix('.json.tmp');temp.write_text(json.dumps(cap,ensure_ascii=False,indent=2)+'\n');os.replace(temp,target)
            results.append({'name':record['name'],'path':str(target.relative_to(ROOT)),'sections':[{'kind':s['kind'],'status':s['status']} for s in cap['metadata']['sections']]});known.add(sha)
        except Exception as error:errors.append({'path':str(path.relative_to(ROOT)),'error':str(error)})
    print(json.dumps({'captures':len(results),'alreadyCaptured':skipped,'errors':errors,'results':results},ensure_ascii=False))
    if errors:raise SystemExit(1)


if __name__=='__main__':main()
