# 데이터 품질 점검

이 점검은 `data/clinics.json`의 원본 무결성·누락·형식·중복 의심을 다룹니다. 현재 영업·폐업·이전·전화 연결·주소 실재 여부의 전수 검증이 아닙니다. 원본 파일과 수집 중인 `data/assets/national-web-auto.json`은 변경하지 않습니다.

## 재현과 통합

```sh
node scripts/data-quality.mjs
node scripts/data-quality.mjs --check
node --test test/data-quality.test.mjs
```

첫 명령은 현재 입력을 읽고 `data/content/data-quality-report.json`만 생성합니다. `--check`는 저장된 점검 시각을 유지하여 재계산한 전체 객체와 비교하고, 오래된 결과이면 실패합니다. 실행 시 네트워크에 접속하지 않습니다. 점검 시각은 실제 점검 실행 시에만 갱신하며 일반 사이트 빌드에서 새 점검을 했다고 표시하지 않습니다.

`scripts/build.mjs`는 이 작업에서 수정하지 않았습니다. 통합 계약은 다음과 같습니다.

```js
import {loadDataQuality} from './data-quality.mjs';
import {dataQualityHomePanel, registerDataQualityPage} from './data-quality-pages.mjs';

const stored = JSON.parse(fs.readFileSync(path.join(root, 'data/content/data-quality-report.json')));
const quality = loadDataQuality(root, {checkedAt: stored.checkedAt});
if (JSON.stringify(stored) !== JSON.stringify(quality)) throw new Error('품질 점검 결과 갱신 필요');
registerDataQualityPage({page, put, report: quality});
// 홈페이지와 /data/ 본문에 아래 패널을 삽입합니다.
const panel = dataQualityHomePanel(quality);
```

상세 페이지는 `/data/quality/`입니다. 기존 `page(route, options)`와 `put(relativePath, body)` 계약을 따릅니다. 별도 CSS 변경 없이 접근 가능한 `report-table-scroll` 영역과 `report-table`을 사용합니다. 요약·전체 검토 목록 다운로드는 `/data/quality/report.json`, `/data/quality/review-queue.json`입니다. 전체 기관 누락 목록을 HTML로 렌더링하지 않습니다.

## 검사 규칙

- 단일 번호 형식은 기존 전화 링크의 `singlePhone` 규칙을 사용합니다. 지역번호 생략, 여러 번호, 메모 등은 형식 검토 대상으로 남깁니다. 번호를 자동 보충하거나 전화 연결 실패로 판정하지 않습니다.
- 주소는 원문 존재·한글·제어 문자를 검사합니다. 우편번호는 5자리 형식, 좌표는 두 유한 숫자와 지구 좌표 범위를 검사합니다. 지오코딩·현행 행정구역 대조가 아닙니다.
- 같은 기관명과 전체 주소, 또는 같은 기관명과 단일 전화가 겹치는 서로 다른 ID를 중복 의심 대상으로 둡니다. 공백·대소문자만 정리하며 주소의 숫자·하이픈·층·호수·괄호를 지우지 않습니다. 같은 이름만으로 묶지 않습니다.
- 같은 행 묶음이 두 규칙에 걸려도 한 묶음으로 표시합니다. 공유 전화·주소 묶음은 참고값이며 중복 후보 수에 더하지 않습니다. 원본 ID를 병합·삭제하지 않습니다.
- 모든 비율의 분모는 전체 수록 행입니다. `recorded + missing = total`, `formatPass + formatReview = recorded`를 유지합니다. 여러 규칙의 행 수는 겹칠 수 있습니다.
- 인원수의 명시된 0은 알려진 값입니다. `null`, 장비 행 부재, 등록시간 미수록을 0 또는 휴진으로 바꾸지 않습니다.
- `sourceIds`가 명세에 연결되는지, 상세 값에 필요한 출처가 있는지, ID·종별이 정상인지, 명세 집계와 다시 계산한 값이 같은지 확인합니다.

## 원본 대조 범위

현재 가공 파일의 SHA-256은 `22ca2821563ec5ba0a78d903e55585ad3a0ecd5da4ed12bb28e667b51b05c5fc`입니다. `docs/input-audit.json`의 독립 재가공 일치 기록과 연결됩니다. `docs/source-verification-recheck.json`에는 2026-10-31의 공식 ZIP 다운로드 해시·원문 CSV 필드 대조 기록이 있습니다. 파일 해시, 자료 기준일, 모집단, 대조 불일치 수, 확인 시각이 맞아야 연결된 과거 기록으로 표시합니다. 과거 기록에 연결됐다는 사실은 이번에 ZIP을 다시 다운로드했다는 뜻이 아닙니다.

2026-11-02에 [공식 카탈로그](https://www.data.go.kr/catalog/15051059/fileData.json)를 다시 열어 2026-09-30 자료와 분기 추출·월말 집계 차이 설명을 확인했습니다. 일반 안내 URL은 web 도구의 콘텐츠 형식 오류가 났지만 별도 공식 카탈로그는 읽을 수 있었습니다. 원문 확인 결과는 `data/content/data-quality-source-evidence.json`에 저장했습니다.

## 실제 결과와 대표 원문 확인

현재 스냅샷 19,681행에서 내부 ID 중복·출처 연결 오류·명세 불일치는 0입니다. 전화 원문 미수록은 72행, 단일 번호 형식 검토는 833행, 홈페이지 원문 미수록은 17,963행, 하루 이상 유효 등록시간 미수록은 14,855행입니다. 형식 검토 수는 실제 정보가 틀린 기관 수가 아닙니다.

중복 의심은 4묶음·8행이며, 5개 규칙 묶음이 이를 뒷받침합니다. 오혜명시온백년치과·인천센터치과는 동일 명칭/주소, 해바라기치과·이편한치과는 동일 명칭/단일 전화로 묶입니다. 오혜명시온백년치과는 두 규칙을 모두 충족하여 한 번만 표시합니다. 상세 페이지에서 기관명·주소·전화 원문, 두 내부 ID, 공식 자료 안내와 다운로드 근거를 공개합니다.

대표 원문 두 곳은 서로 다른 결과입니다.

1. [인천센터치과 홈페이지](http://www.icenterdental.co.kr/) 본문을 표준 HTTP 요청으로 읽었습니다. 기관명과 가정로 280·6층은 대응하며 홈페이지 전화는 지역번호를 포함합니다. 원자료의 구 명칭과 홈페이지의 구 명칭은 다릅니다. 이 차이를 기록하고 원본을 유지했습니다. 전화 연결·현행 행정구역·두 ID 중 채택할 기록은 확인하지 않았습니다. web 도구 타임아웃과 정상 리디렉션을 따른 직접 요청 성공을 별도 기록했습니다.
2. 오혜명시온백년치과의 심평원 기관 페이지는 검색에서 발견했지만 직접 열기에서 읽을 수 있는 본문을 확보하지 못했습니다. 과거 검색 요약을 현재 사실로 사용하지 않았고, 열람 실패를 폐업·이전·중복의 근거로 삼지 않았습니다. 정확한 접근 URL은 근거 JSON에 있습니다.

## 검증

7개 회귀 테스트는 누락/0/형식의 구분, 보수적 중복 규칙과 중복 집계 방지, ID·출처 오류, 과거 증거와 현재 파일 연결, 빈 분모, 시각 조건, XSS 이스케이프, 전체 목록의 HTML 미노출, 실제 전국 집계·원본 바이트 불변을 확인합니다. 전체 검토 큐의 원문 기관명·주소·전화는 공개된 기관 등록 자료이며 환자 정보나 리뷰 본문을 포함하지 않습니다.
