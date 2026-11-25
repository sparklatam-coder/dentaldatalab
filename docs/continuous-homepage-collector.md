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

## 자동 발굴 후보 홈페이지 검증

`scripts/clinic-research-loop.py`가 웹 검색으로 찾은 홈페이지 후보(`ownership: candidate`, 출처 `automated_web_research`)는 모델이 보고한 주소일 뿐 이 저장소의 수집기가 읽은 적이 없습니다. `--candidates` 모드는 그 후보를 수집기가 직접 1회 읽고 기관명·전화·주소를 공공 원자료와 대조합니다.

```sh
node scripts/prepare-candidate-homepages.mjs --dry-run   # 새 대상 수만 확인
python3 scripts/continuous-homepage-collector.py --candidates
python3 scripts/continuous-homepage-collector.py --candidates --once --max-requests 3   # 파일럿
```

- 대상: 인벤토리의 `kind: website` · `ownership: candidate` · 출처 `automated_web_research` 자산 중 네이버·카카오·인스타그램 등 플랫폼 호스트가 아니고, 네 결과 파일(`national-homepages`, `discovered-homepages`, `continuous-homepages`, `candidate-homepages`)의 어떤 요청에도 나오지 않은 주소. 두 수집기는 서로의 결과 파일을 "이미 시도함"으로 읽으므로 같은 URL을 두 번 요청하지 않습니다.
- 입력: `data/research/candidate-homepage-seeds.json` (seed마다 `hostClinicCount` = 같은 호스트를 후보로 가진 기관 수). 결과: `data/assets/candidate-homepages.json`, 잠금 `data/research/candidate-homepages.lock`.
- 결과 행은 `sourceType: candidate_homepage`이며 기관별 `matches`(name/phone/address)와 함께 `datasetPhoneCount`(페이지에 보이는 공공자료 전화번호의 서로 다른 개수)를 기록합니다. 여러 기관의 번호가 보이는 페이지는 한 기관의 홈페이지가 아니라 목록 페이지로 봅니다.
- 차단 정책: 대상이 수천 개의 독립 호스트이므로 401/403/429 또는 차단 화면은 해당 호스트만 `blockedHosts`에 기록하고(재요청 없음) 다음 seed로 계속 진행합니다. 연속 5회 차단되면 `state: blocked`로 전체를 멈추며 `--resume-after-block`으로 재개합니다. 기존 연결 홈페이지 모드의 즉시 중단 정책은 그대로입니다.
- 반영: `scripts/clinic-assets.mjs`가 `candidate-homepages.json`을 다른 크롤 결과와 같이 읽습니다. 진행 현황은 `npm run status:collector`(후보 검증) 또는 `node scripts/collector-status.mjs --linked`(기관 연결 홈페이지)로 읽을 수 있습니다. 결과 파일과 seed 파일만 읽어 처리 수·상태별 건수·승격 조건 충족 수·속도·예상 잔여 시간을 보여주며, 네트워크 요청이나 파일 변경은 하지 않습니다. 실시간 로그는 `tail -f data/research/candidate-homepages.log`입니다. 308 영구 리디렉션은 `scripts/ddl/web.py`가 307처럼 재검증 후 따라갑니다(Python 3.9 urllib 미지원 보완). 2026-11-26 첫 실행에서 이 수정 전에 `http_error 308`로 남은 행은 운영자가 결과 파일에서 제거해 재요청했으며, 그 목록은 결과 파일의 `operatorRequeues`에 남아 있습니다. 본문에서 기관명이 일치하고 전화 또는 도로명 주소가 함께 일치하며 `datasetPhoneCount`가 2 이하인 홈페이지만 `본문·기관 대조`로 승격되어 링크가 활성화됩니다(`hostClinicCount`는 감사용 기록이며 조건이 아닙니다). 그 밖의 결과는 본문 열람 기록만 남기고 귀속 후보를 유지합니다.

### 검증된 홈페이지가 연결한 채널

본문·기관 대조를 통과한 후보 홈페이지의 HTML에 있는 href 중 네이버 블로그·인스타그램·유튜브·페이스북·카카오 채널·네이버 예약·네이버지도·카카오맵 링크는 `scripts/clinic-assets.mjs`의 `channelFromHref`가 **프로필·채널·장소 단위로 정규화**한 뒤 `ownership: linked`("기관 페이지에서 연결")로 올려 링크를 활성화합니다. 플랫폼 페이지는 여전히 읽지 않습니다. 홈페이지가 자기 채널이라고 연결했다는 사실만 근거이며, 그 사실은 `provenance.type: verified_homepage_channel`(원래 href 포함)로 남습니다.

- 정규화: 블로그 글 → 블로그(`blog.naver.com/<id>`), `PostView.naver?blogId=` → 블로그, `pf.kakao.com/<id>/chat` → 채널, 예약 상품 → 사업자(`/booking/13/bizes/<id>`), `m.place.naver.com/hospital/<id>/…` → `map.naver.com/p/entry/place/<id>`, `map.kakao.com/link/map/<id>` → `place.map.kakao.com/<id>`.
- 채널이 아닌 링크는 후보로 남습니다: 인스타그램 게시물(`/p/`, `/reel/`), 유튜브 영상(`/watch`, `youtu.be`), 공유 대화상자, 검색 결과(`map.naver.com/p/search/…`, `map.kakao.com/link/search/…`), 단축 링크(`naver.me`, `kko.to`), 페이스북 `profile.php`·`people/…`, 기타 사이트·링크 모음.
- 공유 채널 보류: 같은 채널을 **3개 이상 기관**의 검증된 홈페이지가 연결하면(`LINKED_CHANNEL_MAX_CLINICS = 2`) 브랜드·그룹 채널로 보고 모두 후보로 남기며 `sharedByClinics`를 기록합니다. 두 기관이 한 홈페이지를 쓰는 경우(등록기관 전화 2개)는 둘 다 받습니다.
- 검증을 통과하지 못한 후보 홈페이지는 종전처럼 href를 전혀 기부하지 않고, 기관 연결 홈페이지 모드(`discovered_homepage`)의 href는 종전처럼 후보로만 남습니다.
