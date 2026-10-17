param([Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_]{5,32}$')][string]$BotUsername)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$directory = Join-Path $repository 'artifacts'
$destination = Join-Path $directory 'telegram-test.env'
if (Test-Path -LiteralPath $destination) { throw 'Test configuration already exists. Edit it locally; it was not overwritten.' }
$tokenInput = Read-Host 'Separate TEST bot token from BotFather (hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenInput)
try { $tokenValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
if ($tokenValue -notmatch '^[0-9]+:[A-Za-z0-9_-]+$') { throw 'Invalid bot token format; no values printed.' }
function New-TestSecret {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$lines = @(
  '# Separate synthetic Telegram test only. Never commit or send this file.'
  ('TELEGRAM_BOT_USERNAME=' + $BotUsername)
  ('TELEGRAM_BOT_TOKEN=' + $tokenValue)
  ('TELEGRAM_WEBHOOK_SECRET=' + (New-TestSecret))
  ('TELEGRAM_DISPATCH_SECRET=' + (New-TestSecret))
  ('TELEGRAM_TEST_DB_PASSWORD=' + (New-TestSecret))
  ('TELEGRAM_TEST_SESSION_SECRET=' + (New-TestSecret))
  ('TELEGRAM_TEST_OWNER_PASSWORD=' + (New-TestSecret))
  'TELEGRAM_TEST_ORIGIN=https://telegram-test.invalid'
)
[IO.File]::WriteAllText($destination, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
$tokenValue = $null
Write-Output 'Created ignored artifacts/telegram-test.env. No secrets printed; normal .env unchanged.'
