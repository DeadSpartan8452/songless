param(
    [switch]$SkipWindows,
    [switch]$UseExistingAndroid
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$buildRoot = Join-Path $dist '.build'
$linuxStage = Join-Path $buildRoot 'Songless-Linux-x64'
$linuxArchive = Join-Path $dist 'Songless-Linux-x64.tar.gz'
$windowsKit = Join-Path $dist 'Songless-Windows-x64'
$windowsArchive = Join-Path $dist 'Songless-Windows-x64.zip'
$androidArchive = Join-Path $dist 'Songless-Android.apk'
$androidSource = Join-Path $dist 'Songless-Android\Songless-Android.apk'
$androidSourceHash = Join-Path $dist 'Songless-Android\Songless-Android.sha256.txt'
$nodeVersion = '24.15.0'
$nodeArchiveName = "node-v$nodeVersion-linux-x64.tar.xz"
$downloadRoot = Join-Path $env:LOCALAPPDATA 'Songless\build-cache'
$nodeArchive = Join-Path $downloadRoot $nodeArchiveName
$nodeChecksums = Join-Path $downloadRoot 'SHASUMS256.txt'
$runtimeStage = Join-Path $buildRoot 'node-linux-runtime'
$packageScript = Join-Path $root 'scripts\package-linux-tar.js'
$androidBuilder = Join-Path $root `
    'packaging\android\Construire-APK-Songless.ps1'
$androidSdk = if ($env:ANDROID_HOME) {
    $env:ANDROID_HOME
} else {
    Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$tar = (Get-Command tar.exe -ErrorAction Stop).Source

function Assert-GeneratedPath([string]$path, [string]$expected) {
    $full = [IO.Path]::GetFullPath($path).TrimEnd('\')
    $target = [IO.Path]::GetFullPath($expected).TrimEnd('\')
    if (-not $full.Equals($target, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Chemin de génération refusé : $full"
    }
}

function Invoke-Native([string]$executable, [string[]]$arguments) {
    & $executable @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Échec de la commande : $([IO.Path]::GetFileName($executable))"
    }
}

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'La génération des paquets demande Windows x64.'
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'musiques'))) {
    throw 'Bibliothèque locale Songless introuvable.'
}

if (-not $SkipWindows) {
    Write-Host '1/4 — Construction du kit Windows x64...'
    Invoke-Native $node @((Join-Path $root 'scripts\build-windows-kit.js'))

    Write-Host '2/4 — Création du ZIP Windows...'
    if (Test-Path -LiteralPath $windowsArchive) {
        Remove-Item -LiteralPath $windowsArchive -Force
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory(
        $windowsKit,
        $windowsArchive,
        [IO.Compression.CompressionLevel]::Optimal,
        $false
    )
} elseif (-not (Test-Path -LiteralPath $windowsArchive)) {
    throw 'Le ZIP Windows attendu est absent.'
}

Write-Host '3/4 — Préparation du paquet Linux autonome...'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
Assert-GeneratedPath $linuxStage (Join-Path $buildRoot 'Songless-Linux-x64')
Assert-GeneratedPath $runtimeStage (Join-Path $buildRoot 'node-linux-runtime')
if (Test-Path -LiteralPath $linuxStage) {
    Remove-Item -LiteralPath $linuxStage -Recurse -Force
}
if (Test-Path -LiteralPath $runtimeStage) {
    Remove-Item -LiteralPath $runtimeStage -Recurse -Force
}

$linuxApp = Join-Path $linuxStage 'app'
$linuxRuntime = Join-Path $linuxStage 'runtime'
New-Item -ItemType Directory -Force -Path $linuxApp,$linuxRuntime |
    Out-Null

foreach ($name in @('server.js','package.json','package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $root $name) `
        -Destination (Join-Path $linuxApp $name)
}
foreach ($name in @('lib','public','tools')) {
    Copy-Item -LiteralPath (Join-Path $root $name) `
        -Destination (Join-Path $linuxApp $name) -Recurse
}
$linuxPackaging = Join-Path $linuxStage 'packaging\linux'
New-Item -ItemType Directory -Force -Path $linuxPackaging | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'packaging\linux\launcher.js') `
    -Destination (Join-Path $linuxPackaging 'launcher.js')
Copy-Item -LiteralPath (Join-Path $root 'packaging\linux\Songless') `
    -Destination (Join-Path $linuxStage 'Songless')
Copy-Item -LiteralPath (Join-Path $root 'packaging\linux\README-Linux.txt') `
    -Destination (Join-Path $linuxStage 'README-Linux.txt')

$windowsOnly = Get-ChildItem -LiteralPath (Join-Path $linuxApp 'tools') `
    -File -Recurse -Force | Where-Object {
        $_.Extension -in @('.exe','.dll','.bat','.cmd','.ps1')
    }
foreach ($file in $windowsOnly) {
    Remove-Item -LiteralPath $file.FullName -Force
}

Push-Location $linuxApp
try {
    Invoke-Native $npm @(
        'ci','--omit=dev','--ignore-scripts','--os=linux','--cpu=x64',
        '--registry=https://registry.npmjs.org/'
    )
} finally {
    Pop-Location
}
$npmBins = Join-Path $linuxApp 'node_modules\.bin'
if (Test-Path -LiteralPath $npmBins) {
    Remove-Item -LiteralPath $npmBins -Recurse -Force
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$nodeBaseUrl = "https://nodejs.org/dist/v$nodeVersion"
if (-not (Test-Path -LiteralPath $nodeChecksums)) {
    Invoke-WebRequest -UseBasicParsing `
        -Uri "$nodeBaseUrl/SHASUMS256.txt" -OutFile $nodeChecksums
}
$checksumLine = Get-Content -LiteralPath $nodeChecksums |
    Where-Object { $_ -match "\s+$([Regex]::Escape($nodeArchiveName))$" } |
    Select-Object -First 1
