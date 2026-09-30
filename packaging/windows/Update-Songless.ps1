param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$Repository = 'DeadSpartan8452/songless'
$ReleaseApi = "https://api.github.com/repos/$Repository/releases/latest"
$AssetName = 'Songless-Windows-x64.zip'
$ChecksumsName = 'Songless-SHA256SUMS.txt'
$Root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$ExpectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Songless')).TrimEnd('\')
if (-not $Root.Equals($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Dossier Songless inattendu ; mise à jour refusée.'
}

try {
  $running = Invoke-WebRequest -UseBasicParsing `
    -Uri 'http://127.0.0.1:3000/api/context' -TimeoutSec 2
  if ($running.StatusCode -eq 200) {
    throw 'Ferme Songless avant de lancer la mise à jour.'
  }
} catch {
  if ($_.Exception.Message -match 'Ferme Songless') { throw }
}

$headers = @{
  Accept = 'application/vnd.github+json'
  'User-Agent' = 'Songless-Updater'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$release = Invoke-RestMethod -Uri $ReleaseApi -Headers $headers -TimeoutSec 30
if (-not $release.tag_name -or $release.draft -or $release.prerelease) {
  throw 'Aucune version stable de Songless n’est publiée.'
}
$currentFile = Join-Path $Root 'VERSION'
$currentVersion = if (Test-Path -LiteralPath $currentFile) {
  [IO.File]::ReadAllText($currentFile).Trim().TrimStart('v')
} else { '0.0.0' }
$latestVersion = ([string]$release.tag_name).TrimStart('v')
$currentParsed = [version]::MinValue
$latestParsed = [version]::MinValue
if (-not [version]::TryParse($currentVersion, [ref]$currentParsed) -or
    -not [version]::TryParse($latestVersion, [ref]$latestParsed)) {
  throw 'Version Songless illisible ; mise à jour refusée.'
}
if ($latestParsed -le $currentParsed) {
  Write-Host "Songless est déjà à jour ($($release.tag_name))."
  exit 0
}

$asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
$checksums = $release.assets | Where-Object { $_.name -eq $ChecksumsName } | Select-Object -First 1
if (-not $asset -or -not $checksums) {
  throw 'La version GitHub ne contient pas le paquet Windows et son manifeste.'
}
if ([long]$asset.size -lt 1 -or [long]$asset.size -gt 1GB) {
  throw 'La taille du paquet Windows publiée est inattendue.'
}
foreach ($item in @($asset, $checksums)) {
  $uri = [Uri]$item.browser_download_url
  if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'github.com') {
    throw 'Adresse de téléchargement hors GitHub refusée.'
  }
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$stage = Join-Path $tempRoot ('Songless-Update-' + [Guid]::NewGuid().ToString('N'))
$stageFull = [IO.Path]::GetFullPath($stage)
if (-not $stageFull.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Dossier temporaire de mise à jour refusé.'
}
New-Item -ItemType Directory -Path $stageFull | Out-Null
try {
  $zip = Join-Path $stageFull $AssetName
  $sumFile = Join-Path $stageFull $ChecksumsName
  Invoke-WebRequest -UseBasicParsing -Uri $checksums.browser_download_url `
    -Headers $headers -OutFile $sumFile -TimeoutSec 120
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url `
    -Headers $headers -OutFile $zip -TimeoutSec 600

  $line = Get-Content -LiteralPath $sumFile | Where-Object {
    $_ -match "\s+$([Regex]::Escape($AssetName))$"
  } | Select-Object -First 1
  if (-not $line) { throw 'Empreinte du paquet Windows absente du manifeste.' }
  $expectedHash = ($line -split '\s+')[0].ToUpperInvariant()
  $actualHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  if ($actualHash -ne $expectedHash) { throw 'Empreinte du ZIP invalide.' }

  $unpack = Join-Path $stageFull 'unpack'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack
  $installer = Join-Path $unpack 'Songless-Windows-x64\Installer-Songless.ps1'
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw 'Installateur Windows absent du paquet téléchargé.'
  }
  Write-Host "Installation de Songless $($release.tag_name)..."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass `
    -File $installer -Action install -Quiet
  if ($LASTEXITCODE -ne 0) { throw 'L’installation de la mise à jour a échoué.' }
  Write-Host 'Mise à jour terminée. Tes chansons et playlists sont conservées.'
} finally {
  if (Test-Path -LiteralPath $stageFull) {
    Remove-Item -LiteralPath $stageFull -Recurse -Force
  }
}
