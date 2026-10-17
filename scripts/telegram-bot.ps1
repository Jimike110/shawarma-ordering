param(
  [Parameter(Mandatory = $true)][string]$Origin,
  [switch]$RemoveWebhook
)
$ErrorActionPreference = 'Stop'
$target = [Uri]$Origin
if ($target.Scheme -ne 'https' -or $target.AbsolutePath -ne '/' -or $target.Query -or $target.Fragment -or $target.UserInfo) {
  throw 'Origin must be an HTTPS origin without a path.'
}
if (-not $env:TELEGRAM_BOT_TOKEN -or $env:TELEGRAM_WEBHOOK_SECRET.Length -lt 32) {
  throw 'Export TELEGRAM_BOT_TOKEN and a random TELEGRAM_WEBHOOK_SECRET of at least 32 characters in this terminal.'
}
function Invoke-Bot([string]$Method, [hashtable]$Body) {
  try {
    $payloadBytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))
    $result = Invoke-RestMethod -Method Post -Uri ('https://api.telegram.org/bot' + $env:TELEGRAM_BOT_TOKEN + '/' + $Method) -ContentType 'application/json; charset=utf-8' -Body $payloadBytes -TimeoutSec 15 -MaximumRedirection 0
    if (-not $result.ok) { throw 'Bot rejected configuration.' }
  } catch {
    # PowerShell exceptions otherwise contain the bot token in the request URL.
    throw 'Telegram configuration failed. Check the local token, secret and connectivity; credentials were not printed.'
  }
}
if ($RemoveWebhook) {
  Invoke-Bot 'deleteWebhook' @{}
  Invoke-Bot 'setChatMenuButton' @{ menu_button = @{ type = 'default' } }
  Write-Output 'Webhook and temporary order menu removed. Stop the temporary tunnel too.'
  exit
}
Invoke-Bot 'setWebhook' @{
  url = $Origin.TrimEnd('/') + '/api/telegram/webhook'
  secret_token = $env:TELEGRAM_WEBHOOK_SECRET
  allowed_updates = @('message', 'my_chat_member')
  max_connections = 2
}
Invoke-Bot 'setChatMenuButton' @{
  menu_button = @{ type = 'web_app'; text = 'Заказать'; web_app = @{ url = $Origin.TrimEnd('/') + '/tg/' } }
}
Write-Output 'Test webhook and order menu configured. Main Mini App setup in BotFather is optional for startapp links; bot buttons open the Mini App directly.'
