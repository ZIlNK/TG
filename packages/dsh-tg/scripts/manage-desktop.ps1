param(
  [Parameter(Mandatory=$true)][string]$DesktopRoot,
  [ValidateSet('install','remove')][string]$Action = 'install',
  [string]$Package,
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' })
)
$ErrorActionPreference = 'Stop'
$appRoot = (Resolve-Path -LiteralPath $DesktopRoot).Path
$executable = Join-Path $appRoot 'DeepSeek Harness.exe'
$launcher = Join-Path $appRoot 'resources/runtime/cli/bin/dsh.cmd'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'Desktop bundled dsh.cmd was not found.' }
$version = & $launcher --version
if ($LASTEXITCODE -ne 0 -or $version.Trim() -notin @('0.2.0-rc.2', '0.2.1-rc.2')) { throw 'This desktop adapter supports Harness 0.2.0-rc.2 and 0.2.1-rc.2.' }
# Desktop owns this profile for its entire process lifetime. Never use the
# legacy Web installer, change its lock, or force a running Desktop to exit.
$running = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | Where-Object { $_.ExecutablePath -eq $executable })
if ($running.Count) { throw 'Quit DeepSeek Harness through its Application menu first; closing its window only hides it. No profile changes were made.' }
$profileDir = Join-Path ([IO.Path]::GetFullPath($DshHome)) 'profiles/desktop'
$manifestPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Open Desktop once to initialize its profile, then quit it before installation.' }
if ($Action -eq 'install') {
  if (-not $Package) { throw 'Package is required for installation.' }
  $packagePath = (Resolve-Path -LiteralPath $Package).Path
  if ([IO.Path]::GetExtension($packagePath) -ne '.tgz') { throw 'Use a precompiled .tgz package.' }
}
$backupDir = Join-Path $profileDir ('backups/tg-desktop-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
foreach ($file in @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.yml','cordis.patch.yml')) {
  $source = Join-Path $profileDir $file
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $file) }
}
$previousDshHome = $env:DSH_HOME
try {
  $env:DSH_HOME = [IO.Path]::GetFullPath($DshHome)
  if ($Action -eq 'install') { & $launcher plugin --profile desktop add $packagePath }
  else { & $launcher plugin --profile desktop remove dsh-tg }
  if ($LASTEXITCODE -ne 0) { throw "Desktop plugin operation failed. Backup: $backupDir" }
} finally { $env:DSH_HOME = $previousDshHome }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$present = $manifest.dsh.profile.bundles -contains 'dsh-tg'
if ($present -ne ($Action -eq 'install')) { throw "Desktop bundle registration did not match the requested action. Backup: $backupDir" }
Write-Output "Desktop TG $Action succeeded. Backup: $backupDir"
Write-Output 'Open DeepSeek Harness again. Game storage and Web profile are retained.'
