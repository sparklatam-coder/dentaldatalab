# 검색 노출 기술 정책

## 빌드 선택

기본 빌드는 전체 `noindex,nofollow` 검토본이다. 공공정보 검색 노출은 아래 환경변수로 별도 활성화한다.

```sh
DDL_SEO_PUBLIC=1 SITE_ORIGIN=https://dentaldatalab.com npm run build:cloudflare
```

`DDL_SEO_PUBLIC`은 전면 서비스 출시 완료를 뜻하지 않는다. `DDL_PRODUCTION=1`의 기존 `DDL_LAUNCH_REVIEWED=YES` 검사는 그대로 유지한다. 운영자·정정 채널의 준비 상태와 수집 한계도 계속 표시한다. 질문 100개는 의료진 검토 전 초안으로 남는다.

## 공개 범위

홈, 치과 상세, 지역 목록, 공공데이터 리포트, 출처·데이터, 처리 기준, 정보 읽기 가이드, 서비스 소개, 에셋 목록과 검색 출처 설명에 `index,follow`를 적용한다.

치료 질문 초안, 검색 도구, 비교함, 정정 메모, 내부 검증 현황, 개인정보 안내와 오류 문서는 `noindex,follow`로 유지하고 공개 sitemap에서 제외한다. 기관별 JSON, HTML 묶음과 다운로드 근거 자료에는 HTTP `X-Robots-Tag: noindex, nofollow`도 적용한다. 서버에서 원래 HTML을 응답하므로 검색 로봇이 상세 내용을 읽기 위해 JavaScript를 실행할 필요가 없다.

공개 모드 robots.txt는 HTML 수집을 허용한다. `noindex` 문서를 robots.txt로 함께 차단하면 검색 로봇이 해당 지시를 읽지 못하므로, 의료 초안 등을 robots.txt에서 차단하지 않는다. 내부 HTML 묶음 경로만 수집 제외한다.

## 대표 주소와 구조화 데이터

`SITE_ORIGIN`은 경로·인증정보·query·fragment 없는 HTTPS origin만 받는다. canonical, Open Graph URL, sitemap과 구조화 데이터가 같은 origin을 사용한다. 별도 호스트(pages.dev, www 등)의 실제 대표 도메인 이동은 호스팅에서 설정하고 HTTP 응답으로 검증해야 한다.

`DDL_SEO_PUBLIC=1`인 compact 빌드는 primary `dentaldatalab.pages.dev`의 동적 상세 URL을 대표 도메인으로 301 이동한다. 경로와 query를 유지하며, preview hash/branch 호스트는 이동시키지 않는다. 프로젝트명이 다르면 `DDL_PAGES_HOST`를 primary `project.pages.dev`로 지정한다. 정적 파일은 Pages `_headers`의 호스트별 규칙으로 primary 및 preview `pages.dev` 모두 noindex 처리한다. 동적 preview HTML도 HTTP noindex를 유지한다.

사이트 전체 primary `pages.dev` 301은 계정의 Bulk Redirects로 별도 설정한다. Pages `_redirects`의 source에는 도메인 수준 조건이 지원되지 않아 full URL source 규칙을 넣지 않는다. 전체 요청을 Worker로 보내지 않으므로 정적 페이지가 Functions 요청 한도를 사용하지 않는다. Bulk Redirects를 아직 연결하지 않은 정적 primary URL은 noindex와 대표 도메인 canonical로 중복 색인을 억제한다.

각 HTML은 WebSite 및 WebPage JSON-LD를 제공한다. 치과 상세는 WebPage의 `mainEntity`로 Dentist 등록정보를 가리킨다. Dentist의 `mainEntityOfPage`는 정보 페이지이며, 이 디렉터리 주소를 해당 치과의 공식 홈페이지 URL로 표시하지 않는다. 진료 성과, 후기 평점, 확인되지 않은 가격이나 영업시간을 구조화 데이터로 만들지 않는다.

