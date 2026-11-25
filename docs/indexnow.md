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

# 이름 붙은 세트. 먼저 dry run으로 선택된 URL을 확인하고, 배포 확인 뒤에만 --submit을 붙인다.
node scripts/submit-indexnow.mjs --set hospitals
node scripts/submit-indexnow.mjs --set hospitals --submit
```

기본 7개는 홈, 리포트, 지역 목록, 에셋 목록, 출처, 처리 기준, 기존 확인 대상 치과 1개다. `--url`과 기본 목록은 1회 최대 8개의 명시적 URL만 허용한다. 의료 초안, 검색·비교 도구, 임의 도메인, HTTP URL, query/fragment URL은 제출하지 않는다. `--set`과 `--url`은 함께 쓸 수 없다.

실제 제출 전 공개 키 파일과 개별 HTML을 읽고 HTTP 200, noindex 부재, canonical 일치, 로컬 빌드와의 HTML SHA-256 일치를 확인한다. 로컬 자료가 배포 자료보다 새로우면 먼저 그 빌드를 배포해야 한다. 검증을 통과하면 `https://api.indexnow.org/indexnow`로 1회 POST한다. 별도 검색엔진별 중복 전송이나 실패 자동 재시도는 하지 않는다. `--url`과 기본 목록에서는 한 URL이라도 검증에 실패하면 아무것도 보내지 않고 중단한다.

## 이름 붙은 세트: `hospitals`

이전 문서의 "대량 제출을 하지 않는다"는 원칙은 **명시적이고 범위가 정해진 이 세트 하나에 한해서만** 완화한다. 그 밖의 대량 제출 기능은 없고, 전국 치과의원을 한꺼번에 제출하는 기능도 만들지 않았다. Bing에 색인된 페이지가 0으로 표시되는 상태에서 치과병원 상세와 허브 페이지를 한 번에 알리기 위한 것이다.

`hospitals`는 아래를 모은 뒤, 항상 **빌드 manifest에 있는 경로 ∩ sitemap에 있는 URL ∩ 색인 대상 경로**로 줄인다.

- 치과병원(종별코드 41) 기관 상세 전부. 종별은 `data/clinics.json`에서 읽으며, 빌드가 그 파일로 만들어졌는지 manifest의 SHA-256으로 확인한다.
- 빌드에 있는 `/hospitals/`, `/reports/`, `/guides/` 아래 모든 경로.
- 있으면 `/`, `/data/`, `/data/open/`, `/press/`, `/for-clinics/`.
- 있으면 `/conditions/`와 `/conditions/<한 단계>/`. 시군구별 조건 목록(`/regions/<시도>/<시군구>/<조건>/`)은 넣지 않는다.

치과의원(51) 상세는 어떤 경우에도 세트에 들어가지 않는다. 빌드가 `noindex`로 내린 경로(`seo-indexing.json`)는 세트뿐 아니라 `--url`에서도 거부된다. 현재 빌드에서 dry run으로 선택되는 수는 284개(허브 36 + 치과병원 상세 248)다. `/data/open/`, `/press/`, `/for-clinics/`, `/conditions/`가 빌드와 색인 대상에 추가되면 그만큼 늘어난다.

세트 실행은 `--url`과 다음이 다르다.

- POST는 1회, URL은 최대 500개다. 대상이 500개를 넘으면 앞의 500개(허브, 그다음 기관 id순)만 보내고 나머지는 `deferred`로 출력해 다음 실행으로 넘긴다.
- 실서비스 HTML 확인은 동시에 최대 4개까지만 요청한다.
- 실서비스 페이지가 없거나 200이 아니거나, noindex이거나, 로컬 빌드와 다르면 **그 URL만 건너뛰고** 이유와 함께 출력·로그에 남긴다(`http_404`, `noindex_meta`, `noindex_header`, `not_html`, `canonical_mismatch`, `differs_from_build`, `unreachable`). 실행은 중단하지 않는다. 통과한 URL이 하나도 없으면 POST하지 않는다.
- 공개 키 파일이 없거나 다르면, 또는 IndexNow가 200·202 외의 응답을 주면 세트에서도 전체를 실패로 처리한다.
- 접수 상태에는 실제로 보낸 URL만 기록한다. 건너뛴 URL은 다음 실행에서 다시 대상이 되고, 이미 접수했고 내용이 같은 URL은 지금처럼 보내지 않는다.

Bing 안내는 IndexNow 사용을 시작한 뒤 추가·수정·삭제된 URL만 알리라고 하며, 알린 URL의 크롤링도 크롤링 할당량에 포함된다고 설명한다. 세트는 새로 만들었거나 내용이 바뀐 페이지를 배포한 뒤 한 번 실행하는 용도이며, 같은 내용을 반복해서 보내는 용도가 아니다.

## 중복 방지와 결과

200은 접수, 202는 키 검증 대기 접수로 기록한다. 성공 접수한 URL의 HTML hash와 키가 같으면 다음 실행에서 전송하지 않는다. 202도 자동 재전송하지 않으며 추후 수집 상태는 검색엔진 도구에서 확인한다. 4xx·5xx·네트워크 오류는 성공 처리하지 않는다. 프로토콜 문서의 오류 응답은 400(형식 오류), 403(키 불일치), 422(host와 맞지 않는 URL 또는 키 형식 불일치), 429(요청 과다·스팸 의심)이며, 어느 것도 자동 재시도하지 않는다.

로컬 `data/research/indexnow/accepted.json`에 접수 상태, `submissions.jsonl`에 실행 결과를 저장한다. 이 폴더는 Git 업로드·사이트 빌드에서 제외된다. `submit.lock`으로 동시 수동 실행을 막는다. 강제 종료로 lock이 남았다면 실제 제출 프로세스가 종료됐는지 확인한 뒤 해당 lock만 정리한다.

이 상태 파일을 삭제하거나 다른 컴퓨터에서 상태 없이 실행하면 이전 접수를 알 수 없으므로 다시 보낼 수 있다. 확인 과정과 접수 로그는 보관한다. 빌드와 수집·SEO 점검 루프에서는 이 제출 명령을 자동 실행하지 않는다.

## 공식 근거

- [Bing: IndexNow 시작](https://www.bing.com/indexnow/getstarted) — 공개 키 파일, POST 형식, 접수 상태, 색인 보장 아님.
- [IndexNow 프로토콜 문서](https://www.indexnow.org/documentation) — 키 형식, keyLocation, 도메인 검증과 POST 최대 10,000 URL.
- [IndexNow](https://www.indexnow.org/) — 참여 검색엔진의 프로토콜 안내.

2026-11-26에 두 문서를 다시 확인했다. 프로토콜 문서는 POST 1회 최대 10,000 URL, `Content-Type: application/json; charset=utf-8`, 응답 200·202·400·403·422·429를 안내한다. Bing 시작 문서에서는 같은 POST 형식과 200·400·403·422·429, 변경된 URL만 알리라는 안내, 색인 보장이 없다는 문장을 확인했고, POST당 URL 수나 일일 한도는 그 문서에서 찾지 못했다. 세트의 500개 한도는 프로토콜 한도가 아니라 이 프로젝트가 정한 상한이다.


## 첫 제출 결과

2026-11-01 실제 배포 자료와 본문이 일치하는 대표 URL7개를 제출했고 HTTP202(키 검증 대기 접수)를 받았다. 전송 기록은 data/research/indexnow에 남아 있다. 한 기관 페이지는 Cloudflare의 HTTP→HTTPS 링크 변환 때문에 로컬 HTML과 달라져 사전 검증에서 제외됐다. 이 경우 원문 비교를 완화하거나 CDN 보안 기능을 끄지 않는다. 해당 기관도 전체 사이트맵에는 포함돼 있다.