if (-not $checksumLine) {
    throw 'Le manifeste officiel Node.js ne contient pas cette archive.'
}
$expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
if (-not (Test-Path -LiteralPath $nodeArchive)) {
    Invoke-WebRequest -UseBasicParsing `
        -Uri "$nodeBaseUrl/$nodeArchiveName" -OutFile $nodeArchive
}
$actualHash = (Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
    Remove-Item -LiteralPath $nodeArchive -Force
    throw 'La somme SHA-256 du runtime Node.js ne correspond pas au manifeste officiel.'
}

New-Item -ItemType Directory -Force -Path $runtimeStage | Out-Null
Invoke-Native $tar @(
    '-xJf',$nodeArchive,'-C',$runtimeStage,'--strip-components=1',
    "node-v$nodeVersion-linux-x64/bin/node",
    "node-v$nodeVersion-linux-x64/LICENSE"
)
Copy-Item -LiteralPath (Join-Path $runtimeStage 'bin\node') `
    -Destination (Join-Path $linuxRuntime 'node')
Copy-Item -LiteralPath (Join-Path $runtimeStage 'LICENSE') `
    -Destination (Join-Path $linuxRuntime 'LICENSE-Node.js')

Invoke-Native $node @($packageScript,$linuxStage,$linuxArchive)
$listing = & $tar -tvzf $linuxArchive
if ($LASTEXITCODE -ne 0) {
    throw 'L’archive Linux ne peut pas être relue.'
}
foreach ($path in @('runtime/node','Songless')) {
    $entry = $listing | Where-Object { $_ -match "\sSongless-Linux-x64/$path$" } |
        Select-Object -First 1
    if (-not $entry -or $entry -notmatch '^-rwxr-xr-x\s') {
        throw "Le droit d’exécution Linux manque pour $path."
    }
}

Write-Host '4/4 — Construction et signature de l’APK Android...'
$androidRebuilt = $false
if (-not $UseExistingAndroid) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File $androidBuilder
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Gradle a échoué ; contrôle de l’APK signé existant.'
    } else {
        $androidRebuilt = $true
    }
}

if (-not (Test-Path -LiteralPath $androidSource)) {
    throw 'Aucun APK Android à inclure.'
}
$expectedAndroidHash = (Get-Content -LiteralPath $androidSourceHash -Raw)
$expectedAndroidHash = ($expectedAndroidHash.Trim() -split '\s+')[0]
$actualAndroidHash = (Get-FileHash -LiteralPath $androidSource `
    -Algorithm SHA256).Hash
if ($actualAndroidHash -ne $expectedAndroidHash) {
    throw 'L’empreinte de contrôle APK ne concorde pas.'
}
$signer = Get-ChildItem -LiteralPath (Join-Path $androidSdk 'build-tools') `
    -Filter apksigner.bat -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signer) {
    throw 'apksigner est introuvable ; l’APK existant ne sera pas copié.'
}
& $signer.FullName verify --verbose $androidSource
if ($LASTEXITCODE -ne 0) {
    throw 'La signature de l’APK existant est invalide.'
}
if ($UseExistingAndroid) {
    Write-Host 'APK Android existant contrôlé et inclus.'
} elseif (-not $androidRebuilt) {
    Write-Warning 'L’APK livré est le dernier APK valide existant, non reconstruit.'
}
Copy-Item -LiteralPath `
    $androidSource -Destination $androidArchive -Force

$releases = @(
    (Join-Path $dist 'Songless-Windows-x64.zip'),
    $linuxArchive,
    $androidArchive
)
$checksumFile = Join-Path $dist 'Songless-SHA256SUMS.txt'
$lines = foreach ($file in $releases) {
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    "$hash  $([IO.Path]::GetFileName($file))"
}
[IO.File]::WriteAllLines($checksumFile,$lines,[Text.Encoding]::ASCII)

Write-Host ''
Write-Host 'Les trois fichiers hôtes sont prêts :'
foreach ($file in $releases) {
    $item = Get-Item -LiteralPath $file
    Write-Host ('  ' + $item.Name + ' — ' + $item.Length + ' octets')
}
Write-Host ('  SHA-256 : ' + $checksumFile)
