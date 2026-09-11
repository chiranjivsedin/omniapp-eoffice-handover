<#
    apply-filenumber-fix.ps1
    Applies the "file number truncated to 30 chars" fix (Newgen iBPS OmniApp / webdesktop).
    See PROD-PATCH-FILENUMBER.md for the full rationale.

    Usage (run as Administrator, on the app server, with the JBoss service STOPPED):
        .\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4
        .\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -WhatIf     # dry run
        .\apply-filenumber-fix.ps1 -JBossHome C:\jboss-eap-7.4 -Rollback   # undo

    It makes its own timestamped backups next to each file before touching anything.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)] [string] $JBossHome,
    [switch] $Rollback,
    [switch] $SkipCss          # apply only the .ini change (2-line wrap instead of 1 line)
)

$ErrorActionPreference = 'Stop'
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$MARKER = 'LOCAL_DEV_QVAR_ONELINE'

$ini = Join-Path $JBossHome 'bin\Newgen\NGConfig\omniflowconfiguration\webdesktopconf\webdesktop.ini'
$war = Join-Path $JBossHome 'standalone\deployments\webdesktop.war'

foreach ($p in @($ini, $war)) {
    if (-not (Test-Path $p)) { throw "Not found: $p  (is -JBossHome correct?)" }
}

# ----------------------------------------------------------------- rollback
if ($Rollback) {
    $iniBk = Get-ChildItem "$ini.pre-filenumberfix-*" -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -First 1
    $warBk = Get-ChildItem "$war.pre-filenumberfix-*" -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -First 1
    if (-not $iniBk -and -not $warBk) { throw 'No backups found to roll back to.' }
    if ($iniBk -and $PSCmdlet.ShouldProcess($ini, "restore from $($iniBk.Name)")) {
        Copy-Item $iniBk.FullName $ini -Force; Write-Host "restored $ini" -ForegroundColor Yellow
    }
    if ($warBk -and $PSCmdlet.ShouldProcess($war, "restore from $($warBk.Name)")) {
        Copy-Item $warBk.FullName $war -Force; Write-Host "restored $war" -ForegroundColor Yellow
    }
    Write-Host 'Rollback done. Restart JBoss (full stop + start).' -ForegroundColor Cyan
    return
}

# ------------------------------------------------- change 1: webdesktop.ini
# Byte-level replace so CRLF line endings and file length are preserved exactly.
$bytes = [System.IO.File]::ReadAllBytes($ini)
$enc   = [System.Text.Encoding]::ASCII
$text  = $enc.GetString($bytes)
$old   = "EnableWordWrapForQVar=N`r`n"
$new   = "EnableWordWrapForQVar=Y`r`n"

if ($text -like "*EnableWordWrapForQVar=Y*") {
    Write-Host 'webdesktop.ini: already set to Y - skipping' -ForegroundColor DarkGray
} else {
    $count = ([regex]::Matches($text, [regex]::Escape($old))).Count
    if ($count -ne 1) { throw "webdesktop.ini: expected exactly 1 'EnableWordWrapForQVar=N' line, found $count. Patch manually." }
    if ($PSCmdlet.ShouldProcess($ini, 'set EnableWordWrapForQVar=Y')) {
        Copy-Item $ini "$ini.pre-filenumberfix-$stamp" -Force
        [System.IO.File]::WriteAllBytes($ini, $enc.GetBytes($text.Replace($old, $new)))
        $after = (Get-Item $ini).Length
        Write-Host "webdesktop.ini: EnableWordWrapForQVar=Y  (size $after bytes, unchanged)" -ForegroundColor Green
    }
}

