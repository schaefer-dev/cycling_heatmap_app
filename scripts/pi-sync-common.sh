# Shared by sync_to_pi.sh and sync_from_pi.sh (sourced, not run).
#
# Both scripts copy the same three things from a source checkout to a target checkout:
#   data/cycling_archive.db   replaced by a consistent snapshot (the target is backed up first)
#   data/bike-sensors.json    personal sensor rules (gitignored); a differing target is backed up
#   data/fit/                 raw FIT files; additive, nothing is ever deleted
# .env is never touched.
#
# Configuration (environment, else a PI_HOST=/PI_REPO= line in .env; nothing else is read there):
#   PI_HOST  ssh destination, e.g. user@192.168.1.20 (required)
#   PI_REPO  checkout on the Pi (default: ~/dev/ridestack)
#   PI_SERVICE  systemd unit on the Pi (default: ridestack, see deploy/ridestack.service)
#   DRY_RUN=1          compare and report only, change nothing
#   ASSUME_YES=1        no prompt; still refuses when there are warnings
#   ALLOW_DROP_RIDES=1  allow replacing a database that has rides the source lacks
#
# Works with macOS bash 3.2 (no associative arrays, no mapfile).

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_REL="data/cycling_archive.db"
SENSORS_REL="data/bike-sensors.json"
FIT_REL="data/fit"
BACKUP_REL="data/backups"
LOCAL_DB="$REPO_ROOT/$DB_REL"

# Reads one KEY=value line from .env without sourcing the file (it holds API secrets).
env_file_value() {
  [[ -f "$REPO_ROOT/.env" ]] || return 0
  sed -n "s/^$1=//p" "$REPO_ROOT/.env" | tail -1 | sed -e "s/^[\"']//" -e "s/[\"']\$//"
}
PI_HOST="${PI_HOST:-$(env_file_value PI_HOST)}"
PI_REPO="${PI_REPO:-$(env_file_value PI_REPO)}"
# Expanded by the Pi's shell, not here.
if [[ -z "$PI_REPO" ]]; then PI_REPO='~/dev/ridestack'; fi
PI_SERVICE="${PI_SERVICE:-ridestack}"
DRY_RUN="${DRY_RUN:-0}"
ASSUME_YES="${ASSUME_YES:-0}"
ALLOW_DROP_RIDES="${ALLOW_DROP_RIDES:-0}"

TMP_DIR="$(mktemp -d -t ridestack_sync.XXXXXX)"

# --- Output helpers ----------------------------------------------------------
if [[ -t 2 ]]; then
  RED=$'\033[1;31m' YELLOW=$'\033[1;33m' RESET=$'\033[0m'
else
  RED="" YELLOW="" RESET=""
fi

WARNINGS=()
warn() { WARNINGS+=("$1"); }

print_warnings() {
  local w
  for w in "${WARNINGS[@]+"${WARNINGS[@]}"}"; do
    echo "${YELLOW}!! WARNING:${RESET} $w" >&2
  done
}

refuse() {
  echo "${RED}REFUSED:${RESET} $1" >&2
  shift
  local line
  for line in "$@"; do echo "         $line" >&2; done
  exit "${REFUSE_CODE:-1}"
}

# An unattended run can never answer the prompt; refuse before doing any work.
require_tty_or_yes() {
  if [[ "$DRY_RUN" != "1" && "$ASSUME_YES" != "1" && ! -t 0 ]]; then
    REFUSE_CODE=2 refuse "not running interactively, so nothing can confirm the swap." \
      "Run it in a terminal, preview with DRY_RUN=1, or set ASSUME_YES=1."
  fi
}

