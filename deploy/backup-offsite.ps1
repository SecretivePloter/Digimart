$ErrorActionPreference = 'Stop'
$privateDir = Join-Path $env:LOCALAPPDATA 'Lidealabs\offsite'
$driveDir = 'G:\My Drive\LIDEALABS encrypted backups'
New-Item -ItemType Directory -Force $privateDir | Out-Null
if (!(Test-Path -LiteralPath $driveDir)) { throw 'Google Drive folder unavailable. Sign in to Drive for desktop.' }
$sshOptions = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15')
try {
    $files = & ssh @sshOptions root@80.47.234.40 "find /var/backups/lidealabs -maxdepth 1 -name 'database-*.age' -printf '%f\n'"
    if ($LASTEXITCODE -ne 0) { throw 'SSH backup listing failed' }
    foreach ($file in $files) {
        if ($file -notmatch '^database-\d{8}T\d{6}Z\.(dump|assets\.tar\.gz)\.age$') { throw 'Unexpected backup name' }
        $local = Join-Path $privateDir $file
        & scp @sshOptions "root@80.47.234.40:/var/backups/lidealabs/$file.sha256" "$local.sha256" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Checksum transfer failed' }
        $expected = (Get-Content -LiteralPath "$local.sha256" -Raw).Split(' ')[0].Trim()
        if (!(Test-Path -LiteralPath $local) -or (Get-FileHash -LiteralPath $local).Hash -ne $expected) {
            & scp @sshOptions "root@80.47.234.40:/var/backups/lidealabs/$file" "$local.tmp" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Encrypted backup transfer failed' }
            if ((Get-FileHash -LiteralPath "$local.tmp").Hash -ne $expected) { throw 'Checksum mismatch' }
            Move-Item -LiteralPath "$local.tmp" -Destination $local -Force
        }
        $cloudPath = Join-Path $driveDir $file
        if (!(Test-Path -LiteralPath $cloudPath)) { Copy-Item -LiteralPath $local -Destination $cloudPath }
        if ((Get-FileHash -LiteralPath $cloudPath).Hash -ne $expected) { throw 'Drive folder checksum mismatch' }
    }
    Add-Content -LiteralPath (Join-Path $privateDir 'backup.log') "$(Get-Date -Format o) Verified encrypted copies; Drive desktop upload still depends on its sync status."
} catch {
    Add-Content -LiteralPath (Join-Path $privateDir 'backup.log') "$(Get-Date -Format o) FAILED: $($_.Exception.Message)"
    throw
}
