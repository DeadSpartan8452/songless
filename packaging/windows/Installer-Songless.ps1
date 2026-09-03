param(
  [ValidateSet('gui', 'verify', 'install', 'uninstall')]
  [string]$Action = 'gui',
  [switch]$Quiet,
  [switch]$NoShortcut,
  [switch]$DeleteData
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$KitRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadRoot = Join-Path $KitRoot 'payload'
$ManifestPath = Join-Path $KitRoot 'manifest.json'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'Songless'
$DataRoot = Join-Path $env:LOCALAPPDATA 'Songless-Data'
$InstallerPort = if ($env:SONGLESS_INSTALL_PORT) {
  [int]$env:SONGLESS_INSTALL_PORT
} else { 3000 }

function Show-Error([string]$Message) {
  [Windows.Forms.MessageBox]::Show(
    $Message, 'Songless', 'OK', 'Error'
  ) | Out-Null
}

function Songless-IsRunning {
  try {
    $Response = Invoke-WebRequest -UseBasicParsing `
      -Uri "http://127.0.0.1:$InstallerPort/api/context" -TimeoutSec 1
    return $Response.StatusCode -eq 200
  } catch { return $false }
}

function Test-Payload {
  if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw 'manifest.json est absent du kit.'
  }
  $Manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
  if ($Manifest.platform -ne 'win32' -or $Manifest.arch -ne 'x64') {
    throw 'Ce kit exige Windows 64 bits (x64).'
  }
  foreach ($Entry in $Manifest.files) {
    $Relative = [string]$Entry.path
    if ($Relative.Contains('..') -or [IO.Path]::IsPathRooted($Relative)) {
      throw 'Le manifeste contient un chemin interdit.'
    }
    $File = Join-Path $KitRoot $Relative
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
      throw "Fichier manquant dans le kit : $Relative"
    }
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant()
    if ($Hash -ne ([string]$Entry.sha256).ToLowerInvariant()) {
      throw "Fichier corrompu dans le kit : $Relative"
    }
  }
}

function Mirror-Directory([string]$Source, [string]$Destination) {
  $SourcePath = [IO.Path]::GetFullPath($Source)
  $DestinationPath = [IO.Path]::GetFullPath($Destination)
  $AllowedSource = [IO.Path]::GetFullPath($PayloadRoot)
  $AllowedDestination = [IO.Path]::GetFullPath($InstallRoot)
  if (-not $SourcePath.StartsWith($AllowedSource, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Source d’installation refusée.'
  }
  if (-not $DestinationPath.StartsWith($AllowedDestination, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Destination d’installation refusée.'
  }
  New-Item -ItemType Directory -Force -Path $DestinationPath | Out-Null
  & robocopy.exe $SourcePath $DestinationPath /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Copie impossible (code $LASTEXITCODE)." }
}

function Install-Songless {
  if (Songless-IsRunning) {
    throw 'Songless est ouvert. Ferme sa fenêtre serveur puis recommence.'
  }
  Test-Payload
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'musiques') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'metadata-backups') | Out-Null
  $LegacyKey = Join-Path $InstallRoot 'app\.songless-instance-key'
  $DurableKey = Join-Path $DataRoot 'instance-key.dpapi'
  if ((Test-Path -LiteralPath $LegacyKey) -and
      -not (Test-Path -LiteralPath $DurableKey)) {
    Copy-Item -LiteralPath $LegacyKey -Destination $DurableKey
  }
  $LegacyAccount = Join-Path $InstallRoot 'app\.songless-tailscale-account'
  $DurableAccount = Join-Path $DataRoot 'tailscale-account.txt'
  if ((Test-Path -LiteralPath $LegacyAccount) -and
      -not (Test-Path -LiteralPath $DurableAccount)) {
    Copy-Item -LiteralPath $LegacyAccount -Destination $DurableAccount
  }
  Mirror-Directory (Join-Path $PayloadRoot 'app') (Join-Path $InstallRoot 'app')
  Mirror-Directory (Join-Path $PayloadRoot 'runtime') (Join-Path $InstallRoot 'runtime')
  foreach ($Name in @('Lancer-Songless.ps1', 'Songless.bat', 'Songless-local.bat', 'Songless-WiFi.bat', 'Songless-Internet.bat')) {
    Copy-Item -Force -LiteralPath (Join-Path $PayloadRoot $Name) -Destination (Join-Path $InstallRoot $Name)
  }
  if (-not $NoShortcut) {
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Songless.lnk'))
    $Shortcut.TargetPath = Join-Path $InstallRoot 'Songless.bat'
    $Shortcut.WorkingDirectory = $InstallRoot
    $Shortcut.Description = 'Songless - blind test local'
    $Shortcut.Save()
  }
  if (-not $Quiet) {
    [Windows.Forms.MessageBox]::Show(
      "Songless est prêt.`n`nTes données restent dans :`n$DataRoot",
      'Songless', 'OK', 'Information'
    ) | Out-Null
  }
}

