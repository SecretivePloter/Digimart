#!/usr/bin/env bash
set -euo pipefail
umask 077
# Run as root; backups contain credentials and must remain private.
test "$(id -u)" = 0
test -n "${BACKUP_DIR:-}" || { echo 'Set BACKUP_DIR to a private backup directory'; exit 1; }
install -d -m 0700 "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
restart_bot=0
if systemctl is-active --quiet lidealabs@whatsapp; then restart_bot=1; systemctl stop lidealabs@whatsapp; fi
trap 'if [ "$restart_bot" = 1 ]; then systemctl start lidealabs@whatsapp; fi' EXIT
tar -czf "$BACKUP_DIR/config-session-$stamp.tar.gz" /etc/lidealabs /var/lib/lidealabs /etc/systemd/system/lidealabs@.service
# DATABASE_URL_UNPOOLED must be supplied through a private environment, never a CLI argument.
test -n "${DATABASE_URL_UNPOOLED:-}" || { echo 'Database backup requires private DATABASE_URL_UNPOOLED'; exit 1; }
PGDATABASE="$DATABASE_URL_UNPOOLED" pg_dump --format=custom --file="$BACKUP_DIR/database-$stamp.dump"
sha256sum "$BACKUP_DIR/config-session-$stamp.tar.gz" "$BACKUP_DIR/database-$stamp.dump" > "$BACKUP_DIR/checksums-$stamp.txt"
echo "Private backup created: $stamp"
