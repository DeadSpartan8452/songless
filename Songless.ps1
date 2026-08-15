# Lanceur Songless
#
# Démarre le serveur s'il ne tourne pas déjà, attend qu'il réponde,
# puis ouvre le jeu dans le navigateur par défaut.
#
# Relançable sans risque : si Songless tourne déjà, on ouvre juste l'onglet.
#
# -Lan ouvre le jeu au réseau de la maison, pour jouer depuis le téléphone.
# Les appareils du réseau sont alors en lecture seule (voir server.js).

param([switch]$Lan)

$ErrorActionPreference = 'Stop'

$dossier = Split-Path -Parent $MyInvocation.MyCommand.Path
$port    = 3000
$url     = "http://localhost:$port"

# server.js n'écoute que sur 127.0.0.1 (IPv4). PowerShell résout « localhost »
# en IPv6 (::1) en premier : le test tombait donc systématiquement en timeout,
# et le lanceur croyait que Songless ne tournait jamais. On teste en IPv4
# explicite ; le navigateur, lui, sait rebasculer tout seul sur IPv4.
$urlTest = "http://127.0.0.1:$port"

function Serveur-Repond {
    try {
        $r = Invoke-WebRequest -Uri "$urlTest/api/genres" -TimeoutSec 2 -UseBasicParsing
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Alerte($message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, 'Songless', 'OK', 'Error') | Out-Null
}

# --- Déjà en route ? On n'en relance pas un second.
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
            Alerte "Songless tourne déjà, mais sans le mode réseau.`n`nFerme la fenêtre « Songless - serveur », puis relance ce raccourci."
            exit 1
        }
    }
    Start-Process $url
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

Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', "title Songless - serveur (fermer cette fenetre arrete le jeu) && $argsNode || pause" `
    -WorkingDirectory $dossier -WindowStyle Minimized

# --- On attend que le serveur réponde avant d'ouvrir le navigateur,
#     sinon on tombe sur une page d'erreur.
$limite = 25
for ($i = 0; $i -lt $limite; $i++) {
    if (Serveur-Repond) {
        Start-Process $url
        exit 0
    }
    Start-Sleep -Milliseconds 400
}

Alerte "Le serveur n'a pas répondu après 10 secondes.`n`nOuvre la fenêtre « Songless - serveur » pour voir le message d'erreur."
exit 1
