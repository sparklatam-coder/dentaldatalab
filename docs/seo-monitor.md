# SEO HTTP 모니터

`scripts/seo-monitor.py`는 공개 사이트의 기술적 검색 노출 조건을 주기적으로 확인한다. 기본 대상은 공개 색인을 허용하는 주 도메인 `https://dentaldatalab.com` 하나이며, 홈페이지 canonical 기대값은 `https://dentaldatalab.com/`이다.

```sh
# 먼저 1회 확인. 조건 실패 시 exit 1과 상세 체크 결과를 저장한다.
python3 scripts/seo-monitor.py --once

# 운영 루프. 이 명령을 실제 실행해야 지속 점검한다.
python3 scripts/seo-monitor.py
```

정상은 기본 1시간 후, 실패는 5분·10분·20분·40분·최대 1시간의 지수 백오프로 재확인한다. `--healthy-seconds`, `--failure-seconds`, `--max-backoff-seconds`로 대기 시간을 늘릴 수 있다. 정상 대기 최소 1시간, 실패 대기 최소 5분은 유지한다. 검사 1회당 사이트별 홈페이지·robots·sitemap·홈페이지에서 발견한 최대 3개 내부 링크만 요청한다. 대기 중에도 프로세스는 살아 있으며 `nextCheckAfterSeconds`는 다음 주기 대기 시간을 나타낸다.

확인 항목은 DNS 해석, curl의 TLS 인증서 검증, HTTP 성공 상태, 제목, 홈페이지 canonical, robots 메타 및 X-Robots-Tag의 noindex, robots.txt의 주요 검색봇 전체 차단, sitemap XML과 URL 존재 여부, 핵심 내부 링크의 HTTP 성공 상태다. robots 검사에서는 `*`, Googlebot, Bingbot, Yeti 그룹의 전체 경로 차단을 확인한다. 전체 robots 규칙 우선순위나 사이트맵 전체 URL의 인덱싱 상태를 재현하지 않는다. sitemap index는 문서 형식과 하위 사이트맵 위치 존재 여부를 확인하며 전체 하위 문서를 순회하지 않는다.

## 결과와 운영

- `data/research/seo-monitor/state.json`: 최신 상세 검사, 실패 연속 횟수, 다음 대기 시간과 PID.
- `data/research/seo-monitor/history.jsonl`: 검사별 누적 기록. HTTP 본문 전체는 보관하지 않는다.
- `data/research/seo-monitor/worker.lock`: `flock`으로 단일 실행을 보장하는 잠금. 종료 시 PID를 비우고 잠금을 해제한다. 파일이 남아 있는 것만으로 실행 중인 것은 아니다.

SIGINT/Ctrl-C 또는 SIGTERM으로 종료한다. 실행 중인 curl 프로세스 그룹도 종료하고 상태를 `stopped`로 남긴다. 재시작하면 직전 연속 실패 횟수를 이어받는다. 예기치 않은 프로세스 강제 종료로 마지막 상태가 오래 남을 수 있으므로 PID와 기록 시각도 확인한다.

주 도메인에서 `noindex`가 발견되면 `index_directive` 경고를 남긴다. `dentaldatalab.pages.dev` 등 보조 도메인은 중복 방지를 위한 noindex 또는 주 도메인으로의 301 전환이 정상 정책이므로 기본 모니터 대상에서 제외한다. `--site`로 추가하는 대상에는 주 도메인과 같은 색인 허용 검사를 적용하므로 보조 도메인을 추가하지 않는다. 모니터가 noindex를 제거하거나 소스를 수정하지는 않는다. 도메인 연결 전 DNS·TLS 경고도 동일하게 기록된다. 한 번 실패했다고 검색엔진 페널티나 검색 누락이 입증되는 것은 아니다.

Google Search Console, 네이버 서치어드바이저, Bing Webmaster Tools의 검색엔진 측 지표가 모니터 API에 연결되기 전이므로 실제 색인·검색 결과 노출 상태는 **미확인: 검색엔진 지표 미연결**로 표시한다. 도메인 소유 확인이나 서비스 UI에서 확인한 상태와 모니터 API 연결 여부는 별개다. 이 프로그램은 검색 결과를 스크래핑하거나 색인 요청을 보내지 않고, 코드를 자동 수정하거나 커밋하지 않는다. 노출 지표 연동은 각 서비스의 API 연결을 완료한 뒤 별도로 진행한다.

```sh
python3 -m unittest discover -s tests -p test_seo_monitor.py
```

검증은 정상 응답, noindex 메타·헤더, 검색봇 전체 차단, 잘못된 canonical·sitemap·링크, TLS 실패, 백오프와 실행 인자 검증을 포함한다. 테스트는 외부 요청 없이 실행된다.
