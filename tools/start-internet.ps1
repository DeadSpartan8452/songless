param(
  [switch]$SkipBrowser,
  [switch]$SmokeTest
)

$ErrorActionPreference = 'Stop'

function Get-ListenerProcessIds {
  param([int]$Port)

  return @(
    Get-NetTCPConnection -LocalPort $Port -State Listen `
      -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
}

function Test-SonglessInternetInstance {
  param(
    [int]$LocalPort,
    [int]$InternetPort,
    [string]$ExpectedPublicUrl
  )

  $LocalOwners = @(Get-ListenerProcessIds -Port $LocalPort)
  $InternetOwners = @(Get-ListenerProcessIds -Port $InternetPort)
  if ($LocalOwners.Count -ne 1 -or $InternetOwners.Count -ne 1) {
    return [pscustomobject]@{
      Valid = $false
      Reason = 'les ports n''ont pas chacun un ecouteur unique'
      ProcessId = $null
    }
  }
  if ([int]$LocalOwners[0] -ne [int]$InternetOwners[0]) {
    return [pscustomobject]@{
      Valid = $false
      Reason = 'les ports appartiennent a deux processus differents'
      ProcessId = $null
    }
  }

  $OwnerId = [int]$LocalOwners[0]
  $Process = Get-CimInstance Win32_Process `
    -Filter "ProcessId=$OwnerId" -ErrorAction SilentlyContinue
  $SonglessCommand = $Process `
    -and $Process.Name -eq 'node.exe' `
    -and $Process.CommandLine -match `
      '(?i)(^|[\\/\s"])server\.js(?=("|\s|$))' `
    -and $Process.CommandLine -match '(?i)(^|\s)--lan(\s|$)' `
    -and $Process.CommandLine -match '(?i)(^|\s)--internet(\s|$)'
  if (-not $SonglessCommand) {
    return [pscustomobject]@{
      Valid = $false
      Reason = 'l''ecouteur commun n''est pas node server.js --internet'
      ProcessId = $OwnerId
    }
  }

  try {
    $LocalContext = Invoke-RestMethod `
      -Uri "http://127.0.0.1:$LocalPort/api/context" -TimeoutSec 2
    $InternetContext = Invoke-RestMethod `
      -Uri "http://127.0.0.1:$InternetPort/api/context" -TimeoutSec 2
  } catch {
    return [pscustomobject]@{
      Valid = $false
      Reason = 'au moins un contexte HTTP Songless ne repond pas'
      ProcessId = $OwnerId
    }
  }

  $LocalExpected = $LocalContext.port -eq $LocalPort `
    -and $LocalContext.lan -eq $true `
    -and $LocalContext.local -eq $true `
    -and $LocalContext.canEditProfiles -eq $true `
    -and $LocalContext.readOnly -eq $false `
    -and [string]$LocalContext.publicUrl -eq $ExpectedPublicUrl
  $InternetExpected = $InternetContext.port -eq $LocalPort `
    -and $InternetContext.lan -eq $true `
    -and $InternetContext.local -eq $false `
    -and $InternetContext.canEditProfiles -eq $false `
    -and $InternetContext.controller -eq $true `
    -and $InternetContext.readOnly -eq $true `
    -and [string]$InternetContext.publicUrl -eq $ExpectedPublicUrl
  if (-not $LocalExpected -or -not $InternetExpected) {
    return [pscustomobject]@{
      Valid = $false
      Reason = 'les contextes HTTP ne correspondent pas a Songless Internet'
      ProcessId = $OwnerId
    }
  }

  $LocalOwnersAfter = @(Get-ListenerProcessIds -Port $LocalPort)
  $InternetOwnersAfter = @(Get-ListenerProcessIds -Port $InternetPort)
  $OwnersUnchanged = $LocalOwnersAfter.Count -eq 1 `
    -and $InternetOwnersAfter.Count -eq 1 `
    -and [int]$LocalOwnersAfter[0] -eq $OwnerId `
    -and [int]$InternetOwnersAfter[0] -eq $OwnerId
  if (-not $OwnersUnchanged) {
    return [pscustomobject]@{
      Valid = $false
      Reason = 'les ecouteurs ont change pendant la verification'
      ProcessId = $OwnerId
    }
  }

  return [pscustomobject]@{
    Valid = $true
    Reason = 'instance Songless Internet verifiee'
    ProcessId = $OwnerId
  }
}

$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal(
  $CurrentIdentity
)
$IsAdministrator = $CurrentPrincipal.IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $IsAdministrator -and -not $SmokeTest) {
  throw 'Le lanceur doit etre valide dans la fenetre de securite Windows.'
}

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
$AccountConfigPath = Join-Path $ProjectRoot '.songless-tailscale-account'
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

if (-not (Test-Path -LiteralPath $AccountConfigPath)) {
  throw 'Le compte Tailscale dedie a Songless n''est pas configure.'
}
$ExpectedAccount = (
  Get-Content -Raw -LiteralPath $AccountConfigPath
).Trim()
if (-not $ExpectedAccount) {
  throw 'Le compte Tailscale dedie a Songless est vide.'
}

$Status = & $TailscalePath status --json | ConvertFrom-Json
if (-not $Status.Self -or -not $Status.Self.DNSName) {
  throw 'Connecte d''abord Tailscale avec son icone pres de l''horloge.'
}
$CurrentUser = $Status.User.PSObject.Properties.Value |
  Where-Object { [string]$_.ID -eq [string]$Status.Self.UserID } |
  Select-Object -First 1
$CurrentAccount = [string]$CurrentUser.LoginName
if ($CurrentAccount -ne $ExpectedAccount) {
  throw 'Tailscale n''utilise pas le compte Songless. Le tunnel Manapattes n''a pas ete touche. Bascule manuellement vers le compte Songless, puis relance.'
}

$DnsName = ([string]$Status.Self.DNSName).TrimEnd('.')
$PublicUrl = "https://$DnsName"
$LocalUrl = 'http://localhost:3000'
$PortLocalOccupe = Test-NetConnection 127.0.0.1 -Port 3000 `
  -InformationLevel Quiet -WarningAction SilentlyContinue
$PortPublicOccupe = Test-NetConnection 127.0.0.1 -Port 3001 `
  -InformationLevel Quiet -WarningAction SilentlyContinue
if ($PortLocalOccupe -and $PortPublicOccupe) {
  $InstanceExistante = Test-SonglessInternetInstance `
    -LocalPort 3000 -InternetPort 3001 `
    -ExpectedPublicUrl $PublicUrl
  if (-not $InstanceExistante.Valid) {
    $Raison = $InstanceExistante.Reason
    throw "Les ports 3000 et 3001 sont occupes, mais aucune instance " `
      + "Songless Internet valide n'a ete reconnue : $Raison. " `
      + "Aucun processus n'a ete arrete."
  }
  Write-Host 'Songless Internet tourne deja. Aucun nouvel onglet ouvert.' `
    -ForegroundColor Yellow
  exit 0
}
if ($PortLocalOccupe -and -not $PortPublicOccupe) {
  $AncienSongless = $false
  try {
    $Contexte = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/context' `
      -TimeoutSec 2
    $Connexion = Get-NetTCPConnection -LocalPort 3000 -State Listen |
      Select-Object -First 1
    $Processus = Get-CimInstance Win32_Process `
      -Filter "ProcessId=$($Connexion.OwningProcess)"
    $AncienSongless = $Contexte.port -eq 3000 `
      -and $Processus.Name -eq 'node.exe' `
      -and $Processus.CommandLine -match 'server\.js'
  } catch {}
  if (-not $AncienSongless) {
    throw 'Le port 3000 est utilise par un autre programme.'
  }
  Write-Host 'Fermeture de l''ancienne instance Songless...' `
    -ForegroundColor Yellow
  Stop-Process -Id $Connexion.OwningProcess -Force
  Start-Sleep -Milliseconds 800
  $PortLocalOccupe = Test-NetConnection 127.0.0.1 -Port 3000 `
    -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($PortLocalOccupe) {
    throw 'L''ancienne instance Songless ne s''est pas fermee.'
  }
}
if ($PortPublicOccupe) {
  throw 'Le port Internet 3001 est deja utilise par un autre programme.'
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

  Write-Host "Adresse HTTPS : $PublicUrl" -ForegroundColor Green
  Write-Host 'Le premier lancement peut demander une validation dans le navigateur.'
  Write-Host 'Fermer cette fenetre coupe immediatement le lien Internet.'

  $TunnelPret = $false
  for ($Tentative = 1; $Tentative -le 6; $Tentative++) {
    Write-Host "Demarrage du tunnel Tailscale ($Tentative/6)..." `
      -ForegroundColor DarkGray
    & $TailscalePath funnel --yes --bg 3001 | Out-Host
    $FunnelExitCode = $LASTEXITCODE
    if ($FunnelExitCode -eq 0) {
      Start-Sleep -Milliseconds 800
      try {
        $FunnelStatus = & $TailscalePath funnel status --json |
          ConvertFrom-Json
        $FunnelStatusJson = $FunnelStatus | ConvertTo-Json -Depth 12
        if ($FunnelStatusJson -match `
          '"Proxy"\s*:\s*"http://127\.0\.0\.1:3001"') {
          $TunnelPret = $true
          break
        }
      } catch {}
    }
    Start-Sleep -Seconds 1
  }
  if (-not $TunnelPret) {
    throw 'Le tunnel Tailscale ne s''est pas active apres 6 tentatives.'
  }

  $AdressePubliquePrete = $false
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $Response = Invoke-WebRequest -UseBasicParsing `
        -Uri "$PublicUrl/api/context" -TimeoutSec 3
      if ($Response.StatusCode -eq 200) {
        $AdressePubliquePrete = $true
        break
      }
    } catch {}
    Start-Sleep -Milliseconds 750
  }
  if (-not $AdressePubliquePrete) {
    throw 'Le tunnel est active, mais l''adresse HTTPS ne repond pas.'
  }

  Write-Host 'Tunnel et adresse HTTPS verifies.' -ForegroundColor Green
  if ($SmokeTest) {
    $CorpsSalon = @{
      mode = 'classic'
      totalRounds = 1
      settings = @{}
    } | ConvertTo-Json
    $Salon = Invoke-RestMethod -Method Post `
      -Uri 'http://127.0.0.1:3000/api/party/create' `
      -ContentType 'application/json' -Body $CorpsSalon -TimeoutSec 3
    $CodeSalon = [uri]::EscapeDataString([string]$Salon.code)
    $JetonHote = [uri]::EscapeDataString([string]$Salon.hostToken)
    $AdresseQr = "http://127.0.0.1:3000/api/party/$CodeSalon/qr.svg" `
      + "?hostToken=$JetonHote&kind=internet"
    $Qr = Invoke-WebRequest -UseBasicParsing -Uri $AdresseQr -TimeoutSec 3
    if ($Qr.StatusCode -ne 200 -or $Qr.Content -notmatch '<svg') {
      throw 'Le QR code du salon n''a pas pu etre genere.'
    }
    $Invitation = Invoke-WebRequest -UseBasicParsing `
      -Uri $Salon.inviteUrls.internet -TimeoutSec 3
    if ($Invitation.StatusCode -ne 200) {
      throw 'Le lien contenu dans le QR code ne repond pas.'
    }
    Write-Host 'QR code et invitation Internet verifies.' `
      -ForegroundColor Green
    Write-Host 'Test de lancement termine avec succes.' -ForegroundColor Green
    return
  }
  if (-not $SkipBrowser) {
    Start-Process $LocalUrl
  }
  Wait-Process -Id $Node.Id
} finally {
  try { & $TailscalePath funnel --yes --https=443 off | Out-Null } catch {}
  if ($Node -and -not $Node.HasExited) {
    Stop-Process -Id $Node.Id
  }
  if ($OwnsInstanceLock) {
    $InstanceLock.ReleaseMutex()
    $InstanceLock.Dispose()
  }
}
