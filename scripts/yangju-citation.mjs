import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {esc,localDate} from '../src/shared.mjs';
import {YANGJU_REPORT_ROUTE} from './yangju-analysis.mjs';
export function citationPack(a,origin) {
 const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin)throw new Error('Expected HTTPS origin');
 const total=a.scope.total;
 if(!Number.isSafeInteger(total)||total<=0||Object.values(a.coverage).some(v=>!Number.isSafeInteger(v)||v<0)||Object.values(a.coverage).reduce((s,n)=>s+n,0)!==total||a.registered.hours!==a.coverage.both+a.coverage.registeredOnly||a.naver.hours!==a.coverage.both+a.coverage.naverOnly)throw new Error('Inconsistent citation population');
 const version='v1-'+createHash('sha256').update(JSON.stringify({citationFormatVersion:1,analysis:a})).digest('hex').slice(0,12);
 const base='/data/reports/yangju-hours-evidence/'+version;
 const period=a.naver.earliestCheckedAt?`${localDate(a.naver.earliestCheckedAt)}–${localDate(a.naver.latestCheckedAt)}`:'미확인';
 const finding=`양주 등록 치과 ${total}곳 중 ${a.snapshotDate} 심평원 자료에서 유효한 진료시간쌍이 확인된 곳은 ${a.registered.hours}곳이다. 별도 네이버 관찰(${period})에서는 ${a.naver.hours}곳의 시간 원문을 확인했다.`;
 const limitation='두 출처는 기준일과 수집 방식이 다르며, 시간표 일치율이나 현재 진료·영업 여부를 검증한 수치가 아니다. 미확인은 휴진을 뜻하지 않는다.';
 const title=`양주 치과 ${total}곳의 시간 정보: 등록 자료와 네이버 안내 분석`;
 const text=`${finding}\n${limitation}\n\n치과데이터랩(운영: 노크AI). 「${title}」. 분석 버전 ${version}.\n원자료: 건강보험심사평가원 전국 병의원 및 약국 현황(${a.snapshotDate} 기준). 별도 네이버 관찰 근거는 버전별 JSON에 수록.\n수집·가공·분석: 치과데이터랩.\n보고서: ${origin+YANGJU_REPORT_ROUTE}\n고정 근거: ${origin+base}.json`;
 return {version,base,title,period,finding,limitation,text,reportUrl:origin+YANGJU_REPORT_ROUTE,evidenceUrl:origin+base+'.json'};
}
export function citationChart(a,origin) {
 const c=citationPack(a,origin),total=a.scope.total,barWidth=880;
 const rows=[['심평원 유효 시간쌍',a.registered.hours,'#087969'],['네이버 시간 원문',a.naver.hours,'#345d80']];
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000" viewBox="0 0 1400 1000" role="img" aria-labelledby="title desc"><title id="title">양주 치과 ${total}곳의 출처별 시간 정보 수록</title><desc id="desc">${esc(c.finding+' '+c.limitation)}</desc><rect width="1400" height="1000" fill="#f7f6ef"/><g font-family="Arial, 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" fill="#142e33"><text x="70" y="80" font-size="25" fill="#087969">치과데이터랩 · 출처별 자료 수록 분석</text><text x="70" y="155" font-size="44" font-weight="bold">양주 치과 ${total}곳, 시간 정보는 어디에 있나요?</text><text x="70" y="210" font-size="25">공통 분모: 심평원 원자료의 양주 치과병원·치과의원 ${total}곳</text>${rows.map(([label,n,color],i)=>{const y=300+i*160;return `<text x="70" y="${y}" font-size="28">${label}</text><rect x="70" y="${y+25}" width="${barWidth}" height="48" rx="8" fill="#e1e7e1"/><rect x="70" y="${y+25}" width="${n/total*barWidth}" height="48" rx="8" fill="${color}"/><text x="990" y="${y+61}" font-size="36" font-weight="bold">${n} / ${total}곳</text>`;}).join('')}<text x="70" y="645" font-size="24">심평원 기준 ${esc(a.snapshotDate)} · 네이버 관찰 ${esc(c.period)}</text><text x="70" y="700" font-size="24" font-weight="bold">두 막대는 중복 포함 가능 · 시간표 일치율·현재 진료 여부가 아닙니다.</text><text x="70" y="743" font-size="24">자료 미확인은 휴진이나 안내 부재를 뜻하지 않습니다.</text><text x="70" y="812" font-size="21">원자료: 건강보험심사평가원 · 별도 네이버 관찰 근거는 보고서 JSON 참고</text><text x="70" y="850" font-size="21">수집·가공·분석: 치과데이터랩 · 운영: 노크AI · 버전 ${c.version}</text><text x="70" y="900" font-size="22">${esc(c.reportUrl.replace('https://',''))}</text><text x="70" y="941" font-size="18">고정 근거: /data/reports/yangju-hours-evidence/${c.version}.json</text></g></svg>`;
}
export function citationSection(a,origin) {
 const c=citationPack(a,origin);
 return `<section class="report-section citation-section" id="key-findings" aria-labelledby="finding-title"><p class="eyebrow">KEY FINDINGS / 인용할 때 함께 읽기</p><h2 id="finding-title">이 분석에서 확인한 핵심</h2><p class="report-summary">${esc(c.finding)}</p><p>${esc(c.limitation)}</p><p class="subtle-note">분석 버전 ${c.version} · 원자료 ${esc(a.snapshotDate)} · 네이버 관찰 ${esc(c.period)}</p><div class="hero-actions"><button type="button" class="btn primary" data-copy-citation data-citation-target="yangju-citation">핵심 발견·출처 인용문 복사</button><a class="btn" href="${c.base}.txt" download>인용문 TXT</a><a class="btn" href="${c.base}.json" download>이 버전 근거 JSON</a></div><details><summary>인용문 직접 선택·복사</summary><pre id="yangju-citation" style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${esc(c.text)}</pre></details><figure style="margin:28px 0"><img id="yangju-citation-chart" src="${c.base}.svg" width="1400" height="1000" alt="양주 등록 치과 ${a.scope.total}곳 중 심평원 시간쌍 ${a.registered.hours}곳과 별도 네이버 시간 원문 ${a.naver.hours}곳의 수록 현황. 현재 진료 여부나 시간표 일치율이 아닙니다." style="display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px"/><figcaption class="subtle-note">출처·기준일·분모·해석 한계가 포함된 그래프입니다. 내려받을 때도 이 정보를 함께 남겨 주세요.</figcaption></figure><div class="hero-actions"><a class="btn" href="${c.base}.svg" download>그래프 SVG 다운로드</a><button type="button" class="btn" data-download-chart="yangju-citation-chart" data-filename="yangju-hours-${c.version}.png">그래프 PNG로 저장</button></div><p class="subtle-note" data-chart-status role="status"></p><noscript><p>복사와 PNG 저장은 JavaScript가 필요합니다. 위 인용문 직접 선택과 TXT·SVG 다운로드는 그대로 사용할 수 있습니다.</p></noscript><p class="subtle-note">고정 근거 파일은 해당 분석 버전을 보존합니다. 이후 새 자료의 분석 결과는 현재 보고서와 구분합니다. 원자료 이용 조건은 <a href="/data/">출처 안내</a>에서 확인하세요.</p></section>`;
}

