param(
  [Parameter(Mandatory = $true)][string]$DataRoot,
  [Parameter(Mandatory = $true)][string]$LegacyRoot
)

$ErrorActionPreference = 'Stop'
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$LegacyRoot = [IO.Path]::GetFullPath($LegacyRoot)
$DataMusic = Join-Path $DataRoot 'musiques'
$DataMetadata = Join-Path $DataRoot 'metadata.json'
$DataBackups = Join-Path $DataRoot 'metadata-backups'
$LegacyMusic = Join-Path $LegacyRoot 'musiques'
$LegacyMetadata = Join-Path $LegacyRoot 'metadata.json'

function Test-SonglessAudio([string]$Directory) {
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    return $false
  }
  $extensions = @('.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wma')
  $file = Get-ChildItem -LiteralPath $Directory -File -Recurse -Force `
    -ErrorAction SilentlyContinue |
    Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } |
    Select-Object -First 1
  return [bool]$file
}

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
New-Item -ItemType Directory -Force -Path $DataMusic | Out-Null
New-Item -ItemType Directory -Force -Path $DataBackups | Out-Null

$dataHasAudio = Test-SonglessAudio $DataMusic
$legacyHasAudio = Test-SonglessAudio $LegacyMusic

if ((Test-Path -LiteralPath $DataMetadata -PathType Leaf) -or $dataHasAudio) {
  $LibraryRoot = $DataRoot
} elseif ($legacyHasAudio) {
  $LibraryRoot = $LegacyRoot
} else {
  if (Test-Path -LiteralPath $LegacyMetadata -PathType Leaf) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $DataBackups "metadata-before-relocation-$stamp.json"
    $temporary = Join-Path $DataRoot "metadata-relocation-$PID.tmp"
    Copy-Item -LiteralPath $LegacyMetadata -Destination $backup
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $LegacyMetadata).Hash
    $backupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backup).Hash
    if ($sourceHash -ne $backupHash) {
      throw 'La sauvegarde des métadonnées historiques ne correspond pas.'
    }
    Copy-Item -LiteralPath $LegacyMetadata -Destination $temporary
    $temporaryHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $temporary).Hash
    if ($sourceHash -ne $temporaryHash) {
      Remove-Item -LiteralPath $temporary -Force
      throw 'La copie des métadonnées historiques ne correspond pas.'
    }
    Move-Item -LiteralPath $temporary -Destination $DataMetadata
  }
  $LibraryRoot = $DataRoot
}

[pscustomobject]@{
  LibraryRoot = $LibraryRoot
  MusicDir = Join-Path $LibraryRoot 'musiques'
  MetadataFile = Join-Path $LibraryRoot 'metadata.json'
  MetadataBackupDir = Join-Path $LibraryRoot 'metadata-backups'
}
