# Ярлык «Хозяйство» на рабочем столе.
#
#   powershell -ExecutionPolicy Bypass -File apps\admin\ярлык.ps1
#
# Панель — приложение Electron, и запускать его командой в консоли
# каждый раз незачем. Ярлык указывает прямо на electron.exe: обёртки
# вроде .vbs тут не нужны, потому что Electron — оконная программа
# и чёрного окна консоли за собой не тащит.
#
# Ярлык живёт только на этой машине и в репозиторий не попадает: он
# и есть тот самый «только у меня».

$ErrorActionPreference = "Stop"

$корень = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$electron = Join-Path $корень "node_modules\electron\dist\electron.exe"
$панель = Join-Path $корень "apps\admin"
$иконка = Join-Path $корень "scripts\panel-gear.ico"

if (-not (Test-Path $electron)) {
  Write-Host "Не нашёл electron.exe — сначала npm install в корне репозитория"
  exit 1
}

$стол = [Environment]::GetFolderPath("Desktop")
$путь = Join-Path $стол "Хозяйство.lnk"

$shell = New-Object -ComObject WScript.Shell
$ярлык = $shell.CreateShortcut($путь)
$ярлык.TargetPath = $electron
$ярлык.Arguments = '"' + $панель + '"'
# Рабочий каталог — корень репозитория: оттуда Electron видит свои
# библиотеки, если однажды они понадобятся панели.
$ярлык.WorkingDirectory = $корень
$ярлык.Description = "Хозяйство мессенджера — люди, приглашения, серверы"
if (Test-Path $иконка) { $ярлык.IconLocation = $иконка }
$ярлык.Save()

Write-Host "Ярлык готов: $путь"
