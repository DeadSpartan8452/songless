$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$androidRoot = Join-Path $projectRoot 'mobile\android-host\android'
$gradle = Join-Path $androidRoot 'gradlew.bat'
$localData = [Environment]::GetFolderPath('LocalApplicationData')
$sdkRoot = if ($env:ANDROID_HOME) {
    $env:ANDROID_HOME
} else {
    Join-Path $localData 'Android\Sdk'
}
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$signingRoot = Join-Path $localData 'Songless\signing'
$keystore = Join-Path $signingRoot 'songless-release.keystore'
$passwordFile = Join-Path $signingRoot 'password.dpapi'
$alias = 'songless'
$outputRoot = Join-Path $projectRoot 'dist\Songless-Android'
$sourceRelative = 'app\build\outputs\apk\release\app-release.apk'
$sourceApk = Join-Path $androidRoot $sourceRelative
$generatedNodeAssets = Join-Path $androidRoot 'build\nodejs-assets'
$generatedAppBuild = Join-Path $androidRoot 'app\build'
$nodeMobileRoot = Join-Path $projectRoot `
    'mobile\android-host\node_modules\nodejs-mobile-react-native\android'
$generatedNodeMobileBuild = Join-Path $nodeMobileRoot 'build'
$outputApk = Join-Path $outputRoot 'Songless-Android.apk'
$payloadBuilder = Join-Path $projectRoot 'scripts\build-android-payload.js'
$alignmentAudit = Join-Path $projectRoot 'scripts\audit-android-native-alignment.js'

function Get-JavaTool([string]$name) {
    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME ('bin\' + $name + '.exe')
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $studio = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr\bin'
    $candidate = Join-Path $studio ($name + '.exe')
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    $gradleJdks = Join-Path $env:USERPROFILE '.gradle\jdks'
    if (Test-Path -LiteralPath $gradleJdks) {
        $tools = Get-ChildItem -LiteralPath $gradleJdks -Recurse -Filter ($name + '.exe') -ErrorAction SilentlyContinue
        $tool = $tools | Sort-Object FullName -Descending | Select-Object -First 1
        if ($tool) { return $tool.FullName }
    }
    $command = Get-Command ($name + '.exe') -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw ($name + '.exe est introuvable. Android Studio doit etre installe.')
}

function New-RandomPassword {
    $bytes = New-Object byte[] 48
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

function Protect-Password([string]$plain) {
    $secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
    return ConvertFrom-SecureString -SecureString $secure
}

function Unprotect-Password([string]$encrypted) {
    $secure = ConvertTo-SecureString -String $encrypted
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

if (-not (Test-Path -LiteralPath $gradle)) {
    throw 'Le projet Android Songless est incomplet.'
}

New-Item -ItemType Directory -Force -Path $signingRoot | Out-Null

$hasKeystore = Test-Path -LiteralPath $keystore
$hasPassword = Test-Path -LiteralPath $passwordFile
if ($hasKeystore -xor $hasPassword) {
    throw 'Signature Android incomplete. Les deux fichiers sont necessaires.'
}

$keytool = Get-JavaTool 'keytool'
$javaBin = Split-Path -Parent $keytool
$env:JAVA_HOME = Split-Path -Parent $javaBin
$env:Path = $javaBin + ';' + $env:Path

if (-not $hasKeystore) {
    Write-Host 'Creation de la signature Android privee...'
    $password = New-RandomPassword
    $protected = Protect-Password $password
    [IO.File]::WriteAllText(
        $passwordFile,
        $protected,
        [Text.Encoding]::ASCII
    )
    $env:SONGLESS_ANDROID_STORE_PASSWORD = $password
    $env:SONGLESS_ANDROID_KEY_PASSWORD = $password
    $keyArgs = @(
        '-genkeypair',
        '-v',
        '-keystore',
        $keystore,
        '-storepass:env',
        'SONGLESS_ANDROID_STORE_PASSWORD',
        '-keypass:env',
        'SONGLESS_ANDROID_KEY_PASSWORD',
        '-alias',
        $alias,
        '-keyalg',
        'RSA',
        '-keysize',
        '4096',
        '-validity',
        '10000',
        '-dname',
        'CN=Songless, OU=Application, O=Songless, C=FR'
    )
    & $keytool @keyArgs
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $keystore -Force -ErrorAction SilentlyContinue
        throw 'Creation de la signature impossible.'
    }
} else {
    $protected = [IO.File]::ReadAllText(
        $passwordFile,
        [Text.Encoding]::ASCII
    )
    $password = Unprotect-Password $protected
    $env:SONGLESS_ANDROID_STORE_PASSWORD = $password
    $env:SONGLESS_ANDROID_KEY_PASSWORD = $password
}

$env:SONGLESS_ANDROID_KEYSTORE = $keystore
$env:SONGLESS_ANDROID_KEY_ALIAS = $alias

Write-Host 'Preparation du moteur Songless embarque...'
$node = Get-Command 'node.exe' -ErrorAction Stop
& $node.Source $payloadBuilder
if ($LASTEXITCODE -ne 0) {
    throw 'Preparation du moteur Android impossible.'
}

$androidRootFull = [IO.Path]::GetFullPath($androidRoot).TrimEnd('\')
$nodeMobileRootFull = [IO.Path]::GetFullPath($nodeMobileRoot).TrimEnd('\')
$generatedBuildDirectories = @(
    @($generatedNodeAssets, (Join-Path $androidRootFull 'build\nodejs-assets')),
    @($generatedAppBuild, (Join-Path $androidRootFull 'app\build')),
    @($generatedNodeMobileBuild, (Join-Path $nodeMobileRootFull 'build'))
)
foreach ($entry in $generatedBuildDirectories) {
    $generatedPath = [IO.Path]::GetFullPath($entry[0])
    $expectedPath = [IO.Path]::GetFullPath($entry[1])
    if (-not $generatedPath.Equals(
        $expectedPath,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw 'Un cache Android genere ne peut pas etre purge en securite.'
    }
    if (Test-Path -LiteralPath $generatedPath) {
        Write-Host ('Purge du cache genere : ' + $generatedPath)
        Remove-Item -LiteralPath $generatedPath -Recurse -Force
    }
}

Write-Host 'Construction de l APK Release...'
Push-Location $androidRoot
try {
    & $gradle assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) {
        throw 'Gradle a refuse la construction.'
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $sourceApk)) {
    throw 'APK Release introuvable apres construction.'
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
Copy-Item -LiteralPath $sourceApk -Destination $outputApk -Force

$buildTools = Join-Path $sdkRoot 'build-tools'
$signers = Get-ChildItem -LiteralPath $buildTools -Filter 'apksigner.bat' -Recurse -ErrorAction SilentlyContinue
$signers = $signers | Sort-Object FullName -Descending
$signer = $signers | Select-Object -First 1
if (-not $signer) {
    throw 'apksigner.bat est introuvable.'
}

& $signer.FullName verify --verbose --print-certs $outputApk
if ($LASTEXITCODE -ne 0) {
    throw 'La signature finale de l APK est invalide.'
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputApk).Hash
$hashFile = Join-Path $outputRoot 'Songless-Android.sha256.txt'
$hashLine = $hash + '  Songless-Android.apk'
[IO.File]::WriteAllText(
    $hashFile,
    ($hashLine + [Environment]::NewLine),
    [Text.Encoding]::ASCII
)

Write-Host 'Controle de la compatibilite native 16 Kio...'
& $node.Source $alignmentAudit $outputApk
$alignmentExit = $LASTEXITCODE
if ($alignmentExit -eq 1) {
    throw 'Le controle des bibliotheques natives Android a echoue.'
}
if ($alignmentExit -eq 2) {
    Write-Warning 'APK fonctionnel en compatibilite 16 Kio, pas encore natif 16 Kio.'
}

Remove-Item Env:SONGLESS_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:SONGLESS_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue

Write-Host ''
Write-Host ('APK : ' + $outputApk)
Write-Host ('SHA-256 : ' + $hash)
Write-Host 'La cle privee reste hors du projet.'
exit 0
