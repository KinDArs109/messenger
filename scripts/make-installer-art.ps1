# ---------------------------------------------------------------
#  Картинки для установщика.
#
#  NSIS принимает только BMP и только без прозрачности — PNG и альфа
#  он не понимает. Поэтому рисуем 24-битные BMP: боковую панель
#  мастера и полоску в шапке.
#
#  Размеры жёсткие, их задаёт сам NSIS: 164×314 сбоку, 150×57 сверху.
#  Другие он молча растянет.
# ---------------------------------------------------------------

Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot "..\apps\desktop\build"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$bg     = [System.Drawing.Color]::FromArgb(30, 31, 34)
$accent = [System.Drawing.Color]::FromArgb(88, 101, 242)
$bright = [System.Drawing.Color]::FromArgb(242, 243, 245)
$muted  = [System.Drawing.Color]::FromArgb(148, 155, 164)

# Знак мессенджера: скруглённый прямоугольник с хвостиком и тремя
# точками. Тот же, что в приложении и на странице скачивания.
function Draw-Mark($g, [single]$x, [single]$y, [single]$size, $color) {
    $pen = New-Object System.Drawing.Pen($color, [single]($size * 0.09))
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $w = $size
    $h = $size * 0.72
    $r = $size * 0.18

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    # Хвостик вместо левого нижнего скругления.
    $path.AddLine($x + $w * 0.42, $y + $h, $x + $w * 0.30, $y + $h + $size * 0.20)
    $path.AddLine($x + $w * 0.30, $y + $h + $size * 0.20, $x + $w * 0.30, $y + $h)
    $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.DrawPath($pen, $path)
    $path.Dispose()
    $pen.Dispose()

    $dot = New-Object System.Drawing.SolidBrush($color)
    $d = $size * 0.10
    foreach ($i in 0..2) {
        $cx = $x + $w * (0.28 + 0.22 * $i)
        $g.FillEllipse($dot, $cx - $d / 2, $y + $h * 0.45 - $d / 2, $d, $d)
    }
    $dot.Dispose()
}

function New-Canvas([int]$w, [int]$h) {
    # Format24bppRgb, а не 32: с альфа-каналом NSIS показывает мусор.
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.Clear($bg)
    return @($bmp, $g)
}

# ─── Боковая панель мастера ──────────────────────────────────────
$pair = New-Canvas 164 314
$bmp, $g = $pair

# Лёгкое свечение за знаком — иначе панель выглядит плоским пятном.
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse(-40, -60, 244, 220)
$brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
$brush.CenterColor = [System.Drawing.Color]::FromArgb(58, 60, 92)
$brush.SurroundColors = @($bg)
$g.FillPath($brush, $glow)
$brush.Dispose(); $glow.Dispose()

Draw-Mark $g 52 66 60 $accent

$title = New-Object System.Drawing.Font("Segoe UI Semibold", 13)
$sub   = New-Object System.Drawing.Font("Segoe UI", 8.5)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center

$g.DrawString("Мессенджер", $title, (New-Object System.Drawing.SolidBrush($bright)),
              (New-Object System.Drawing.RectangleF(0, 190, 164, 26)), $fmt)
$g.DrawString("для своих", $sub, (New-Object System.Drawing.SolidBrush($muted)),
              (New-Object System.Drawing.RectangleF(0, 216, 164, 20)), $fmt)

$g.Dispose()
$bmp.Save((Join-Path $out "installerSidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Save((Join-Path $out "uninstallerSidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

# ─── Полоска в шапке ─────────────────────────────────────────────
# Шапка у NSIS белая, поэтому знак здесь тёмный, а не светлый.
$pair = New-Canvas 150 57
$bmp, $g = $pair
$g.Clear([System.Drawing.Color]::White)
Draw-Mark $g 96 12 34 $accent
$g.Dispose()
$bmp.Save((Join-Path $out "installerHeader.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

Write-Output "Готово: installerSidebar.bmp, uninstallerSidebar.bmp, installerHeader.bmp"
