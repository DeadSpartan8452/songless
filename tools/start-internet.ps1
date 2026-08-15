$ErrorActionPreference = 'Stop'

$InstanceLock = New-Object System.Threading.Mutex(
  $false,
  'Local\SonglessInternetUniqueInstance'
)
$OwnsInstanceLock = $false
try {
  $OwnsInstanceLock = $InstanceLock.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  $OwnsInstanceLock = $true
}
if (-not $OwnsInstanceLock) {
  Write-Host 'Songless est deja ouvert. Aucun second lancement.' `
    -ForegroundColor Yellow
  exit 0
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TailscaleCommand = Get-Command tailscale.exe -ErrorAction SilentlyContinue
$TailscalePath = if ($TailscaleCommand) { $TailscaleCommand.Source } else { $null }
if (-not $TailscalePath) {
  $InstalledTailscale = 'C:\Program Files\Tailscale\tailscale.exe'
  if (Test-Path -LiteralPath $InstalledTailscale) {
    $TailscalePath = $InstalledTailscale
  }
}

Write-Host 'Songless Internet - Tailscale Funnel HTTPS' -ForegroundColor Cyan
Write-Host 'Gratuit, sans domaine et sans serveur distant.' -ForegroundColor DarkGray

if (-not $TailscalePath) {
  throw 'Tailscale est absent. Demande a Codex de terminer l''installation.'
}

$Status = & $TailscalePath status --json | ConvertFrom-Json
if (-not $Status.Self -or -not $Status.Self.DNSName) {
  throw 'Connecte d''abord Tailscale avec son icone pres de l''horloge.'
}

$DnsName = ([string]$Status.Self.DNSName).TrimEnd('.')
$PublicUrl = "https://$DnsName"
$LocalUrl = 'http://localhost:3000'
$PortLocalOccupe = Test-NetConnection 127.0.0.1 -Port 3000 `
  -InformationLevel Quiet -WarningAction SilentlyContinue
$PortPublicOccupe = Test-NetConnection 127.0.0.1 -Port 3001 `
  -InformationLevel Quiet -WarningAction SilentlyContinue
if ($PortLocalOccupe -and $PortPublicOccupe) {
  Write-Host 'Songless Internet tourne deja. Aucun nouvel onglet ouvert.' `
    -ForegroundColor Yellow
  exit 0
}
if ($PortLocalOccupe -or $PortPublicOccupe) {
  throw 'Songless tourne deja. Ferme-le avant de lancer le mode Internet.'
}

$env:SONGLESS_PUBLIC_URL = $PublicUrl
$env:SONGLESS_PUBLIC_PORT = '3001'
$Node = Start-Process -FilePath 'node.exe' `
  -ArgumentList 'server.js', '--lan', '--internet' `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -PassThru

try {
  Start-Sleep -Seconds 2
  if ($Node.HasExited) {
    throw 'Songless n''a pas pu demarrer.'
  }
  $Pret = $false
  for ($i = 0; $i -lt 25; $i++) {
    try {
      $Response = Invoke-WebRequest -UseBasicParsing `
        -Uri 'http://127.0.0.1:3000/api/context' -TimeoutSec 2
      if ($Response.StatusCode -eq 200) {
        $Pret = $true
        break
      }
    } catch {}
    Start-Sleep -Milliseconds 400
  }
  if (-not $Pret) {
    throw 'Songless ne repond pas apres 10 secondes.'
  }
  Start-Process $LocalUrl
  Write-Host "Adresse HTTPS : $PublicUrl" -ForegroundColor Green
  Write-Host 'Le premier lancement peut demander une validation dans le navigateur.'
  Write-Host 'Fermer cette fenetre coupe immediatement le lien Internet.'
  & $TailscalePath funnel --https=443 3001
} finally {
  try { & $TailscalePath funnel --https=443 off | Out-Null } catch {}
  if ($Node -and -not $Node.HasExited) {
    Stop-Process -Id $Node.Id
  }
  if ($OwnsInstanceLock) {
    $InstanceLock.ReleaseMutex()
    $InstanceLock.Dispose()
  }
}
