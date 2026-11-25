# 실제 웹 검색을 수행하는 치과 수집 루프

`scripts/clinic-research-loop.py`는 병원 하나마다 별도의 Codex 읽기 전용 작업을 실행한다. 모델은 기본 `gpt-6.1-sol`, 추론 강도는 `medium`이다. 작업은 공개 웹 검색과 병원 홈페이지를 확인하고 결과 JSON만 반환하며, 부모 Python 프로세스가 파일을 저장한다. 데이터셋에 이미 있는 홈페이지 주소만 재검사하는 기존 루프와 별개의 수집기다.

## 실행

```sh
python3 scripts/clinic-research-loop.py --once --codex /Users/ax/.local/bin/codex
python3 scripts/clinic-research-loop.py --codex /Users/ax/.local/bin/codex
```

첫 명령은 병원 한 곳을 조사한다. 두 번째 명령은 조사하지 않은 전체 병원을 계속 처리한다. 의정부시를 먼저 처리하고 나머지는 지역·기관명 순서로 진행한다. 기존 수동 조사 배치와 이 수집기에서 이미 시도한 기관은 건너뛴다. `--max-clinics 10`으로 실행당 기관 수를 제한할 수 있다. 병원당 기본 제한시간은 600초이며 다음 기관까지 5초 대기한다.

## 병렬 실행

```sh
python3 scripts/clinic-research-loop.py --parallel 5 --interval 2 --codex /Users/ax/.local/bin/codex
```

`--parallel N`(1~16, 기본 1)은 Codex 워커를 N개 동시에 실행한다. 상태 파일과 결과 파일 기록은 부모 프로세스 한 곳에서만 하며 잠금 파일도 하나다. `--interval`은 새 워커를 띄우는 최소 간격이다. 워커 하나가 실패하면 새 기관은 더 받지 않고 진행 중인 나머지 워커는 끝까지 기다려 결과를 저장한 뒤 `error` 상태로 멈춘다. 재개 방법은 순차 실행과 같다. 2026-11-05 측정에서 5워커는 분당 약 13기관으로 순차(분당 약 2기관)보다 빨랐다. Codex 계정 요청 제한에 걸리면 워커 실패로 멈추므로 로그를 확인한다.

## Claude CLI 워커 풀 추가

```sh
python3 scripts/clinic-research-loop.py --parallel 15 --claude /Users/ax/.local/bin/claude --claude-parallel 10 --interval 0 --codex /Users/ax/.local/bin/codex
```

`--claude PATH --claude-parallel N`은 Codex 풀과 별도로 Claude Code CLI 워커를 N개 더 띄운다. 워커는 `claude -p`를 웹검색·웹페치 도구만 허용하고 프로젝트 설정·MCP·세션 저장 없이 실행하며, 같은 JSON 스키마로 결과를 받는다. 기본 모델은 `claude-sonnet-5-5`(`--claude-model`). 이벤트 로그는 Codex와 같은 `<clinicId>.events.jsonl`에 stream-json으로 남고, 최종 `result` 이벤트의 구조화 출력을 `<clinicId>.result.json`으로 저장한다. 기록과 상태에는 `worker.backend`/`worker.model`이 붙는다. 워커 환경변수에 `USER`가 있어야 macOS 키체인의 Claude 로그인을 찾는다.

`access_limited`는 해당 워커 풀만 멈추고(`pool_blocked` 이벤트) 그 기관은 다시 큐에 넣어 다른 풀이 처리한다. 모든 풀이 막히면 `blocked` 상태로 종료한다. 2026-11-05 측정: Codex 15 + Claude 10은 분당 약 72기관(Codex 42, Claude 30).

## Claude 단독 실행과 실패 처리 (2026-11-05)

```sh
python3 scripts/clinic-research-loop.py --parallel 0 --claude /Users/ax/.local/bin/claude --claude-parallel 30 --interval 0
```

`--parallel 0`은 Codex 풀 없이 Claude 풀만 쓴다(워커 상한은 풀당 40). Claude 프롬프트는 검색 4회(이름+전화, 이름+주소, 이름+시+홈페이지, 이름+시+블로그/인스타/카카오)를 `extended` 모드로 돌리고, 디렉토리 페이지(모두닥·굿닥·일상킷·당근 등)는 자산이 아니라 홈페이지·블로그 항목을 읽는 근거로만 쓰도록 명시한다. 같은 12곳 표본에서 이 프롬프트는 이전 프롬프트보다 자산 발견 기관이 1곳에서 4곳으로 늘었고, Codex가 찾은 홈페이지 중 3곳은 Claude 검색 결과에 아예 나오지 않아 여전히 놓친다.

워커 하나의 잘못된 출력·타임아웃은 그 기관만 `error`로 남기고(재시도 없음, `failed` 이벤트) 루프는 계속 간다. 연속 실패가 `MAX_FAILURE_STREAK`(5)에 이르면 전체를 `error`로 멈춘다. `--once`/`--max-clinics`는 착수가 아니라 완료(저장 또는 오류) 기관 수를 센다. 이전 Claude 프롬프트로 저장된 662건은 2026-11-05에 결과 파일에서 제거하고 재큐했다.

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

프로세스가 체크포인트 없이 죽은 경우(kill -9, 전원 차단 등)에는 `in_progress`로 남은 기관이 있다. 다음 실행은 이 기관들을 `interrupted`로 바꿔 다시 큐에 넣되, 먼저 종료 코드 2로 멈춰 점검을 요구한다. 로그를 확인한 뒤 위의 `--resume-after-error` 명령으로 이어가면 해당 기관부터 다시 조사한다. 이전에는 이런 기관이 큐에서 조용히 빠졌다.

각 워커는 저장소 밖의 임시 디렉터리에서, 최소 환경변수(`PATH`, `HOME`, 로케일, 임시 디렉터리, 프록시·인증서 설정, `CODEX_*`/`OPENAI_*`)만 받아 실행된다. 셸에 있는 다른 토큰은 전달되지 않는다. Codex 로그인(`~/.codex/auth.json`)은 `HOME`으로 찾는다.

잠금 파일이 남아 있으면 그 안의 PID가 실제 실행 중인지 먼저 확인한다. 실행 중인 프로세스가 없을 때만 오래된 잠금을 제거한다. 백그라운드 실행은 실행 환경의 프로세스 관리자가 담당한다. 이 스크립트만 작성된 상태가 실제 실행 중이라는 뜻은 아니므로 PID와 로그의 `started`/`saved` 이벤트를 확인한다.

검증: `python3 -m unittest discover -s test -p test_clinic_research_loop.py`
