Add-Type -AssemblyName System.Drawing

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $s = $size / 256.0

  $bg = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(255, 13, 18, 32))
  $r = 52 * $s
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc(0, 0, (2*$r), (2*$r), 180, 90)
  $gp.AddArc(($size-2*$r), 0, (2*$r), (2*$r), 270, 90)
  $gp.AddArc(($size-2*$r), ($size-2*$r), (2*$r), (2*$r), 0, 90)
  $gp.AddArc(0, ($size-2*$r), (2*$r), (2*$r), 90, 90)
  $gp.CloseFigure()
  $g.FillPath($bg, $gp)

  $ringPen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(115, 91, 141, 239)), (4*$s)
  $g.DrawEllipse($ringPen, (46*$s), (46*$s), (164*$s), (164*$s))

  $inner = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(31, 91, 141, 239))
  $g.FillEllipse($inner, (82*$s), (82*$s), (92*$s), (92*$s))

  $pts = New-Object 'System.Drawing.PointF[]' 8
  $pts[0]  = New-Object System.Drawing.PointF -ArgumentList ((128*$s), (62*$s))
  $pts[1]  = New-Object System.Drawing.PointF -ArgumentList ((141*$s), (115*$s))
  $pts[2]  = New-Object System.Drawing.PointF -ArgumentList ((194*$s), (128*$s))
  $pts[3]  = New-Object System.Drawing.PointF -ArgumentList ((141*$s), (141*$s))
  $pts[4]  = New-Object System.Drawing.PointF -ArgumentList ((128*$s), (194*$s))
  $pts[5]  = New-Object System.Drawing.PointF -ArgumentList ((115*$s), (141*$s))
  $pts[6]  = New-Object System.Drawing.PointF -ArgumentList ((62*$s), (128*$s))
  $pts[7]  = New-Object System.Drawing.PointF -ArgumentList ((115*$s), (115*$s))
  $starBrush = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(255, 91, 141, 239))
  $g.FillPolygon($starBrush, $pts)

  $dot = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::White)
  $g.FillEllipse($dot, (119*$s), (119*$s), (18*$s), (18*$s))
  $g.Dispose()
  return $bmp
}

$sizes = @(256, 128, 64, 48, 32, 24, 16)
$blobs = @{}
foreach ($sz in $sizes) {
  $bmp = New-IconBitmap $sz
  if ($sz -eq 256) { $bmp.Save("desktop/src/icon.png", [System.Drawing.Imaging.ImageFormat]::Png) }
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $blobs[$sz] = $ms.ToArray()
  $ms.Dispose(); $bmp.Dispose()
}

$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter -ArgumentList $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($sz in $sizes) {
  $b = if ($sz -ge 256) { 0 } else { $sz }
  $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$blobs[$sz].Length); $w.Write([uint32]$offset)
  $offset += $blobs[$sz].Length
}
foreach ($sz in $sizes) { $w.Write($blobs[$sz]) }
[System.IO.File]::WriteAllBytes("desktop/src/icon.ico", $out.ToArray())
$w.Dispose()
Write-Host "icon.png + icon.ico generated"
