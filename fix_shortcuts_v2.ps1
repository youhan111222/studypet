$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
$ws = New-Object -ComObject WScript.Shell

$searchRoots = @(
    "D:\01_核心资产", "D:\02_游戏中心", "D:\03_专业软件",
    "D:\04_常用工具", "D:\05_开发编程", "D:\06_系统与缓存",
    "D:\07_其他待处理", "D:\08音乐", "D:\文档笔记",
    "D:\BaiduNetdiskDownload", "D:\BiliDownload", "D:\CloudMusic",
    "D:\SteamLibrary", "D:\Desktop"
)

$startPaths = @(
    "C:\ProgramData\Microsoft\Windows\Start Menu",
    "$env:APPDATA\Microsoft\Windows\Start Menu"
)

$fixed = 0
$missing = @()

foreach ($base in $startPaths) {
    Get-ChildItem $base -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
        $lnkPath = $_.FullName
        $target = $ws.CreateShortcut($lnkPath).TargetPath
        if (-not $target) { return }
        if (Test-Path $target) { return }

        $exeName = Split-Path $target -Leaf
        $exeDir = Split-Path $target -Parent
        $dirName = Split-Path $exeDir -Leaf
        $found = $null

        # Strategy 1: find by directory name
        foreach ($root in $searchRoots) {
            $candidateDir = Join-Path $root $dirName
            if (Test-Path $candidateDir) {
                $possible = Join-Path $candidateDir $exeName
                if (Test-Path $possible) {
                    $found = $possible
                } else {
                    $exe = Get-ChildItem $candidateDir -Recurse -Name $exeName -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($exe) { $found = Join-Path $candidateDir $exe }
                }
                if ($found) { break }
            }
        }

        # Strategy 2: search by exe name
        if (-not $found) {
            foreach ($root in $searchRoots) {
                $exe = Get-ChildItem $root -Recurse -Name $exeName -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($exe) {
                    $found = Join-Path $root $exe
                    break
                }
            }
        }

        if ($found) {
            try {
                $s = $ws.CreateShortcut($lnkPath)
                $s.TargetPath = $found
                $s.WorkingDirectory = Split-Path $found -Parent
                $s.Save()
                Write-Host "FIXED: $($_.Name) -> $found"
                $fixed++
            } catch {
                $missing += "$($_.Name): $target -> fix error: $_"
            }
        } else {
            $missing += "$($_.Name): old=$target"
            Write-Host "MISSING: $($_.Name) | exe=$exeName | old=$target"
        }
    }
}

Write-Host ""
Write-Host "=== Fixed: $fixed ==="
Write-Host "=== Still broken: $($missing.Count) ==="
$missing | ForEach-Object { Write-Host $_ }
