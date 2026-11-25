# 기관 연결 클릭 집계

방문자가 기관 페이지 등에서 기관의 전화·지도·홈페이지·예약·채널 링크를 눌러 기관으로 넘어간 횟수를 센다. 어느 기관의 어떤 종류 링크였는지만 남기고, 누가 눌렀는지는 남기지 않는다. 저장소(Cloudflare Workers Analytics Engine)는 운영자가 대시보드에서 바인딩을 한 번 추가해야 켜진다. 그 전에는 코드가 배포되어 있어도 아무것도 저장하지 않는다.

- 정의: `scripts/outbound-events.mjs` (경로, 허용 값, 검증 함수)
- 브라우저: `src/app.mjs` 마지막 줄
- 서버: `scripts/build-cloudflare.mjs`가 만드는 Pages Worker의 `POST /e/outbound`
- 리포트: `scripts/outbound-report.mjs`

## 무엇을 세는가

`data-outbound`와 `data-clinic` 속성이 둘 다 있는 `<a>`를 눌렀을 때 1건이다.

| `data-outbound` | 뜻 | 현재 속성을 붙이는 곳 |
| --- | --- | --- |
| `tel` | 전화 걸기 | 기관 페이지 빠른 실행 바(별도 브랜치) |
| `map` | 지도 열기 | 빠른 실행 바, 에셋 목록의 네이버지도·카카오맵·구글지도 |
| `homepage` | 홈페이지 열기 | 빠른 실행 바, 에셋 목록의 홈페이지, 기본 정보의 ‘웹에서 확인한 홈페이지’ 행 |
| `booking` | 예약 페이지 열기 | 빠른 실행 바, 에셋 목록의 예약 |
| `share` | 공유 | 빠른 실행 바(별도 브랜치) |
| `channel` | 그 밖의 기관 채널 | 에셋 목록의 블로그·유튜브·인스타그램·페이스북·카카오 채널·링크 모음·기타 |

에셋 목록(`scripts/clinic-assets-pages.mjs`)에서는 기관 소유로 분류되고 링크가 열려 있는 채널 링크에만 속성을 붙인다. 근거·출처 링크, 제3자 언급, ‘검토 중 · 링크 비활성’ 후보, 네이버지도 관찰 원문 링크에는 붙이지 않는다. 빠른 실행 바가 병합되기 전에는 기본 정보의 신고 전화번호·신고 홈페이지 링크에 속성이 없어 집계되지 않는다.

## 이벤트 형식

브라우저가 보내는 것 (`navigator.sendBeacon`, `text/plain` 본문의 JSON, 필드는 정확히 3개):

```json
{"kind": "tel", "clinic": "c-0123456789ab", "page": "/clinics/c-0123456789ab/"}
```

- `kind`: 위 표의 여섯 값 중 하나.
- `clinic`: `^c-[a-f0-9]{12}$`.
- `page`: `location.pathname`. 쿼리스트링(검색어)과 `#` 뒤는 보내지 않는다. 소문자 디렉터리 경로(`/`, `/find/`, `/regions/110000/110001/`)만 허용한다.

Worker가 저장하는 것 (`writeDataPoint` 1회):

| Analytics Engine 열 | 값 |
| --- | --- |
| `blob1` | kind |
| `blob2` | 기관 ID |
| `blob3` | 페이지 영역: 경로의 첫 마디(`clinics`, `regions`, `find` …), 루트는 `home` |
| `double1` | 1 |
| `index1` | 기관 ID (샘플링 키) |
| `timestamp` | Analytics Engine이 기록 시각을 자동으로 넣는다 |

## 기록하지 않는 것

- IP 주소, User-Agent, 쿠키, Referer, 언어·화면 정보, 국가(`request.cf`): Worker가 읽지도 않는다. 읽는 요청 정보는 `Origin`·`Sec-Fetch-Site`·`Content-Length` 헤더와 512바이트 이하 본문뿐이며, 이는 `test/cloudflare-build.test.mjs`가 검사한다.
- 방문자·세션·기기 식별자: 만들지 않는다. 브라우저 코드는 쿠키·localStorage를 쓰지 않는다. 그래서 같은 사람이 두 번 누르면 2건이고, 순 방문자 수는 구할 수 없다.
- 검색어, 전체 페이지 경로, 누른 링크의 URL.

Cloudflare가 호스팅 과정에서 처리하는 접속 정보는 이 집계와 별개이며 `/privacy/`의 ‘공개 호스팅의 서버 기록’에 따로 적혀 있다. 같은 페이지의 ‘기관 연결 링크의 클릭 수 집계’ 항목이 이 기능을 고지한다. 고지 문구는 `scripts/build.mjs`의 `prosePage('/privacy/', …)`에 있고, `scripts/qa.mjs`가 비콘 코드와 고지가 함께 있는지 확인한다.

