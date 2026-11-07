#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
dir=/var/backups/lidealabs
install -d -m 0700 "$dir"
exec 9>/run/lock/lidealabs-backup.lock
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp="$dir/.database-$stamp.tmp"
final="$dir/database-$stamp.dump"
trap 'rm -f -- "$tmp"; echo "Backup failed or interrupted" >&2' ERR
runuser -u postgres -- pg_dump --format=custom --dbname=lidealabs > "$tmp"
pg_restore --list "$tmp" >/dev/null
test -s "$tmp"
mv "$tmp" "$final"
sha256sum "$final" > "$final.sha256"
# Evidence files are immutable on disk, including older revisions. Taking this
# archive after the database dump retains every file referenced by that dump.
assets="$dir/database-$stamp.assets.tar.gz"
tar -czf "$assets.tmp" -C /var/lib/lidealabs private manual-evidence
mv "$assets.tmp" "$assets"
sha256sum "$assets" > "$assets.sha256"
# A public recipient is sufficient for encryption; private key lives off-server.
if test -s /etc/lidealabs/backup-recipient.txt; then
  age -R /etc/lidealabs/backup-recipient.txt -o "$final.age.tmp" "$final"
  mv "$final.age.tmp" "$final.age"
  sha256sum "$final.age" > "$final.age.sha256"
  age -R /etc/lidealabs/backup-recipient.txt -o "$assets.age.tmp" "$assets"
  mv "$assets.age.tmp" "$assets.age"
  sha256sum "$assets.age" > "$assets.age.sha256"
fi
# Prune only after a new dump and encryption have succeeded.
mapfile -t old < <(find "$dir" -maxdepth 1 -name 'database-*.dump' -printf '%f\n' | sort -r | tail -n +8)
for file in "${old[@]}"; do
  rm -f -- "$dir/$file" "$dir/$file.sha256" "$dir/$file.age" "$dir/$file.age.sha256"
  oldassets="${file%.dump}.assets.tar.gz"
  rm -f -- "$dir/$oldassets" "$dir/$oldassets.sha256" "$dir/$oldassets.age" "$dir/$oldassets.age.sha256"
done
echo "Backup succeeded: database-$stamp.dump"
