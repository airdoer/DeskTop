param(
    [Parameter(Mandatory = $true)][string]$BuildDir
)

# Deletes every file and directory under $BuildDir, keeping $BuildDir itself.
# Prints one ASCII line per item; exits 0 when everything is gone, 2 when at
# least one item could not be removed.
#
# Why this exists: Windows often keeps a handle on freshly packaged exes
# (AV scan, explorer preview, a stray app instance). A plain Remove-Item then
# dies with "The process cannot access the file because it is being used by
# another process". For those items we rename them aside to
# "<name>.deleted-<stamp>" so the path is free for the next build instead of
# aborting the whole cleanup, and report them at the end.

function Remove-Hard($path) {
    try {
        if ([System.IO.Directory]::Exists($path)) {
            [System.IO.Directory]::Delete($path, $true)
        } elseif ([System.IO.File]::Exists($path)) {
            [System.IO.File]::Delete($path)
        }
        if (-not (Test-Path -LiteralPath $path)) { return $true }
    } catch {
        return $false
    }
    return $false
}

if (-not (Test-Path -LiteralPath $BuildDir)) {
    [Console]::Out.WriteLine("MISSING")
    exit 0
}

# Drop leftovers from earlier failed cleanups first.
Get-ChildItem -LiteralPath $BuildDir -Force -Filter "*.deleted-*" -ErrorAction SilentlyContinue |
    ForEach-Object { [void](Remove-Hard $_.FullName) }

$items = @(Get-ChildItem -LiteralPath $BuildDir -Force -ErrorAction SilentlyContinue)
if ($items.Count -eq 0) {
    [Console]::Out.WriteLine("EMPTY")
    exit 0
}

$bytes = 0
Get-ChildItem -LiteralPath $BuildDir -Recurse -Force -File -ErrorAction SilentlyContinue |
    ForEach-Object { $bytes += $_.Length }
[Console]::Out.WriteLine(("SIZE     {0:N1} MB" -f ($bytes / 1MB)))

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$leftover = New-Object System.Collections.Generic.List[string]

foreach ($item in $items) {
    $path = $item.FullName
    if (Remove-Hard $path) {
        [Console]::Out.WriteLine("removed  $($item.Name)")
        continue
    }

    # Locked: move it aside so the original path is usable again.
    $trash = "$path.deleted-$stamp"
    try {
        if ([System.IO.Directory]::Exists($path)) {
            [System.IO.Directory]::Move($path, $trash)
        } else {
            [System.IO.File]::Move($path, $trash)
        }
        [Console]::Out.WriteLine("moved    $($item.Name) -> $(Split-Path -Leaf $trash)")
        $leftover.Add($trash)
        continue
    } catch {}

    [Console]::Out.WriteLine("FAILED   $($item.Name)")
    $leftover.Add($path)
}

if ($leftover.Count -gt 0) {
    [Console]::Out.WriteLine("LEFTOVER $($leftover.Count)")
    foreach ($p in $leftover) { [Console]::Out.WriteLine("  $p") }
    exit 2
}

[Console]::Out.WriteLine("CLEAN")
exit 0
