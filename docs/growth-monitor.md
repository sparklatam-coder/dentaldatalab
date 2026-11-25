# 성장 점검: 매달 같은 방법으로 재는 절차

단계별 계획의 “넘어가는 기준”과 AI 인용 여부를 매달 같은 질문·같은 표본으로 기록한다. 검색엔진을 자동으로 긁지 않는다. 사람이(또는 브라우저를 쓰는 Claude 세션이) 아래 절차대로 보고 적으며, 스크립트는 빈 파일 생성·검사·요약만 한다.

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

- 구글(`google`): 검색 결과 첫 화면의 웹 검색결과.
- 네이버(`naver`): 통합검색은 여러 묶음이 섞여 순서를 하나로 셀 수 없으므로 **웹문서 보기**(`https://search.naver.com/search.naver?where=web&query=기관명`)의 목록으로 센다.
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

## 배경: 이 기록을 만들기 전에 보고된 관찰

아래는 2026-11에 운영자가 따로 본 내용이며, 위 절차로 잰 값이 아니므로 월 파일에는 넣지 않았다.

- 구글에서 ‘치과 데이터’를 검색했을 때 AI 개요가 치과데이터랩을 언급했다.
- 구글 AI 답이 ‘전국 치과 수’에 대해 치의신보를 인용했다.
- 네이버 AI 브리핑이 한 치과병원의 자체 소개 글을 인용했다.
- Bing `site:dentaldatalab.com` 결과는 0건이었다.
- “양주시 일요일 진료 치과병원” 같은 조건 검색어에는 my-doctor.io가 노출되고 있었다.
