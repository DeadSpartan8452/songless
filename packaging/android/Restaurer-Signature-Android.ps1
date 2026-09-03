param(
    [string]$BackupPath = '',
    [string]$SigningRoot = ''
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$localData = [Environment]::GetFolderPath('LocalApplicationData')
$defaultSigningRoot = Join-Path $localData 'Songless\signing'
if (-not $SigningRoot) { $SigningRoot = $defaultSigningRoot }
$keystore = Join-Path $SigningRoot 'songless-release.keystore'
$passwordFile = Join-Path $SigningRoot 'password.dpapi'
$defaultBackup = Join-Path $projectRoot `
    'dist\Songless-Sauvegarde-Signature\Songless-signature-portable.p12'
$temporaryStore = $keystore + '.nouveau'
$temporaryPassword = $passwordFile + '.nouveau'
$alias = 'songless'

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
        $tools = Get-ChildItem -LiteralPath $gradleJdks -Recurse `
            -Filter ($name + '.exe') -ErrorAction SilentlyContinue
        $tool = $tools | Sort-Object FullName -Descending | Select-Object -First 1
        if ($tool) { return $tool.FullName }
    }
    $command = Get-Command ($name + '.exe') -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw ($name + '.exe est introuvable. Android Studio doit etre installe.')
}

function Convert-ToPlainText([Security.SecureString]$secure) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function New-RandomPassword {
    $bytes = New-Object byte[] 48
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

if (-not $BackupPath) {
    $BackupPath = $defaultBackup
}
$BackupPath = [IO.Path]::GetFullPath($BackupPath)
if (-not (Test-Path -LiteralPath $BackupPath)) {
    throw ('Sauvegarde introuvable : ' + $BackupPath)
}
if ((Test-Path -LiteralPath $keystore) -or
    (Test-Path -LiteralPath $passwordFile)) {
    throw 'Une signature locale existe deja. Elle ne sera jamais ecrasee.'
}

$secureBackup = Read-Host 'Mot de passe de la sauvegarde' -AsSecureString
$backupPassword = Convert-ToPlainText $secureBackup
$localPassword = New-RandomPassword
$env:SONGLESS_BACKUP_PASSWORD = $backupPassword
$env:SONGLESS_LOCAL_PASSWORD = $localPassword
$keytool = Get-JavaTool 'keytool'

New-Item -ItemType Directory -Force -Path $SigningRoot | Out-Null
Remove-Item -LiteralPath $temporaryStore -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $temporaryPassword -Force -ErrorAction SilentlyContinue

try {
    & $keytool -list -keystore $BackupPath -storetype PKCS12 `
        '-storepass:env' SONGLESS_BACKUP_PASSWORD -alias $alias | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Mot de passe incorrect ou sauvegarde invalide.'
    }
    $arguments = @(
        '-importkeystore', '-noprompt',
        '-srckeystore', $BackupPath,
        '-srcstoretype', 'PKCS12',
        '-srcstorepass:env', 'SONGLESS_BACKUP_PASSWORD',
        '-srcalias', $alias,
        '-destkeystore', $temporaryStore,
        '-deststoretype', 'PKCS12',
        '-deststorepass:env', 'SONGLESS_LOCAL_PASSWORD'
    )
    & $keytool @arguments
    if ($LASTEXITCODE -ne 0) {
        throw 'La restauration de la cle privee a echoue.'
    }
    $secureLocal = ConvertTo-SecureString -String $localPassword `
        -AsPlainText -Force
    $protected = ConvertFrom-SecureString -SecureString $secureLocal
    [IO.File]::WriteAllText(
        $temporaryPassword,
        $protected,
        [Text.Encoding]::ASCII
    )
    Move-Item -LiteralPath $temporaryStore -Destination $keystore
    Move-Item -LiteralPath $temporaryPassword -Destination $passwordFile
} catch {
    Remove-Item -LiteralPath $keystore -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
    throw
} finally {
    Remove-Item -LiteralPath $temporaryStore -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporaryPassword -Force -ErrorAction SilentlyContinue
    Remove-Item Env:SONGLESS_BACKUP_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:SONGLESS_LOCAL_PASSWORD -ErrorAction SilentlyContinue
    $backupPassword = $null
    $localPassword = $null
}

Write-Host 'La signature a ete restauree et reprotegee par Windows DPAPI.'
exit 0
