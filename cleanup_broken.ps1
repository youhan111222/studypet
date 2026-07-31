$startPaths = @(
    "C:\ProgramData\Microsoft\Windows\Start Menu",
    "$env:APPDATA\Microsoft\Windows\Start Menu"
)

$deadPatterns = @("Hypergryph", "Coodesker", "RuntimeHost", "cscan", "clean")

foreach ($base in $startPaths) {
    Get-ChildItem $base -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
        $lnkPath = $_.FullName
        $ws = New-Object -ComObject WScript.Shell
        $target = $ws.CreateShortcut($lnkPath).TargetPath
        if (-not $target) { return }
        if (Test-Path $target) { return }

        $name = $_.Name
        $shouldDelete = $false
        foreach ($pat in $deadPatterns) {
            if ($name -like "*$pat*") { $shouldDelete = $true; break }
        }
        if (-not $shouldDelete) { return }

        Remove-Item $lnkPath -Force
        Write-Host "Deleted: $name"
    }
}