sitemap에는 색인 대상의 대표 URL만 넣는다. 공식 자료 기준일이나 매 빌드 시각을 모든 문서의 수정일로 오인하지 않도록 `lastmod`는 생략한다. 실제 내용별 변경 이력을 관리하게 되면 그 날짜를 사용할 수 있다.

## 기존 목록·상세 콘텐츠 개선

기존 지역 경로와 기관 경로를 유지하면서 시도·시군구 첫 목록에 같은 분기 자료의 치과의원·치과병원 수, 치과전문의 1명 이상 등록 수, 유효한 시작·종료 시간쌍 수를 직접 집계한다. 전문의 미확인은 0명 등록과 구분하고, 자료 기준일·수록 범위·현재 운영 미확인을 함께 표시한다. 시간 유효성은 공공데이터 리포트의 `hasValidHours`와 같은 함수를 사용한다. 새로운 치료·동네 키워드용 대량 페이지는 만들지 않는다.

기관 제목은 기관명을 먼저 쓰고 원자료의 지역·읍면동으로 구분한다. 설명은 실제 주소, 형식이 확인되는 신고 전화, 전문의 등록 수 및 기준일을 사용한다. 전화 형식 확인은 현재 연결 여부의 검증을 뜻하지 않으며, 홈페이지·진료시간의 출처 구분을 유지한다. 확인되지 않은 평가·가격·시술 전문성·후기를 설명에 추가하지 않는다.

시군구 페이지의 설명은 해당 페이지에서 실제 표시하는 가나다순 범위와 첫·마지막 기관명으로 구분한다. 2페이지 이상은 시군구 첫 목록으로 연결하는 breadcrumb와 통계 링크를 제공한다. 페이지 이동은 실제 `href`가 있는 이전·다음·번호 링크로 만들고, 현재 페이지와 이동 목적을 접근성 이름으로 표시한다. 상세 페이지에도 해당 시군구·시도 및 원래 정보 섹션으로 향하는 내부 링크를 제공한다.

