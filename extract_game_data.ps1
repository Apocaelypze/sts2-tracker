# Slay the Spire 2 - Asset & Intelligence Extractor
# Extracts Character Portraits, Card Art, Relic Sprites, and parses Game Intelligence into sts2_data.json

param (
    [string]$pckPath = "F:\SteamLibrary\steamapps\common\Slay the Spire 2\SlayTheSpire2.pck",
    [string]$sts2DllPath = "F:\SteamLibrary\steamapps\common\Slay the Spire 2\data_sts2_windows_x86_64\sts2.dll",
    [string]$outputDir = "C:\Users\wjb21\.gemini\antigravity\scratch\sts2_tracker\web"
)

$ErrorActionPreference = "Stop"
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Slay the Spire 2 - Asset & Intelligence Extractor " -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan

# 1. Ensure output directories exist
$charDir = Join-Path $outputDir "assets\characters"
$cardDir = Join-Path $outputDir "assets\cards"
$relicDir = Join-Path $outputDir "assets\relics"
$dataDir = Join-Path $outputDir "data"

foreach ($d in @($charDir, $cardDir, $relicDir, $dataDir)) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}

# 2. Load Pfim for BC7 decoding and Mono.Cecil for IL inspection
$pfimDll = "C:\Users\wjb21\.gemini\antigravity\scratch\sts2_tracker\pfim_pkg\lib\netstandard2.0\Pfim.dll"
$cecilDll = "C:\Users\wjb21\.gemini\antigravity\scratch\sts2_tracker\cecil_pkg\lib\net40\Mono.Cecil.dll"

if (-not (Test-Path $pfimDll) -or -not (Test-Path $cecilDll)) {
    throw "Pfim or Mono.Cecil DLL missing! Please ensure nuget packages are extracted."
}

Add-Type -AssemblyName System.Drawing
[System.Reflection.Assembly]::LoadFrom($pfimDll) | Out-Null
[System.Reflection.Assembly]::LoadFrom($cecilDll) | Out-Null

# 3. Read PCK File Table
Write-Host "[1/5] Reading SlayTheSpire2.pck directory table..." -ForegroundColor Yellow
$fs = [System.IO.File]::OpenRead($pckPath)
[void]$fs.Seek(0x713DAD30, [System.IO.SeekOrigin]::Begin) # Directory offset
$br = New-Object System.IO.BinaryReader($fs)
$fileCount = $br.ReadInt32()

$pckEntries = @{}
for ($i = 0; $i -lt $fileCount; $i++) {
    $strLen = $br.ReadInt32()
    $pathBytes = $br.ReadBytes($strLen)
    $rawPath = [System.Text.Encoding]::UTF8.GetString($pathBytes).TrimEnd([char]0, ' ')
    $offset = $br.ReadInt64()
    $size = $br.ReadInt64()
    $md5 = $br.ReadBytes(16)
    $flags = $br.ReadInt32()
    $pckEntries[$rawPath] = @{ Offset = $offset; Size = $size }
}
Write-Host "Indexed $fileCount total entries from PCK." -ForegroundColor Green

# Helper function to read file bytes from PCK
function Get-PckFileBytes([string]$path) {
    if (-not $pckEntries.ContainsKey($path)) { return $null }
    $entry = $pckEntries[$path]
    [void]$fs.Seek($entry.Offset + 0x70, [System.IO.SeekOrigin]::Begin)
    return $br.ReadBytes([int]$entry.Size)
}

# Helper to extract embedded WebP from ctex
function Extract-WebPFromCtex([byte[]]$ctexBytes, [string]$outPath) {
    if (-not $ctexBytes -or $ctexBytes.Length -lt 64) { return $false }
    $idx = -1
    for ($j = 0; $j -lt [Math]::Min(128, $ctexBytes.Length - 4); $j++) {
        if ($ctexBytes[$j] -eq 82 -and $ctexBytes[$j+1] -eq 73 -and $ctexBytes[$j+2] -eq 70 -and $ctexBytes[$j+3] -eq 70) {
            $idx = $j
            break
        }
    }
    if ($idx -lt 0) { return $false }
    $webp = New-Object byte[] ($ctexBytes.Length - $idx)
    [Array]::Copy($ctexBytes, $idx, $webp, 0, $webp.Length)
    [System.IO.File]::WriteAllBytes($outPath, $webp)
    return $true
}

