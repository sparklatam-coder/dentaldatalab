# 치료 질문 100개 검토·공개 조건

확인일: 2026-11-02. 현재 질문·답변 원본은 변경하지 않았다.

## 실제 감사 결과

- 질문 100개 모두 원본 `clinicalReviewStatus: pending`이다.
- 인용한 서로 다른 URL은 59개이며, 59개 모두 제목·발행기관·기존 원문 확인시각이 있다.
- 이번 작업에서는 공식 원문 8개를 웹으로 재열람했다. 나머지 51개를 다시 확인했다고 표시하지 않는다.
- 실제 의료진의 이름·자격 확인·검토일·문안 승인·인용별 대조 기록은 제공되지 않았다. 의료진 승인 기록 0개, 공개 전 기록 조건 충족 0개, 검토 필요 100개다.
- 출처가 연결되어 있다는 사실, 원문 기관이 표시한 검토일, 편집자가 원문을 읽은 날짜는 우리 답변의 의료진 검토일이 아니다.

## 화면과 파일

- `/questions/`: 기존 질문과 답변. 각 질문에서 검토 현황으로 이동한다.
- `/questions/review/`: 분류별·질문별 검토 상태, 실제 검토자·검토일, 공개 전 남은 일, 출처와 인용 질문의 양방향 연결.
- `/data/content/review-audit.json`: 현재 문안의 SHA-256와 기록 조건 검사 결과. 다운로드에 원본 의료진 검토 증빙 문서나 자격증 번호를 복사하지 않는다.
- `data/content/review-ledger.json`: 실제 의료진 검토 기록을 넣는 입력. 현재 `reviews: []`다.
- `data/content/review-source-checks.json`: 이번에 재열람한 8개 원문의 접근 기록. 의료진 승인 입력과 분리된다.

`registerContentPage`가 검토 화면을 함께 등록한다. `build.mjs`의 새 호출은 필요 없다. 두 경로 모두 `/questions/` 아래에 있으며 `scripts/seo.mjs`의 공개 색인 허용 목록에서 제외된다. 공개 sitemap에도 포함되지 않는다. 현재 production 모드에서 콘텐츠 묶음을 제외하는 기존 정책을 바꾸지 않았다. 의료용 Article·FAQ 승인 또는 저자 구조화 데이터도 추가하지 않았다.

## 공개 전 기록 조건

`scripts/content-review-data.mjs`는 실제 검토 기록을 대신 생성하지 않는다. 아래 필드의 존재·형식·시각·문안 대응을 검사한다. 사람이 증빙을 실제 확인했는지 코드를 통해 인증하거나 치과의사 면허를 자동 조회하는 기능은 아니다. 운영자가 실제 근거를 확인한 기록만 입력해야 한다. AI가 자신을 의료진으로 등록하거나 날짜·승인·증빙을 만들어 채우면 안 된다.

1. `questionId`당 최신 결정 1개를 둔다. 중복 결정은 승인으로 선택하지 않으며, 존재하지 않는 질문 ID는 오류다. 과거 기록은 별도 보관하고 자동으로 이전 승인으로 돌아가지 않는다.
2. `contentRevision`은 질문·제목·답변·인용·편집 이유를 포함한 현재 문안의 SHA-256이다. 해당 필드가 바뀌면 기존 기록은 공개 조건을 통과하지 못한다.
3. `decision: approved`는 실제 검토가 완료된 경우에만 입력한다. `reviewer`에 `name`, `profession: dentist`, `qualification`, `credentialEvidenceUrl`, `credentialVerified: true`, `credentialCheckedAt`, `credentialVerifiedBy`가 필요하다. 자격 확인일은 의료 검토일 이후일 수 없다.
4. `reviewedAt`, 실제 검토 문서의 `reviewEvidenceUrl`, `nextReviewAt`을 기록한다. 미래·잘못된 날짜는 거부하고, 다음 검토일이 지나면 다시 검토한다.
5. `sourceChecks`에 현재 인용 URL마다 1개씩 `url`, `checkedAt`, `supportsAnswer: true`, `locator`(해당 절), `rationale`(어디까지 뒷받침하는지)를 남긴다. 모든 인용의 해당 범위와 예외를 의료진이 확인해야 한다.
6. `titleReviewed`, `koreanContextReviewed`, `patientSafetyReviewed`가 실제로 확인되어야 한다. 외국의 보험·진료 이용 체계·응급 연락처를 한국에 그대로 적용하지 않는다. 약물 중단·용량·치료 적합성을 개인에게 단정하는 표현도 검토한다.
7. 의료 검토 이후 `editorial`의 `decision: approved`, `reviewedBy`, `reviewedAt`, `evidenceUrl`을 기록한다.

원문 확인과 검토일 사이 최대 90일, 검토 유효기간 최대 366일은 이 서비스의 편집 운영 기준이다. 법정 주기나 의료적 유효기간을 의미하지 않는다. 더 짧은 재검토 기한을 지정할 수 있다. 입력에 `approved` 한 단어만 넣어서는 통과하지 않는다.

`publicationEligible: true`는 위 기록 조건 충족만 의미한다. 실제 게시·배포·검색 색인 해제를 수행하지 않으며 편집 목록은 계속 `noindex`다. 개별 최종 문서의 공개 여부는 따로 결정해야 한다.

## 재현과 검증

```sh
node --test test/content.test.mjs test/content-review.test.mjs
```

`loadContent(root, { asOf })`로 감사 기준시각을 고정할 수 있다. 기본값은 실제 실행시각이다. 테스트는 원문 열람일의 의료진 검토일 승격 금지, 문안·제목 변경, 증빙 누락, 인용 대응 누락, 미래·무효 날짜, 기한 경과, 중복 결정, HTML 이스케이프와 noindex/sitemap 제외를 확인한다. 테스트용 가상 검토자는 테스트 코드에만 있으며 실제 ledger와 공개 데이터에는 저장하지 않는다.

## 아직 필요한 실제 작업

100개 모두 치과의사의 현재 한국 환자용 문안 검토가 필요하다. 인용별 문장 대응과 예외, 제목 표현, 한국 보험·응급 안내, 소아·임신·약물·치료 후 관리 문구를 확인한 뒤 실제 검토 증빙을 남겨야 한다. 이번에 재열람하지 않은 51개 출처의 현재 원문도 검토 과정에서 다시 확인해야 한다. 현재 상태를 ‘의료진 검토 완료’나 ‘의학적 정확성 검증 완료’로 홍보하지 않는다.