관련 근거는 [Google 제목 링크](https://developers.google.com/search/docs/appearance/title-link), [Google 설명 문구](https://developers.google.com/search/docs/appearance/snippet), [Google 크롤링 가능한 링크](https://developers.google.com/search/docs/crawling-indexing/links-crawlable), [네이버 사이트 제작 가이드](https://searchadvisor.naver.com/guide/seo-basic-create)다. 구체적이고 해당 문서 내용에 맞는 제목·설명, 실제 링크와 대표 주소를 적용하며 검색엔진의 노출 문구나 순위를 보장하지 않는다.

## 검증 및 한계

`test/seo.test.mjs`는 검토본/공개본 정책, 의료초안 제외, sitemap 일치, origin 유효성, compact Worker의 실제 HTML·JSON·404 응답 헤더를 검증한다. 공개 배포 후에는 최종 도메인의 robots.txt, sitemap.xml, HTTP 헤더, canonical, 개별 치과 페이지의 HTML 본문을 다시 확인해야 한다.

검색 수집 허용과 sitemap 제공은 색인·순위를 보장하지 않는다. Google Search Console 및 네이버 서치어드바이저의 소유 확인, sitemap 제출, 색인 보고서 조회는 해당 계정의 실제 상태로 확인한다. `site:` 검색만으로 전체 색인 수를 확정하지 않는다.

## 공식 근거

- [Google: noindex로 검색 색인 차단](https://developers.google.com/search/docs/crawling-indexing/block-indexing) — meta/HTTP 헤더로 색인을 제어하며, 지시를 읽을 수 있게 크롤링을 허용해야 한다.
- [Google: sitemap 생성·제출](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) — 대표 URL과 실제 변경일 사용 기준.
- [네이버: 선호 URL 및 로봇 메타 태그](https://searchadvisor.naver.com/guide/markup-structure) — 절대 canonical URL과 noindex/nofollow의 의미.
- [네이버: robots.txt 설정](https://searchadvisor.naver.com/guide/seo-basic-robots) — 루트 robots.txt, 응답 형식, 수집 허용 및 sitemap 안내.
- [Cloudflare: Pages redirects](https://developers.cloudflare.com/pages/configuration/redirects/) — domain-level source redirect 제한.
- [Cloudflare: pages.dev를 대표 도메인으로 이동](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/) — 계정 Bulk Redirects 방식.
- [Cloudflare: Pages headers](https://developers.cloudflare.com/pages/configuration/headers/) — primary/preview `pages.dev`별 noindex 패턴과 동적 응답은 Worker에서 헤더를 설정해야 하는 조건.


## 실제 연결 결과 (2026-11-01)

- dentaldatalab.com: Hostinger 등록 유지, Cloudflare NS 활성화 및 Pages apex CNAME 연결 완료.
- Cloudflare production 변수 `DDL_SEO_PUBLIC=1`; c91f3f8 배포에서 실제 robots 허용 및 sitemap 20,669 URL 확인.
- Google Search Console: 도메인 DNS TXT 소유확인 완료, https://dentaldatalab.com/sitemap.xml 접수 성공. 성과·색인은 데이터 처리 중으로 표시됨.
- Cloudflare Bulk Redirects: dentaldatalab_canonical 목록 + DentalDataLab canonical host 규칙 활성화. www.dentaldatalab.com 및 dentaldatalab.pages.dev에서 apex HTTPS로301, 하위경로·쿼리 보존. preview 하위도메인은 포함하지 않음. 실제 HTTP301 Location 확인.
- 초기 DNS 전파 중 outbound proxy가 이전 파킹 서버를 캐시할 수 있어 직접 HTTPS 접속과 권한 네임서버도 병행 확인했다.

## 검색 식별·공유 이미지 및 추가 등록 (2026-11-01)

사이트명·대체 이름과 브랜드 발행자 `Organization`을 `WebSite`에 연결하고, 실제 브랜드 로고·1200×630 공유 이미지·PNG 파비콘을 제공한다. 법인명·주소·검토자·연락처는 확인 없이 생성하지 않는다. 공유 이미지는 검색 순위 상승을 보장하는 수단이 아니라 링크를 공유할 때 사이트를 식별하는 자료다. 정적 `/assets/*`는 1시간 캐시하며 HTML·기관 Worker의 정책은 유지한다.

네이버 HTML 태그 소유확인은 `NAVER_SITE_VERIFICATION` 환경변수 또는 `data/content/site-verification.json`의 `naver` 문자열로 설정한다. 실제 공개 확인 코드만 허용하며 빈 값은 태그를 출력하지 않는다. 등록 페이지의 meta 태그에서 content 값만 사용한다. 코드 배포 후 네이버 콘솔에서 소유확인을 완료하고 sitemap을 제출해야 하며, 코드 준비 자체가 등록 완료를 뜻하지 않는다. 현재 브라우저 제어 연결 오류로 네이버 콘솔 조작은 진행하지 못했으며 다른 PC에서 공개 확인 태그를 전달받는 단계다.

Google sitemap은 처리 성공·발견 URL 20,669개로 확인했다. 홈페이지 실시간 검사에서 색인 가능 응답과 색인 요청 접수를 확인했다. Bing은 소유확인·sitemap 접수 후 처리 대기다. IndexNow는 선별한 7개 URL을 한 번 제출해 HTTP 202를 받았으며 실제 색인 결과와 구분한다. 매시간 Mac LaunchAgent와 GitHub Actions에서 robots·sitemap·canonical·HTTP 응답을 감시하지만 계정별 검색 성과나 순위까지 자동 확인하는 것은 아니다.

공식 근거: [Google 사이트 이름](https://developers.google.com/search/docs/appearance/site-names), [Organization 구조화 데이터](https://developers.google.com/search/docs/appearance/structured-data/organization), [유용한 콘텐츠](https://developers.google.com/search/docs/fundamentals/creating-helpful-content). 기술 설정만으로 순위를 보장하지 않으며, 향후 실제 Search Console 성과에 따라 유용한 원자료 분석·정보 갱신과 페이지 품질을 개선한다.
