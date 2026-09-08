param(
    [Parameter(Mandatory = $true)][string]$OutDir
)

# Prepares a clean output directory for electron-builder and prints the
# directory that should actually be used (stdout, single line, ASCII only).
#
# Why: electron-builder unlinks the previous win-unpacked\resources\app.asar
# before writing a new one. If any process still holds a handle on it (AV scan,
# explorer, a stray app instance, ...) the build dies with EBUSY. So we clear
# the directory up-front; when that is impossible we rename it away, and when
# even that fails we fall back to a fresh timestamped directory so the build
# always succeeds instead of aborting.

function Remove-Dir($p) {
    if (-not (Test-Path -LiteralPath $p)) { return $true }
    try {
        [System.IO.Directory]::Delete($p, $true)
    } catch {
        return $false
    }
    return -not (Test-Path -LiteralPath $p)
}

$parent = Split-Path -Parent $OutDir
$leaf = Split-Path -Leaf $OutDir

# Best effort: drop stale "<dir>.old-*" leftovers from earlier runs.
if ($parent -and (Test-Path -LiteralPath $parent)) {
    Get-ChildItem -LiteralPath $parent -Directory -Filter "$leaf.old-*" -ErrorAction SilentlyContinue |
        ForEach-Object { [void](Remove-Dir $_.FullName) }
}

$final = $OutDir

if (Test-Path -LiteralPath $OutDir) {
    if (-not (Remove-Dir $OutDir)) {
        # Locked: move it aside instead of failing the build.
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $old = "$OutDir.old-$stamp"
        try { [System.IO.Directory]::Move($OutDir, $old) } catch {}
    }
}

if (Test-Path -LiteralPath $OutDir) {
    # Still locked and cannot even be renamed: use a brand new directory.
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $final = "$OutDir-$stamp"
}

[Console]::Out.WriteLine($final)
