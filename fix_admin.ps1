#Requires -Version 5.1
$logFile = "D:\StudyPet\fix_result.txt"

# Self-elevate if not admin
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$scriptPath`""
    exit
}

# Running as admin now
$ws = New-Object -ComObject WScript.Shell
$searchRoots = Get-ChildItem D:\ -Directory -Depth 0 -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^\.' } | ForEach-Object { $_.FullName }
$startPaths = @(
    "C:\ProgramData\Microsoft\Windows\Start Menu",
    "$env:APPDATA\Microsoft\Windows\Start Menu"
)

$fixed = 0
$missing = @()
$output = @()

foreach ($base in $startPaths) {
    Get-ChildItem $base -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
        $lnkPath = $_.FullName
        $target = $ws.CreateShortcut($lnkPath).TargetPath
        if (-not $target) { return }
        if (Test-Path $target) { return }

        $exeName = Split-Path $target -Leaf
        $dirName = Split-Path (Split-Path $target -Parent) -Leaf
        $found = $null

        foreach ($r in $searchRoots) {
            $cd = Join-Path $r $dirName
            if (Test-Path $cd) {
                $p = Join-Path $cd $exeName
                if (Test-Path $p) { $found = $p }
                else {
                    $f = Get-ChildItem $cd -Recurse -Name $exeName -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($f) { $found = Join-Path $cd $f }
                }
                if ($found) { break }
            }
        }

        if (-not $found) {
            foreach ($r in $searchRoots) {
                $f = Get-ChildItem $r -Recurse -Name $exeName -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($f) { $found = Join-Path $r $f; break }
            }
        }

        $name = $_.Name
        if ($found) {
            try {
                $s = $ws.CreateShortcut($lnkPath)
                $s.TargetPath = $found
                $s.WorkingDirectory = Split-Path $found -Parent
                $s.Save()
                $msg = "FIXED: $name -> $found"
                Write-Host $msg
                $output += $msg
                $fixed++
            } catch {
                $msg = "ERROR: $name - $_"
                Write-Host $msg
                $output += $msg
                $missing += $msg
            }
        } else {
            $msg = "MISSING: $name - $exeName (was: $target)"
            Write-Host $msg
            $output += $msg
            $missing += $msg
        }
    }
}

$summary = @"
`n=== Fixed: $fixed ===
=== Still broken: $($missing.Count) ===
"@
Write-Host $summary
$output += $summary

$output | Out-File -FilePath $logFile -Encoding UTF8
Write-Host "Log saved to $logFile"
Read-Host "Press Enter to close"
