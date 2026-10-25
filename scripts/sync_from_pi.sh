#!/usr/bin/env bash
#
# Pull Ridestack data FROM the Raspberry Pi to this machine: the database, bike-sensors.json
# and the raw FIT files (see pi-sync-common.sh). .env is never touched.
#
# The Pi is the main platform, so this is the normal direction. It still replaces the local
# database, so it is written defensively:
#
#   1. Refuses while the Ridestack app or one of its commands runs locally (it would keep
#      writing to the replaced file). The script never stops it.
#   2. Takes a consistent snapshot of the Pi database with `VACUUM INTO` (works while the Pi
#      app runs), transfers it to a temporary name and verifies it.
#   3. Compares it with the local database. It refuses if the local copy has rides the Pi lacks
#      (ALLOW_DROP_RIDES=1 overrides) or a newer schema. Rides edited differently on the two
#      sides and route names set only locally become warnings.
#   4. Shows a summary and asks once.
#   5. Backs up the local database with SQLite's online `.backup` to
#      data/backups/pre-sync-<ts>.db. Removes the stale -wal/-shm (they would be replayed onto
#      the new file) and moves the snapshot into place.
#   6. Copies bike-sensors.json (a differing local copy is backed up first) and new FIT files.
#
# Usage:
#   npm run pi:pull                 # pull from the Pi (asks once)
#   DRY_RUN=1 npm run pi:pull       # fetch + compare + report, change nothing locally
#   ASSUME_YES=1 npm run pi:pull    # unattended; still refuses if there are warnings
#
set -euo pipefail
# shellcheck source=pi-sync-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/pi-sync-common.sh"

require_tty_or_yes

LOCAL_INCOMING="$LOCAL_DB.incoming"
PI_SNAPSHOT=""
cleanup() {
  rm -rf "$TMP_DIR"
  rm -f "$LOCAL_INCOMING"
  if [[ -n "$PI_SNAPSHOT" ]]; then
    ssh -o ConnectTimeout=10 "$PI_HOST" "rm -f $(printf %q "$PI_SNAPSHOT")" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# --- 1. Preflight --------------------------------------------------------------
connect_pi
PI_DB="$PI_ROOT/$DB_REL"
echo "==> Pi source:    $PI_HOST:$PI_DB"
echo "==> Local target: $LOCAL_DB"
check_code_versions
refuse_if_app_running local "$LOCAL_DB"
file_exists pi "$PI_DB" || refuse "no database on the Pi at $PI_DB."

# --- 2. Consistent snapshot on the Pi, transferred and verified ---------------------
echo "==> Creating consistent snapshot on the Pi with VACUUM INTO ..."
PI_SNAPSHOT="$PI_ROOT/data/.ridestack_snapshot_pull.db"
run_on pi "rm -f $(printf %q "$PI_SNAPSHOT") && sqlite3 $(printf %q "$PI_DB") \"VACUUM INTO '$PI_SNAPSHOT';\""
integrity_ok pi "$PI_SNAPSHOT" || refuse "the Pi snapshot failed integrity_check."

echo "==> Transferring snapshot from the Pi ..."
rsync -ah --partial --progress "$PI_HOST:$PI_SNAPSHOT" "$LOCAL_INCOMING"
integrity_ok local "$LOCAL_INCOMING" || refuse "the transferred snapshot failed integrity_check."
echo "    Snapshot OK ($(du -h "$LOCAL_INCOMING" | cut -f1))."
warn_running_sync local "$LOCAL_INCOMING" Pi

# --- 3. Compare ----------------------------------------------------------------------
LOCAL_HAS_DB=0
if [[ -f "$LOCAL_DB" ]]; then
  LOCAL_HAS_DB=1
  compare_dbs local "$LOCAL_INCOMING" Pi local "$LOCAL_DB" local
else
  echo "==> No local database yet."
fi
compare_files pi local

print_summary "Will replace the local database$([[ "$LOCAL_HAS_DB" == "1" ]] && echo " (backed up to $BACKUP_REL/ first)") and copy the data files above."
if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> DRY RUN complete. No local data was changed."
  exit 0
fi
confirm "Replace the local data with the Pi's?"

# --- 5. Back up, replace ------------------------------------------------------------
# Something may have opened the database since the preflight.
refuse_if_app_running local "$LOCAL_DB"

TS="$(date +%Y%m%d_%H%M%S)"
LOCAL_BACKUP="$REPO_ROOT/$BACKUP_REL/pre-sync-$TS.db"
if [[ "$LOCAL_HAS_DB" == "1" ]]; then
  echo "==> Backing up the local database with sqlite3 .backup ..."
  mkdir -p "$REPO_ROOT/$BACKUP_REL"
  sqlite3 "$LOCAL_DB" ".backup '$LOCAL_BACKUP'"
  echo "    Backup: $LOCAL_BACKUP"
fi

echo "==> Replacing the local database ..."
rm -f "$LOCAL_DB-wal" "$LOCAL_DB-shm"
mv "$LOCAL_INCOMING" "$LOCAL_DB"

# --- 6. Data files ----------------------------------------------------------------------
copy_files pi local "$TS"

echo "==> Done. Data pulled from $PI_HOST:$PI_ROOT"
if [[ "$LOCAL_HAS_DB" == "1" ]]; then
  echo "    The previous local database remains in: $LOCAL_BACKUP"
fi
