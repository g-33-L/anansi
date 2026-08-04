#!/usr/bin/env bash
# Restore rehearsal — proves a backup of the Anansi database can actually be
# restored, and that the restored data is coherent. Run this at least once
# before launch and monthly after (see _docs/BACKUP_RESTORE.md).
#
# Usage:
#   SOURCE_DATABASE_URL=postgres://...   the database to back up (prod or a fresh dump)
#   TARGET_DATABASE_URL=postgres://...   a SCRATCH database — will be DROPPED and recreated
#   ./scripts/restore-rehearsal.sh
#
#   # or restore an existing dump file instead of dumping live:
#   DUMP_FILE=backups/anansi-2026-07-14.dump TARGET_DATABASE_URL=... ./scripts/restore-rehearsal.sh
#
# Safety: the script refuses to restore INTO any URL that doesn't contain
# "scratch" or "rehearsal" in the database name, so it can never point at prod.

set -euo pipefail

err()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
okay() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

command -v pg_dump >/dev/null || { err "pg_dump not found — install postgresql client tools"; exit 1; }
command -v pg_restore >/dev/null || { err "pg_restore not found"; exit 1; }
command -v psql >/dev/null || { err "psql not found"; exit 1; }

: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to a scratch database URL (will be wiped)}"

# ─── Guardrail: never restore over a non-scratch database ─────────────────────
TARGET_DB_NAME="$(basename "${TARGET_DATABASE_URL%%\?*}")"
case "$TARGET_DB_NAME" in
  *scratch*|*rehearsal*|*restore_test*) ;;
  *)
    err "Refusing: target database name '$TARGET_DB_NAME' must contain 'scratch', 'rehearsal', or 'restore_test'."
    err "This script DROPS the target schema. Point it at a throwaway database."
    exit 1
    ;;
esac

# A PostgreSQL client newer than the restore target can emit session settings
# that the target does not understand (for example, pg_dump 17 → PostgreSQL
# 16 emits `SET transaction_timeout`). A drill must prove the production
# restore path, so require a major-version-matched client and, for live dumps,
# a source/target pair on the same major version.
server_major() {
  psql "$1" -v ON_ERROR_STOP=1 -tA -c "SHOW server_version_num" | awk '{ print int($1 / 10000) }'
}

CLIENT_MAJOR="$(pg_restore --version | sed -E 's/.* ([0-9]+)(\..*)?$/\1/')"
TARGET_MAJOR="$(server_major "$TARGET_DATABASE_URL")" || {
  err "Could not determine target PostgreSQL version."
  exit 1
}
if [[ "$CLIENT_MAJOR" != "$TARGET_MAJOR" ]]; then
  err "PostgreSQL client major $CLIENT_MAJOR does not match restore target major $TARGET_MAJOR."
  err "Use matching pg_dump/pg_restore tools; cross-major rehearsals do not prove a supported restore path."
  exit 1
fi
if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  SOURCE_MAJOR="$(server_major "$SOURCE_DATABASE_URL")" || {
    err "Could not determine source PostgreSQL version."
    exit 1
  }
  if [[ "$SOURCE_MAJOR" != "$TARGET_MAJOR" ]]; then
    err "Source PostgreSQL major $SOURCE_MAJOR does not match restore target major $TARGET_MAJOR."
    err "Restore into the same major version as the source, then perform an explicit upgrade separately."
    exit 1
  fi
fi

START_TS=$(date +%s)
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# ─── 1. Obtain the dump and source evidence ───────────────────────────────────
# Keeping source counts makes this a restore *proof*, not merely a check that a
# database can be opened after pg_restore. If a dump is supplied directly there
# is no source to compare with, so the structural checks below remain in force.
TABLES=(
  workspaces developer_accounts developer_api_keys memory_users memory_chunks
  static_documents entity_nodes entity_edges subscriptions
)
SOURCE_COUNTS_FILE="$WORKDIR/source-counts.tsv"
HAS_SOURCE_COUNTS=false

source_count() {
  local table="$1"
  psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "SELECT count(*) FROM \"${table}\""
}

if [[ -n "${DUMP_FILE:-}" ]]; then
  [[ -f "$DUMP_FILE" ]] || { err "DUMP_FILE '$DUMP_FILE' does not exist"; exit 1; }
  okay "Using existing dump: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
else
  : "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL (or DUMP_FILE) to produce a backup}"
  info "Capturing source row counts for restore comparison..."
  for table in "${TABLES[@]}"; do
    source_rows="$(source_count "$table")" || {
      err "Could not count source table '$table'; refusing to rehearse an unverifiable backup."
      exit 1
    }
    printf '%s\t%s\n' "$table" "$source_rows" >> "$SOURCE_COUNTS_FILE"
  done
  HAS_SOURCE_COUNTS=true
  DUMP_FILE="$WORKDIR/rehearsal.dump"
  info "Dumping source database (custom format, includes pgvector columns)..."
  DUMP_START=$(date +%s)
  pg_dump --format=custom --no-owner --no-privileges \
    --file="$DUMP_FILE" "$SOURCE_DATABASE_URL"
  okay "Dump complete in $(( $(date +%s) - DUMP_START ))s ($(du -h "$DUMP_FILE" | cut -f1))"
