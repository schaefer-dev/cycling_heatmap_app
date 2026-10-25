#!/usr/bin/env bash
#
# Push this machine's Ridestack data TO the Raspberry Pi: the database, bike-sensors.json and
# the raw FIT files (see pi-sync-common.sh). .env is never touched.
#
# The Pi is the main platform. Its Garmin/Hammerhead syncs and edits made in its UI exist
# nowhere else, so pushing REPLACES the canonical database. It is refused unless
# FORCE_OVERWRITE_PI=1 is set (pull with sync_from_pi.sh instead). Even then:
#
#   1. If the Pi's systemd service (PI_SERVICE, deploy/ridestack.service) is active, it is
#      stopped right before the swap and started again afterwards, also when a step fails.
#      Anything else holding the Pi database (a CLI command, an app started by hand) makes it
#      refuse; the script never kills processes.
#   2. Takes a consistent snapshot of the local database with `VACUUM INTO` (works while the
#      local app runs) and checks its integrity.
#   3. Compares it with the Pi database. It refuses if the Pi has rides the snapshot lacks
#      (ALLOW_DROP_RIDES=1 overrides) or a newer schema. Rides edited differently on the two
#      sides and route names set only on the Pi become warnings.
#   4. Shows a summary and asks once.
#   5. Backs up the Pi database with SQLite's online `.backup` to data/backups/pre-sync-<ts>.db.
#      Transfers the snapshot to a temporary name and verifies it. Removes the old -wal/-shm
#      (they belong to the old file and would be replayed onto the new one) and moves it into
#      place.
#   6. Copies bike-sensors.json (a differing Pi copy is backed up first) and new FIT files.
#
# Usage:
#   DRY_RUN=1 npm run pi:push                  # compare only, change nothing
#   FORCE_OVERWRITE_PI=1 npm run pi:push       # replace the Pi's data (asks once)
#
set -euo pipefail
# shellcheck source=pi-sync-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/pi-sync-common.sh"

if [[ "$DRY_RUN" != "1" && "${FORCE_OVERWRITE_PI:-0}" != "1" ]]; then
  REFUSE_CODE=2 refuse "the Pi holds the canonical database; pushing replaces it." \
    "Pull instead (npm run pi:pull), or compare first with DRY_RUN=1," \
    "and set FORCE_OVERWRITE_PI=1 only if you mean it."
fi
require_tty_or_yes
[[ -f "$LOCAL_DB" ]] || refuse "no local database at $LOCAL_DB."

SNAPSHOT="$TMP_DIR/snapshot.db"
PI_DB=""
SERVICE_STOPPED=0
cleanup() {
  rm -rf "$TMP_DIR"
  if [[ -n "$PI_DB" ]]; then
    ssh -o ConnectTimeout=10 "$PI_HOST" "rm -f $(printf %q "$PI_DB.incoming")" >/dev/null 2>&1 || true
  fi
  if [[ "$SERVICE_STOPPED" == "1" ]]; then
    echo "==> Starting $PI_SERVICE on the Pi ..."
    pi_systemctl start || echo "${RED}WARNING:${RESET} could not start $PI_SERVICE; start it by hand." >&2
  fi
}
trap cleanup EXIT

# --- 1. Preflight --------------------------------------------------------------
connect_pi
PI_DB="$PI_ROOT/$DB_REL"
echo "==> Local DB:  $LOCAL_DB ($(du -h "$LOCAL_DB" | cut -f1))"
echo "==> Pi target: $PI_HOST:$PI_DB"
check_code_versions
SERVICE_ACTIVE=0
if pi_service_active; then
  SERVICE_ACTIVE=1
  echo "    Service $PI_SERVICE is running on the Pi; it is stopped for the swap and started again."
else
  refuse_if_app_running pi "$PI_DB"
fi
warn_running_sync local "$LOCAL_DB" local

# --- 2. Consistent local snapshot ------------------------------------------------
echo "==> Creating consistent snapshot with VACUUM INTO ..."
sqlite3 "$LOCAL_DB" "VACUUM INTO '$SNAPSHOT';"
integrity_ok local "$SNAPSHOT" || refuse "the snapshot failed integrity_check."
echo "    Snapshot OK ($(du -h "$SNAPSHOT" | cut -f1))."

# --- 3. Compare ----------------------------------------------------------------------
PI_HAS_DB=0
if file_exists pi "$PI_DB"; then
  PI_HAS_DB=1
  compare_dbs local "$SNAPSHOT" local pi "$PI_DB" Pi
else
  echo "==> No database on the Pi yet."
fi
compare_files local pi

print_summary "Will replace the Pi database$([[ "$PI_HAS_DB" == "1" ]] && echo " (backed up to $BACKUP_REL/ first)") and copy the data files above."
if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> DRY RUN complete. Nothing was changed on the Pi."
  exit 0
fi
confirm "Replace the Pi's data with this machine's?"

# --- 5. Back up, transfer, verify, replace ------------------------------------------
if [[ "$SERVICE_ACTIVE" == "1" ]]; then
  echo "==> Stopping $PI_SERVICE on the Pi ..."
  pi_systemctl stop
  SERVICE_STOPPED=1
fi
# Something may have started on the Pi since the preflight (or outlived the service).
refuse_if_app_running pi "$PI_DB"

TS="$(date +%Y%m%d_%H%M%S)"
PI_BACKUP="$PI_ROOT/$BACKUP_REL/pre-sync-$TS.db"
if [[ "$PI_HAS_DB" == "1" ]]; then
  echo "==> Backing up the Pi database with sqlite3 .backup ..."
  run_on pi "mkdir -p $(printf %q "$PI_ROOT/$BACKUP_REL") && sqlite3 $(printf %q "$PI_DB") \".backup '$PI_BACKUP'\""
  echo "    Backup: $PI_BACKUP"
fi

echo "==> Transferring snapshot to the Pi ..."
rsync -ah --partial --progress "$SNAPSHOT" "$PI_HOST:$PI_DB.incoming"
integrity_ok pi "$PI_DB.incoming" || refuse "the transferred database failed integrity_check; the Pi database is unchanged."
echo "    Transferred copy OK."

echo "==> Replacing the Pi database ..."
run_on pi "rm -f $(printf %q "$PI_DB-wal") $(printf %q "$PI_DB-shm") && mv $(printf %q "$PI_DB.incoming") $(printf %q "$PI_DB")"

# --- 6. Data files ----------------------------------------------------------------------
copy_files local pi "$TS"

echo "==> Done. Data pushed to $PI_HOST:$PI_ROOT"
if [[ "$PI_HAS_DB" == "1" ]]; then
  echo "    The previous Pi database remains in: $PI_BACKUP"
fi
if [[ "$SERVICE_ACTIVE" != "1" ]]; then
  echo "    Start the app on the Pi (sudo systemctl start $PI_SERVICE); pending migrations run at startup."
fi
