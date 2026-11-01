# GitHub → Cloudflare Pages 배포

## 계정 연결

GitHub 저장소를 Cloudflare Pages의 Git integration으로 연결한다. GitHub App 설치 시 필요한 저장소만 선택한다.

- Production branch: `main`
- Framework preset: `None`
- Build command: `npm run build:cloudflare`
- Build output directory: `.cloudflare-dist`
- Node.js: 22 (`NODE_VERSION=22`)
- Root directory: 저장소 루트

기본 배포는 검색엔진 `noindex`가 붙는 검토본이다. 공개 운영자·정정 접수·개인정보 고지 검토 전까지 `DDL_PRODUCTION`과 `DDL_LAUNCH_REVIEWED`는 설정하지 않는다. `noindex`는 접근 제한이 아니므로 배포 URL은 외부에서 열 수 있다.

## 무료 Pages에 맞춘 출력

`npm run build:cloudflare`는 기본 정적 빌드를 별도 폴더에 만든 뒤 기관 상세 HTML과 기관 JSON을 ID 앞 3자리별로 묶는다. Pages Advanced Worker가 기존 `/clinics/c-…/`와 `/data/clinic-assets/records/c-….json` URL에서 원문을 반환한다. 모든 기관과 기존 앵커를 유지한다. 전체 inventory 다운로드는 gzip 압축 파일로 제공한다.

2026-11-01 검증: 19,681개 기관 HTML/기관 JSON 보존, 총 9,417파일, 최대 파일 약13.55MiB. 빌드할 때마다 파일20,000개 및 단일25MiB 제한을 검사한다. 상세 페이지·기관 JSON은 Pages Functions 동적 요청 할당량을 사용한다.

- 제한: https://developers.cloudflare.com/pages/platform/limits/
- Git 연결: https://developers.cloudflare.com/pages/get-started/git-integration/
- Functions 비용: https://developers.cloudflare.com/pages/functions/pricing/

## 검증과 로컬 미리보기

```sh
npm run build:cloudflare
npm run test:unit
npx wrangler pages dev .cloudflare-dist
```

일반 `npm run preview`는 기본 `dist`용이며 compact 출력의 Worker 실행을 지원하지 않는다. 실제 배포 후 홈페이지, 치과 검색, 기관 상세와 마케팅 에셋, 기관별 JSON 및 전체 압축 다운로드를 확인한다.

## 업로드 범위

코드, 정규화한 공개 기관 데이터, 빌드에 필요한 조사 JSON을 Git에 저장한다. 원본 대화, ZIP/인수인계, 원본 HTML·스크린샷, CLI 실행 기록, 수집 루프 상태, 환경변수 및 빌드 결과는 제외한다. 로컬 수집 결과가 GitHub/Cloudflare에 자동 반영되지는 않으며, 검토한 데이터 변경을 커밋·푸시하면 다시 배포한다.
