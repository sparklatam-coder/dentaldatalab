# 성장 점검: 매달 같은 방법으로 재는 절차

단계별 계획의 “넘어가는 기준”과 AI 인용 여부를 매달 같은 질문·같은 표본으로 기록한다. 기록하는 방법은 둘이다.

- **자동**(기본): 이 Mac에서 `scripts/growth-monitor-run.sh`가 `scripts/growth-observe.mjs`를 돌려 결과 페이지를 열고 정해진 규칙으로 칸을 채운다. 규칙·조건·한계는 [7. 자동 실행](#7-자동-실행)에 있다.
- **수동**: 자동으로 잴 수 없는 칸(콘솔 수치, 막힌 엔진)은 사람이 1–4절의 절차대로 보고 적는다.

`scripts/growth-monitor.mjs`는 빈 파일 생성·검사·요약만 한다. 어느 쪽으로 적었든 같은 검사를 통과해야 한다.

- 고정 정의: `data/content/growth-monitor.json` — AI 질문 20개, 기관명 표본 30곳, 엔진, 단계 기준, 멈춤 규칙. **질문 문장과 표본은 바꾸지 않는다.**
- 월별 기록: `data/content/growth-observations/YYYY-MM.json` — 한 달에 한 파일.
- 원칙: 재지 않은 칸은 `null`로 둔다. `false`, `0`, `"not_in_top10"`은 실제로 보고 확인한 값일 때만 쓴다.
- 기관명 표본은 검색할 이름의 목록일 뿐이다. 기관을 평가하거나 순위를 매기지 않는다.

## 1. 시작

```sh
node scripts/growth-monitor.mjs --template 2026-12   # 이미 있으면 덮어쓰지 않고 멈춘다
```

파일의 `observedOn`(관찰한 날, 그 달 안의 날짜), `observer`(관찰자), `conditions`(엔진별 조건)를 먼저 채운다. `conditions` 예: `"로그아웃 · 시크릿 창 · 데스크톱 Chrome · 한국어 · 서울"`. 칸을 하나라도 채운 엔진은 조건이 없으면 검사에서 거절된다.

공통 조건:

- 가능하면 **로그아웃한 시크릿 창**에서, 한국어 화면으로 본다. 로그인해야만 쓸 수 있으면 그 사실을 `conditions`에 적는다.
- 질문과 기관명은 월 파일의 `question`·`name`을 **그대로 복사해** 넣는다. 따옴표·지역명·덧붙이는 말을 넣지 않는다.
- 질문마다 한 번만 묻고 처음 나온 결과를 적는다. 마음에 드는 답이 나올 때까지 다시 묻지 않는다.
- 로그인 요구·보안문자·오류로 결과를 보지 못한 칸은 `null`로 두고 `notes`에 이유를 적는다.

## 2. AI 인용 (질문 20개 × 엔진 3개)

칸 형식:

```json
{ "answerShown": true, "cited": true, "citedUrls": ["https://dentaldatalab.com/hospitals/"], "otherDomains": ["dailydental.co.kr"], "note": null }
```

- `answerShown`: AI가 만든 답이 화면에 나왔는가. 엔진이 정상 동작했는데 AI 답 영역이 없으면 `false`(이때 `cited`는 `false`, 두 목록은 빈 배열).
- `cited`: **AI 답 영역 안**에 dentaldatalab.com으로 가는 링크가 보이거나, 답 본문·출처 목록이 “치과데이터랩”(dentaldatalab)을 출처로 이름을 들어 말하면 `true`. AI 답 아래의 일반 검색 결과에 사이트가 나온 것은 인용이 아니다.
- `citedUrls`: 인용된 dentaldatalab.com 주소. `?utm_source=…` 같은 쿼리와 `#…` 뒤는 떼고 `https://dentaldatalab.com/…` 형태로 적는다. 링크 없이 이름만 나왔으면 빈 배열로 두고 `note`에 어떻게 언급됐는지 적는다.
- `otherDomains`: 같은 AI 답이 출처로 단 **다른 사이트의 호스트명**. 소문자, `https://`·경로·맨 앞 `www.` 없이(예: `blog.naver.com`). 출처 목록을 펼쳐 전부 적는다.

엔진별 절차:

| 엔진 (`cells` 키) | 여는 곳 | 질문 넣는 곳 | AI 답이 나왔는지 | 출처 보는 법 |
|---|---|---|---|---|
| ChatGPT 검색 (`chatgpt`) | https://chatgpt.com/ · 질문마다 새 채팅(가능하면 임시 채팅), 검색 기능 켜기 | 채팅 입력창 | 답 글이 생성되면 `true`. 검색 없이 답했으면 `note`에 “검색 없이 답함” | 답의 링크 표시와 ‘출처’ 버튼을 눌러 나오는 목록 |
| 구글 AI 개요 (`googleAiOverview`) | https://www.google.com/ (한국어) | 검색창 | 결과 맨 위에 ‘AI 개요’ 영역이 있으면 `true`. 10초쯤 기다려도 없으면 `false`. ‘AI 모드’ 탭은 쓰지 않는다 | ‘AI 개요 더보기’로 펼친 뒤 영역 안의 출처 링크 |
| 네이버 AI 브리핑 (`naverAiBriefing`) | https://www.naver.com/ | 검색창 | 통합검색 결과에 ‘AI 브리핑’ 영역이 있으면 `true`, 없으면 `false` | 영역 안의 출처 링크·출처 카드 |

## 3. 기관명 검색 (치과병원 30곳 × 엔진 2개)

칸 형식: `{ "rank": 3, "url": "https://dentaldatalab.com/clinics/c-000029b3fb02/" }` 또는 `{ "rank": "not_in_top10", "url": null }`.

1. 월 파일의 `name`을 그대로 검색한다.
2. 위에서부터 **일반 웹 검색 결과만** 센다. 광고(스폰서·파워링크), 지도·플레이스 묶음, AI 답 영역, 관련 질문, 이미지·동영상·뉴스 묶음, 오른쪽 정보 패널은 세지 않는다.
3. 처음 10개 안에 dentaldatalab.com 결과가 있으면 가장 위에 있는 것의 순위(1–10)와 주소를 적는다. 기관 페이지가 아니라 목록 페이지여도 적는다. 없으면 `not_in_top10`.

- 구글(`google`): 검색 결과 **첫 페이지**의 웹 검색결과(제목 링크가 있는 결과). 첫 페이지에 10개가 안 되면 있는 만큼만 세고, 2페이지는 열지 않는다.
- 네이버(`naver`): **통합검색**(`https://search.naver.com/search.naver?query=기관명`) 본문에 이어지는 결과 카드(웹문서·블로그·카페·지식iN이 한 줄로 섞여 나온다)를 위에서부터 10개 센다. 파워링크 광고, 플레이스(지도) 묶음, AI 브리핑, 이미지·클립·연관 검색어 묶음은 세지 않는다. 예전의 ‘웹문서 보기’(`where=web`)는 2026-11 현재 따로 된 목록을 주지 않아 쓰지 않는다.
- 이름이 같은 기관이 여럿인 표본(정의 파일의 `sameNameCount`가 2 이상)도 같은 방법으로 적는다. 요약은 “10위 안”과 “그중 해당 기관 페이지(`/clinics/<id>/`)”를 따로 센다.

## 4. 기준 입력값 (`gateInputs`)

| 키 | 읽는 곳 | 적는 값 |
|---|---|---|
| `bingSiteResults` | Bing에서 `site:dentaldatalab.com` 검색 | 표시된 결과 수. 결과가 없으면 `0`. 개수 표시 없이 결과만 보이면 첫 화면의 결과 수를 세고 `notes`에 적는다 |
| `naverCollectedPages` | 네이버 서치어드바이저 > 웹마스터 도구 > 리포트 > 수집 현황 (계정 로그인 필요) | 화면의 수집 페이지 수. 일별·누적 중 무엇을 적었는지 `notes`에 남긴다 |
| `referringDomains` | Google Search Console > 링크 > 상위 링크 사이트, Bing Webmaster Tools > 백링크 > 참조 도메인 | 두 숫자 중 큰 값(합집합의 하한). `dentaldatalab.pages.dev` 등 자기 도메인은 뺀다. 두 숫자는 `notes`에 |
| `handoffClicks` | `scripts/outbound-report.mjs`의 월 합계 (스크립트가 생긴 뒤) | 그 달이 끝난 뒤 **그 달 파일**에 채운다. 그 전에는 `null` |

콘솔에 로그인할 수 없으면 `null`로 둔다.

## 5. 검사와 요약

```sh
node scripts/growth-monitor.mjs --validate            # 전체 월 파일 검사 (파일 하나만: --validate <파일>)
node scripts/growth-monitor.mjs --summary --text      # 표로 보기 (--json 은 JSON만, 옵션 없으면 둘 다)
node scripts/growth-monitor.mjs --check --manifest dist/build-manifest.json   # 기대 페이지·표본 기관이 아직 있는지
```

검사를 통과한 뒤 월 파일을 커밋한다. `--check`는 전체 빌드(`npm run build`)의 `build-manifest.json`이 있어야 경로를 확인하며, 없으면 `not_checked`로 표시한다. 분기 자료가 바뀌어 표본 기관이 없어지거나 이름이 바뀌어도 표본은 그대로 두고 `notes`에 적는다. 표본이나 질문을 바꿔야 하면 `definitionVersion`을 올리고 새 기록으로 시작한다.

요약이 계산하는 것:

- **AI 인용률** = 인용된 칸 ÷ 측정한 칸(엔진별). 재지 않은 칸은 분모에 넣지 않는다.
- **기관명 10위 안 비율** = 10위 안에 든 기관 ÷ 측정한 기관(엔진별).
- **단계 기준**은 `충족 / 미달 / 측정 안 됨` 세 가지다. 필요한 값이 `null`이면 미달이 아니라 측정 안 됨이다.

| 단계 | 넘어가는 기준 | 판정 |
|---|---|---|
| 0 색인 기반 | Bing `site:` 결과가 생김, 네이버 수집 페이지 1,000개 이상 | `bingSiteResults ≥ 1` 그리고 `naverCollectedPages ≥ 1000` |
| 1 정본화 | 치과병원 기관명 검색에서 10위 안 비율 30% 이상 | 구글과 네이버 **각각** 30곳을 모두 측정했고 10위 안이 30% 이상(9곳 이상) |
| 2 링크 엔진 | 링크해 주는 외부 도메인 20개 이상 | `referringDomains ≥ 20` |
| 3 환자 유입 | 병원으로 가는 클릭이 매달 늘어남 | 이번 달 `handoffClicks` > 바로 전달 값 (두 달 모두 값이 있어야 판정) |

- **현재 단계**는 가장 최근에 측정한 결과가 충족이 아닌 첫 단계다.
- **멈춤 규칙**: “한 단계가 두 달 넘게 기준에 못 미치면 다음으로 넘어가지 말고 원인부터 고칩니다.” 현재 단계가 측정한 달 기준으로 **3개월 연속 미달**이면 `적용`으로 표시한다. 충족한 달이 나오면 연속이 끊긴다. 측정하지 않은 달은 미달로 세지도, 연속을 끊지도 않는다.

## 6. 읽을 때 주의

- AI 답은 같은 질문이라도 시점·계정·기기·위치에 따라 달라진다. 이 기록은 **그 날짜, 그 조건에서 한 번 본 관찰**이며 인용이나 순위를 보증하지 않는다.
- 표본 30곳의 비율은 치과병원 248곳 전체의 추정치가 아니라 고정 표본의 추이를 보기 위한 값이다.
- `site:` 검색 결과 수는 색인 수가 아니다. “결과가 생겼는가”만 본다.

## 7. 자동 실행

`scripts/growth-observe.mjs`가 Aside 브라우저(`aside` CLI)로 결과 페이지를 열어 월 파일의 빈 칸을 채운다. LLM은 쓰지 않는다. 페이지에서 읽은 구조에 고정된 규칙을 적용하므로 같은 페이지에서는 같은 값이 나온다.

### 무엇이 도는가

`scripts/growth-monitor-run.sh`는 매일 돌려도 되는 실행기다(bash·git·node만 필요).

1. 자기가 들어 있는 저장소로 이동하고 `git pull --ff-only`를 시도한다. 여기서 만든 월 파일 커밋은 push하지 않으므로 origin이 움직이면 fast-forward가 안 되는데, 그때는 작업 폴더가 깨끗할 때에 한해 `git pull --rebase`로 그 커밋을 origin 위에 다시 올린다. 충돌하면 그만두고 원래 상태로 계속한다.
2. 이번 달 파일의 모든 칸이 채워져 있으면 **아무것도 하지 않고 끝난다**(탭도 열지 않는다).
3. 아니면 관찰기를 돌려 **빈 칸만** 채우고, `--validate`로 검사하고, 요약을 `data/research/growth-monitor/summary-YYYY-MM.txt`에, 실행 기록을 `run-YYYY-MM.log`에 쓴다.
4. 새로 기록된 칸이 있으면 **그 달 파일 하나만** 로컬 커밋한다. push는 하지 않는다. 검사에 실패하면 커밋하지 않는다.
5. macOS 알림 한 줄을 띄운다(예: `2026-11 AI 인용 0/40칸 (측정 40/60) · 기관명 10위 안 0/60 (측정 60/60) · 남음: ChatGPT 검색 0/20(막힘)`). 새로 기록된 것이 없으면 알림도 없다.

환경 변수: `NODE_BIN`, `ASIDE_BIN`(실행 파일 위치), `GROWTH_NOTIFY=0`(알림 끔), `GROWTH_SKIP_PULL=1`(pull 생략). LaunchAgent 등록은 이 저장소가 하지 않는다.

### 이 Mac의 설치 (2026-11-26)

- 실행용 복제본: `~/Library/Application Support/DentalDataLab/growth-monitor/` (GitHub에서 받은 별도 복제본). launchd가 띄운 프로세스는 외장 SSD(`/Volumes/M6_SSD`)에서 git을 쓸 수 없어(`Operation not permitted`) 내장 디스크에 둔다.
- LaunchAgent: `~/Library/LaunchAgents/com.dentaldatalab.growth-monitor.plist`, 매일 09:10에 `scripts/growth-monitor-run.sh`를 실행한다. 그 시각에 Mac이 잠들어 있었으면 깨어난 뒤 한 번 돈다. Aside 브라우저가 떠 있어야 한다.
- 월 파일 커밋은 복제본에만 쌓인다. 저장소에 반영하려면 사람이 확인한 뒤 복제본에서 `git push` 하거나, 작업 저장소에서 `git pull "$HOME/Library/Application Support/DentalDataLab/growth-monitor" main`으로 가져온다.
- 끄기: `launchctl bootout gui/$(id -u)/com.dentaldatalab.growth-monitor`. 다시 켜기: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dentaldatalab.growth-monitor.plist`. 지금 한 번 돌리기: `launchctl kickstart gui/$(id -u)/com.dentaldatalab.growth-monitor`.
- 로그: 복제본의 `data/research/growth-monitor/run-YYYY-MM.log`, `summary-YYYY-MM.txt`, `launchd.*.log`.

손으로 돌릴 때:

```sh
node scripts/growth-observe.mjs --month 2026-12 --dry-run     # 열 주소만 세어 본다(브라우저를 열지 않는다)
node scripts/growth-observe.mjs --month 2026-12               # 빈 칸 전부
node scripts/growth-observe.mjs --month 2026-12 --kind name --engine naver --limit 5
node scripts/growth-observe.mjs --month 2026-12 --engine googleAiOverview --id q05 --redo   # 한 칸 다시
```

- 이미 적힌 칸(`false`, `0`, `not_in_top10` 포함)은 건너뛴다. `--redo`를 줘야 다시 재고 덮어쓴다.
- `--kind ai|name|gate`, `--engine <엔진 id 또는 bing>`, `--id <줄 id>[,…]`, `--limit N`(엔진마다 N칸)으로 범위를 좁힌다.
- 칸 하나를 적을 때마다 월 파일을 검사한 뒤 원자적으로 다시 쓴다. 중간에 멈춰도 그때까지의 칸은 남고, 다시 돌리면 이어서 한다.
- 그 달이 아닌 월 파일은 채우지 않는다(지난달을 오늘 본 결과로 채우지 않기 위해).

### 조건 (월 파일 `conditions`에 엔진별로 자동 기록)

- **운영자의 평소 Aside 창**에서 돈다. `aside`는 시크릿 창을 열 수 없으므로 1절의 “로그아웃한 시크릿 창” 조건과 다르다. 2026-11 기준선에서는 구글·네이버 모두 로그인 상태였다. 로그인 여부(예/아니오)만 적고 계정 이름·메일은 어디에도 남기지 않는다. 구글은 `pws=0`(개인화 끔)·`hl=ko`·`gl=kr`로 연다.
- 한 달 안에서 로그인 상태가 바뀐 채 이어서 재면 `run.warnings`에 `conditions_changed`가 남는다. 처음 적힌 조건 문구는 덮어쓰지 않는다.
- **ChatGPT는 임시 채팅으로만** 묻는다(`temporary-chat=true`, 대화 기록에 남지 않음. 메모리·사용자 지정 지침은 참조될 수 있다). 화면에서 임시 채팅 표시를 확인하지 못하면 질문을 보내지 않는다.
- 여는 주소는 네 곳뿐이다: `www.google.com/search`, `search.naver.com/search.naver`, `chatgpt.com/`, `www.bing.com/search`. 다른 탭은 보지도 붙지도 않고, 연 탭은 반드시 닫는다.
- **클릭·입력·로그인·결과 링크 따라가기를 하지 않는다.** 읽기만 한다.
- 같은 사이트에는 한 번에 한 요청, 요청 사이 8–15초(무작위). 한 번 실행은 20분 안팎이다.
- **구글은 한 번 실행에 25쪽까지만 연다**(`RUN_PAGE_BUDGET`). 2026-11-26 기준선에서 8–15초 간격으로 이어 보낸 42번째 구글 요청에 비정상 트래픽 확인 화면(`/sorry/`)이 나왔기 때문이다. 그래서 구글 50칸(AI 20 + 기관명 30)은 하루에 끝나지 않는다. 첫날 AI 20칸과 기관명 5칸, 다음 날 나머지 25칸이 채워지고, 그동안 `구글 검색`은 `partial`로 남는다. 손으로 연달아 여러 번 돌려 이 한도를 피하지 않는다.
- 보안문자·비정상 트래픽 화면(`/sorry/`)이 나오면 그 사이트는 그 실행에서 멈추고 남은 칸은 `null`로 둔다. 다음 실행(다음 날)에 이어서 한다. 그 화면이 다시 나오면 한 쪽만 열고 또 멈춘다.

### 엔진별로 읽는 규칙

| 칸 | 읽는 곳 | 규칙 |
|---|---|---|
| `googleAiOverview` | 구글 첫 페이지의 제목이 ‘AI 개요’인 영역 | 영역이 있고 본문이 30자 이상이면 `answerShown: true`. 영역 안의 모든 링크(접힌 출처 목록 포함, 펼치는 클릭 없이 DOM에서 읽음) 가운데 dentaldatalab.com이 있으면 `cited`·`citedUrls`, 나머지는 호스트명으로 `otherDomains`. 구글 자신의 링크(도움말·정책·재검색)는 뺀다. 페이지 로드 후 최소 9초 기다린다 |
| `naverAiBriefing` | 네이버 통합검색의 ‘AI 브리핑’ 블록 | 위와 같다. 네이버 자체 화면 링크(도움말·Keep·재검색·신고)는 빼고, `blog.naver.com` 같은 콘텐츠 호스트는 출처로 센다. 최소 7.5초 기다린다 |
| `chatgpt` | 임시 채팅의 답 | 답이 끝나고 내용이 더 바뀌지 않을 때만 읽는다. 답 안의 링크로 판정한다. **2026-11 현재 재지 못한다**(아래) |
| `google` | 구글 첫 페이지 `#rso` 안의 제목(h3) 링크 | 광고·AI 개요 안의 링크는 뺀다. 위에서부터 최대 10개 중 dentaldatalab.com으로 가는 첫 결과의 순서 |
| `naver` | 통합검색 본문의 결과 카드 줄 | 3절의 규칙. 카드 안의 링크 중 하나라도 dentaldatalab.com이면 그 카드를 우리 결과로 본다 |
| `bingSiteResults` | Bing `site:dentaldatalab.com` | 결과 수 표시에 숫자가 하나이고, 화면에 나열된 결과가 그 수를 뒷받침할 때만 적는다. ‘결과 없음’ 화면이면 `0`. 그 밖에는 `null` |

- 링크 없이 이름(치과데이터랩·dentaldatalab)만 나오면 `cited: true`, `citedUrls: []`, `note`에 그 문장을 남긴다.
- 결과 목록도 AI 영역도 읽지 못한 페이지는 **기록하지 않는다**(`null`). “AI 답 없음”이나 `not_in_top10`으로 적지 않는다. 같은 엔진이 연달아 3번 읽지 못하면 그 엔진을 멈춘다.

### 재지 못하는 것

- **구글 기관명 검색 2026-11**: 30곳 중 21곳만 쟀다(위의 `/sorry/`). 남은 9곳은 `null`이며, 11월 안에 실행기가 다시 돌면 채워진다. 채워지지 않으면 11월의 구글 값은 21곳 기준이다.
- **ChatGPT**: 2026-11-26 현재 임시 채팅을 열면 “임시 채팅” 안내 창이 먼저 뜨고, ‘계속’을 눌러야 질문이 전송된다. 관찰기는 클릭하지 않으므로 ChatGPT 20칸은 `null`로 남고 `run.engineStatus.chatgpt`가 `blocked`가 된다. 막혀 있는 동안 그 달은 “빈 칸 있음”으로 남으므로, 실행기는 돌 때마다 질문 없는 임시 채팅 화면을 한 번 열어 확인만 하고(질문은 보내지 않는다) 달라진 것이 없으면 아무것도 쓰지 않는다. 운영자가 그 창을 한 번 닫아 다시 뜨지 않게 되면 다음 실행부터 시도한다. 다만 주소의 `?q=`가 임시 채팅에서 자동 전송되는지, 답을 읽는 규칙이 맞는지는 **실제 답으로 확인하지 못했다**. 처음 기록되는 달에는 증거 파일로 반드시 대조한다.
- `naverCollectedPages`, `referringDomains`, `handoffClicks`: 콘솔 로그인이 필요해 자동으로 채우지 않는다. 4절대로 사람이 적는다.
- 구글 2페이지 이후, 네이버 ‘더보기’ 뒤의 결과, AI 답을 펼쳐야만 내려받는 내용.
- 시점·계정·위치에 따른 차이. 한 달에 한 번, 한 조건에서 본 값이다.

### 실행 기록 (`run`)

관찰기가 월 파일 끝에 남기는 선택 항목이다. 손으로 적은 파일에는 없어도 된다.

```json
"run": {
  "tool": "scripts/growth-observe.mjs v1",
  "lastRunAt": "2026-11-25T18:25:00.000Z",
  "completedAt": null,
  "engineStatus": { "chatgpt": { "status": "blocked", "note": "임시 채팅 안내 창…" }, "google": { "status": "ok", "note": null } },
  "warnings": []
}
```

- `completedAt`은 AI 60칸과 기관명 60칸이 모두 채워졌을 때만 찍힌다(기준 입력값은 포함하지 않는다). 실행기는 이것이 아니라 “빈 칸이 없는가”로 그 달을 건너뛴다.
- `engineStatus`: `ok`(그 엔진의 칸이 모두 기록됨) · `partial`(남은 칸 있음) · `stopped`(차단 화면 또는 연속 실패로 멈춤) · `blocked`(조건을 확인하지 못해 시작하지 않음). 마지막 실행 기준이다.
- `warnings`: `extractor_may_be_stale`(한 엔진이 한 실행에서 잰 칸, 또는 그 달에 적힌 칸이 10칸 이상인데 전부 “AI 답 없음” — 화면 구조가 바뀌어 규칙이 낡았을 수 있다. 칸은 그대로 기록하되 0으로 조용히 넘어가지 않게 표시한다), `few_results_parsed`(기관명 검색 10건 이상에서 읽은 결과가 평균 5개 미만), `conditions_changed`. 경고는 `--validate`와 `--summary`에 그대로 나온다. 경고가 있으면 그 엔진의 값을 믿기 전에 증거 파일을 본다.

### 증거 보기와 한 칸 다시 재기

질의 하나마다 정리된 화면 내용이 `data/research/growth-monitor/<YYYY-MM>/<엔진>/<id>.txt`에 남는다(`.gitignore` 대상, 커밋하지 않는다). 파일에는 질의·주소·관찰 시각·기록된 칸, AI 영역의 본문과 링크 목록, 순서대로 번호를 붙인 결과 목록, 화면 스냅샷이 들어 있다. 스냅샷은 **본문(main) 영역만** 찍는다. 프로필·메일·알림 링크가 있는 머리글과 위치가 나오는 바닥글은 찍지 않는다. 그래도 남을 수 있는 메일 주소, ‘계정’·‘내정보’ 표시가 든 줄, 위치 표시 줄은 저장 전에 지운다.

```sh
less data/research/growth-monitor/2026-11/googleAiOverview/q05.txt   # recorded: 줄과 아래 내용을 대조
node scripts/growth-observe.mjs --month 2026-11 --engine googleAiOverview --id q05 --redo
```

칸이 화면과 다르면 손으로 고치지 말고 규칙(`scripts/growth-observe.mjs`의 `pageGoogle`·`pageNaver`·`buildAiCell`·`buildNameCell`)을 고치고 `test/growth-observe.test.mjs`에 그 경우를 더한 뒤 `--redo`로 다시 잰다. 다시 잰 값은 그 시각의 화면이므로 처음 값과 다를 수 있다. “마음에 드는 답이 나올 때까지 다시 묻지 않는다”는 1절의 원칙은 자동 실행에도 그대로다. `--redo`는 규칙을 고쳤을 때만 쓴다.

## 배경: 이 기록을 만들기 전에 보고된 관찰

아래는 2026-11에 운영자가 따로 본 내용이며, 위 절차로 잰 값이 아니므로 월 파일에는 넣지 않았다.

- 구글에서 ‘치과 데이터’를 검색했을 때 AI 개요가 치과데이터랩을 언급했다.
- 구글 AI 답이 ‘전국 치과 수’에 대해 치의신보를 인용했다.
- 네이버 AI 브리핑이 한 치과병원의 자체 소개 글을 인용했다.
- Bing `site:dentaldatalab.com` 결과는 0건이었다.
- “양주시 일요일 진료 치과병원” 같은 조건 검색어에는 my-doctor.io가 노출되고 있었다.
