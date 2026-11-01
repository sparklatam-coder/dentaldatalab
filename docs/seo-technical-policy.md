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
