# Lanceur Songless
#
# Démarre le serveur s'il ne tourne pas déjà, attend qu'il réponde,
# puis ouvre le jeu dans le navigateur par défaut.
#
# Relançable sans risque : si Songless tourne déjà, on ouvre juste l'onglet.
#
# -Lan ouvre le jeu au réseau de la maison, pour jouer depuis le téléphone.
# Les appareils du réseau sont alors en lecture seule (voir server.js).

param(
    [switch]$Lan,
    [switch]$SkipBrowser
)

$ErrorActionPreference = 'Stop'

$dossier = Split-Path -Parent $MyInvocation.MyCommand.Path
$port    = 3000
$url     = "http://localhost:$port"

# Clé propre à cette installation, chiffrée par Windows pour l’utilisateur.
# PowerShell 5.1 ne charge pas toujours cet assembly automatiquement sur une
# installation fraîche. Sans lui, ProtectedData est inconnu et la boîte
# d'erreur du lanceur peut rester cachée derrière la fenêtre réduite.
Add-Type -AssemblyName System.Security
$keyPath = if ($env:SONGLESS_INSTANCE_KEY_FILE) {
    [IO.Path]::GetFullPath($env:SONGLESS_INSTANCE_KEY_FILE)
} else {
    Join-Path $dossier '.songless-instance-key'
}
$keyDirectory = Split-Path -Parent $keyPath
if (-not (Test-Path -LiteralPath $keyDirectory)) {
    New-Item -ItemType Directory -Force -Path $keyDirectory | Out-Null
}
try {
    if (Test-Path -LiteralPath $keyPath) {
        $protected = [Convert]::FromBase64String(
            (Get-Content -Raw -LiteralPath $keyPath).Trim()
        )
        $keyBytes = [Security.Cryptography.ProtectedData]::Unprotect(
            $protected,
            $null,
            [Security.Cryptography.DataProtectionScope]::CurrentUser
        )
    } else {
        $keyBytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($keyBytes)
        $rng.Dispose()
        $protected = [Security.Cryptography.ProtectedData]::Protect(
            $keyBytes,
            $null,
            [Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        [IO.File]::WriteAllText($keyPath, [Convert]::ToBase64String($protected))
    }
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "La cle locale de Songless ne peut pas etre ouverte.`n`nRepare l'installation sans supprimer tes donnees.",
        'Songless', 'OK', 'Error'
    ) | Out-Null
    exit 1
}
$nonce = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($nonce)
$rng.Dispose()
$hmac = New-Object Security.Cryptography.HMACSHA256 (,$keyBytes)
$runtimeBytes = $hmac.ComputeHash($nonce)
$hmac.Dispose()
$instanceToken = [Convert]::ToBase64String($runtimeBytes).TrimEnd('=')
$instanceToken = $instanceToken.Replace('+', '-').Replace('/', '_')
$urlAdmin = "$url/admin-bootstrap?token=$instanceToken"

# server.js n'écoute que sur 127.0.0.1 (IPv4). PowerShell résout « localhost »
# en IPv6 (::1) en premier : le test tombait donc systématiquement en timeout,
# et le lanceur croyait que Songless ne tournait jamais. On teste en IPv4
# explicite ; le navigateur, lui, sait rebasculer tout seul sur IPv4.
$urlTest = "http://127.0.0.1:$port"

function Serveur-Repond {
    try {
        $r = Invoke-WebRequest -Uri "$urlTest/api/context" -TimeoutSec 2 -UseBasicParsing
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Alerte($message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, 'Songless', 'OK', 'Error') | Out-Null
}

# --- Déjà en route ? On ne relance rien et on n'ouvre pas un second onglet.
if (Serveur-Repond) {
    # Sauf si on demande le mode réseau alors que le serveur en cours ne l'a
    # pas : ouvrir l'onglet sans rien dire laisserait croire que le téléphone
    # peut se connecter.
    if ($Lan) {
        $dejaLan = $false
        try {
            $ctx = Invoke-RestMethod -Uri "$urlTest/api/context" -TimeoutSec 2
            $dejaLan = [bool]$ctx.lan
        } catch { }

        if (-not $dejaLan) {
            Alerte "Songless tourne deja, mais sans le mode reseau.`n`nFerme la fenetre Songless - serveur, puis relance ce raccourci."
            exit 1
        }
    }
    Write-Host 'Songless est deja ouvert. Aucun second lancement.' `
        -ForegroundColor Yellow
    exit 0
}

# --- Vérifications avant démarrage
if (-not (Test-Path (Join-Path $dossier 'server.js'))) {
    Alerte "server.js introuvable dans :`n$dossier"
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Alerte "Node.js est introuvable. Installe-le depuis nodejs.org, puis relance ce raccourci."
    exit 1
}

if (-not (Test-Path (Join-Path $dossier 'node_modules'))) {
    # Première utilisation : on installe les dépendances, ça peut prendre une minute.
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm install' `
        -WorkingDirectory $dossier -Wait -WindowStyle Minimized
}

# --- Démarrage du serveur dans sa propre fenêtre.
# Volontairement réduite et non masquée : la fermer arrête Songless.
$argsNode = if ($Lan) { 'node server.js --lan' } else { 'node server.js' }
$env:SONGLESS_INSTANCE_SECRET = $instanceToken

Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "title Songless - serveur (fermer cette fenetre arrete le jeu) && $argsNode || pause" `
    -WorkingDirectory $dossier -WindowStyle Minimized

# --- On attend que le serveur réponde avant d'ouvrir le navigateur,
#     sinon on tombe sur une page d'erreur.
$limite = 25
for ($i = 0; $i -lt $limite; $i++) {
    if (Serveur-Repond) {
        if (-not $SkipBrowser) {
            Start-Process $urlAdmin
        }
        exit 0
    }
    Start-Sleep -Milliseconds 400
}

Alerte "Le serveur n'a pas repondu apres 10 secondes.`n`nOuvre la fenetre Songless - serveur pour voir le message d'erreur."
exit 1
