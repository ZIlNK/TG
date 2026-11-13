param(
  [Parameter(Mandatory=$true)][string]$DshCli,
  [string]$Profile = 'web',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' })
)
$ErrorActionPreference = 'Stop'
if ($Profile -eq 'desktop') { throw 'Use manage-desktop.ps1 -Action remove; this uninstaller is for legacy Web profiles.' }
$cliPath = (Resolve-Path -LiteralPath $DshCli).Path
$version = & node $cliPath --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '0\.1\.5-rc\.2') { throw 'This plugin supports Harness 0.1.5-rc.2 only.' }
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
$profileDir = Join-Path $DshHome "profiles/$Profile"
$manifestPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$patch = Get-Content -LiteralPath $patchPath -Raw
$remaining = [regex]::Replace($patch, '(?ms)^# BEGIN dsh-tg managed\r?\n.*?^# END dsh-tg managed\r?\n?', '')
if ($remaining -match '(?m)^\s*- id: (?:include:)?tg-game(?:-v[0-9-]+)?\s*$') { throw 'Remove the unmanaged tg-game entry explicitly before uninstalling.' }
$backupDir = Join-Path $profileDir ('backups/tg-uninstall-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($file in @('package.json','pnpm-lock.yaml','cordis.patch.yml')) { $source=Join-Path $profileDir $file; if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $file) } }
if (($remaining -replace '(?m)^\s*#.*$', '').Trim().Length -eq 0) { $remaining += "`n[]`n" }
[IO.File]::WriteAllText($patchPath, $remaining)
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-tg' })
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 30))
$previousDshHome = $env:DSH_HOME
try {
  $env:DSH_HOME = [IO.Path]::GetFullPath($DshHome)
  & node $cliPath plugin --profile $Profile remove dsh-tg
  if ($LASTEXITCODE -ne 0) { throw "Package removal failed. Backup: $backupDir" }
} finally { $env:DSH_HOME = $previousDshHome }
Write-Output 'TG uninstalled. Game storage and other plugins are retained.'