fi

# ─── 2. Recreate the scratch schema and restore ───────────────────────────────
info "Resetting scratch database '$TARGET_DB_NAME'..."
# Drizzle stores migration history in its own schema. Reset both application
# schemas so replaying the archive into a previously rehearsed target is as
# clean as a new database, rather than failing on `CREATE SCHEMA drizzle`.
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA IF EXISTS public, drizzle CASCADE; CREATE SCHEMA public;"

info "Restoring..."
RESTORE_START=$(date +%s)
# --no-owner/--no-privileges: scratch DB user differs from prod roles. We let
# the dump create pgvector itself; pre-creating it turns a real restore into a
# misleading success with an ignored "extension already exists" failure.
if ! pg_restore --no-owner --no-privileges --exit-on-error \
  --dbname="$TARGET_DATABASE_URL" "$DUMP_FILE" 2>"$WORKDIR/restore-errors.log"; then
  err "pg_restore failed; the backup is NOT restorable."
  head -20 "$WORKDIR/restore-errors.log" | sed 's/^/    /' >&2
  exit 1
fi
RESTORE_SECS=$(( $(date +%s) - RESTORE_START ))
okay "Restore finished in ${RESTORE_SECS}s"

# ─── 3. Sanity checks — the restore is only real if the data is coherent ─────
q() { psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }

FAILED=0
check() { # check <label> <query> <predicate-description>
  local label="$1" result
  result=$(q "$2") || { err "$label: query failed"; FAILED=1; return; }
  if [[ -n "$3" && "$result" == "0" ]]; then
    err "$label: $result ($3)"
    FAILED=1
  else
    okay "$label: $result"
  fi
}

echo ""
info "Sanity checks:"
for table in "${TABLES[@]}"; do
  restored_count="$(q "SELECT count(*) FROM \"${table}\"")" || {
    err "$table: query failed"
    FAILED=1
    continue
  }
  expected_count=""
  if [[ "$HAS_SOURCE_COUNTS" == "true" ]]; then
    expected_count="$(awk -F '\t' -v table="$table" '$1 == table { print $2 }' "$SOURCE_COUNTS_FILE")"
  fi
  if [[ -n "$expected_count" && "$restored_count" != "$expected_count" ]]; then
    err "$table: restored $restored_count row(s), expected $expected_count"
    FAILED=1
  else
    okay "$table: $restored_count"
  fi
done

check "chunks with embeddings" "SELECT count(*) FROM memory_chunks WHERE embedding IS NOT NULL" ""

# Referential integrity spot checks — FK orphans mean a broken restore
ORPHAN_CHUNKS=$(q "SELECT count(*) FROM memory_chunks c LEFT JOIN workspaces w ON w.id = c.workspace_id WHERE w.id IS NULL")
if [[ "$ORPHAN_CHUNKS" == "0" ]]; then okay "FK integrity: no orphaned chunks"; else err "FK integrity: $ORPHAN_CHUNKS orphaned chunks"; FAILED=1; fi

ORPHAN_EDGES=$(q "SELECT count(*) FROM entity_edges e LEFT JOIN entity_nodes n ON n.id = e.from_entity_id WHERE n.id IS NULL")
if [[ "$ORPHAN_EDGES" == "0" ]]; then okay "FK integrity: no orphaned edges"; else err "FK integrity: $ORPHAN_EDGES orphaned edges"; FAILED=1; fi

# A vector column must round-trip as a parseable vector, not text garbage
VECTOR_INVALID=$(q "SELECT count(*) FROM memory_chunks WHERE embedding IS NOT NULL AND vector_dims(embedding) <> 768" 2>/dev/null || echo "skip")
if [[ "$VECTOR_INVALID" == "skip" ]]; then
  err "pgvector round-trip check could not run"
  FAILED=1
elif [[ "$VECTOR_INVALID" != "0" ]]; then
  err "pgvector round-trip: $VECTOR_INVALID embedded chunk(s) have a non-768 dimension"
  FAILED=1
else
  okay "pgvector round-trip: all embedded chunks are 768-dimensional"
fi

# ─── 4. Verdict ───────────────────────────────────────────────────────────────
TOTAL_SECS=$(( $(date +%s) - START_TS ))
echo ""
if [[ "$FAILED" == "1" ]]; then
  err "REHEARSAL FAILED in ${TOTAL_SECS}s — this backup is NOT restorable. Fix before trusting it."
  exit 1
fi
okay "REHEARSAL PASSED in ${TOTAL_SECS}s (restore step: ${RESTORE_SECS}s)."
info "Record ${RESTORE_SECS}s as the current RTO data point in _docs/BACKUP_RESTORE.md."
