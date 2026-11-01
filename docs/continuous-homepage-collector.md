# 홈페이지 수집 루프

이 프로그램은 **이미 기관 페이지가 실제로 연결한 독립 홈페이지**만 순서대로 확인합니다. 기관명·주소·전화와 대조하고 공개된 링크를 추출합니다. 추출한 링크와 자동 일치는 검토 후보입니다. 네이버지도·네이버 블로그·SNS 화면을 수집하거나 새로운 기관과 검색 결과를 발굴하는 프로그램은 아닙니다. 후보가 없으면 5분마다 로컬 자료의 변화를 확인하며 대기합니다.

프로젝트 폴더에서 실행:

```sh
python3 scripts/continuous-homepage-collector.py
```

터미널을 닫아도 실행하려면:

```sh
nohup python3 scripts/continuous-homepage-collector.py >> data/research/continuous-homepages.log 2>&1 &
```

실행 상태와 기록은 `data/assets/continuous-homepages.json`, 로그는 `data/research/continuous-homepages.log`에 있습니다. 진행 중 프로세스 번호는 `data/research/continuous-homepages.lock`에 기록됩니다. 중지하려면 해당 프로세스가 맞는지 확인한 뒤 SIGTERM을 보냅니다.

```sh
ps -p "$(cat data/research/continuous-homepages.lock)" -o pid=,command=
kill -TERM "$(cat data/research/continuous-homepages.lock)"
```

터미널에서 직접 실행 중이면 Ctrl+C로 중지할 수 있습니다. 다시 실행하면 이미 시도한 URL은 건너뜁니다. 파일럿은 `--once --max-requests 1`, 대기 간격은 `--interval 300`처럼 설정합니다. 간격은 최소 60초입니다.

HTTP 401·403·429 또는 차단 화면이 감지되면 전체 루프가 즉시 정지합니다. 확인 후 `--resume-after-block`으로 다시 시작할 수 있지만, 차단된 호스트와 이미 시도한 URL을 자동 재요청하지 않습니다. 요청 직전에도 체크포인트를 쓰므로, 실행이 비정상 종료되면 그 URL은 미완료 기록으로 남고 자동 재시도하지 않습니다. 비정상 종료 후 잠금 파일이 남았다면 프로세스가 실제로 종료된 것을 확인한 다음 잠금 파일만 삭제하고 재시작합니다.

수집은 직렬로 진행합니다. 공개 주소와 표준 포트만 허용하고 네이버 등 플랫폼 및 비공개 IP는 제외합니다. 로컬 서버를 계속 갱신하는 개발 서버가 실행 중이면 결과 반영 여부를 확인할 수 있고, 별도 정적 빌드에는 `npm run build`를 실행합니다.
