# 실제 웹 검색을 수행하는 치과 수집 루프

`scripts/clinic-research-loop.py`는 병원 하나마다 별도의 Codex 읽기 전용 작업을 실행한다. 모델은 기본 `gpt-6.1-sol`, 추론 강도는 `medium`이다. 작업은 공개 웹 검색과 병원 홈페이지를 확인하고 결과 JSON만 반환하며, 부모 Python 프로세스가 파일을 저장한다. 데이터셋에 이미 있는 홈페이지 주소만 재검사하는 기존 루프와 별개의 수집기다.

## 실행

```sh
python3 scripts/clinic-research-loop.py --once --codex /Users/ax/.local/bin/codex
python3 scripts/clinic-research-loop.py --codex /Users/ax/.local/bin/codex
```

첫 명령은 병원 한 곳을 조사한다. 두 번째 명령은 조사하지 않은 전체 병원을 계속 처리한다. 의정부시를 먼저 처리하고 나머지는 지역·기관명 순서로 진행한다. 기존 수동 조사 배치와 이 수집기에서 이미 시도한 기관은 건너뛴다. `--max-clinics 10`으로 실행당 기관 수를 제한할 수 있다. 병원당 기본 제한시간은 600초이며 다음 기관까지 5초 대기한다.

## 결과와 상태

- `data/assets/national-web-auto.json`: 화면에서 사용할 수 있는 누적 자동 발굴 후보.
- `data/research/clinic-research-loop/state.json`: 현재 기관, 기관별 시작·종료 시각, 결과 및 실패 상태.
- 같은 폴더의 `<clinicId>.result.json`: 작업이 반환한 원본 구조화 결과.
- 같은 폴더의 `<clinicId>.events.jsonl`: 실제 검색 작업과 오류를 확인하는 실행 로그.
- 같은 폴더의 `worker.lock`: 중복 실행 방지용 부모 프로세스 PID.

모든 발굴 링크는 `ownership: candidate`로 저장한다. 주소·전화번호·기관명 증거, 출처 URL, 실제 본문 열람 여부를 함께 남긴다. 검색 결과에만 등장한 링크를 본문 확인으로 표시하지 않는다. 검토 전에는 공식 소유로 승격하지 않으며 원본 기관 데이터의 연락처나 주소를 덮어쓰지 않는다.

이 수집기는 웹사이트와 마케팅 채널을 발굴하는 단계다. 네이버 소개·예약 문구·운영시간·리뷰 전문 수집을 완료했다고 표시하지 않는다. 기존 429 상황 때문에 네이버 등 플랫폼에 직접 접속하거나 차단을 반복 시도하지 않는다.

## 중단·실패

부모 프로세스에 SIGTERM 또는 Ctrl-C를 보내면 실행 중인 자식 프로세스 그룹도 종료하고 체크포인트를 저장한다. 종료된 기관은 자동 재시도하지 않는다. 정상 중단 후 같은 실행 명령으로 다음 기관부터 계속할 수 있다.

인증·모델·요청 제한·타임아웃·형식 오류 등으로 작업이 실패하면 전체 루프를 멈춘다. 실패 상태에서는 재실행만으로 작업이 반복되지 않는다. 로그를 확인하고 원인을 해결한 뒤 아래 명령으로 실패한 기관을 건너뛰고 남은 작업을 이어간다.

```sh
python3 scripts/clinic-research-loop.py --resume-after-error --codex /Users/ax/.local/bin/codex
```

잠금 파일이 남아 있으면 그 안의 PID가 실제 실행 중인지 먼저 확인한다. 실행 중인 프로세스가 없을 때만 오래된 잠금을 제거한다. 백그라운드 실행은 실행 환경의 프로세스 관리자가 담당한다. 이 스크립트만 작성된 상태가 실제 실행 중이라는 뜻은 아니므로 PID와 로그의 `started`/`saved` 이벤트를 확인한다.

검증: `python3 -m unittest discover -s tests -p test_clinic_research_loop.py`