# 4. Extract Character Portraits
Write-Host "[2/5] Extracting Hero Portraits..." -ForegroundColor Yellow
$charMap = @{
    "ironclad"    = ".godot/imported/char_select_ironclad.png-6a60464bc609de472b194c81a0841360.ctex"
    "silent"      = ".godot/imported/char_select_silent.png-aa584b8f0a98b68f16fe08914b07273d.ctex"
    "defect"      = ".godot/imported/char_select_defect.png-ba64757c91d84638a1bb40ba6fc49e4d.ctex"
    "regent"      = ".godot/imported/char_select_regent.png-76fe3440499e294a36f663ff4cc83733.ctex"
    "necrobinder" = ".godot/imported/char_select_necrobinder.png-05afee48adb7cc146ffabe70c902ec95.ctex"
}

foreach ($cKey in $charMap.Keys) {
    $bytes = Get-PckFileBytes $charMap[$cKey]
    $outPath = Join-Path $charDir "$cKey.webp"
    if (Extract-WebPFromCtex $bytes $outPath) {
        Write-Host "  Extracted portrait: $cKey.webp" -ForegroundColor Green
    } else {
        Write-Host "  Failed portrait: $cKey" -ForegroundColor Red
    }
}

# 5. Extract Card Art Illustrations
Write-Host "[3/5] Extracting Card Art Illustrations (Lossless WebP)..." -ForegroundColor Yellow
$cardExtracted = 0
$cardMap = @{}

foreach ($key in $pckEntries.Keys) {
    if ($key -like '.godot/imported/*.ctex' -and -not ($key -like '*.bptc.ctex') -and -not ($key -like '*.s3tc.ctex')) {
        $fname = [System.IO.Path]::GetFileName($key)
        # format: <name>.png-<hash>.ctex
        $dashIdx = $fname.IndexOf('-')
        if ($dashIdx -gt 0) {
            $baseName = $fname.Substring(0, $dashIdx).Replace('.png', '').ToLowerInvariant()
            if (-not $cardMap.ContainsKey($baseName)) {
                $cardMap[$baseName] = $key
            }
        }
    }
}

# Find all card tres files
foreach ($key in $pckEntries.Keys) {
    if ($key -like 'images/atlases/card_atlas.sprites/*.tres') {
        $cardId = [System.IO.Path]::GetFileNameWithoutExtension($key).ToLowerInvariant()
        $outPath = Join-Path $cardDir "$cardId.webp"
        if (-not (Test-Path $outPath)) {
            $sourceCtex = $null
            if ($cardMap.ContainsKey($cardId)) {
                $sourceCtex = $cardMap[$cardId]
            } else {
                $short = $cardId.Replace("card.", "")
                if ($cardMap.ContainsKey($short)) { $sourceCtex = $cardMap[$short] }
            }
            if ($sourceCtex) {
                $bytes = Get-PckFileBytes $sourceCtex
                if (Extract-WebPFromCtex $bytes $outPath) {
                    $cardExtracted++
                }
            }
        } else {
            $cardExtracted++
        }
    }
}
Write-Host "  Extracted $cardExtracted card illustrations to $cardDir" -ForegroundColor Green

# 6. Decode Relic Atlas and Extract Transparent PNGs
Write-Host "[4/5] Decoding Relic Atlas and Extracting Relic Sprites..." -ForegroundColor Yellow
$relicAtlasCtex = ".godot/imported/relic_atlas.png-9b0d72cf095fb31862c28656d62b697f.bptc.ctex"
$atlasBytes = Get-PckFileBytes $relicAtlasCtex

