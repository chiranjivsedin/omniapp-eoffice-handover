# Apply (or roll back) the LOCAL_DEV_TILE_CARD styling to both WARs.
#
# The tile is split across two deployments, so one visual change needs two patches:
#   omniapp.war    resources/<locale>/css/stylesheet.css  <- the tile frame + widths
#   webdesktop.war resources/<locale>/css/stylesheet.css  <- the coloured block inside
#
# Idempotent: any existing LOCAL_DEV_TILE_CARD block is removed before appending, so
# re-running never doubles up. The superseded LOCAL_DEV_TILE_UI block from the earlier
# CSS attempt is removed too.
#
# WARs are updated in place with the .NET ZipFile API - `jar -uf` fails on these files
# with "ZipException: invalid entry size".
#
# Usage:  .\apply-tile-card.ps1            apply to every locale
#         .\apply-tile-card.ps1 -Rollback  strip our blocks, restore nothing else
#         .\apply-tile-card.ps1 -WhatIf    report what would change

param(
    [switch]$Rollback,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root    = Split-Path -Parent $PSScriptRoot
$deploy  = Join-Path $root 'jboss\wildfly-23.0.2.Final\standalone\deployments'
$MARKER  = 'LOCAL_DEV_TILE_CARD'
$OLD     = 'LOCAL_DEV_TILE_UI'

$targets = @(
    @{ War = 'omniapp.war';    Css = Join-Path $PSScriptRoot 'omniapp-tile-frame.css' },
    @{ War = 'webdesktop.war'; Css = Join-Path $PSScriptRoot 'webdesktop-tile-card.css' }
)

# Cut a "/* ===== <marker> ... end <marker> ... */" block out of a stylesheet.
function Remove-Block([string]$text, [string]$marker) {
    while ($true) {
        $i = $text.IndexOf("/* ===== $marker")
        if ($i -lt 0) { break }
        $j = $text.IndexOf("end $marker", $i)
        if ($j -lt 0) { break }
        $k = $text.IndexOf('*/', $j)
        if ($k -lt 0) { break }
        $text = $text.Substring(0, $i) + $text.Substring($k + 2)
    }
    return $text.TrimEnd("`r", "`n", " ") + "`r`n"
}

foreach ($t in $targets) {
    $war = Join-Path $deploy $t.War
    if (-not (Test-Path $war)) { Write-Host "SKIP $($t.War) - not deployed"; continue }

    $add = ''
    if (-not $Rollback) {
        if (-not (Test-Path $t.Css)) { throw "missing source CSS: $($t.Css)" }
        $add = [System.IO.File]::ReadAllText($t.Css)
    }

    # Back up once, before the first modification, so rollback has a floor.
    $bak = Join-Path $PSScriptRoot ("$($t.War).PRE-TILE-CARD")
    if (-not $Rollback -and -not (Test-Path $bak) -and -not $WhatIf) {
        Copy-Item $war $bak
        Write-Host "backup -> $bak"
    }

    $mode = if ($WhatIf) { 'Read' } else { 'Update' }
    $zip = if ($WhatIf) { [System.IO.Compression.ZipFile]::OpenRead($war) }
           else         { [System.IO.Compression.ZipFile]::Open($war, 'Update') }
    try {
        $entries = @($zip.Entries | Where-Object {
            $_.FullName -match '^resources/[^/]+/css/stylesheet\.css$'
        })
        Write-Host ("`n{0}: {1} locale stylesheet(s)" -f $t.War, $entries.Count)

        foreach ($e in $entries) {
            $sr = New-Object System.IO.StreamReader($e.Open())
            $orig = $sr.ReadToEnd(); $sr.Close()

            $new = Remove-Block $orig $MARKER
            $new = Remove-Block $new  $OLD
            if (-not $Rollback) { $new = $new + $add }

            if ($new -eq $orig) { continue }

            if ($WhatIf) {
                Write-Host ("  WOULD {0,-6} {1}  {2} -> {3}" -f `
                    $(if ($Rollback) { 'strip' } else { 'patch' }), $e.FullName, $orig.Length, $new.Length)
            } else {
                $s = $e.Open(); $s.SetLength(0)
                $sw = New-Object System.IO.StreamWriter($s)
                $sw.Write($new); $sw.Flush(); $sw.Close()
                Write-Host ("  {0,-7} {1}  {2} -> {3}" -f `
                    $(if ($Rollback) { 'stripped' } else { 'patched' }), $e.FullName, $orig.Length, $new.Length)
            }
        }
    } finally { $zip.Dispose() }
}

Write-Host "`nDone. Restart WildFly with a full stop + start (never jboss-cli :reload)."