# Asks once; ASSUME_YES skips the question but never overrides warnings.
confirm() {
  if [[ "$ASSUME_YES" == "1" ]]; then
    if [[ ${#WARNINGS[@]} -gt 0 ]]; then
      REFUSE_CODE=3 refuse "ASSUME_YES does not override warnings; a human must check them first." \
        "Rerun interactively to confirm."
    fi
    return 0
  fi
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] || { echo "Cancelled; nothing changed."; exit 1; }
}

# --- Running things on either side -------------------------------------------
# side is "local" or "pi"; commands are shell command lines.
run_on() {
  if [[ "$1" == "pi" ]]; then
    ssh -o ConnectTimeout=10 "$PI_HOST" "$2"
  else
    bash -c "$2"
  fi
}

# SQL goes in on stdin, so nothing needs quoting for ssh. Plain (not -readonly) open: a WAL
# database whose -shm is gone cannot be opened read-only. Callers only pass SELECTs and PRAGMAs.
sql() { # side db sql
  printf '%s\n' "$3" | run_on "$1" "sqlite3 -batch -separator '|' $(printf %q "$2")"
}

file_exists() { run_on "$1" "test -f $(printf %q "$2")"; }

has_table() { # side db table
  [[ -n "$(sql "$1" "$2" "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '$3';")" ]]
}

has_column() { # side db table column
  [[ -n "$(sql "$1" "$2" "SELECT 1 FROM pragma_table_info('$3') WHERE name = '$4';")" ]]
}

integrity_ok() { [[ "$(sql "$1" "$2" "PRAGMA integrity_check;" | head -1)" == "ok" ]]; }

# Resolves PI_REPO to an absolute path (PI_ROOT) and checks the tools both sides need.
connect_pi() {
  local tool
  if [[ -z "$PI_HOST" ]]; then
    refuse "PI_HOST is not set." "Set it in the environment or add a PI_HOST=user@host line to .env."
  fi
  for tool in sqlite3 rsync lsof; do
    command -v "$tool" >/dev/null || refuse "$tool is not installed on this machine."
  done
  echo "==> Connecting to $PI_HOST ..."
  PI_ROOT="$(ssh -o ConnectTimeout=10 "$PI_HOST" "cd $PI_REPO && pwd")" ||
    refuse "cannot open $PI_REPO on $PI_HOST."
  for tool in sqlite3 rsync lsof; do
    run_on pi "command -v $tool >/dev/null" ||
      refuse "$tool is not installed on the Pi." "Install it with: sudo apt install $tool"
  done
  echo "    Pi checkout: $PI_HOST:$PI_ROOT"
}

pi_service_active() {
  run_on pi "systemctl is-active --quiet $(printf %q "$PI_SERVICE")"
}

# systemctl <verb> PI_SERVICE on the Pi; asks for the sudo password (ssh -t) only when needed.
pi_systemctl() {
  local cmd
  cmd="systemctl $1 $(printf %q "$PI_SERVICE")"
  ssh -o ConnectTimeout=10 "$PI_HOST" "sudo -n $cmd" 2>/dev/null ||
    ssh -t -o ConnectTimeout=10 "$PI_HOST" "sudo $cmd"
}

root_of() { if [[ "$1" == "pi" ]]; then echo "$PI_ROOT"; else echo "$REPO_ROOT"; fi; }

# The receiving checkout must know the schema it gets; a different commit is worth a look.
check_code_versions() {
  local here there
  here="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
  there="$(run_on pi "git -C $(printf %q "$PI_ROOT") rev-parse --short HEAD 2>/dev/null || echo '?'")"
  echo "    Code: local $here, Pi $there"
  if [[ "$here" != "$there" ]]; then
    warn "the checkouts are at different commits (local $here, Pi $there). Update the older one (git pull) so it knows the database schema."
  fi
}

# PIDs of the Ridestack app or a CLI command on that side: anything holding the database, the
# dev tooling (vite, concurrently) and node running in <root>/server (the API server). The sync
# never stops them, since a Garmin/Hammerhead sync may be running inside the server.
app_pids() { # side root db
  local db
  db="$(printf %q "$3")"
  run_on "$1" "
    lsof -t $db $db-wal $db-shm 2>/dev/null
    pgrep -f $(printf %q "$2/node_modules/[.]bin/")
    lsof -a -c node -d cwd -Fpn 2>/dev/null |
      awk -v dir=$(printf %q "$2/server") '/^p/ { pid = substr(\$0, 2) } /^n/ && substr(\$0, 2) == dir { print pid }'
    true
  " | sort -u | tr '\n' ' '
}

refuse_if_app_running() { # side db
  local side="$1" root pids where
  root="$(root_of "$side")"
  pids="$(app_pids "$side" "$root" "$2")"
  [[ -z "${pids// /}" ]] && return 0
  if [[ "$side" == "pi" ]]; then where="on the Pi"; else where="on this machine"; fi
  # shellcheck disable=SC2086 # word splitting of the PID list is intended
  REFUSE_CODE=2 refuse "Ridestack (or one of its commands) is running $where:" \
    "$(run_on "$side" "ps -ww -o pid=,command= -p $(echo $pids | tr ' ' ',')" || true)" \
    "Stop it (Ctrl+C in its terminal or tmux window) and rerun. This script never stops it."
}

# Warns about a Garmin/Hammerhead sync recorded as running in the source database.
warn_running_sync() { # side db label
  local running
  has_table "$1" "$2" sync_runs || return 0
  running="$(sql "$1" "$2" "SELECT id || ' (started ' || started_at || ')' FROM sync_runs WHERE status = 'running';")"
  if [[ -n "$running" ]]; then
    warn "the $3 database has a sync run marked running: $(echo "$running" | tr '\n' ' '). It may be unfinished or stale; the copy holds whatever it had imported so far."
  fi
}

# --- Database comparison -------------------------------------------------------
# Reads only tables and columns that exist, so an old-schema database compares fine.
COUNT_TABLES="rides routes garmin_activities hammerhead_activities planned_routes"

table_count() { # side db table → row count, or - without the table
  if has_table "$1" "$2" "$3"; then sql "$1" "$2" "SELECT COUNT(*) FROM $3;"; else echo -; fi
}

# 'a','b',... from a file of ids, for an IN (...) list.
sql_id_list() { sed -e "s/'/''/g" -e "s/.*/'&'/" "$1" | paste -sd, -; }

# Compares the source database (about to be copied) with the target (about to be replaced).
# Rides only the target has are refused unless ALLOW_DROP_RIDES=1; edits that would be undone
# become warnings. Sets DROPPED_RIDES.
compare_dbs() { # src_side src_db src_label dst_side dst_db dst_label
  local ss="$1" sdb="$2" sl="$3" ds="$4" ddb="$5" dl="$6" t ids n lines src_uv dst_uv

  src_uv="$(sql "$ss" "$sdb" "PRAGMA user_version;")"
  dst_uv="$(sql "$ds" "$ddb" "PRAGMA user_version;")"
  echo "==> Comparison (table | $dl now | $sl, replacing it):"
  printf '    %-24s %10s %10s\n' "schema (user_version)" "$dst_uv" "$src_uv"
  for t in $COUNT_TABLES; do
    printf '    %-24s %10s %10s\n' "$t" "$(table_count "$ds" "$ddb" "$t")" "$(table_count "$ss" "$sdb" "$t")"
  done
  if (( dst_uv > src_uv )); then
    REFUSE_CODE=3 refuse "the $dl database has a newer schema (v$dst_uv) than the $sl one (v$src_uv)." \
      "The $sl copy is behind; sync in the other direction first."
  fi

  DROPPED_RIDES=0
  has_table "$ds" "$ddb" rides || return 0

  # Rides the target has and the source lacks.
  sql "$ss" "$sdb" "SELECT id FROM rides;" | LC_ALL=C sort > "$TMP_DIR/src_ids"
  sql "$ds" "$ddb" "SELECT id FROM rides;" | LC_ALL=C sort > "$TMP_DIR/dst_ids"
  LC_ALL=C comm -13 "$TMP_DIR/src_ids" "$TMP_DIR/dst_ids" > "$TMP_DIR/dropped"
  DROPPED_RIDES="$(wc -l < "$TMP_DIR/dropped" | tr -d ' ')"
  if (( DROPPED_RIDES > 0 )); then
    lines="$(sql "$ds" "$ddb" "SELECT date || ' | ' || COALESCE(title, '') || ' | ' || printf('%.1f km', COALESCE(distance_km, 0)) FROM rides WHERE id IN ($(sql_id_list "$TMP_DIR/dropped")) ORDER BY date;" | sed 's/^/           /')"
    if [[ "$ALLOW_DROP_RIDES" != "1" ]]; then
      echo "$lines" >&2
      REFUSE_CODE=3 refuse "the $dl database has $DROPPED_RIDES ride(s) the $sl one lacks (listed above); replacing it drops them." \
        "Sync in the other direction first, or set ALLOW_DROP_RIDES=1 if they are dispensable" \
        "(e.g. duplicates); they stay in the backup."
    fi
    warn "$DROPPED_RIDES ride(s) only on the $dl side will be dropped (ALLOW_DROP_RIDES=1; they stay in the backup):
$lines"
  fi

  # Rides on both sides whose title, bike or notes differ: the target's edit would be undone.
  # hex() keeps every row on one line whatever the notes contain.
  local fp="id || '|' || hex(COALESCE(title, '') || char(31) || COALESCE(bike_type, '') || char(31) || COALESCE(notes, ''))"
  sql "$ss" "$sdb" "SELECT $fp FROM rides;" | LC_ALL=C sort > "$TMP_DIR/src_fp"
  sql "$ds" "$ddb" "SELECT $fp FROM rides;" | LC_ALL=C sort > "$TMP_DIR/dst_fp"
  LC_ALL=C join -t'|' "$TMP_DIR/src_fp" "$TMP_DIR/dst_fp" | awk -F'|' '$2 != $3 { print $1 }' > "$TMP_DIR/changed"
  n="$(wc -l < "$TMP_DIR/changed" | tr -d ' ')"
  if (( n > 0 )); then
    ids="$(sql_id_list "$TMP_DIR/changed")"
    local row="SELECT id, date, replace(COALESCE(title, ''), '|', '/'), COALESCE(bike_type, '-'), hex(COALESCE(notes, '')) FROM rides WHERE id IN ($ids);"
    sql "$ds" "$ddb" "$row" > "$TMP_DIR/changed_dst"
    sql "$ss" "$sdb" "$row" > "$TMP_DIR/changed_src"
    lines="$(awk -F'|' '
      NR == FNR { title[$1] = $3; bike[$1] = $4; notes[$1] = $5; next }
      { printf "           %s | %s [%s] -> %s [%s]%s\n", $2, title[$1], bike[$1], $3, $4, (notes[$1] != $5 ? " (notes differ)" : "") }
    ' "$TMP_DIR/changed_dst" "$TMP_DIR/changed_src" | sort | head -20)"
    warn "$n ride(s) were edited differently on the two sides; the $dl version is replaced ($dl -> $sl, first 20):
$lines"
  fi

  # Route names the user set on the target that the source lacks or names differently.
  if has_table "$ss" "$sdb" routes && has_table "$ds" "$ddb" routes && has_column "$ds" "$ddb" routes name_source; then
    sql "$ss" "$sdb" "SELECT id || '|' || hex(name) FROM routes;" | LC_ALL=C sort > "$TMP_DIR/src_routes"
    sql "$ds" "$ddb" "SELECT id || '|' || hex(name) FROM routes WHERE name_source = 'user';" | LC_ALL=C sort > "$TMP_DIR/dst_routes"
    LC_ALL=C comm -13 "$TMP_DIR/src_routes" "$TMP_DIR/dst_routes" | cut -d'|' -f1 > "$TMP_DIR/lost_routes"
    n="$(wc -l < "$TMP_DIR/lost_routes" | tr -d ' ')"
    if (( n > 0 )); then
      lines="$(sql "$ds" "$ddb" "SELECT name FROM routes WHERE id IN ($(sql_id_list "$TMP_DIR/lost_routes")) ORDER BY name;" | head -20 | sed 's/^/           /')"
      warn "$n route name(s) you set on the $dl side are missing or different on the $sl side (first 20):
$lines"
    fi
  fi
}

# --- Data files -----------------------------------------------------------------
# Sets SENSORS_ACTION (skip | same | new | replace) and FIT_NEW (files the target lacks).
compare_files() { # src_side dst_side
  local ss="$1" ds="$2" src_sum dst_sum sroot droot
  sroot="$(root_of "$ss")"
  droot="$(root_of "$ds")"

  src_sum="$(run_on "$ss" "{ cksum < $(printf %q "$sroot/$SENSORS_REL"); } 2>/dev/null || true")"
  dst_sum="$(run_on "$ds" "{ cksum < $(printf %q "$droot/$SENSORS_REL"); } 2>/dev/null || true")"
  if [[ -z "$src_sum" ]]; then SENSORS_ACTION=skip
  elif [[ -z "$dst_sum" ]]; then SENSORS_ACTION=new
  elif [[ "$src_sum" == "$dst_sum" ]]; then SENSORS_ACTION=same
  else SENSORS_ACTION=replace
  fi

  local list="find . -type f 2>/dev/null | LC_ALL=C sort"
  run_on "$ss" "cd $(printf %q "$sroot/$FIT_REL") 2>/dev/null && $list || true" > "$TMP_DIR/src_fit"
  run_on "$ds" "cd $(printf %q "$droot/$FIT_REL") 2>/dev/null && $list || true" > "$TMP_DIR/dst_fit"
  FIT_NEW="$(LC_ALL=C comm -23 "$TMP_DIR/src_fit" "$TMP_DIR/dst_fit" | wc -l | tr -d ' ')"
  local fit_total
  fit_total="$(wc -l < "$TMP_DIR/src_fit" | tr -d ' ')"

  echo "==> Data files:"
  case "$SENSORS_ACTION" in
    skip) echo "    $SENSORS_REL: none on the source side; left alone" ;;
    same) echo "    $SENSORS_REL: identical" ;;
    new) echo "    $SENSORS_REL: will be copied (none on the target yet)" ;;
    replace) echo "    $SENSORS_REL: differs; the target's copy is backed up, then replaced" ;;
  esac
  echo "    $FIT_REL/: $FIT_NEW new of $fit_total file(s); files only on the target are kept"
}

