#!/usr/bin/env bash
set -euo pipefail
umask 077
release=/opt/lidealabs/releases/20261103-qris-manual
backup=/var/backups/lidealabs/qris-20261103
previous=$(cat "$backup/previous-release")
rollback() {
 echo 'Restoring previous application/config; database records are preserved.' >&2
 cp -a "$backup/app.env.before" /etc/lidealabs/app.env
 ln -sfn "$previous" /opt/lidealabs/current.rollback
 mv -Tf /opt/lidealabs/current.rollback /opt/lidealabs/current
 systemctl restart lidealabs@server lidealabs@whatsapp
}
trap rollback ERR
systemctl stop lidealabs@whatsapp lidealabs@server
runuser -u postgres -- pg_dump -Fc lidealabs > "$backup/cutover.dump"
pg_restore --list "$backup/cutover.dump" >/dev/null
cp -a /etc/lidealabs/app.env "$backup/app.env.before"
tar -czf "$backup/config-session.tar.gz" /etc/lidealabs /var/lib/lidealabs /etc/systemd/system/lidealabs@.service
age -R /etc/lidealabs/backup-recipient.txt -o "$backup/cutover.dump.age" "$backup/cutover.dump"
age -R /etc/lidealabs/backup-recipient.txt -o "$backup/config-session.tar.gz.age" "$backup/config-session.tar.gz"
sha256sum "$backup/cutover.dump" "$backup/config-session.tar.gz" > "$backup/checksums"
runuser -u postgres -- psql -d lidealabs -Atc "SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY id)) FROM products p" > "$backup/catalog.before"
install -d -m 0700 -o lidealabs -g lidealabs /var/lib/lidealabs/private /var/lib/lidealabs/manual-evidence
install -m 0600 -o lidealabs -g lidealabs /root/qris-gopay.png /var/lib/lidealabs/private/qris-gopay.png
cmp /root/qris-gopay.png /var/lib/lidealabs/private/qris-gopay.png
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/lidealabs/app.env')
values={'PAYMENT_PROVIDER':'qris_manual','PAYMENTS_ENABLED':'true','MANUAL_QRIS_IMAGE':'/var/lib/lidealabs/private/qris-gopay.png','MANUAL_QRIS_MERCHANT':'"MUGENWORKLABS, PULSA & INTERNET"','MANUAL_PAYMENT_EVIDENCE_DIR':'/var/lib/lidealabs/manual-evidence'}
lines=[line for line in p.read_text().splitlines() if line.split('=',1)[0] not in values]
p.write_text('\n'.join(lines+[k+'='+v for k,v in values.items()])+'\n')
PY
cd "$release"
runuser -u lidealabs -- node --env-file=/etc/lidealabs/app.env dist/migrate.js
runuser -u lidealabs -- node --env-file=/etc/lidealabs/app.env deploy/probe-manual-checkout.mjs
runuser -u postgres -- psql -d lidealabs -Atc "SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY id)) FROM products p" > "$backup/catalog.after"
cmp "$backup/catalog.before" "$backup/catalog.after"
ln -s "$release" /opt/lidealabs/current.qris
mv -Tf /opt/lidealabs/current.qris /opt/lidealabs/current
systemctl start lidealabs@server lidealabs@whatsapp
sleep 4
systemctl is-active lidealabs@server lidealabs@whatsapp
curl --fail -s http://127.0.0.1:3000/health
printf '\n'
trap - ERR
printf 'QRIS_MANUAL_DEPLOYED\n'