if ($atlasBytes) {
    $width = [BitConverter]::ToInt32($atlasBytes, 8)
    $height = [BitConverter]::ToInt32($atlasBytes, 12)
    $rawBc7Len = $width * $height # 4096 * 680 = 2,785,280 bytes
    $rawBc7 = New-Object byte[] $rawBc7Len
    [Array]::Copy($atlasBytes, 52, $rawBc7, 0, $rawBc7Len)

    # Build DDS stream with DX10 header for Pfim
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
    $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
    $bw.Write([int]0x1000)
    $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
    $bw.Write([int]98) # DXGI_FORMAT_BC7_UNORM
    $bw.Write([int]3)  # D3D10_RESOURCE_DIMENSION_TEXTURE2D
    $bw.Write([int]0)
    $bw.Write([int]1)
    $bw.Write([int]0)
    $bw.Write($rawBc7)
    $ms.Position = 0

    $pfImage = [Pfim.Pfimage]::FromStream($ms)
    Write-Host "  Pfim decoded Relic Atlas: $($pfImage.Width)x$($pfImage.Height)" -ForegroundColor Green

    $handle = [System.Runtime.InteropServices.GCHandle]::Alloc($pfImage.Data, [System.Runtime.InteropServices.GCHandleType]::Pinned)
    $ptr = $handle.AddrOfPinnedObject()
    $fullAtlasBmp = New-Object System.Drawing.Bitmap($pfImage.Width, $pfImage.Height, $pfImage.Stride, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb, $ptr)

    # Now read all relic tres regions and crop
    $relicCount = 0
    $rectRegex = [System.Text.RegularExpressions.Regex]::new('region\s*=\s*Rect2\s*\(\s*([0-9\.\-]+)\s*,\s*([0-9\.\-]+)\s*,\s*([0-9\.\-]+)\s*,\s*([0-9\.\-]+)\s*\)')

    foreach ($key in $pckEntries.Keys) {
        if ($key -like 'images/atlases/relic_atlas.sprites/*.tres') {
            $relicId = [System.IO.Path]::GetFileNameWithoutExtension($key).ToLowerInvariant()
            $tresBytes = Get-PckFileBytes $key
            $tresStr = [System.Text.Encoding]::UTF8.GetString($tresBytes)
            $m = $rectRegex.Match($tresStr)
            if ($m.Success) {
                $rx = [int][Math]::Round([double]::Parse($m.Groups[1].Value))
                $ry = [int][Math]::Round([double]::Parse($m.Groups[2].Value))
                $rw = [int][Math]::Round([double]::Parse($m.Groups[3].Value))
                $rh = [int][Math]::Round([double]::Parse($m.Groups[4].Value))

                # Bounds validation
                if ($rx + $rw -le $width -and $ry + $rh -le $height -and $rw -gt 0 -and $rh -gt 0) {
                    $cropRect = New-Object System.Drawing.Rectangle($rx, $ry, $rw, $rh)
                    $relicBmp = $fullAtlasBmp.Clone($cropRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                    $outRelicPath = Join-Path $relicDir "$relicId.png"
                    $relicBmp.Save($outRelicPath, [System.Drawing.Imaging.ImageFormat]::Png)
                    $relicBmp.Dispose()
                    $relicCount++
                }
            }
        }
    }
    $fullAtlasBmp.Dispose()
    $handle.Free()
    $ms.Dispose()
    Write-Host "  Successfully extracted $relicCount relic sprites to $relicDir" -ForegroundColor Green
} else {
    Write-Host "  Could not find relic atlas in PCK!" -ForegroundColor Red
}

# 7. Build Game Intelligence (sts2_data.json) from Localization and sts2.dll
Write-Host "[5/5] Building Game Intelligence Database (sts2_data.json)..." -ForegroundColor Yellow

# Read localization JSONs
function Get-PckJson([string]$path) {
    $bytes = Get-PckFileBytes $path
    if (-not $bytes) { return @{} }
    $str = [System.Text.Encoding]::UTF8.GetString($bytes)
    return $str | ConvertFrom-Json
}

$cardsLoc = Get-PckJson "localization/eng/cards.json"
$relicsLoc = Get-PckJson "localization/eng/relics.json"
$monstersLoc = Get-PckJson "localization/eng/monsters.json"
$encountersLoc = Get-PckJson "localization/eng/encounters.json"
$potionsLoc = Get-PckJson "localization/eng/potions.json"

# Inspect sts2.dll with Mono.Cecil for Card costs/types and Monster HP ranges
$sts2Asm = [Mono.Cecil.AssemblyDefinition]::ReadAssembly($sts2DllPath)
$cardModels = @{}
foreach ($t in ($sts2Asm.MainModule.Types | Where-Object { $_.Namespace -eq 'MegaCrit.Sts2.Core.Models.Cards' })) {
    $cName = $t.Name.ToUpperInvariant()
    $ctor = $t.Methods | Where-Object { $_.IsConstructor -and -not $_.IsStatic } | Select-Object -First 1
    $cost = 1
    $cardType = "Skill"
    $rarity = "Common"

    if ($ctor -and $ctor.Body) {
        $insts = $ctor.Body.Instructions
        # Look for call to CardModel::.ctor
        for ($k = 0; $k -lt $insts.Count; $k++) {
            if ($insts[$k].OpCode.Name -eq "call" -and $insts[$k].Operand.ToString() -like "*CardModel::.ctor*") {
                # Preceding instructions push arguments
                if ($k -ge 5) {
                    $cOp = $insts[$k - 5].OpCode.Name
                    if ($cOp -eq "ldc.i4.0") { $cost = 0 }
                    elseif ($cOp -eq "ldc.i4.1") { $cost = 1 }
                    elseif ($cOp -eq "ldc.i4.2") { $cost = 2 }
                    elseif ($cOp -eq "ldc.i4.3") { $cost = 3 }
                    elseif ($cOp -eq "ldc.i4.4") { $cost = 4 }
                    elseif ($cOp -eq "ldc.i4.m1") { $cost = -1 }
                    elseif ($cOp -eq "ldc.i4.s" -or $cOp -eq "ldc.i4") { $cost = [int]$insts[$k - 5].Operand }

                    $tOp = $insts[$k - 4].OpCode.Name
                    $tVal = 0
                    if ($tOp -eq "ldc.i4.0") { $tVal = 0 }
                    elseif ($tOp -eq "ldc.i4.1") { $tVal = 1 }
                    elseif ($tOp -eq "ldc.i4.2") { $tVal = 2 }
                    elseif ($tOp -eq "ldc.i4.3") { $tVal = 3 }
                    elseif ($tOp -eq "ldc.i4.s" -or $tOp -eq "ldc.i4") { $tVal = [int]$insts[$k - 4].Operand }
                    if ($tVal -eq 1) { $cardType = "Attack" }
                    elseif ($tVal -eq 2) { $cardType = "Skill" }
                    elseif ($tVal -eq 3) { $cardType = "Power" }
                    elseif ($tVal -eq 4) { $cardType = "Status" }
                    elseif ($tVal -eq 5) { $cardType = "Curse" }

                    $rOp = $insts[$k - 3].OpCode.Name
                    $rVal = 1
                    if ($rOp -eq "ldc.i4.0") { $rVal = 0 }
                    elseif ($rOp -eq "ldc.i4.1") { $rVal = 1 }
                    elseif ($rOp -eq "ldc.i4.2") { $rVal = 2 }
                    elseif ($rOp -eq "ldc.i4.3") { $rVal = 3 }
                    elseif ($rOp -eq "ldc.i4.s" -or $rOp -eq "ldc.i4") { $rVal = [int]$insts[$k - 3].Operand }
                    if ($rVal -eq 1) { $rarity = "Basic" }
                    elseif ($rVal -eq 2) { $rarity = "Common" }
                    elseif ($rVal -eq 3) { $rarity = "Uncommon" }
                    elseif ($rVal -eq 4) { $rarity = "Rare" }
                    elseif ($rVal -eq 5) { $rarity = "Special" }
                }
                break
            }
        }
    }
    $cardModels[$cName] = @{ Cost = $cost; Type = $cardType; Rarity = $rarity }
}

# Inspect Monster HP ranges
$monsterModels = @{}
foreach ($t in ($sts2Asm.MainModule.Types | Where-Object { $_.Namespace -eq 'MegaCrit.Sts2.Core.Models.Monsters' })) {
    $mName = $t.Name.ToUpperInvariant()
    $minHp = 50; $maxHp = 50
    $minHpA8 = 50; $maxHpA8 = 50

    $mMin = $t.Methods | Where-Object { $_.Name -eq 'get_MinInitialHp' } | Select-Object -First 1
    $mMax = $t.Methods | Where-Object { $_.Name -eq 'get_MaxInitialHp' } | Select-Object -First 1

    function Parse-HpInstructions($method) {
        if (-not $method -or -not $method.Body) { return @{ Base = 50; A8 = 50 } }
        $nums = @()
        foreach ($inst in $method.Body.Instructions) {
            $op = $inst.OpCode.Name
            if ($op -like "ldc.i4.*" -and $op -ne "ldc.i4.s") {
                if ($op -eq "ldc.i4.0") { $nums += 0 }
                elseif ($op -eq "ldc.i4.1") { $nums += 1 }
                elseif ($op -eq "ldc.i4.2") { $nums += 2 }
                elseif ($op -eq "ldc.i4.3") { $nums += 3 }
                elseif ($op -eq "ldc.i4.4") { $nums += 4 }
                elseif ($op -eq "ldc.i4.5") { $nums += 5 }
                elseif ($op -eq "ldc.i4.6") { $nums += 6 }
                elseif ($op -eq "ldc.i4.7") { $nums += 7 }
                elseif ($op -eq "ldc.i4.8") { $nums += 8 }
            } elseif ($op -eq "ldc.i4.s" -or $op -eq "ldc.i4") {
                $nums += [int]$inst.Operand
            }
        }
        if ($nums.Count -ge 3 -and $nums[0] -eq 8) {
            return @{ A8 = $nums[1]; Base = $nums[2] }
        } elseif ($nums.Count -ge 1) {
            return @{ Base = $nums[-1]; A8 = $nums[-1] }
        }
        return @{ Base = 50; A8 = 50 }
    }

    $minRes = Parse-HpInstructions $mMin
    $maxRes = Parse-HpInstructions $mMax

    $monsterModels[$mName] = @{
        MinHp = $minRes.Base
        MaxHp = $maxRes.Base
        MinHpA8 = $minRes.A8
        MaxHpA8 = $maxRes.A8
    }
}
$sts2Asm.Dispose()
$fs.Close()

# Clean description text from formatting codes
function Format-Desc([string]$text) {
    if (-not $text) { return "" }
    $res = $text
    $res = $res.Replace("[gold]", "<strong>").Replace("[/gold]", "</strong>")
    $res = $res.Replace("[blue]", "<span style='color:#38bdf8'>").Replace("[/blue]", "</span>")
    $res = $res.Replace("[red]", "<span style='color:#ef4444'>").Replace("[/red]", "</span>")
    $res = $res.Replace("[green]", "<span style='color:#10b981'>").Replace("[/green]", "</span>")
    $res = $res.Replace("[purple]", "<span style='color:#c084fc'>").Replace("[/purple]", "</span>")
    $res = $res.Replace("[orange]", "<span style='color:#f97316'>").Replace("[/orange]", "</span>")
    $res = $res.Replace("{energyPrefix:energyIcons(1)}", " [1 Energy]")
    $res = $res.Replace("{Energy:energyIcons()}", " Energy")
    $res = $res.Replace("{Damage:diff()}", "Damage")
    $res = $res.Replace("{Block:diff()}", "Block")
    $res = $res.Replace("`n", "<br/>")
    return $res
}

# Compile final JSON database
$db = @{
    cards = @{}
    relics = @{}
    monsters = @{}
    encounters = @{}
    potions = @{}
}

# Cards DB
$cardsLocProps = $cardsLoc | Get-Member -MemberType NoteProperty
foreach ($prop in $cardsLocProps) {
    if ($prop.Name.EndsWith(".title")) {
        $cKey = $prop.Name.Replace(".title", "")
        $title = $cardsLoc.$($prop.Name)
        $descRaw = $cardsLoc."$cKey.description"
        $desc = Format-Desc $descRaw

        $cleanKey = $cKey.Replace("_", "")
        $model = $cardModels[$cleanKey]
        $cost = if ($model) { $model.Cost } else { 1 }
        $cType = if ($model) { $model.Type } else { "Skill" }
        $rarity = if ($model) { $model.Rarity } else { "Common" }

        $db.cards["CARD.$cKey"] = @{
            id = "CARD.$cKey"
            name = $title
            cost = $cost
            type = $cType
            rarity = $rarity
            desc = $desc
            hasArt = (Test-Path (Join-Path $cardDir "$($cKey.ToLowerInvariant()).webp"))
        }
    }
}

# Relics DB
$relicsLocProps = $relicsLoc | Get-Member -MemberType NoteProperty
foreach ($prop in $relicsLocProps) {
    if ($prop.Name.EndsWith(".title")) {
        $rKey = $prop.Name.Replace(".title", "")
        $title = $relicsLoc.$($prop.Name)
        $descRaw = $relicsLoc."$rKey.description"
        $flavor = $relicsLoc."$rKey.flavor"

        $db.relics["RELIC.$rKey"] = @{
            id = "RELIC.$rKey"
            name = $title
            desc = Format-Desc $descRaw
            flavor = if ($flavor) { Format-Desc $flavor } else { "" }
            hasArt = (Test-Path (Join-Path $relicDir "$($rKey.ToLowerInvariant()).png"))
        }
    }
}

# Monsters DB
$monstersLocProps = $monstersLoc | Get-Member -MemberType NoteProperty
foreach ($prop in $monstersLocProps) {
    if ($prop.Name.EndsWith(".name")) {
        $mKey = $prop.Name.Replace(".name", "")
        $name = $monstersLoc.$($prop.Name)
        $cleanKey = $mKey.Replace("_", "")
        $hp = $monsterModels[$cleanKey]

        $db.monsters["MONSTER.$mKey"] = @{
            id = "MONSTER.$mKey"
            name = $name
            minHp = if ($hp) { $hp.MinHp } else { 45 }
            maxHp = if ($hp) { $hp.MaxHp } else { 55 }
            minHpA8 = if ($hp) { $hp.MinHpA8 } else { 50 }
            maxHpA8 = if ($hp) { $hp.MaxHpA8 } else { 60 }
        }
    }
}

# Encounters DB
$encLocProps = $encountersLoc | Get-Member -MemberType NoteProperty
foreach ($prop in $encLocProps) {
    if ($prop.Name.EndsWith(".title")) {
        $eKey = $prop.Name.Replace(".title", "")
        $title = $encountersLoc.$($prop.Name)
        $loss = $encountersLoc."$eKey.loss"

        $db.encounters["ENCOUNTER.$eKey"] = @{
            id = "ENCOUNTER.$eKey"
            name = $title
            loss = if ($loss) { Format-Desc $loss } else { "" }
        }
    }
}

# Potions DB
$potionsLocProps = $potionsLoc | Get-Member -MemberType NoteProperty
foreach ($prop in $potionsLocProps) {
    if ($prop.Name.EndsWith(".title")) {
        $pKey = $prop.Name.Replace(".title", "")
        $title = $potionsLoc.$($prop.Name)
        $desc = $potionsLoc."$pKey.description"

        $db.potions["POTION.$pKey"] = @{
            id = "POTION.$pKey"
            name = $title
            desc = Format-Desc $desc
        }
    }
}

$jsonPath = Join-Path $dataDir "sts2_data.json"
$dbJson = $db | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($jsonPath, $dbJson, [System.Text.Encoding]::UTF8)

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " Extraction Complete!" -ForegroundColor Green
Write-Host " Output Database: $jsonPath ($([Math]::Round($dbJson.Length / 1024)) KB)" -ForegroundColor Green
Write-Host " Hero Portraits:  $charDir" -ForegroundColor Green
Write-Host " Card Art:        $cardDir" -ForegroundColor Green
Write-Host " Relic Sprites:   $relicDir" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan
