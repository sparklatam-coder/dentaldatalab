#!/bin/bash
# Unattended monthly growth check for this Mac (docs/growth-monitor.md, "자동 실행"). Safe to run every day:
#   - a month whose cells are all recorded is a no-op: it exits 0 before any browser tab or git write;
#   - a partly recorded month resumes with the cells that are still null;
#   - a run that records nothing new writes nothing, commits nothing and stays quiet;
#   - only this month's file is committed, locally. Nothing is ever pushed.
# It drives the owner's Aside browser through scripts/growth-observe.mjs and needs bash, git and node only.
# Environment:
#   NODE_BIN          node executable (default: node on PATH)
#   ASIDE_BIN         aside executable, read by growth-observe.mjs (default: aside on PATH)
#   GROWTH_NOTIFY=0   no macOS notification
#   GROWTH_SKIP_PULL=1  skip the best-effort `git pull --ff-only`
set -u

cd "$(dirname "$0")/.." || exit 1
# launchd starts jobs with a minimal PATH.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE="${NODE_BIN:-node}"
MONTH="$(date +%Y-%m)"
FILE="data/content/growth-observations/$MONTH.json"
LOG_DIR="data/research/growth-monitor"
LOG="$LOG_DIR/run-$MONTH.log"
SUMMARY="$LOG_DIR/summary-$MONTH.txt"
LOCK="$LOG_DIR/.run.lock"

notify() {
  [ "${GROWTH_NOTIFY:-1}" = "0" ] && return 0
  command -v osascript >/dev/null 2>&1 || return 0
  # The text is passed as an argument, never spliced into the AppleScript source.
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "치과데이터랩 성장 점검"' -e 'end run' -- "$1" >/dev/null 2>&1 || true
}

mkdir -p "$LOG_DIR" || exit 1
if [ "${GROWTH_SKIP_PULL:-0}" != "1" ]; then git pull --ff-only >/dev/null 2>&1 || true; fi

# A completed month needs nothing.
if "$NODE" scripts/growth-observe.mjs --month "$MONTH" --is-complete >/dev/null 2>&1; then exit 0; fi

# One run at a time. A lock older than three hours is the leftover of a killed run.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -z "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then exit 0; fi
  rmdir "$LOCK" 2>/dev/null
  mkdir "$LOCK" 2>/dev/null || exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

BEFORE="$(cksum "$FILE" 2>/dev/null || echo none)"
{
  echo "== $(date '+%Y-%m-%d %H:%M:%S %z') growth-monitor-run $MONTH"
  "$NODE" scripts/growth-observe.mjs --month "$MONTH"
  echo "observer exit: $?"
} >>"$LOG" 2>&1

if ! "$NODE" scripts/growth-monitor.mjs --validate "$FILE" >>"$LOG" 2>&1; then
  echo "validation failed; nothing committed" >>"$LOG"
  notify "$MONTH 월 파일 검사 실패 — 커밋하지 않았습니다. $LOG 를 확인하세요."
  exit 1
fi
"$NODE" scripts/growth-monitor.mjs --summary --text >"$SUMMARY" 2>>"$LOG" || true

AFTER="$(cksum "$FILE" 2>/dev/null || echo none)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "no change" >>"$LOG"
  exit 0
fi

# Commit this month's file only; whatever else is staged or modified in the checkout is left alone. Never push.
if git add -- "$FILE" >>"$LOG" 2>&1 && ! git diff --cached --quiet -- "$FILE"; then
  git commit --only -m "Record the $MONTH growth observations (automated run)" -- "$FILE" >>"$LOG" 2>&1 || echo "commit failed" >>"$LOG"
fi

notify "$("$NODE" scripts/growth-observe.mjs --month "$MONTH" --notification 2>/dev/null || echo "$MONTH 기록됨")"
exit 0
