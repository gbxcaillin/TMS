#!/usr/bin/env bash
# Pull-based auto deploy for crm.example.com. Cron runs this every 5 minutes; it
# fetches origin/main and, only when main has moved, runs deploy/update.sh.
# Nothing reaches into the server: no keys in GitHub, no open ports.
#
#   /root/crm/deploy/autodeploy.sh            check once, deploy if main moved (what cron runs)
#   /root/crm/deploy/autodeploy.sh --install  add the cron entry and run one check now
#   /root/crm/deploy/autodeploy.sh --remove   take the cron entry out (back to manual update.sh)
#   /root/crm/deploy/autodeploy.sh --status   last deploys, hold state, cron state
#   /root/crm/deploy/autodeploy.sh --rollback go back to the commit before the last deploy and hold
#   /root/crm/deploy/autodeploy.sh --resume   lift the hold and deploy main again
#
# Log: /var/log/crm-autodeploy.log (one line per deploy, failures included).
set -euo pipefail
REPO="${CRM_REPO:-/root/crm}"
STACK="${CRM_STACK:-/root/familyoffice}"   # compose project that owns the crm container
UPDATE="${CRM_UPDATE:-$REPO/deploy/update.sh}"
BRANCH=main
LOG="${CRM_AUTODEPLOY_LOG:-/var/log/crm-autodeploy.log}"
LOCK="${CRM_AUTODEPLOY_LOCK:-/run/lock/crm-autodeploy.lock}"
STATE="${CRM_AUTODEPLOY_STATE:-/root/.crm-autodeploy}"        # commit that was live before the last deploy (for --rollback)
HOLD="${CRM_AUTODEPLOY_HOLD:-/root/.crm-autodeploy-hold}"     # present while a rollback is in force
TAG="# crm-autodeploy"
CRON="*/5 * * * * $REPO/deploy/autodeploy.sh >>$LOG 2>&1 $TAG"

log() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG"; }
short() { git -C "$REPO" rev-parse --short "$1"; }

install_cron() {
  ( crontab -l 2>/dev/null | grep -vF "$TAG" || true; echo "$CRON" ) | crontab -
  touch "$LOG"
  log "cron installed: every 5 min"
  check
}

remove_cron() {
  ( crontab -l 2>/dev/null | grep -vF "$TAG" || true ) | crontab -
  log "cron removed: deploys are manual again (deploy/update.sh)"
}

status() {
  echo "cron:   $(crontab -l 2>/dev/null | grep -cF "$TAG") entry"
  echo "live:   $(short HEAD) on $(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  [ -f "$HOLD" ] && echo "hold:   yes (rolled back at $(cat "$HOLD"); run --resume to deploy main again)" || echo "hold:   no"
  [ -f "$STATE" ] && echo "before: $(short "$(cat "$STATE")") (what --rollback would restore)"
  echo "log:    $LOG"
  [ -f "$LOG" ] && tail -n 5 "$LOG"
}

deploy() {
  local from="$1" to="$2"
  echo "$from" > "$STATE"
  if "$UPDATE" "$BRANCH" >>"$LOG" 2>&1; then
    log "deployed $(short "$from") -> $(short "$to")"
  else
    log "FAILED deploying $(short "$from") -> $(short "$to"); see the lines above. Fix forward with a new merge, or run --rollback"
    return 1
  fi
}

check() {
  if [ -f "$HOLD" ]; then exit 0; fi
  exec 9>"$LOCK"
  if ! flock -n 9; then exit 0; fi
  if ! git -C "$REPO" fetch --quiet origin "$BRANCH"; then log "fetch failed (network?), will retry next run"; exit 0; fi
  local live remote
  live=$(git -C "$REPO" rev-parse HEAD)
  remote=$(git -C "$REPO" rev-parse "origin/$BRANCH")
  [ "$live" = "$remote" ] && exit 0
  if [ "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
    log "skipped: $BRANCH moved to $(short "$remote") but the checkout is on $(git -C "$REPO" rev-parse --abbrev-ref HEAD); run update.sh by hand when done"
    exit 0
  fi
  deploy "$live" "$remote"
}

rollback() {
  [ -f "$STATE" ] || { echo "nothing to roll back to (no deploy recorded)"; exit 1; }
  local prev; prev=$(cat "$STATE")
  local cur; cur=$(git -C "$REPO" rev-parse HEAD)
  date -Is > "$HOLD"
  git -C "$REPO" checkout --quiet "$prev"
  if ( cd "$STACK" && docker compose up -d --build crm >>"$LOG" 2>&1 ); then
    log "ROLLED BACK $(short "$cur") -> $(short "$prev"); auto deploy on hold until --resume"
  else
    log "ROLLBACK FAILED rebuilding $(short "$prev"); checkout is at $(short "$prev") and auto deploy is on hold. See the lines above"
    return 1
  fi
}

resume() {
  rm -f "$HOLD"
  git -C "$REPO" checkout --quiet "$BRANCH"
  log "hold lifted"
  check
}

case "${1:-}" in
  "") check ;;
  --install) install_cron ;;
  --remove) remove_cron ;;
  --status) status ;;
  --rollback) rollback ;;
  --resume) resume ;;
  *) echo "usage: autodeploy.sh [--install|--remove|--status|--rollback|--resume]"; exit 2 ;;
esac
