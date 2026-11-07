#!/bin/sh
set -eu
umask 077
archive=${1:?Usage: release-admin-ai.sh ARCHIVE COMMIT}
commit=${2:?Missing commit}
case "$commit" in *[!a-f0-9]*|'') echo 'Invalid commit'; exit 1;; esac
previous=$(readlink -f /opt/lidealabs/current)
release=/opt/lidealabs/releases/20261107-admin-ai-$commit
test -d "$previous"
test ! -e "$release"
test -f "$archive"
actual=$(git get-tar-commit-id < "$archive")
test "$actual" = "$commit" || { echo 'Archive commit does not match requested commit'; exit 1; }
backup=/var/backups/lidealabs/before-admin-ai-$(date -u +%Y%m%dT%H%M%SZ).dump
install -d -m 0700 /var/backups/lidealabs
runuser -u postgres -- pg_dump -Fc lidealabs > "$backup"
pg_restore --list "$backup" > "$backup.list"
test -s "$backup"
install -d -o lidealabs -g lidealabs "$release"
tar -xf "$archive" -C "$release"
printf '%s\n' "$commit" > "$release/RELEASE_COMMIT"
printf '%s\n' "$previous" > "$release/PREVIOUS_RELEASE"
chown -R lidealabs:lidealabs "$release"
cd "$release"
runuser -u lidealabs -- npm ci --ignore-scripts
runuser -u lidealabs -- npm run build
runuser -u lidealabs -- npm test
runuser -u lidealabs -- node --env-file=/etc/lidealabs/app.env dist/migrate.js
switched=false
rollback() {
 if [ "$switched" = true ]; then
  ln -s "$previous" /opt/lidealabs/current.ai-rollback
  mv -Tf /opt/lidealabs/current.ai-rollback /opt/lidealabs/current
  systemctl restart lidealabs@whatsapp
 fi
}
trap rollback EXIT
ln -s "$release" /opt/lidealabs/current.ai-next
mv -Tf /opt/lidealabs/current.ai-next /opt/lidealabs/current
switched=true
systemctl restart lidealabs@whatsapp
sleep 8
systemctl is-active lidealabs@whatsapp lidealabs@server
curl --fail -s http://127.0.0.1:3000/health
trap - EXIT
printf '\nActive release: %s\nRollback target: %s\nBackup: %s\n' "$release" "$previous" "$backup"
