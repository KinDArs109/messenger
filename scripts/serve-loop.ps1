# ---------------------------------------------------------------
#  Сторож сервера: держит процесс живым и поднимает после падения.
#
#  Заменяет pm2. Причина простая: на Windows демон pm2 открывает
#  собственное окно консоли, спрятать его нечем, и закрыть тоже —
#  оно возвращается. Ради одной функции (перезапуск после падения)
#  это слишком заметная плата, а сама функция умещается в цикл.
#
#  Запускается скрыто через server.vbs. Файл обязан быть
#  в UTF-8 с BOM — иначе PowerShell 5.1 прочитает комментарии
#  в системной кодировке.
# ---------------------------------------------------------------

$PROJECT = "C:\Users\Admin\Documents\Claude\messenger"
$SERVER  = Join-Path $PROJECT "apps\server"
$TSX     = Join-Path $PROJECT "node_modules\tsx\dist\cli.mjs"
$LOGS    = Join-Path $PROJECT "logs"
$PIDFILE = Join-Path $LOGS "supervisor.pid"

New-Item -ItemType Directory -Force -Path $LOGS | Out-Null

# Эта машина и есть боевая, поэтому режим — production.
#
# Переменная окружения сильнее файла: Node не перезаписывает из
# --env-file то, что уже задано. В .env остаётся development,
# чтобы `npm run dev` работал как раньше.
#
# Разница не косметическая: в разработке сервер включает CORS для
# localhost:5173 и не ставит на cookie флаг Secure.
$env:NODE_ENV = "production"

# Второй сторож не нужен: два сервера подрались бы за порт 3001.
if (Test-Path $PIDFILE) {
    $old = Get-Content $PIDFILE -ErrorAction SilentlyContinue
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) { exit }
}
$PID | Set-Content $PIDFILE -Encoding ASCII

try {
    $fails = 0
    while ($true) {
        $started = Get-Date

        $proc = Start-Process -FilePath "node" `
            -ArgumentList "`"$TSX`" --env-file=.env src/index.ts" `
            -WorkingDirectory $SERVER -NoNewWindow -PassThru `
            -RedirectStandardOutput (Join-Path $LOGS "server.log") `
            -RedirectStandardError  (Join-Path $LOGS "server-error.log")

        $proc.WaitForExit()

        # Продержался меньше полуминуты — это не случайность, а поломка.
        # Пять таких подряд, и цикл останавливается: бесконечный
        # перезапуск только прячет причину и жжёт процессор.
        if (((Get-Date) - $started).TotalSeconds -lt 30) { $fails++ } else { $fails = 0 }
        if ($fails -ge 5) { break }

        Start-Sleep -Seconds 2
    }
} finally {
    Remove-Item $PIDFILE -Force -ErrorAction SilentlyContinue
}