## 서버의 응답

`POST /e/outbound`는 셌든 안 셌든 항상 본문 없는 `204`와 `Cache-Control: no-store`로 답한다. 어떤 요청이 집계되는지 외부에서 구분할 수 없게 하기 위해서다. 브라우저의 `sendBeacon`은 응답을 쓰지 않는다. `POST`가 아닌 메서드는 `405`(`Allow: POST`)다. `/e/` 아래의 다른 경로는 정적 자산 처리로 넘어가 404가 된다.

다음은 204로 답하되 세지 않는다.

- 브라우저가 같은 출처라고 표시하지 않은 요청: `Origin`이 사이트 출처와 다르거나, `Sec-Fetch-Site`가 `same-origin`이 아니거나, 두 헤더가 모두 없는 요청(curl, 대부분의 크롤러·스크립트).
- `*.pages.dev` 호스트로 온 요청(미리보기 배포는 방문자 통계가 아니다). 기본 `dentaldatalab.pages.dev`는 기존처럼 주 도메인으로 301 된다.
- 512바이트를 넘는 본문, JSON이 아닌 본문, 필드가 3개가 아닌 본문, 허용 목록 밖의 `kind`, 형식이 다른 `clinic`·`page`.

`clinic`은 형식만 검사한다. 실제로 있는 기관인지는 Worker가 확인하지 않는다(무료 CPU 한도 안에서 묶음 JSON을 읽지 않기 위해서다). 리포트는 `data/clinics.json`에 있는 치과병원 ID만 조회한다.

## 바인딩 추가 전과 후

| | 바인딩 없음 (지금) | `OUTBOUND` 바인딩 추가 후 |
| --- | --- | --- |
| 브라우저 | 링크를 누르면 비콘 1건을 보낸다 | 같음 |
| Worker | 검증한 뒤 버린다. 204 | 유효한 이벤트마다 데이터 포인트 1건을 쓴다. 204 |
| 저장 | 없음 | Analytics Engine 데이터셋 `dentaldatalab_outbound` |
| 리포트 | 조회할 데이터셋이 없다 | `scripts/outbound-report.mjs`로 조회 |

Worker 코드는 `env.OUTBOUND?.writeDataPoint(...)`이므로 바인딩이 없거나 쓰기가 실패해도 응답과 다른 경로에는 영향이 없다.

## 1회 설정: `OUTBOUND` 바인딩 추가

