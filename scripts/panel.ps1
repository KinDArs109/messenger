# ---------------------------------------------------------------
#  Панель управления мессенджером.
#
#  Показывает состояние трёх слоёв (база, сервер, туннель), умеет
#  включать и выключать каждый, управляет автозагрузкой и прячется
#  в трей при закрытии окна.
#
#  WinForms, а не Electron: панель должна открываться мгновенно и не
#  тащить за собой 150 МБ рантайма ради четырёх кнопок. Ничего
#  устанавливать не нужно — всё уже есть в Windows.
#
#  Файл обязан быть в UTF-8 *с BOM*: Windows PowerShell 5.1 читает
#  скрипты без BOM в системной кодировке, и кириллица превращается
#  в мусор.
# ---------------------------------------------------------------

param(
    # Запуск при входе в Windows: окно не показываем, сразу уходим
    # в трей и поднимаем сервисы. Вручную панель открывают, чтобы
    # посмотреть состояние, и самовольно что-то включать в этом
    # случае она не должна.
    [switch]$Autostart
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
[System.Windows.Forms.Application]::EnableVisualStyles()

# ─── Единственный экземпляр ──────────────────────────────────────
# Мьютекс, а не поиск процесса по имени: процессов powershell.exe
# в системе много, и отличить свой от чужого по имени нельзя.
#
# Переменная скрипта, а не локальная: мьютекс должен жить, пока жив
# процесс. Собранный сборщиком мусора, он освободился бы, и второй
# запуск прошёл бы беспрепятственно.
$isNew = $false
$script:Instance = New-Object System.Threading.Mutex($true, "Local\MessengerSettingsPanel", [ref]$isNew)

# Через это событие второй запуск просит первый показать окно.
#
# Не FindWindow по заголовку: при запуске из автозагрузки окно не
# показывается ни разу, WinForms не создаёт для него дескриптор,
# и находить попросту нечего. Событие существует независимо от окна.
$script:ShowEvent = New-Object System.Threading.EventWaitHandle(
    $false, [System.Threading.EventResetMode]::AutoReset, "Local\MessengerPanelShow"
)

if (-not $isNew) {
    # Панель уже запущена. Человек нажал на ярлык, потому что хотел
    # увидеть панель, а не завести вторую иконку в трее.
    [void]$script:ShowEvent.Set()
    exit
}

# ─── Пути ────────────────────────────────────────────────────────
$PROJECT     = "C:\Users\Admin\Documents\Claude\messenger"
$PGSQL_HOME  = "C:\Users\Admin\pgsql"
$CLO         = Join-Path $PROJECT "tools\cloudpub\clo.exe"
$PG_CTL      = Join-Path $PGSQL_HOME "bin\pg_ctl.exe"
$PG_DATA     = Join-Path $PGSQL_HOME "data"
# Шестерня, а не знак мессенджера: это пульт управления, и путать
# его иконку с самим приложением — верный способ открыть не то.
# Рисуется скриптом make-gear-icon.ps1.
$ICON_FILE   = Join-Path $PSScriptRoot "panel-gear.ico"
$STARTUP_LNK = Join-Path ([Environment]::GetFolderPath('Startup')) 'Messenger.lnk'
# Имя намеренно не $AUTOSTART: в PowerShell имена переменных
# нечувствительны к регистру, и такая переменная — это тот же
# $Autostart, что и параметр-переключатель выше. Присвоение строки
# роняло скрипт на старте.
$BOOT_VBS    = Join-Path $PROJECT "scripts\panel-boot.vbs"

# ─── Палитра ─────────────────────────────────────────────────────
# Та же, что в самом мессенджере: панель — часть продукта, а не
# случайная утилита рядом с ним.
$C_BG     = [System.Drawing.Color]::FromArgb(30, 31, 34)
$C_CARD   = [System.Drawing.Color]::FromArgb(43, 45, 49)
$C_TEXT   = [System.Drawing.Color]::FromArgb(219, 222, 225)
$C_MUTED  = [System.Drawing.Color]::FromArgb(148, 155, 164)
$C_GREEN  = [System.Drawing.Color]::FromArgb(35, 165, 90)
$C_RED    = [System.Drawing.Color]::FromArgb(242, 63, 67)
$C_AMBER  = [System.Drawing.Color]::FromArgb(240, 178, 50)
$C_ACCENT = [System.Drawing.Color]::FromArgb(88, 101, 242)
$C_BTN    = [System.Drawing.Color]::FromArgb(56, 58, 64)

$F_TITLE = New-Object System.Drawing.Font("Segoe UI Semibold", 13)
$F_BODY  = New-Object System.Drawing.Font("Segoe UI", 9.75)
$F_SMALL = New-Object System.Drawing.Font("Segoe UI", 8.25)
$F_MONO  = New-Object System.Drawing.Font("Consolas", 9.5)

# ─── Проверки состояния ──────────────────────────────────────────
# Только мгновенные, локальные: панель опрашивает их каждые две
# секунды, и любой сетевой запрос здесь заморозил бы интерфейс.
function Test-Port([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(250)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { $client.Close() }
}

function Test-Tunnel {
    return [bool](Get-Process -Name clo -ErrorAction SilentlyContinue)
}

function Test-Autostart { return Test-Path $STARTUP_LNK }

# ─── Действия ────────────────────────────────────────────────────
# Всё запускается скрыто и без ожидания: пока команда отрабатывает,
# окно должно оставаться живым. Результат подхватит следующий опрос.
$script:shell = New-Object -ComObject WScript.Shell

function Invoke-Hidden([string]$command) {
    # WScript.Shell, а не Start-Process.
    #
    # Start-Process привязывает запущенное к времени жизни панели:
    # выходишь из трея — туннель умирает вместе с ней, и сайт отдаёт
    # 503, хотя база и сервер живы. Панель — пульт, а не хозяин
    # сервисов, и переживать её они обязаны.
    #
    # Второй аргумент 0 — скрытое окно, третий $false — не ждать.
    $script:shell.Run($command, 0, $false) | Out-Null
}

# Рабочую папку задаём через cd прямо в команде: WScript.Shell
# наследует текущую папку процесса, а pm2 обязан видеть свой
# ecosystem.config.cjs.
function Start-Db   { Invoke-Hidden "`"$PG_CTL`" -D `"$PG_DATA`" -l `"$PG_DATA\startup.log`" -w start" }
function Stop-Db    { Invoke-Hidden "`"$PG_CTL`" -D `"$PG_DATA`" -m fast stop" }
function Start-Srv  { Invoke-Hidden "wscript.exe `"$PROJECT\scripts\server.vbs`"" }

function Stop-Srv {
    # Сначала сторож, потом сам сервер: в обратном порядке сторож
    # успел бы поднять его заново, и кнопка «Остановить» не работала бы.
    $pidfile = Join-Path $PROJECT "logs\supervisor.pid"
    if (Test-Path $pidfile) {
        $spid = Get-Content $pidfile -ErrorAction SilentlyContinue
        if ($spid) { Stop-Process -Id $spid -Force -ErrorAction SilentlyContinue }
        Remove-Item $pidfile -Force -ErrorAction SilentlyContinue
    }
    $conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
}
function Start-Tun  { Invoke-Hidden "`"$CLO`" run" }

# Порядок обязателен: сервер без базы падает, туннель без сервера
# отдаёт ошибку.
function Start-All {
    if (-not (Test-Port 5432)) {
        Start-Db
        # Ждём готовности базы, а не запускаем сразу следом. pg_ctl
        # мы вызываем скрыто и не дожидаясь, поэтому «запустили»
        # и «принимает соединения» — разные моменты, и на холодном
        # старте между ними уходят секунды.
        $deadline = (Get-Date).AddSeconds(40)
        while (-not (Test-Port 5432) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 400
            # Без этого на время ожидания замирает трей и окно.
            [System.Windows.Forms.Application]::DoEvents()
        }
    }
    if (-not (Test-Port 3001)) { Start-Srv }
    if (-not (Test-Tunnel))    { Start-Tun }
}
function Stop-Tun   { Get-Process -Name clo -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }

function Set-Autostart([bool]$enabled) {
    if ($enabled) {
        $shell = New-Object -ComObject WScript.Shell
        $lnk = $shell.CreateShortcut($STARTUP_LNK)
        $lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
        $lnk.Arguments = "`"$BOOT_VBS`""
        $lnk.WorkingDirectory = $PROJECT
        $lnk.Description = "Messenger: baza, server, tunnel"
        $lnk.Save()
    } elseif (Test-Path $STARTUP_LNK) {
        Remove-Item $STARTUP_LNK -Force
    }
}

# ─── Публичный адрес ─────────────────────────────────────────────
# Берём у самого clo, а не из константы: поменяется поддомен —
# панель не должна показывать вчерашний адрес.
function Get-PublicUrl {
    try {
        $out = & $CLO ls 2>&1 | Out-String
        if ($out -match '(https://[a-z0-9\-\.]+\.cloudpub\.ru)') { return $Matches[1] }
    } catch { }
    return $null
}
$script:PublicUrl = Get-PublicUrl

# ─── Окно ────────────────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = "Настройки мессенджера"
$form.Size = New-Object System.Drawing.Size(504, 428)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.BackColor = $C_BG
$form.ForeColor = $C_TEXT
$form.Font = $F_BODY

# Тёмный заголовок окна. Без этого светлая системная полоса стоит
# над тёмной панелью, и приложение выглядит собранным наспех.
# Атрибут 20 — DWMWA_USE_IMMERSIVE_DARK_MODE, есть в Windows 10 1809+.
Add-Type -Namespace Native -Name Dwm -MemberDefinition @'
[DllImport("dwmapi.dll")]
public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
'@
$form.Add_HandleCreated({
    $dark = 1
    try { [Native.Dwm]::DwmSetWindowAttribute($form.Handle, 20, [ref]$dark, 4) | Out-Null } catch { }
})

if (Test-Path $ICON_FILE) {
    $script:AppIcon = New-Object System.Drawing.Icon($ICON_FILE)
    $form.Icon = $script:AppIcon
} else {
    $script:AppIcon = [System.Drawing.SystemIcons]::Application
}

$title = New-Object System.Windows.Forms.Label
$title.Text = "Настройки мессенджера"
$title.Font = $F_TITLE
$title.ForeColor = $C_TEXT
$title.Location = New-Object System.Drawing.Point(20, 16)
$title.Size = New-Object System.Drawing.Size(300, 26)
$form.Controls.Add($title)

# ─── Строка состояния одного слоя ────────────────────────────────
# Возвращает набор своих элементов, чтобы опрос потом обновлял их
# по ссылке, а не искал по индексу в коллекции контролов.
function New-StatusRow([string]$label, [int]$top, [scriptblock]$onStart, [scriptblock]$onStop) {
    $card = New-Object System.Windows.Forms.Panel
    $card.Location = New-Object System.Drawing.Point(20, $top)
    $card.Size = New-Object System.Drawing.Size(448, 44)
    $card.BackColor = $C_CARD
    $form.Controls.Add($card)

    $dot = New-Object System.Windows.Forms.Label
    $dot.Text = "●"
    $dot.Font = New-Object System.Drawing.Font("Segoe UI", 12)
    $dot.ForeColor = $C_MUTED
    $dot.Location = New-Object System.Drawing.Point(12, 11)
    $dot.Size = New-Object System.Drawing.Size(20, 22)
    $card.Controls.Add($dot)

    $name = New-Object System.Windows.Forms.Label
    $name.Text = $label
    $name.ForeColor = $C_TEXT
    $name.Location = New-Object System.Drawing.Point(36, 13)
    $name.Size = New-Object System.Drawing.Size(130, 20)
    $card.Controls.Add($name)

    $state = New-Object System.Windows.Forms.Label
    $state.Text = "проверяю…"
    $state.ForeColor = $C_MUTED
    $state.Location = New-Object System.Drawing.Point(180, 13)
    $state.Size = New-Object System.Drawing.Size(150, 20)
    $card.Controls.Add($state)

    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = "Запустить"
    $btn.Location = New-Object System.Drawing.Point(342, 9)
    $btn.Size = New-Object System.Drawing.Size(94, 26)
    $btn.FlatStyle = "Flat"
    $btn.FlatAppearance.BorderSize = 0
    $btn.BackColor = $C_BTN
    $btn.ForeColor = $C_TEXT
    $btn.Font = $F_SMALL
    $btn.Cursor = "Hand"
    $card.Controls.Add($btn)

    $row = [pscustomobject]@{
        Dot = $dot; State = $state; Button = $btn
        OnStart = $onStart; OnStop = $onStop; Running = $false
    }

    $btn.Add_Click({
        # Кнопка знает своё состояние из последнего опроса, а не
        # переспрашивает систему: между опросом и кликом ничего
        # измениться не успевает, а лишний вызов тормозил бы клик.
        if ($row.Running) { & $row.OnStop } else { & $row.OnStart }
        $row.State.Text = if ($row.Running) { "останавливаю…" } else { "запускаю…" }
        $row.State.ForeColor = $C_AMBER
        $row.Button.Enabled = $false
    }.GetNewClosure())

    return $row
}

$rowDb  = New-StatusRow "База данных" 56  { Start-Db }  { Stop-Db }
$rowSrv = New-StatusRow "Сервер"      108 { Start-Srv } { Stop-Srv }
$rowTun = New-StatusRow "Туннель"     160 { Start-Tun } { Stop-Tun }

# ─── Адрес ───────────────────────────────────────────────────────
$addrCard = New-Object System.Windows.Forms.Panel
$addrCard.Location = New-Object System.Drawing.Point(20, 216)
$addrCard.Size = New-Object System.Drawing.Size(448, 68)
$addrCard.BackColor = $C_CARD
$form.Controls.Add($addrCard)

$addrLabel = New-Object System.Windows.Forms.Label
$addrLabel.Text = "Адрес для друзей"
$addrLabel.Font = $F_SMALL
$addrLabel.ForeColor = $C_MUTED
$addrLabel.Location = New-Object System.Drawing.Point(12, 9)
$addrLabel.Size = New-Object System.Drawing.Size(200, 16)
$addrCard.Controls.Add($addrLabel)

$addrValue = New-Object System.Windows.Forms.LinkLabel
$addrValue.Text = if ($script:PublicUrl) { $script:PublicUrl } else { "туннель не настроен" }
$addrValue.Font = $F_MONO
$addrValue.LinkColor = $C_ACCENT
$addrValue.ActiveLinkColor = $C_ACCENT
$addrValue.ForeColor = $C_MUTED
$addrValue.Location = New-Object System.Drawing.Point(12, 30)
$addrValue.Size = New-Object System.Drawing.Size(322, 22)
# AutoSize выключен, а ширины хватает на весь адрес целиком: иначе
# LinkLabel переносит строку и обрезает её по высоте карточки.
$addrValue.AutoSize = $false
$addrCard.Controls.Add($addrValue)
$addrValue.Add_LinkClicked({
    if ($script:PublicUrl) { Start-Process $script:PublicUrl }
})

$copyBtn = New-Object System.Windows.Forms.Button
$copyBtn.Text = "Копировать"
$copyBtn.Location = New-Object System.Drawing.Point(342, 27)
$copyBtn.Size = New-Object System.Drawing.Size(94, 26)
$copyBtn.FlatStyle = "Flat"
$copyBtn.FlatAppearance.BorderSize = 0
$copyBtn.BackColor = $C_BTN
$copyBtn.ForeColor = $C_TEXT
$copyBtn.Font = $F_SMALL
$copyBtn.Cursor = "Hand"
$addrCard.Controls.Add($copyBtn)
$script:copiedAt = $null
$copyBtn.Add_Click({
    if ($script:PublicUrl) {
        [System.Windows.Forms.Clipboard]::SetText($script:PublicUrl)
        $copyBtn.Text = "Скопировано"
        $script:copiedAt = Get-Date
    }
})

# ─── Автозагрузка ────────────────────────────────────────────────
$auto = New-Object System.Windows.Forms.CheckBox
$auto.Text = "Запускать всё при входе в Windows"
$auto.Location = New-Object System.Drawing.Point(22, 298)
$auto.Size = New-Object System.Drawing.Size(320, 24)
$auto.ForeColor = $C_TEXT
$auto.Checked = Test-Autostart
$auto.Cursor = "Hand"
$form.Controls.Add($auto)
$auto.Add_CheckedChanged({ Set-Autostart $auto.Checked })

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "Ноутбук не должен засыпать — спящий он недоступен друзьям."
$hint.Font = $F_SMALL
$hint.ForeColor = $C_MUTED
$hint.Location = New-Object System.Drawing.Point(22, 322)
$hint.Size = New-Object System.Drawing.Size(450, 18)
$form.Controls.Add($hint)

# ─── Всё разом ───────────────────────────────────────────────────
$allOn = New-Object System.Windows.Forms.Button
$allOn.Text = "Запустить всё"
$allOn.Location = New-Object System.Drawing.Point(20, 350)
$allOn.Size = New-Object System.Drawing.Size(218, 34)
$allOn.FlatStyle = "Flat"
$allOn.FlatAppearance.BorderSize = 0
$allOn.BackColor = $C_ACCENT
$allOn.ForeColor = [System.Drawing.Color]::White
$allOn.Cursor = "Hand"
$form.Controls.Add($allOn)
$allOn.Add_Click({ Start-All })

$allOff = New-Object System.Windows.Forms.Button
$allOff.Text = "Остановить всё"
$allOff.Location = New-Object System.Drawing.Point(250, 350)
$allOff.Size = New-Object System.Drawing.Size(218, 34)
$allOff.FlatStyle = "Flat"
$allOff.FlatAppearance.BorderSize = 0
$allOff.BackColor = $C_BTN
$allOff.ForeColor = $C_TEXT
$allOff.Cursor = "Hand"
$form.Controls.Add($allOff)
$allOff.Add_Click({ Stop-Tun; Stop-Srv; Stop-Db })

# ─── Трей ────────────────────────────────────────────────────────
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $script:AppIcon
# Подсказка у иконки говорит о состоянии самого мессенджера, а не
# о панели: пользователю важно «работает ли», а не «открыты ли
# настройки». Дальше её обновляет опрос.
$tray.Text = "Мессенджер"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add("Открыть")
$miOpen.Add_Click({ $form.Show(); $form.WindowState = "Normal"; $form.Activate() })
[void]$menu.Items.Add("-")
$miExit = $menu.Items.Add("Закрыть")
$miExit.Add_Click({
    # Выход из панели не трогает сами сервисы: они живут отдельно
    # и должны продолжать работать, пока их не остановят явно.
    $script:reallyExit = $true
    $tray.Visible = $false
    $form.Close()
    # Цикл сообщений держит контекст, а не окно, поэтому закрытия
    # формы для выхода недостаточно — иначе процесс остался бы жить
    # без окна и без иконки, невидимым.
    $script:Context.ExitThread()
})
$tray.ContextMenuStrip = $menu
$tray.Add_MouseDoubleClick({ $form.Show(); $form.WindowState = "Normal"; $form.Activate() })

$script:reallyExit = $false
$form.Add_FormClosing({
    param($sender, $e)
    # Крестик прячет окно, а не выходит: панель должна оставаться
    # фоновым процессом. Настоящий выход — только из меню в трее.
    #
    # Аргументы события берём через param, а не через $_: в
    # обработчиках PowerShell $_ не заполняется, и $_.Cancel молча
    # не сработал бы — окно закрывалось бы вместе с приложением.
    if (-not $script:reallyExit) {
        $e.Cancel = $true
        $form.Hide()
    }
})

# ─── Опрос ───────────────────────────────────────────────────────
function Update-Row($row, [bool]$running) {
    $row.Running = $running
    $row.Dot.ForeColor = if ($running) { $C_GREEN } else { $C_RED }
    $row.State.Text = if ($running) { "работает" } else { "остановлен" }
    $row.State.ForeColor = if ($running) { $C_GREEN } else { $C_MUTED }
    $row.Button.Text = if ($running) { "Остановить" } else { "Запустить" }
    $row.Button.Enabled = $true
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({
    $db  = Test-Port 5432
    $srv = Test-Port 3001
    $tun = Test-Tunnel

    Update-Row $rowDb  $db
    Update-Row $rowSrv $srv
    Update-Row $rowTun $tun

    if (-not $script:PublicUrl -and $tun) {
        $script:PublicUrl = Get-PublicUrl
        if ($script:PublicUrl) { $addrValue.Text = $script:PublicUrl }
    }

    if ($script:copiedAt -and ((Get-Date) - $script:copiedAt).TotalSeconds -gt 2) {
        $copyBtn.Text = "Копировать"
        $script:copiedAt = $null
    }

    # Кто-то запустил панель второй раз — это просьба показать окно.
    # WaitOne(0) не ждёт, а только проверяет: держать на нём цикл
    # сообщений нельзя.
    if ($script:ShowEvent.WaitOne(0)) {
        $form.Show()
        $form.WindowState = "Normal"
        [void]$form.Activate()
    }

    $all = $db -and $srv -and $tun
    $tray.Text = if ($all) { "Мессенджер — работает" }
                 elseif ($db -or $srv -or $tun) { "Мессенджер — частично" }
                 else { "Мессенджер — остановлен" }
})
$timer.Start()

# Цикл сообщений привязан к контексту, а не к окну.
#
# Application.Run($form) обязательно показывает окно — при запуске
# вместе с Windows это означало бы всплывающую панель на каждом
# включении. С контекстом окно создано, но показывается только
# когда его попросят: из ярлыка или из трея.
$script:Context = New-Object System.Windows.Forms.ApplicationContext

if ($Autostart) {
    # Панель — точка входа: сервисы поднимает она, а не отдельный
    # скрипт в автозагрузке. Так у всего один хозяин, и состояние
    # в трее с самого начала соответствует действительности.
    Start-All
} else {
    $form.Show()
}

[System.Windows.Forms.Application]::Run($script:Context)
$tray.Dispose()
$script:Instance.ReleaseMutex()