# Backs up a differing sensors file on the target, then copies the sensors file and new FITs.
copy_files() { # src_side dst_side timestamp
  local ss="$1" ds="$2" ts="$3" sroot droot src dst
  sroot="$(root_of "$ss")"
  droot="$(root_of "$ds")"
  rsync_path() { if [[ "$1" == "pi" ]]; then echo "$PI_HOST:$2"; else echo "$2"; fi; }

  if [[ "$SENSORS_ACTION" == "replace" ]]; then
    run_on "$ds" "mkdir -p $(printf %q "$droot/$BACKUP_REL") && cp -p $(printf %q "$droot/$SENSORS_REL") $(printf %q "$droot/$BACKUP_REL/bike-sensors-$ts.json")"
    echo "    Backup: $droot/$BACKUP_REL/bike-sensors-$ts.json"
  fi
  if [[ "$SENSORS_ACTION" == "new" || "$SENSORS_ACTION" == "replace" ]]; then
    echo "==> Copying $SENSORS_REL ..."
    rsync -a "$(rsync_path "$ss" "$sroot/$SENSORS_REL")" "$(rsync_path "$ds" "$droot/$SENSORS_REL")"
  fi

  if (( FIT_NEW > 0 )); then
    echo "==> Copying $FIT_NEW FIT file(s) ..."
    src="$(rsync_path "$ss" "$sroot/$FIT_REL/")"
    dst="$(rsync_path "$ds" "$droot/$FIT_REL/")"
    rsync -a "$src" "$dst"
  fi
}

print_summary() { # what_happens
  echo
  echo "==> Summary"
  echo "    $1"
  if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo "    ${#WARNINGS[@]} warning(s); check before continuing:"
    print_warnings
  else
    echo "    No warnings."
  fi
  echo
}
