param (
    [string]$pckPath = "F:\SteamLibrary\steamapps\common\Slay the Spire 2\SlayTheSpire2.pck",
    [string]$outputDir = "C:\Users\wjb21\Desktop\Antigravity Work\sts2_tracker\web\assets\cards"
)

$ErrorActionPreference = "Stop"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Extracting Official High-Res Non-Beta Card Illustrations" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$pfimDll = "C:\Users\wjb21\.gemini\antigravity\scratch\sts2_tracker\pfim_pkg\lib\netstandard2.0\Pfim.dll"
Add-Type -AssemblyName System.Drawing
[System.Reflection.Assembly]::LoadFrom($pfimDll) | Out-Null

$fs = [System.IO.File]::OpenRead($pckPath)
[void]$fs.Seek(0x713DAD30, [System.IO.SeekOrigin]::Begin)
$br = New-Object System.IO.BinaryReader($fs)
$fileCount = $br.ReadInt32()

$pckEntries = @{}
$spriteEntries = @()

for ($i = 0; $i -lt $fileCount; $i++) {
    $strLen = $br.ReadInt32()
    $pathBytes = $br.ReadBytes($strLen)
    $rawPath = [System.Text.Encoding]::UTF8.GetString($pathBytes).TrimEnd([char]0, ' ')
    $offset = $br.ReadInt64()
    $size = $br.ReadInt64()
    $md5 = $br.ReadBytes(16)
    $flags = $br.ReadInt32()
    $pckEntries[$rawPath] = @{ Offset = $offset; Size = $size }

    if ($rawPath.StartsWith("images/atlases/card_atlas.sprites/") -and $rawPath.EndsWith(".tres") -and -not $rawPath.Contains("/beta/")) {
        $spriteEntries += $rawPath
    }
}

Write-Host "Indexed $fileCount files. Found $($spriteEntries.Count) non-beta card sprites." -ForegroundColor Green

function Get-PckBytes([string]$path) {
    if (-not $pckEntries.ContainsKey($path)) { return $null }
    $entry = $pckEntries[$path]
    [void]$fs.Seek($entry.Offset + 0x70, [System.IO.SeekOrigin]::Begin)
    return $br.ReadBytes([int]$entry.Size)
}

$atlasCtexMap = @{
    "card_atlas_0.png" = ".godot/imported/card_atlas_0.png-6b947739e98d17beac01a23ccc9a95cd.bptc.ctex"
    "card_atlas_1.png" = ".godot/imported/card_atlas_1.png-bb33bddb901036c1b98672ff24807efe.bptc.ctex"
    "card_atlas_2.png" = ".godot/imported/card_atlas_2.png-b839d300f2a53ba5863bc17e02165eea.bptc.ctex"
}

# Pre-parse all sprite .tres files to know their atlas and Rect2
$atlasSprites = @{
    "card_atlas_0.png" = @()
    "card_atlas_1.png" = @()
    "card_atlas_2.png" = @()
}

$rectRegex = [regex]'region\s*=\s*Rect2\(\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*,\s*(-?[0-9.]+)\s*\)'
$atlasRegex = [regex]'path\s*=\s*"res://images/atlases/([^"]+)"'

foreach ($spritePath in $spriteEntries) {
    $tresBytes = Get-PckBytes $spritePath
    if (-not $tresBytes) { continue }
    $tresStr = [System.Text.Encoding]::UTF8.GetString($tresBytes)

    $mAtlas = $atlasRegex.Match($tresStr)
    $mRect = $rectRegex.Match($tresStr)

    if ($mAtlas.Success -and $mRect.Success) {
        $atlasName = $mAtlas.Groups[1].Value
        $cName = [System.IO.Path]::GetFileNameWithoutExtension($spritePath).ToLowerInvariant()

        $rx = [int][Math]::Round([double]::Parse($mRect.Groups[1].Value))
        $ry = [int][Math]::Round([double]::Parse($mRect.Groups[2].Value))
        $rw = [int][Math]::Round([double]::Parse($mRect.Groups[3].Value))
        $rh = [int][Math]::Round([double]::Parse($mRect.Groups[4].Value))

        if ($atlasSprites.ContainsKey($atlasName)) {
            $atlasSprites[$atlasName] += @{
                Name = $cName
                X = $rx
                Y = $ry
                W = $rw
                H = $rh
            }
        }
    }
}

