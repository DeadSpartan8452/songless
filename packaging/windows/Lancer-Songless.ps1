param(
  [ValidateSet('menu', 'local', 'lan', 'internet')]
  [string]$Mode = 'menu'
)

$ErrorActionPreference = 'Stop'
$InstallRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $InstallRoot 'app'
$DataRoot = Join-Path $env:LOCALAPPDATA 'Songless-Data'
$RuntimeRoot = Join-Path $InstallRoot 'runtime'
$Launcher = Join-Path $AppRoot 'Songless.bat'
$UpdateScript = Join-Path $InstallRoot 'Update-Songless.ps1'
$VersionFile = Join-Path $InstallRoot 'VERSION'
$CurrentVersion = if (Test-Path -LiteralPath $VersionFile) {
  [IO.File]::ReadAllText($VersionFile).Trim()
} else { 'inconnue' }

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'musiques') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'metadata-backups') | Out-Null

$LegacyLibraryRoot = Join-Path $env:USERPROFILE 'Codex\Songless'
$LegacyMusicDir = Join-Path $LegacyLibraryRoot 'musiques'
$LegacyMetadata = Join-Path $LegacyLibraryRoot 'metadata.json'
if ((Test-Path -LiteralPath $LegacyMusicDir -PathType Container) -and
    (Test-Path -LiteralPath $LegacyMetadata -PathType Leaf)) {
  $LibraryRoot = $LegacyLibraryRoot
  $MusicDir = $LegacyMusicDir
  $MetadataFile = $LegacyMetadata
  $MetadataBackupDir = Join-Path $LegacyLibraryRoot 'metadata-backups'
} else {
  $LibraryRoot = $DataRoot
  $MusicDir = Join-Path $DataRoot 'musiques'
  $MetadataFile = Join-Path $DataRoot 'metadata.json'
  $MetadataBackupDir = Join-Path $DataRoot 'metadata-backups'
}

$ProcessPath = [Environment]::GetEnvironmentVariable(
  'Path', [EnvironmentVariableTarget]::Process
)
[Environment]::SetEnvironmentVariable(
  'Path', $null, [EnvironmentVariableTarget]::Process
)
[Environment]::SetEnvironmentVariable(
  'Path', "$RuntimeRoot;$ProcessPath", [EnvironmentVariableTarget]::Process
)
$env:SONGLESS_MUSIC_DIR = $MusicDir
$env:SONGLESS_METADATA_FILE = $MetadataFile
$env:SONGLESS_METADATA_BACKUP_DIR = $MetadataBackupDir
$env:SONGLESS_DATA_FILE = Join-Path $DataRoot 'songless-data.json'
$env:SONGLESS_BACKUP_DIR = Join-Path $DataRoot 'metadata-backups'
$env:SONGLESS_INSTANCE_KEY_FILE = Join-Path $DataRoot 'instance-key.dpapi'
$env:SONGLESS_TAILSCALE_ACCOUNT_FILE = Join-Path $DataRoot 'tailscale-account.txt'

if ($Mode -eq 'menu') {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $Form = New-Object Windows.Forms.Form
  $Form.Text = 'Songless'
  $Form.Size = New-Object Drawing.Size(480, 300)
  $Form.StartPosition = 'CenterScreen'
  $Form.BackColor = [Drawing.Color]::FromArgb(20, 16, 31)
  $Form.ForeColor = [Drawing.Color]::White
  $Form.Font = New-Object Drawing.Font('Segoe UI', 10)

  $Title = New-Object Windows.Forms.Label
  $Title.Text = 'SONGLESS'
  $Title.Font = New-Object Drawing.Font('Segoe UI', 26, 'Bold')
  $Title.ForeColor = [Drawing.Color]::FromArgb(196, 143, 255)
  $Title.SetBounds(28, 20, 400, 45)
  $Form.Controls.Add($Title)

  $Version = New-Object Windows.Forms.Label
  $Version.Text = "Version installée : $CurrentVersion"
  $Version.SetBounds(32, 73, 410, 26)
  $Form.Controls.Add($Version)

  $Status = New-Object Windows.Forms.Label
  $Status.Text = 'Les chansons et playlists restent sur cet ordinateur.'
  $Status.SetBounds(32, 108, 410, 38)
  $Form.Controls.Add($Status)

  $Launch = New-Object Windows.Forms.Button
  $Launch.Text = 'Lancer Songless'
  $Launch.SetBounds(32, 168, 195, 48)
  $Launch.BackColor = [Drawing.Color]::FromArgb(124, 58, 237)
  $Launch.FlatStyle = 'Flat'
  $Launch.Add_Click({
    if (-not (Test-Path -LiteralPath $Launcher)) {
      [Windows.Forms.MessageBox]::Show(
        'Les fichiers Songless sont incomplets. Réinstalle le paquet.',
        'Songless', 'OK', 'Error'
      ) | Out-Null
      return
    }
    Start-Process -FilePath $Launcher -WorkingDirectory $InstallRoot
    $Form.Close()
  })
  $Form.Controls.Add($Launch)

  $Update = New-Object Windows.Forms.Button
  $Update.Text = 'Mise à jour'
  $Update.SetBounds(240, 168, 195, 48)
  $Update.FlatStyle = 'Flat'
  $Update.Add_Click({
    if (-not (Test-Path -LiteralPath $UpdateScript)) {
      [Windows.Forms.MessageBox]::Show(
        'Le module de mise à jour est absent. Réinstalle le paquet.',
        'Songless', 'OK', 'Error'
      ) | Out-Null
      return
    }
    $Update.Enabled = $false
    $Launch.Enabled = $false
    $Status.Text = 'Recherche de la version publiée sur GitHub…'
    $Form.Refresh()
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File $UpdateScript -InstallRoot $InstallRoot
      if ($LASTEXITCODE -ne 0) {
        throw 'La mise à jour n’a pas abouti.'
      }
      $Status.Text = 'Terminé. Tes chansons et playlists sont conservées.'
      [Windows.Forms.MessageBox]::Show(
        'Songless est à jour. Les chansons et playlists locales ont été conservées.',
        'Songless', 'OK', 'Information'
      ) | Out-Null
    } catch {
      $Status.Text = 'La mise à jour a échoué.'
      [Windows.Forms.MessageBox]::Show(
        $_.Exception.Message, 'Songless', 'OK', 'Error'
      ) | Out-Null
    } finally {
      $Update.Enabled = $true
      $Launch.Enabled = $true
    }
  })
  $Form.Controls.Add($Update)

  $Close = New-Object Windows.Forms.Button
  $Close.Text = 'Fermer'
  $Close.SetBounds(240, 226, 195, 32)
  $Close.FlatStyle = 'Flat'
  $Close.Add_Click({ $Form.Close() })
  $Form.Controls.Add($Close)
  [void]$Form.ShowDialog()
  exit 0
}

if (-not (Test-Path -LiteralPath $Launcher)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    'Songless est incomplet. Réinstalle le paquet.',
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
