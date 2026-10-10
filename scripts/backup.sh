#!/bin/sh
set -eu
umask 077
mkdir -p /backups
backup() {
  destination="/backups/shawarma-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
  if pg_dump --format=custom --file="$destination.tmp" && pg_restore --list "$destination.tmp" >/dev/null; then
    mv "$destination.tmp" "$destination"
    touch /backups/last-success
    # Only this service's complete daily archives, in its fixed backup directory.
    find /backups -maxdepth 1 -type f -name 'shawarma-*.dump' -mtime +13 -delete
    echo "Database backup completed."
    return 0
  fi
  echo "Database backup failed; will retry." >&2
  return 1
}
if [ "${1:-}" = '--once' ]; then backup; exit; fi
while true; do
  if backup; then sleep 86400; else sleep 60; fi
done
