#!/bin/sh
set -eu
release=/opt/lidealabs/releases/20261106-video-e469973
evidence=/var/lib/lidealabs/media-validation-20261106
previous=$(readlink -f /opt/lidealabs/current)
test ! -e "$release"
install -d -o lidealabs -g lidealabs "$release"
tar -xf "$evidence/release.tar" -C "$release"
cp "$evidence/verify-video-send.mjs" "$release/deploy/verify-video-send.mjs"
ln -s "$previous/node_modules" "$release/node_modules"
chown -R lidealabs:lidealabs "$release"
cd "$release"
runuser -u lidealabs -- npm run build
runuser -u lidealabs -- npm test
runuser -u lidealabs -- /opt/lidealabs/tools/social-venv/bin/python tools/test-social-media.py
runuser -u lidealabs -- node --env-file=/etc/lidealabs/app.env deploy/probe-downloader.mjs https://www.facebook.com/share/v/1J9AAkbfWQ/ .fb
printf '%s\n' "$previous" > "$evidence/previous-release"
rollback() {
 ln -sfn "$previous" /opt/lidealabs/current.video-rollback
 mv -Tf /opt/lidealabs/current.video-rollback /opt/lidealabs/current
 systemctl start lidealabs@whatsapp
}
trap rollback EXIT
systemctl stop lidealabs@whatsapp
ln -s "$release" /opt/lidealabs/current.video-next
mv -Tf /opt/lidealabs/current.video-next /opt/lidealabs/current
runuser -u lidealabs -- node --env-file=/etc/lidealabs/app.env deploy/verify-video-send.mjs
systemctl start lidealabs@whatsapp
systemctl is-active lidealabs@server lidealabs@whatsapp
curl --fail -s http://127.0.0.1:3000/health
sha256sum tools/social-media.py /opt/lidealabs/current/tools/social-media.py
trap - EXIT
