param(
    [ValidateSet('bootstrap', 'recovery')][string]$Mode = 'bootstrap',
    [string]$Username = 'owner',
    [string]$DisplayName = 'Владелец',
    [switch]$Hosted
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$projectDirectory = Split-Path -Parent $PSScriptRoot
$securePassword = Read-Host 'Пароль (от 15 символов; ввод скрыт)' -AsSecureString
$secureConfirmation = Read-Host 'Повторите пароль' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirmation)
try {
    $ownerPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $ownerConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)
    if ($ownerPassword -cne $ownerConfirmation) { throw 'Пароли не совпадают.' }
    Push-Location $projectDirectory
    try {
        if ($Hosted) {
            if (-not $env:DATABASE_URL) { throw 'Сначала задайте DATABASE_URL (прямой адрес нужной Neon базы) в этом терминале.' }
            Push-Location (Join-Path $projectDirectory 'backend')
            try { $ownerPassword | go run ./cmd/staff-admin -mode $Mode -username $Username -name $DisplayName }
            finally { Pop-Location }
        } else {
            $ownerPassword | docker compose -f compose.yaml -f compose.vite.yaml exec -T api staff-admin -mode $Mode -username $Username -name $DisplayName
        }
        if ($LASTEXITCODE -ne 0) { throw 'Учётная запись не изменена. Проверьте сообщение команды.' }
    } finally { Pop-Location }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer)
    $ownerPassword = $null
    $ownerConfirmation = $null
    $securePassword.Dispose()
    $secureConfirmation.Dispose()
}
