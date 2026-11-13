param(
  [Parameter(Mandatory=$true)][string]$DshCli,
  [Parameter(Mandatory=$true)][string]$Package,
  [string]$Profile = 'web',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' })
)
$ErrorActionPreference = 'Stop'
if ($Profile -eq 'desktop') { throw 'Use manage-desktop.ps1 with the Desktop bundled CLI; this installer is for legacy Web profiles.' }
$cliPath = (Resolve-Path -LiteralPath $DshCli).Path
$packagePath = (Resolve-Path -LiteralPath $Package).Path
$version = & node $cliPath --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '0\.1\.5-rc\.2') { throw 'This plugin supports Harness 0.1.5-rc.2 only.' }
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
$profileDir = Join-Path $DshHome "profiles/$Profile"
$manifestPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.dsh.profile.patchReload -ne 'live') { throw 'Enable live patch reload in this profile before installation.' }
$patch = Get-Content -LiteralPath $patchPath -Raw
$withoutManaged = [regex]::Replace($patch, '(?ms)^# BEGIN dsh-tg managed\r?\n.*?^# END dsh-tg managed\r?\n?', '')
if ($withoutManaged -match '(?m)^\s*- id: (?:include:)?tg-game(?:-v[0-9-]+)?\s*$') { throw 'An existing unmanaged tg-game entry needs to be reconciled before installation.' }
$backupDir = Join-Path $profileDir ('backups/tg-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($file in @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.yml','cordis.patch.yml')) {
  $source = Join-Path $profileDir $file
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $file) }
}
$withoutManaged = [regex]::Replace($withoutManaged, '(?m)^\s*\[\]\s*$', '').TrimEnd()
$hasManaged = $patch -match '(?m)^# BEGIN dsh-tg managed\r?$'
if (-not $hasManaged -and $manifest.dsh.profile.bundles -contains 'dsh-tg') {
  throw 'This profile already loads dsh-tg through a bundle. Uninstall that entry before switching to managed live installation.'
}
if ($hasManaged) {
  # rc.2 applies new entries before removing old ones. Wait for the old service
  # AND its storage domain to close, rather than relying on an arbitrary delay.
  $probePath = Join-Path $backupDir 'wait-for-unload.mjs'
  $ackPath = Join-Path $backupDir 'unloaded.json'
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'wait-for-unload.mjs') -Destination $probePath
  $probeUri = [Uri]::new($probePath).AbsoluteUri
  $oldEntry = [Uri]::new((Join-Path $profileDir 'node_modules/dsh-tg/lib/index.js')).AbsoluteUri
  $quotedAck = $ackPath.Replace("'", "''")
  $transition = "`n- insert:`n    - id: tg-install-unload-probe`n      name: '$probeUri'`n      config:`n        entry: '$oldEntry'`n        acknowledgement: '$quotedAck'`n"
  try {
    [IO.File]::WriteAllText($patchPath, $withoutManaged + $transition)
    $deadline = (Get-Date).AddSeconds(40)
    while (-not (Test-Path -LiteralPath $ackPath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Path -LiteralPath $ackPath)) { throw 'Timed out waiting for the old TG plugin to release its storage.' }
    $ack = Get-Content -LiteralPath $ackPath -Raw | ConvertFrom-Json
    if (-not $ack.ok) { throw "Old TG plugin did not release its storage: $($ack.message)" }
    $settledPatch = $withoutManaged + "`n"
    if (($withoutManaged -replace '(?m)^\s*#.*$', '').Trim().Length -eq 0) { $settledPatch += "[]`n" }
    [IO.File]::WriteAllText($patchPath, $settledPatch)
  } catch {
    [IO.File]::WriteAllText($patchPath, $patch)
    throw
  }
}
# The official CLI installs the prebuilt package and updates the profile lock.
$previousDshHome = $env:DSH_HOME
try {
  $env:DSH_HOME = [IO.Path]::GetFullPath($DshHome)
  & node $cliPath plugin --profile $Profile add $packagePath
  if ($LASTEXITCODE -ne 0) { throw "Plugin installation failed. Backup: $backupDir" }
} finally { $env:DSH_HOME = $previousDshHome }
$installedDir = Join-Path $profileDir 'node_modules/dsh-tg'
$pluginVersion = (Get-Content -LiteralPath (Join-Path $installedDir 'package.json') -Raw | ConvertFrom-Json).version
$entry = [Uri]::new((Join-Path $installedDir 'lib/index.js')).AbsoluteUri + '?tg=' + $pluginVersion
# In rc.2, the live composer retains startup bundle layers. Use a single user
# patch for this profile, including its next boot, to avoid a duplicate service.
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-tg' })
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 30))
# A versioned loader id removes the old entry before creating its replacement.
# rc.2 changing only an entry's name can leave its former client source cached.
$entryId = 'tg-game-v' + ($pluginVersion -replace '\.', '-')
$managed = "# BEGIN dsh-tg managed`n- insert:`n    - id: $entryId`n      name: '$entry'`n# END dsh-tg managed`n"
[IO.File]::WriteAllText($patchPath, $withoutManaged + "`n" + $managed)
if ($hasManaged) {
  Remove-Item -LiteralPath $probePath
  # Keep the small acknowledgement with the installation backup as evidence.
}
Write-Output "Installed dsh-tg $pluginVersion. Profile backup: $backupDir"
Write-Output 'Refresh the authenticated Harness page and select 文字游戏.'