function Uninstall-Songless {
  if (Songless-IsRunning) {
    throw 'Songless est ouvert. Ferme sa fenêtre serveur avant la désinstallation.'
  }
  if (-not $Quiet) {
    $Choice = [Windows.Forms.MessageBox]::Show(
      'Désinstaller l’application Songless ? Les musiques et profils seront conservés.',
      'Songless', 'YesNo', 'Warning'
    )
    if ($Choice -ne 'Yes') { return }
  }
  $Expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Songless'))
  if (([IO.Path]::GetFullPath($InstallRoot)) -ne $Expected) {
    throw 'Destination de désinstallation refusée.'
  }
  $Shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Songless.lnk'
  if (Test-Path -LiteralPath $Shortcut) { Remove-Item -Force -LiteralPath $Shortcut }
  if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -Recurse -Force -LiteralPath $InstallRoot
  }
  $ShouldDeleteData = $DeleteData
  if (-not $Quiet) {
    $ShouldDeleteData = [Windows.Forms.MessageBox]::Show(
      'Supprimer aussi toutes les musiques, les profils et les sauvegardes Songless ?',
      'Songless - données', 'YesNo', 'Warning'
    ) -eq 'Yes'
  }
  if ($ShouldDeleteData -and (Test-Path -LiteralPath $DataRoot)) {
    $ExpectedData = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Songless-Data'))
    if (([IO.Path]::GetFullPath($DataRoot)) -ne $ExpectedData) {
      throw 'Dossier de données refusé.'
    }
    Remove-Item -Recurse -Force -LiteralPath $DataRoot
  }
  if (-not $Quiet) {
    [Windows.Forms.MessageBox]::Show('Désinstallation terminée.', 'Songless') | Out-Null
  }
}

if ($Action -eq 'verify') { Test-Payload; exit 0 }
if ($Action -eq 'install') { Install-Songless; exit 0 }
if ($Action -eq 'uninstall') { Uninstall-Songless; exit 0 }

$Form = New-Object Windows.Forms.Form
$Form.Text = 'Installer Songless'
$Form.Size = New-Object Drawing.Size(560, 370)
$Form.StartPosition = 'CenterScreen'
$Form.BackColor = [Drawing.Color]::FromArgb(20, 16, 31)
$Form.ForeColor = [Drawing.Color]::White
$Form.Font = New-Object Drawing.Font('Segoe UI', 10)

$Title = New-Object Windows.Forms.Label
$Title.Text = 'SONGLESS'
$Title.Font = New-Object Drawing.Font('Segoe UI', 28, 'Bold')
$Title.ForeColor = [Drawing.Color]::FromArgb(255, 220, 94)
$Title.SetBounds(28, 24, 490, 52)
$Form.Controls.Add($Title)

$Copy = New-Object Windows.Forms.Label
$Copy.Text = "Installer ou réparer Songless sans terminal.`nL’application et tes données restent séparées."
$Copy.SetBounds(32, 88, 490, 55)
$Form.Controls.Add($Copy)

$Install = New-Object Windows.Forms.Button
$Install.Text = 'Installer / Réparer'
$Install.SetBounds(32, 168, 230, 52)
$Install.BackColor = [Drawing.Color]::FromArgb(139, 92, 246)
$Install.FlatStyle = 'Flat'
$Install.Add_Click({ try { Install-Songless } catch { Show-Error $_.Exception.Message } })
$Form.Controls.Add($Install)

$Uninstall = New-Object Windows.Forms.Button
$Uninstall.Text = 'Désinstaller'
$Uninstall.SetBounds(280, 168, 230, 52)
$Uninstall.FlatStyle = 'Flat'
$Uninstall.Add_Click({ try { Uninstall-Songless } catch { Show-Error $_.Exception.Message } })
$Form.Controls.Add($Uninstall)

$Close = New-Object Windows.Forms.Button
$Close.Text = 'Fermer'
$Close.SetBounds(280, 245, 230, 42)
$Close.FlatStyle = 'Flat'
$Close.Add_Click({ $Form.Close() })
$Form.Controls.Add($Close)

[void]$Form.ShowDialog()
