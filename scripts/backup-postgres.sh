#!/usr/bin/env bash
# Create a consistent, checksummed PostgreSQL backup suitable for a restore
# rehearsal. Schedule this every five minutes only when BACKUP_DIR is durable,
# encrypted, and replicated off the primary host/provider.

set -euo pipefail
umask 077

err()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
okay() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }

command -v pg_dump >/dev/null || { err "pg_dump not found — install PostgreSQL client tools"; exit 1; }

sha256() {
  if command -v shasum >/dev/null; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  elif command -v sha256sum >/dev/null; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    err "No SHA-256 checksum utility found (need shasum or sha256sum)"
    return 1
  fi
}

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the database to back up}"
: "${BACKUP_DIR:?Set BACKUP_DIR to an existing durable backup directory}"

[[ -d "$BACKUP_DIR" ]] || { err "BACKUP_DIR '$BACKUP_DIR' does not exist or is not a directory"; exit 1; }
[[ "$BACKUP_DIR" != "/" ]] || { err "Refusing to write backups directly to /"; exit 1; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_name="anansi-${timestamp}.dump"
manifest_name="${backup_name}.json"
lock_dir="$BACKUP_DIR/.anansi-backup.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  err "Another backup appears to be running ($lock_dir exists); refusing overlapping dumps."
  exit 1
fi
temporary_dump="$(mktemp "$BACKUP_DIR/.anansi-backup.XXXXXX")"
cleanup() {
  rm -f "$temporary_dump"
  rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_seconds="$(date +%s)"
info "Creating PostgreSQL custom-format backup..."
pg_dump --format=custom --no-owner --no-privileges --file="$temporary_dump" "$SOURCE_DATABASE_URL"

backup_path="$BACKUP_DIR/$backup_name"
mv "$temporary_dump" "$backup_path"

checksum="$(sha256 "$backup_path")"
completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
duration_seconds=$(( $(date +%s) - started_seconds ))
bytes="$(wc -c < "$backup_path" | tr -d ' ')"

cat > "$BACKUP_DIR/$manifest_name" <<EOF
{
  "format": "pg_dump custom",
  "createdAt": "$completed_at",
  "snapshotStartedAt": "$started_at",
  "durationSeconds": $duration_seconds,
  "file": "$backup_name",
  "bytes": $bytes,
  "sha256": "$checksum"
}
EOF

okay "Backup complete: $backup_path (${bytes} bytes, ${duration_seconds}s)"
info "Manifest: $BACKUP_DIR/$manifest_name"
info "Upload both files to independent durable storage before treating this as an RPO point."