Cloudflare 문서 [Pages Functions › Bindings › Analytics Engine](https://developers.cloudflare.com/pages/functions/bindings/#analytics-engine)의 절차다.

1. Cloudflare 대시보드에서 **Workers & Pages**로 간다.
2. Pages 프로젝트(`dentaldatalab`)를 선택한다.
3. **Settings** > **Bindings** > **Add** > **Analytics engine**.
4. **Variable name**에 `OUTBOUND`를 입력한다. 코드가 이 이름을 찾으므로 그대로 써야 한다.
5. **Dataset**에 `dentaldatalab_outbound`를 입력한다. 데이터셋은 미리 만들 필요가 없고 첫 기록 때 자동으로 생긴다([Get started](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)).
6. 프로젝트를 다시 배포한다. 문서의 표현은 “Redeploy your project for the binding to take effect”이고, 바인딩은 새 배포부터 적용된다.

화면에 Production/Preview 환경 선택이 나오면 Production에만 추가한다. Preview에 추가해도 `*.pages.dev` 요청은 세지 않는다.

확인: 재배포 후 `https://dentaldatalab.com`의 기관 페이지에서 에셋 링크를 한 번 누르고, 잠시 뒤 아래 리포트를 실행해 해당 월 합계가 1 이상인지 본다.

### `wrangler.toml`을 추가하지 않는 이유

같은 바인딩을 저장소의 Wrangler 설정 파일로도 줄 수 있지만 이 저장소에는 넣지 않았다. [Pages Functions › Configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)에 따르면 `pages_build_output_dir`가 있는 Wrangler 파일을 배포하면 그 파일이 프로젝트 설정의 source of truth가 되어 대시보드에서 같은 항목을 더는 수정할 수 없고, 대시보드 설정과 다르게 손으로 쓴 파일은 운영 설정을 바꿔 버린다(문서는 `wrangler pages download config`로 현재 설정을 내려받아 시작하라고 권한다). 이 프로젝트는 빌드 명령·환경 변수(`NODE_VERSION`, `SITE_ORIGIN`, `DDL_SEO_PUBLIC` 등)를 대시보드에서 관리하고 있어, 바인딩 하나 때문에 설정 방식을 바꾸지 않는다.

## 읽기 전용 토큰과 리포트

토큰 만들기([SQL API › Authentication](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/#authentication)):

1. 대시보드의 [API Tokens](https://dash.cloudflare.com/profile/api-tokens) 페이지에서 **Create Token** > **Create Custom Token**.
2. 이름을 정하고 **Permissions**를 *Account* | *Account Analytics* | *Read*로 한다. 다른 권한은 넣지 않는다.
3. 필요하면 계정 범위·IP 제한·만료(TTL)를 정하고 생성한 뒤 토큰 문자열을 보관한다.

계정 ID는 대시보드에 표시되는 32자 값이다.

```sh
# SQL만 출력한다. 네트워크 요청과 자격 증명이 필요 없다.
node scripts/outbound-report.mjs --dry-run

# 최근 3개월(이번 달 포함, 한국 시간 기준) JSON
CF_ACCOUNT_ID=<32자 계정 ID> CF_API_TOKEN=<토큰> node scripts/outbound-report.mjs

# 한 달을 정해 보관용으로 저장 (data/research/는 Git에 올라가지 않는다)
mkdir -p data/research/outbound
CF_ACCOUNT_ID=… CF_API_TOKEN=… node scripts/outbound-report.mjs --from 2026-11 --to 2026-11 > data/research/outbound/2026-11.json
CF_ACCOUNT_ID=… CF_API_TOKEN=… node scripts/outbound-report.mjs --from 2026-11 --to 2026-11 --format csv > data/research/outbound/2026-11.csv
```

- 자격 증명은 환경 변수로만 받는다. 스크립트는 `.env`를 읽지 않고, 값을 파일에 쓰거나 출력하지 않으며, 오류 메시지에서도 가린다. 셸 기록에 남기지 않으려면 `read -s CF_API_TOKEN && export CF_API_TOKEN`처럼 입력한다.
- 자격 증명이 없으면 `--dry-run`처럼 SQL만 출력하고 종료 코드 1로 끝난다.
- 1회 실행에 조회 2건이다. `byKind`는 전체 기관의 월별·링크 종류별 합계, `byClinic`은 치과병원(`data/clinics.json`의 `typeCode` 41) 기관별 월별·링크 종류별 합계다.
- JSON의 `hospitals.rows`에는 클릭이 0건인 치과병원도 들어간다. CSV는 월별 `site` 행 다음에 기관·월별 `hospital` 행이 온다(UTF-8 BOM).
- 월 경계는 `Asia/Seoul` 기준이다.
- 합계는 `COUNT()`가 아니라 `SUM(_sample_interval)`이다. Analytics Engine은 한 인덱스에 기록이 몰리면 샘플링하고, 문서가 이 방식으로 세라고 정한다([SQL API › Sampling](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/#sampling)). 인덱스를 기관 ID로 두어 기관별 합계가 가장 정확하게 나오도록 했다.

## 한도와 보존 (문서 기준)

- 보존 기간은 3개월이다([Limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/)). 그 뒤에는 조회할 수 없으므로 매달 리포트를 저장해 둔다.
- Workers Free: 하루 데이터 포인트 100,000건 기록, 조회 10,000건 포함. 문서는 현재 Analytics Engine 사용량을 청구하지 않는다고 적고 있다([Pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)).
- `writeDataPoint` 1회에 blob 20개·double 20개·index 1개(96바이트 이하), blob 합계 16KB, 요청 1건당 250회까지다. 이 기능은 요청당 1회, blob 3개를 쓴다.
- 클릭 1건은 Pages Functions 요청 1건이다. 무료 플랜의 하루 100,000건 한도를 기관 상세 페이지 요청과 함께 쓴다([Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)). `_routes.json`의 include에 `/e/*`가 추가됐다.
- 무료 플랜의 CPU 한도는 요청당 10ms다([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). 이 경로는 묶음 JSON을 읽지 않고 512바이트 이하 본문 하나만 파싱한다.

## 수치를 읽을 때의 한계

- 클릭은 링크를 누른 횟수다. 통화 연결, 예약 완료, 내원을 뜻하지 않는다.
- 덜 세는 경우: 가운데 버튼이나 ‘새 탭에서 열기’ 메뉴로 연 경우(`click` 이벤트가 없다), 자바스크립트를 끈 브라우저, 비콘을 막는 확장 프로그램, 하루 Functions 한도를 넘긴 뒤의 요청.
- 더 세는 경우: 같은 사람의 반복 클릭. 식별자를 저장하지 않으므로 나중에 중복을 걸러 낼 수 없다.
- 봇: 같은 출처 표시가 없는 요청은 세지 않는다. 실제 브라우저를 조종하는 자동화는 구분하지 못한다. User-Agent를 읽지 않으므로 그것으로 걸러 내지도 않는다.
- 조작 가능성: 헤더는 브라우저가 아닌 클라이언트가 꾸밀 수 있으므로, 형식이 맞는 이벤트를 누군가 일부러 보내면 집계된다. 요청 수 제한은 코드에 없다. 기관에 수치를 보여 줄 때는 이 점을 감안한 참고치로 쓴다.

## 로컬에서

- `npm run preview`와 `npm run dev`(`scripts/server.mjs`)는 `POST /e/outbound`에 204로 답하고 본문을 읽지 않고 버린다. 아무것도 저장하지 않는다.
- `npx wrangler pages dev .cloudflare-dist`에서는 바인딩이 없으므로 검증 후 버리는 경로가 실행된다. 문서는 Analytics Engine 바인딩을 로컬에서 쓸 수 없다고 적고 있다.
- 과거 ZIP을 여는 `scripts/serve-archive.mjs`는 바꾸지 않았다. 거기서는 비콘이 405를 받지만 화면 동작에는 영향이 없다.

## 문서로 확인하지 못한 것

- Analytics Engine을 한 번도 쓰지 않은 계정에서 별도의 사용 설정 단계가 필요한지. 위 문서들에는 그런 단계가 없다. 바인딩 저장이나 배포에서 Analytics Engine을 켜라는 안내가 나오면 그 안내를 따른 뒤 다시 배포한다.
- Bindings 화면에서 Production/Preview를 고르는 위치. 문서의 Analytics Engine 절에는 환경 선택 단계가 없고, 다른 바인딩 절에는 있다.
- ‘다시 배포’의 화면상 이름(예: 배포 목록의 재시도 버튼). 새 커밋을 `main`에 푸시해도 새 배포가 만들어진다.
- 기록 후 SQL API에서 보이기까지 걸리는 시간. 문서에 수치가 없다.
- 리포트 SQL을 실제 SQL API에서 실행해 보지 않았다. `formatDateTime(timestamp, '%Y-%m', 'Asia/Seoul')`, `toDateTime('…', 'Asia/Seoul')`, `IN (…)`, `SUM(_sample_interval)`, `FORMAT JSON`은 모두 [SQL Reference](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/)에 있는 문법이지만, 조합한 문장의 동작과 치과병원 ID 248개를 넣은 문장 길이(약 5KB)의 허용 여부는 첫 실행에서 확인해야 한다.
- 데이터가 한 건도 없어 테이블이 아직 없을 때 SQL API가 어떤 오류를 주는지. 스크립트는 200이 아닌 응답을 상태 코드와 본문 앞부분으로 보여 주고 종료 코드 1로 끝난다.
- 하루 Functions 한도를 넘겨 fail open 상태가 됐을 때 `POST /e/outbound`가 받는 응답. 어떤 응답이든 브라우저는 무시한다.
- 실제 Cloudflare 런타임에서의 실행. 생성된 `_worker.js`의 fetch 핸들러를 Node에서 모의 `env`로 실행해 검증했고, 비콘은 로컬 미리보기 서버와 headless Chrome으로 확인했다(`Origin`·`Sec-Fetch-Site: same-origin`이 붙은 `text/plain` POST 1건, 쿠키 없음).

## 공식 근거 (2026-11-26 확인)

- [Workers Analytics Engine › Get started](https://developers.cloudflare.com/analytics/analytics-engine/get-started/): 바인딩, `writeDataPoint({blobs, doubles, indexes})`, 데이터셋 자동 생성, index는 1개만.
- [Limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/): 필드 수·크기 한도, 3개월 보존.
- [Pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/): Workers Free 포함량, 현재 미청구.
- [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/): 엔드포인트 `https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql`, Bearer 토큰, 본문에 SQL을 넣는 POST, 표 구조, 샘플링 보정.
- [SQL Reference › Statements](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/statements/): `FORMAT JSON` 응답 `{"meta": […], "data": […], "rows": n}`.
- [Sampling with WAE](https://developers.cloudflare.com/analytics/analytics-engine/sampling/): `_sample_interval`, 인덱스 선택.
- [Pages Functions › Bindings](https://developers.cloudflare.com/pages/functions/bindings/#analytics-engine): 대시보드 절차, 로컬 사용 불가.
- [Pages Functions › Configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/): Wrangler 파일이 source of truth가 되는 조건과 결과.
- [Pages Functions › Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/), [Routing](https://developers.cloudflare.com/pages/functions/routing/): `_worker.js`의 `env`, `_routes.json`.
