# ---------------------------------------------------------------
#  Рисует иконку-шестерню для панели настроек.
#
#  Своим кодом, а не готовой картинкой: иконка нужна ровно одна,
#  тащить ради неё библиотеку или искать файл с непонятной лицензией
#  дороже, чем нарисовать двадцатью строками System.Drawing.
#
#  Результат — panel.ico рядом со скриптом. Внутри .ico лежит PNG:
#  так формат разрешает с Vista, и не приходится городить BMP
#  с маской прозрачности.
# ---------------------------------------------------------------

Add-Type -AssemblyName System.Drawing

# Каждый размер рисуется заново, а не ужимается из большого.
# В трее иконка живёт в 16 пикселей: ужатая с 256 она превращается
# в мыло, нарисованная — остаётся читаемой шестернёй.
$sizes = @(16, 20, 24, 32, 48, 64, 128, 256)
$teeth = 8

# Цвет акцента мессенджера — иконка должна читаться как часть
# продукта, а не как случайная утилита рядом с ним.
$accent = [System.Drawing.Color]::FromArgb(255, 88, 101, 242)

function New-Gear([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $brush = New-Object System.Drawing.SolidBrush($accent)

    # Все размеры заданы долями стороны, поэтому пропорции одинаковы
    # хоть на 16 пикселях, хоть на 256.
    $center = $size / 2.0
    $toothW = $size * 0.18
    $toothH = $size * 0.23
    $radius = $size * 0.36
    $corner = [Math]::Max(1.0, $size * 0.047)

    # Каждый зубец — скруглённый прямоугольник, повёрнутый вокруг
    # центра. Поворачиваем систему координат, а не считаем углы
    # вручную: ошибиться в тригонометрии проще, чем в 360/8.
    for ($i = 0; $i -lt $teeth; $i++) {
        $g.ResetTransform()
        $g.TranslateTransform($center, $center)
        $g.RotateTransform(360.0 / $teeth * $i)

        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $x = -$toothW / 2
        $y = -$radius - $toothH / 2
        $r = $corner
        $path.AddArc($x, $y, $r, $r, 180, 90)
        $path.AddArc($x + $toothW - $r, $y, $r, $r, 270, 90)
        $path.AddArc($x + $toothW - $r, $y + $toothH - $r, $r, $r, 0, 90)
        $path.AddArc($x, $y + $toothH - $r, $r, $r, 90, 90)
        $path.CloseFigure()
        $g.FillPath($brush, $path)
        $path.Dispose()
    }

    $g.ResetTransform()

    $body = $size * 0.69
    $g.FillEllipse($brush, $center - $body / 2, $center - $body / 2, $body, $body)

    # SourceCopy, а не обычное смешивание: нам нужно именно вырезать
    # дырку до прозрачности, а не закрасить её прозрачной краской —
    # прозрачная краска поверх непрозрачной ничего не меняет.
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $hole = $size * 0.29
    $g.FillEllipse(
        (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)),
        $center - $hole / 2, $center - $hole / 2, $hole, $hole
    )

    $g.Dispose()
    return $bmp
}

# ─── Упаковка в .ico ─────────────────────────────────────────────
# Формат: заголовок, затем таблица записей, затем сами картинки.
# Смещения считаются только после того, как известны размеры всех
# картинок, поэтому сначала кодируем всё в память.

<#
    Мелкие размеры кладём классическим DIB, и только 256 — в PNG.

    Причина не в эстетике: GDI+ не понимает PNG внутри .ico вообще —
    DrawIcon на такой иконке падает с «range extends past the end».
    Шелл Windows её показывает, а всё, что рисует через GDI+, — нет.
    Держать иконку на поддержке одной подсистемы не стоит, тем более
    что DIB понимают обе.
#>
function ConvertTo-Dib([System.Drawing.Bitmap]$bmp) {
    $size = $bmp.Width
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                          [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $pixels = New-Object byte[] ($data.Stride * $size)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $pixels.Length)
    $bmp.UnlockBits($data)

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)

    # BITMAPINFOHEADER. Высота удвоена: формат ждёт картинку и маску
    # одной высотой, даже когда маска не используется.
    $bw.Write([uint32]40)
    $bw.Write([int32]$size)
    $bw.Write([int32]($size * 2))
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]0)                 # без сжатия
    $bw.Write([uint32]($size * $size * 4))
    0..3 | ForEach-Object { $bw.Write([uint32]0) }

    # Пиксели идут снизу вверх — так устроен DIB.
    for ($y = $size - 1; $y -ge 0; $y--) {
        $bw.Write($pixels, $y * $data.Stride, $size * 4)
    }

    # Маска прозрачности: нули. Прозрачность несёт альфа-канал,
    # но строку маски формат требует в любом случае, выровненную
    # по четыре байта.
    $maskRow = [Math]::Floor(($size + 31) / 32) * 4
    $bw.Write((New-Object byte[] ($maskRow * $size)))

    $bw.Flush()
    $bytes = $ms.ToArray()
    $bw.Close()
    # Запятая обязательна: без неё PowerShell разворачивает массив
    # в поток вывода, и наружу приходит Object[] из отдельных байтов.
    # BinaryWriter такой массив молча пишет как одно значение —
    # файл собирается, но картинок в нём нет.
    return ,$bytes
}

$images = foreach ($s in $sizes) {
    $bmp = New-Gear $s
    if ($s -ge 256) {
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
    } else {
        $bytes = ConvertTo-Dib $bmp
    }
    $bmp.Dispose()
    [pscustomobject]@{ Size = $s; Bytes = [byte[]]$bytes }
}

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([uint16]0)                    # зарезервировано
$bw.Write([uint16]1)                    # тип: иконка
$bw.Write([uint16]$images.Count)

# Первая картинка начинается сразу за заголовком и таблицей записей.
$offset = 6 + 16 * $images.Count
foreach ($img in $images) {
    # Ширина и высота — по одному байту, поэтому 256 записывается
    # нулём: ровно так это описано в формате.
    $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
    $bw.Write([byte]$dim)
    $bw.Write([byte]$dim)
    $bw.Write([byte]0)                  # палитры нет
    $bw.Write([byte]0)                  # зарезервировано
    $bw.Write([uint16]1)                # плоскостей
    $bw.Write([uint16]32)               # бит на пиксель
    $bw.Write([uint32]$img.Bytes.Length)
    $bw.Write([uint32]$offset)
    $offset += $img.Bytes.Length
}
foreach ($img in $images) { $bw.Write($img.Bytes) }
$bw.Flush()

# Имя отличается от прежнего panel.ico намеренно. Windows кэширует
# иконки по паре «путь + индекс», и перезапись файла по тому же пути
# на рабочем столе не видна: там остаётся картинка из кэша, иногда
# на сутки. Новый путь — гарантированный показ новой иконки.
$icoPath = Join-Path $PSScriptRoot "panel-gear.ico"
[System.IO.File]::WriteAllBytes($icoPath, $out.ToArray())
$bw.Close()

Write-Output "Готово: $icoPath — размеров $($images.Count), $([math]::Round((Get-Item $icoPath).Length / 1KB, 1)) КБ"
