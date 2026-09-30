param(
  [ValidateSet('menu', 'local', 'lan', 'internet')]
  [string]$Mode = 'menu'
)

$ErrorActionPreference = 'Stop'
$InstallRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $InstallRoot 'app'
$DataRoot = Join-Path $env:LOCALAPPDATA 'Songless-Data'
$RuntimeRoot = Join-Path $InstallRoot 'runtime'
$LibraryRoot = Join-Path $env:USERPROFILE 'Codex\Songless'
$LibraryMusicDir = Join-Path $LibraryRoot 'musiques'
$LibraryMetadataFile = Join-Path $LibraryRoot 'metadata.json'

if (-not (Test-Path -LiteralPath $LibraryMusicDir -PathType Container)) {
  throw "Bibliotheque Songless introuvable : $LibraryMusicDir"
}
if (-not (Test-Path -LiteralPath $LibraryMetadataFile -PathType Leaf)) {
  throw "Metadonnees Songless introuvables : $LibraryMetadataFile"
}
$AudioExtensions = @('.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.aac', '.flac', '.opus')
$LibraryAudioCount = @(
  Get-ChildItem -LiteralPath $LibraryMusicDir -File |
    Where-Object { $AudioExtensions -contains $_.Extension.ToLowerInvariant() }
).Count
if ($LibraryAudioCount -eq 0) {
  throw "Bibliotheque Songless vide : $LibraryMusicDir. Aucun dossier de test ne sera utilise."
}

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'musiques') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'metadata-backups') | Out-Null

$ProcessPath = [Environment]::GetEnvironmentVariable(
  'Path', [EnvironmentVariableTarget]::Process
)
[Environment]::SetEnvironmentVariable(
  'Path', $null, [EnvironmentVariableTarget]::Process
)
[Environment]::SetEnvironmentVariable(
  'Path', "$RuntimeRoot;$ProcessPath", [EnvironmentVariableTarget]::Process
)
$env:SONGLESS_MUSIC_DIR = $LibraryMusicDir
$env:SONGLESS_METADATA_FILE = $LibraryMetadataFile
$env:SONGLESS_METADATA_BACKUP_DIR = Join-Path $LibraryRoot 'metadata-backups'
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
