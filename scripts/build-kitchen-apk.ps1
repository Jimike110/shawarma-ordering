param(
    [Parameter(Mandatory=$true)][string]$Origin,
    [int]$VersionCode = 2,
    [string]$VersionName = '1.0.1',
    [string]$InstalledGradle = '',
    [string]$JavaHome = '',
    [string]$AndroidSdk = '',
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
if ($Origin -notmatch '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' -or $Origin -eq 'https://example.invalid') { throw 'Use the exact business HTTPS origin without a path or trailing slash.' }
if ($VersionCode -lt 1 -or $VersionName -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Use a positive version code and a semantic version name.' }
$repoPath = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $repoPath
try {
    if ($InstalledGradle) {
        if (!(Test-Path -LiteralPath $InstalledGradle) -or !(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe')) -or !(Test-Path -LiteralPath $AndroidSdk)) { throw 'Supply InstalledGradle, JavaHome (JDK 21) and AndroidSdk paths for the installed toolchain.' }
        $env:JAVA_HOME = $JavaHome
        $env:ANDROID_HOME = $AndroidSdk
    } else {
        docker build -f android-kitchen/Dockerfile -t shawarma-android-build android-kitchen
        if ($LASTEXITCODE -ne 0) { throw 'Android toolchain build failed.' }
    }
    $signingDirectory = Join-Path $repoPath 'artifacts/android-signing'
    New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
    $keyPath = Join-Path $signingDirectory 'kitchen.jks'
    $passwordPath = Join-Path $signingDirectory 'password.txt'
    if ((Test-Path -LiteralPath $keyPath) -and !(Test-Path -LiteralPath $passwordPath)) { throw 'Signing key exists but its password file is missing. Recover the original secret; do not replace this key.' }
    if (!(Test-Path -LiteralPath $passwordPath)) {
        $randomBytes = New-Object byte[] 32
        $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $randomGenerator.GetBytes($randomBytes) } finally { $randomGenerator.Dispose() }
        [IO.File]::WriteAllText($passwordPath, [Convert]::ToBase64String($randomBytes), [Text.UTF8Encoding]::new($false))
    }
    if (!(Test-Path -LiteralPath $keyPath)) {
        if ($InstalledGradle) {
            & (Join-Path $JavaHome 'bin/keytool.exe') -genkeypair -keystore $keyPath -storepass:file $passwordPath -keypass:file $passwordPath -alias kitchen -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Kitchen Trial App'
        } else {
            docker run --rm -v "${repoPath}:/app" --entrypoint keytool shawarma-android-build -genkeypair -keystore /app/artifacts/android-signing/kitchen.jks -storepass:file /app/artifacts/android-signing/password.txt -keypass:file /app/artifacts/android-signing/password.txt -alias kitchen -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Kitchen Trial App'
        }
        if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed.' }
    }
    if ($InstalledGradle) {
        $env:KITCHEN_KEYSTORE_FILE = $keyPath
        $env:KITCHEN_KEYSTORE_PASSWORD_FILE = $passwordPath
        $gradleOptions = @()
        if ($Offline) { $gradleOptions += '--offline' }
        & $InstalledGradle --no-daemon -p android-kitchen "-PkitchenOrigin=$Origin" "-PappVersionCode=$VersionCode" "-PappVersionName=$VersionName" @gradleOptions testDebugUnitTest lintRelease assembleRelease --console plain
    } else {
        docker run --rm -v "${repoPath}:/app" -v shawarma_android_gradle:/cache -e KITCHEN_KEYSTORE_FILE=/app/artifacts/android-signing/kitchen.jks -e KITCHEN_KEYSTORE_PASSWORD_FILE=/app/artifacts/android-signing/password.txt shawarma-android-build "-PkitchenOrigin=$Origin" "-PappVersionCode=$VersionCode" "-PappVersionName=$VersionName" testDebugUnitTest lintRelease assembleRelease
    }
    if ($LASTEXITCODE -ne 0) { throw 'Android checks/build failed. No APK was exported.' }
    $outputDirectory = Join-Path $repoPath 'artifacts/android'
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $exportPath = Join-Path $outputDirectory "yasha-kitchen-$VersionName.apk"
    Copy-Item -LiteralPath (Join-Path $repoPath 'android-kitchen/app/build/outputs/apk/release/app-release.apk') -Destination $exportPath
    $apkDigest = (Get-FileHash -LiteralPath $exportPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($exportPath + '.sha256', $apkDigest + '  ' + [IO.Path]::GetFileName($exportPath) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Write-Output "APK: artifacts/android/yasha-kitchen-$VersionName.apk"
    Write-Output 'Keep an encrypted backup of artifacts/android-signing outside the repository. Future updates need the same signing key.'
} finally { Pop-Location }