$totalExtracted = 0

foreach ($atlasKey in @("card_atlas_0.png", "card_atlas_1.png", "card_atlas_2.png")) {
    $ctexKey = $atlasCtexMap[$atlasKey]
    $sprites = $atlasSprites[$atlasKey]
    Write-Host "`nProcessing $atlasKey ($($sprites.Count) sprites)..." -ForegroundColor Yellow

    $ctexBytes = Get-PckBytes $ctexKey
    if (-not $ctexBytes) {
        Write-Host "  Could not find $ctexKey in PCK!" -ForegroundColor Red
        continue
    }

    $width = [BitConverter]::ToInt32($ctexBytes, 8)
    $height = [BitConverter]::ToInt32($ctexBytes, 12)
    $rawBc7Len = $ctexBytes.Length - 52
    $rawBc7 = New-Object byte[] $rawBc7Len
    [Array]::Copy($ctexBytes, 52, $rawBc7, 0, $rawBc7Len)

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes("DDS "))
    $bw.Write([int]124)
    $bw.Write([int]0x000A1007)
    $bw.Write([int]$height)
    $bw.Write([int]$width)
    $bw.Write([int]$rawBc7Len)
    $bw.Write([int]0)
    $bw.Write([int]1)
    for ($i = 0; $i -lt 11; $i++) { $bw.Write([int]0) }
    $bw.Write([int]32)
    $bw.Write([int]4)
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes("DX10"))
    for ($i = 0; $i -lt 5; $i++) { $bw.Write([int]0) }
    $bw.Write([int]0x1000)
    for ($i = 0; $i -lt 4; $i++) { $bw.Write([int]0) }
    $bw.Write([int]98) # DXGI_FORMAT_BC7_UNORM
    $bw.Write([int]3)  # D3D10_RESOURCE_DIMENSION_TEXTURE2D
    $bw.Write([int]0)
    $bw.Write([int]1)
    $bw.Write([int]0)
    $bw.Write($rawBc7)
    $ms.Position = 0

    $pfImage = [Pfim.Pfimage]::FromStream($ms)
    Write-Host "  Decoded $atlasKey with Pfim: $($pfImage.Width)x$($pfImage.Height)" -ForegroundColor Green

    $handle = [System.Runtime.InteropServices.GCHandle]::Alloc($pfImage.Data, [System.Runtime.InteropServices.GCHandleType]::Pinned)
    $ptr = $handle.AddrOfPinnedObject()
    $fullAtlasBmp = New-Object System.Drawing.Bitmap($pfImage.Width, $pfImage.Height, $pfImage.Stride, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb, $ptr)

    foreach ($s in $sprites) {
        $rx = $s.X; $ry = $s.Y; $rw = $s.W; $rh = $s.H
        if ($rx + $rw -le $width -and $ry + $rh -le $height -and $rw -gt 0 -and $rh -gt 0) {
            $cropRect = New-Object System.Drawing.Rectangle($rx, $ry, $rw, $rh)
            $cardBmp = $fullAtlasBmp.Clone($cropRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $outPath = Join-Path $outputDir "$($s.Name).png"
            $cardBmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

            if ($s.Name -eq "strike_ironclad") {
                $cardBmp.Save((Join-Path $outputDir "strike.png"), [System.Drawing.Imaging.ImageFormat]::Png)
            }
            if ($s.Name -eq "defend_ironclad") {
                $cardBmp.Save((Join-Path $outputDir "defend.png"), [System.Drawing.Imaging.ImageFormat]::Png)
            }

            $cardBmp.Dispose()
            $totalExtracted++
        }
    }

    $fullAtlasBmp.Dispose()
    $handle.Free()
    $ms.Dispose()
    Write-Host "  Cropped $($sprites.Count) sprites from $atlasKey." -ForegroundColor Green
}

$fs.Close()
Write-Host "`n[SUCCESS] Successfully extracted $totalExtracted official card illustrations to $outputDir!" -ForegroundColor Green
