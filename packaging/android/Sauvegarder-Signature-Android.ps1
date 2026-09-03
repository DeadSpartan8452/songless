param(
    [string]$SigningRoot = '',
    [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot '..\..')
$localData = [Environment]::GetFolderPath('LocalApplicationData')
$defaultSigningRoot = Join-Path $localData 'Songless\signing'
$defaultOutputRoot = Join-Path $projectRoot 'dist\Songless-Sauvegarde-Signature'
if (-not $SigningRoot) { $SigningRoot = $defaultSigningRoot }
if (-not $OutputRoot) { $OutputRoot = $defaultOutputRoot }
$keystore = Join-Path $SigningRoot 'songless-release.keystore'
$passwordFile = Join-Path $SigningRoot 'password.dpapi'
$outputFile = Join-Path $OutputRoot 'Songless-signature-portable.p12'
$temporaryFile = $outputFile + '.nouveau'
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

if (-not (Test-Path -LiteralPath $keystore) -or
    -not (Test-Path -LiteralPath $passwordFile)) {
    throw 'Aucune signature Android Songless complete a sauvegarder.'
}
if (Test-Path -LiteralPath $outputFile) {
    throw 'Une sauvegarde portable existe deja. Elle ne sera jamais ecrasee.'
}

Write-Host 'Choisis un mot de passe de sauvegarde d au moins 14 caracteres.'
Write-Host 'Il ne sera enregistre nulle part : conserve-le separement du fichier.'
$firstSecure = Read-Host 'Mot de passe de sauvegarde' -AsSecureString
$secondSecure = Read-Host 'Confirme le mot de passe' -AsSecureString
$backupPassword = Convert-ToPlainText $firstSecure
$confirmation = Convert-ToPlainText $secondSecure
if ($backupPassword.Length -lt 14) {
    throw 'Le mot de passe doit contenir au moins 14 caracteres.'
}
if ($backupPassword -cne $confirmation) {
    throw 'Les deux mots de passe sont differents.'
}

$protected = [IO.File]::ReadAllText($passwordFile, [Text.Encoding]::ASCII)
$sourceSecure = ConvertTo-SecureString -String $protected
$sourcePassword = Convert-ToPlainText $sourceSecure
$env:SONGLESS_SOURCE_PASSWORD = $sourcePassword
$env:SONGLESS_BACKUP_PASSWORD = $backupPassword
$keytool = Get-JavaTool 'keytool'

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue

try {
    $arguments = @(
        '-importkeystore', '-noprompt',
        '-srckeystore', $keystore,
        '-srcstoretype', 'PKCS12',
        '-srcstorepass:env', 'SONGLESS_SOURCE_PASSWORD',
        '-srcalias', $alias,
        '-destkeystore', $temporaryFile,
        '-deststoretype', 'PKCS12',
        '-deststorepass:env', 'SONGLESS_BACKUP_PASSWORD'
    )
    & $keytool @arguments
    if ($LASTEXITCODE -ne 0) {
        throw 'La cle portable n a pas pu etre creee.'
    }
    & $keytool -list -keystore $temporaryFile -storetype PKCS12 `
        '-storepass:env' SONGLESS_BACKUP_PASSWORD -alias $alias | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'La verification de la sauvegarde a echoue.'
    }
    Move-Item -LiteralPath $temporaryFile -Destination $outputFile
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputFile).Hash
    $hashFile = Join-Path $OutputRoot 'Songless-signature-portable.sha256.txt'
    [IO.File]::WriteAllText(
        $hashFile,
        ($hash + '  Songless-signature-portable.p12' + [Environment]::NewLine),
        [Text.Encoding]::ASCII
    )
} finally {
    Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
    Remove-Item Env:SONGLESS_SOURCE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:SONGLESS_BACKUP_PASSWORD -ErrorAction SilentlyContinue
    $sourcePassword = $null
    $backupPassword = $null
    $confirmation = $null
}

Write-Host ''
Write-Host ('Sauvegarde portable : ' + $outputFile)
Write-Host 'Copie ce fichier sur un autre support.'
Write-Host 'Conserve son mot de passe a un autre endroit.'
exit 0