# ------------------------------------------------- change 2: webdesktop.war
if ($SkipCss) { Write-Host 'Skipping CSS change (-SkipCss).' -ForegroundColor DarkGray }
else {

$css = @"

/* ===== $MARKER =====================================================
   Render long queue-variable values (e.g. filenumber) on a SINGLE line instead of
   wrapping, and stop any one long value from stretching the grid.
   Requires EnableWordWrapForQVar=Y in webdesktop.ini, which makes WDWorkitemList emit
   the FULL value inside the div built by createWordWrapDiv() - that div's
   "width: 150px; word-break: break-word; white-space: normal" is an INLINE style with
   no id/class, hence !important and the [style*=] selector.

   max-width caps how far one value can stretch the grid. 320px is measured, not
   guessed: the longest real file number renders at 294px, so a file number still shows
   in full on one line, while a long subject or nominee list stops at 320px with an
   ellipsis (hover shows the full value). Without the cap a 198-char subject took
   1142px and pushed the table to 3061px in a ~1030px viewport, driving every other
   column off screen.

   Do NOT remove `white-space: nowrap`: once the table overflows, the browser collapses
   columns to their minimum content width - dropping nowrap squeezed a column to 59px
   and grew the row to 691px tall.

   If the column-resize patch (LOCAL_DEV_COLUMN_RESIZE) is also deployed, it sets
   max-width:none for cells inside a resizable table, so dragging a column wider still
   reveals everything. This CSS works fine on its own; you just cannot drag past 320px.
   Revert: delete this block, or restore webdesktop.war from backup.
   ================================================================================== */
td.wl > div[style*="word-break: break-word"] {
    width: auto !important;
    max-width: 320px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
}
td.wl > div[style*="word-break: break-word"] > label {
    white-space: nowrap !important;
}
/* ===== end $MARKER ================================================= */
"@

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression

    # Pre-scan read-only: if every stylesheet already carries the marker there is nothing
    # to do, and we must NOT create a backup (a backup of an already-patched WAR would
    # become the rollback target and defeat the rollback).
    $needsPatch = 0
    $zipRo = [System.IO.Compression.ZipFile]::OpenRead($war)
    try {
        foreach ($en in @($zipRo.Entries | Where-Object { $_.FullName -match '^resources/[^/]+/css/stylesheet\.css$' })) {
            $r = New-Object System.IO.StreamReader($en.Open())
            $t0 = $r.ReadToEnd(); $r.Close()
            if ($t0 -notlike "*$MARKER*") { $needsPatch++ }
        }
    } finally { $zipRo.Dispose() }

    if ($needsPatch -eq 0) {
        Write-Host 'webdesktop.war: all stylesheets already patched - skipping' -ForegroundColor DarkGray
    }
    elseif ($PSCmdlet.ShouldProcess($war, "append CSS override to $needsPatch stylesheet(s)")) {
        Copy-Item $war "$war.pre-filenumberfix-$stamp" -Force

        $zip = [System.IO.Compression.ZipFile]::Open($war, 'Update')
        try {
            # every localised copy of the worklist stylesheet
            $targets = @($zip.Entries | Where-Object { $_.FullName -match '^resources/[^/]+/css/stylesheet\.css$' } | ForEach-Object { $_.FullName })
            if ($targets.Count -eq 0) { throw 'No resources/<locale>/css/stylesheet.css entries found in the WAR.' }

            $patched = 0; $skipped = 0
            foreach ($name in $targets) {
                $e = $zip.GetEntry($name)
                $sr = New-Object System.IO.StreamReader($e.Open())
                $content = $sr.ReadToEnd(); $sr.Close()

                if ($content -like "*$MARKER*") { $skipped++; continue }

                $e.Delete()
                $ne = $zip.CreateEntry($name)
                $sw = New-Object System.IO.StreamWriter($ne.Open())
                $sw.Write($content); $sw.Write($css); $sw.Close()
                $patched++
            }
            Write-Host "webdesktop.war: patched $patched stylesheet(s), $skipped already had the marker" -ForegroundColor Green
        } finally { $zip.Dispose() }
        Write-Host ("webdesktop.war: {0} bytes" -f (Get-Item $war).Length) -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'Now do a FULL stop + start of JBoss (do NOT use jboss-cli :reload).' -ForegroundColor Cyan
Write-Host 'Then hard-refresh the browser (Ctrl+F5) - the old stylesheet is cached.' -ForegroundColor Cyan
