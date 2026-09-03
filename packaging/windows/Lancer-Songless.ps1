param(
  [ValidateSet('menu', 'local', 'lan', 'internet')]
  [string]$Mode = 'menu'
)

$ErrorActionPreference = 'Stop'
$InstallRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $InstallRoot 'app'
$DataRoot = Join-Path $env:LOCALAPPDATA 'Songless-Data'
$RuntimeRoot = Join-Path $InstallRoot 'runtime'

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'musiques') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'metadata-backups') | Out-Null

$env:PATH = "$RuntimeRoot;$env:PATH"
$env:SONGLESS_MUSIC_DIR = Join-Path $DataRoot 'musiques'
$env:SONGLESS_METADATA_FILE = Join-Path $DataRoot 'metadata.json'
$env:SONGLESS_METADATA_BACKUP_DIR = Join-Path $DataRoot 'metadata-backups'
$env:SONGLESS_DATA_FILE = Join-Path $DataRoot 'songless-data.json'
$env:SONGLESS_BACKUP_DIR = Join-Path $DataRoot 'metadata-backups'
$env:SONGLESS_INSTANCE_KEY_FILE = Join-Path $DataRoot 'instance-key.dpapi'
$env:SONGLESS_TAILSCALE_ACCOUNT_FILE = Join-Path $DataRoot 'tailscale-account.txt'

$Launcher = Join-Path $AppRoot 'Songless.bat'
if (-not (Test-Path -LiteralPath $Launcher)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    'Songless est incomplet. Lance Installer Songless puis choisis Reparer.',
    'Songless', 'OK', 'Error'
  ) | Out-Null
  exit 1
}

$Argument = switch ($Mode) {
  'local' { '--local' }
  'lan' { '--lan' }
  'internet' { '--internet' }
  default { '' }
}
if ($Argument) { & $Launcher $Argument } else { & $Launcher }
exit $LASTEXITCODE
