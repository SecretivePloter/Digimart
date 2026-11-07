#!/usr/bin/env bash
# One-time cutover record for the already-tested release.
set -euo pipefail
umask 077
release=/opt/lidealabs/releases/20261103-qris-downloader
backup=/var/backups/lidealabs/downloader-20261103
install -d -m 0700 "$backup"
cp -a /etc/lidealabs/app.env "$backup/app.env.before"
readlink -f /opt/lidealabs/current > "$backup/previous-release"
runuser -u postgres -- pg_dump -Fc lidealabs > "$backup/before.dump"
pg_restore --list "$backup/before.dump" >/dev/null
rollback() {
 cp -a "$backup/app.env.before" /etc/lidealabs/app.env
 ln -sfn "$(cat "$backup/previous-release")" /opt/lidealabs/current.rollback
 mv -Tf /opt/lidealabs/current.rollback /opt/lidealabs/current
 systemctl restart lidealabs@server lidealabs@whatsapp
}
trap rollback ERR
install -d -m 0700 -o lidealabs -g lidealabs /var/lib/lidealabs/downloads
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/lidealabs/app.env')
values={'DOWNLOADER_ENABLED':'true','YT_DLP_PATH':'/opt/lidealabs/tools/yt-dlp_linux','DOWNLOAD_TEMP_DIR':'/var/lib/lidealabs/downloads'}
lines=[line for line in p.read_text().splitlines() if line.split('=',1)[0] not in values]
p.write_text('\n'.join(lines+[k+'='+v for k,v in values.items()])+'\n')
PY
cd "$release"
runuser -u lidealabs -- node --env-file=/etc/lidealabs/app.env deploy/probe-manual-checkout.mjs
systemctl stop lidealabs@whatsapp lidealabs@server
ln -s "$release" /opt/lidealabs/current.downloader
mv -Tf /opt/lidealabs/current.downloader /opt/lidealabs/current
systemctl start lidealabs@server lidealabs@whatsapp
sleep 4
systemctl is-active lidealabs@server lidealabs@whatsapp
curl --fail -s http://127.0.0.1:3000/health
printf '\n'
trap - ERR
