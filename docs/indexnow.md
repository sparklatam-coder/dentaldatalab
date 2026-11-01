# IndexNow 수동 알림

IndexNow는 새로 공개되거나 수정된 URL을 참여 검색엔진에 알리는 프로토콜이다. Google Search Console 소유 확인이나 검색 성과 접근 권한을 만들지 않으며, 접수 성공이 크롤링·색인·순위를 뜻하지 않는다. Search Console/네이버 서치어드바이저의 소유 확인 및 sitemap 제출도 별도로 관리한다.

## 키와 공개 파일

최초 생성한 임의 UUID를 `data/content/indexnow-key.txt`에 보관한다. 이는 비밀번호·계정 토큰이 아닌, 공개 도메인의 IndexNow 알림 소유 확인용 challenge다. 키를 매번 새로 생성하지 않는다. SEO 공개 빌드는 동일한 내용의 UTF-8 텍스트 파일을 루트 `/<key>.txt`에 생성한다. 일반 검토 빌드에서는 생성하지 않는다.

코드와 키를 배포한 뒤 해당 루트 URL이 HTTPS 200이며 파일 본문이 키와 일치해야 실제 제출이 가능하다. `SITE_ORIGIN=https://dentaldatalab.com`과 `DDL_SEO_PUBLIC=1`을 사용한다.

## 실행

```sh
# 기본은 로컬 계획 출력만 수행: 네트워크·로그·접수 상태를 변경하지 않는다.
node scripts/submit-indexnow.mjs

# 다른 빌드 디렉터리를 검사한다.
node scripts/submit-indexnow.mjs --dist /tmp/dentaldatalab-seo-check

# 배포 확인 후 사용자가 명시적으로 실행할 때만 실제 알림을 보낸다.
node scripts/submit-indexnow.mjs --submit

# 특정 공개 URL만 선택할 수 있다. --url은 반복 가능하다.
node scripts/submit-indexnow.mjs --url https://dentaldatalab.com/ --submit
```

기본 7개는 홈, 리포트, 지역 목록, 에셋 목록, 출처, 처리 기준, 기존 확인 대상 치과 1개다. 이 구현은 1회 최대 8개의 명시적 URL만 허용한다. 프로토콜 자체 한도는 10,000개지만, 전국 기관을 자동으로 모두 제출하는 기능은 만들지 않았다. 의료 초안, 검색·비교 도구, 임의 도메인, HTTP URL, query/fragment URL은 제출하지 않는다.

실제 제출 전 공개 키 파일과 개별 HTML을 읽고 HTTP 200, noindex 부재, canonical 일치, 로컬 빌드와의 HTML SHA-256 일치를 확인한다. 로컬 자료가 배포 자료보다 새로우면 먼저 그 빌드를 배포해야 한다. 검증을 통과하면 `https://api.indexnow.org/indexnow`로 1회 POST한다. 별도 검색엔진별 중복 전송이나 실패 자동 재시도는 하지 않는다.

## 중복 방지와 결과

200은 접수, 202는 키 검증 대기 접수로 기록한다. 성공 접수한 URL의 HTML hash와 키가 같으면 다음 실행에서 전송하지 않는다. 202도 자동 재전송하지 않으며 추후 수집 상태는 검색엔진 도구에서 확인한다. 4xx·5xx·네트워크 오류는 성공 처리하지 않는다.

로컬 `data/research/indexnow/accepted.json`에 접수 상태, `submissions.jsonl`에 실행 결과를 저장한다. 이 폴더는 Git 업로드·사이트 빌드에서 제외된다. `submit.lock`으로 동시 수동 실행을 막는다. 강제 종료로 lock이 남았다면 실제 제출 프로세스가 종료됐는지 확인한 뒤 해당 lock만 정리한다.

이 상태 파일을 삭제하거나 다른 컴퓨터에서 상태 없이 실행하면 이전 접수를 알 수 없으므로 다시 보낼 수 있다. 확인 과정과 접수 로그는 보관한다. 빌드와 수집·SEO 점검 루프에서는 이 제출 명령을 자동 실행하지 않는다.

## 공식 근거

- [Bing: IndexNow 시작](https://www.bing.com/indexnow/getstarted) — 공개 키 파일, POST 형식, 접수 상태, 색인 보장 아님.
- [IndexNow 프로토콜 문서](https://www.indexnow.org/documentation) — 키 형식, keyLocation, 도메인 검증과 POST 최대 10,000 URL.
- [IndexNow](https://www.indexnow.org/) — 참여 검색엔진의 프로토콜 안내.


## 첫 제출 결과

2026-11-01 실제 배포 자료와 본문이 일치하는 대표 URL7개를 제출했고 HTTP202(키 검증 대기 접수)를 받았다. 전송 기록은 data/research/indexnow에 남아 있다. 한 기관 페이지는 Cloudflare의 HTTP→HTTPS 링크 변환 때문에 로컬 HTML과 달라져 사전 검증에서 제외됐다. 이 경우 원문 비교를 완화하거나 CDN 보안 기능을 끄지 않는다. 해당 기관도 전체 사이트맵에는 포함돼 있다.
