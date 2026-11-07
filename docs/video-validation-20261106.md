# WhatsApp video normalization, 6 November 2026

PR #2 head verified through GitHub API: `a2dc9ee53b920d67bf580afc648c77bb8a01d1a8`.
Integrated its Python normalization into local branch while preserving group routing and existing untracked operational files. Implementation commit: `e469973`.

## Reproduction and validation

Input: https://www.facebook.com/share/v/1J9AAkbfWQ/

The previous production worker extracted MP4 containing AV1 video and HE-AAC audio, 1080x1920, 42.609002 seconds, 13,044,343 bytes. This establishes incompatible video codec as a concrete cause candidate for the reported phone failure; human playback of the replacement remains a separate acceptance check.

Normalized output: H.264 Main, yuv420p, AAC-LC, 1080x1920, 42.610000 seconds, 19,814,787 bytes. Both original and normalized files passed full FFmpeg decode with `-xerror`. Source and output remain in a private VPS evidence directory `/var/lib/lidealabs/media-validation-20261106`.

FFmpeg and ffprobe on VPS: 8.0.1-3ubuntu2. Python interpreter: `/opt/lidealabs/tools/social-venv/bin/python`. Systemd working directory `/opt/lidealabs/current` resolves the worker through `resolve('tools/social-media.py')`; release changes therefore select the new worker after restart.

Regression checks: `npm run build`, `npm test` (20 passing), and virtualenv Python `tools/test-social-media.py` (3 tests passing, including valid audio/silent video, corrupt input, failed size-limited conversion). The worker also verifies codec, preserved audio, duration within 0.5 seconds, size <=32 MiB, and full decode before atomic replacement.

Baileys installed implementation awaits the upload in `prepareWAMessageMedia`, then awaits relay in `sendMessage`. `withDownloadedMedia` awaits that callback before directory cleanup. A delayed-upload regression test checks file availability until callback settlement and absence afterward.

## Operations

Release: `/opt/lidealabs/releases/20261106-video-e469973`.
Previous release: `/opt/lidealabs/releases/20261105-media-pr2`.
Deployment log: `/var/lib/lidealabs/media-validation-20261106/deployment.log`.

Production verification completed: upload and relay resolved, temporary-file cleanup passed after send, receipt status progressed from 2 to 3, both existing services returned active, `/health` returned OK with manual QRIS enabled, and deployed worker SHA-256 matched `643d9915e304925884847cca1b8436048e3918279a8c1d624bae7198c32b3873`. Phone playback still requires user confirmation.

Run `node --env-file=/etc/lidealabs/app.env deploy/probe-downloader.mjs https://www.facebook.com/share/v/1J9AAkbfWQ/ .fb` from the release as `lidealabs` to repeat extraction, conversion, codec and full-decode validation without sending a message.

`deploy/verify-video-send.mjs` sends only to the existing authorized test number. Stop `lidealabs@whatsapp` before running it, and restore that service afterward. Never start a second bot against the same auth directory. The release script automates exclusive-session testing, service restoration and rollback on failure. It is a one-time deployment script and refuses to overwrite its release directory.

Rollback: stop `lidealabs@whatsapp`, atomically redirect `/opt/lidealabs/current` to the previous release using a temporary symlink and `mv -Tf`, then start the same service and check `/health`. No database migration or configuration change is required.

Human acceptance: play the received video through to the end in WhatsApp, seek near its end and confirm audible sound. Delivery receipts do not establish phone playback.