export function loadYangjuArchives() {
 const directory=new URL('../data/content/report-archives/',import.meta.url);
 const records=fs.readdirSync(directory).filter(n=>/^yangju-hours-evidence.*\.json$/.test(n)).sort().map(n=>JSON.parse(fs.readFileSync(new URL(n,directory),'utf8')));
 if(!records.length)throw new Error('Missing Yangju report archive');
 return records;
}
export function registerCitationFiles({put,analysis,domain,archives=[]}) {
 const current=citationPack(analysis,domain);
 if(archives.length&&!archives.some(a=>citationPack(a,domain).version===current.version))throw new Error('Archive the new Yangju analysis before publishing; preserve earlier archives.');
 const versions=new Map();
 for(const a of [...archives,analysis]){const c=citationPack(a,domain);versions.set(c.version,{a,c});}
 for(const {a,c} of versions.values()){
  put(c.base.slice(1)+'.json',JSON.stringify({schemaVersion:1,version:c.version,reportUrl:c.reportUrl,analysis:a,citation:c.text},null,2));
  put(c.base.slice(1)+'.txt',c.text+'\n');put(c.base.slice(1)+'.svg',citationChart(a,domain));
 }
 put('data/reports/yangju-hours-evidence-versions.json',JSON.stringify({current:current.version,versions:[...versions.values()].map(({c})=>({version:c.version,evidenceUrl:c.evidenceUrl,chartUrl:domain+c.base+'.svg',citationUrl:domain+c.base+'.txt'}))},null,2));
}
