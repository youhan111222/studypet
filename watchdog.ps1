# StudyPet Watchdog — monitors all service ports and restarts dead processes
# Run: powershell -WindowStyle Hidden -File watchdog.ps1
#
# CRITICAL: Uses netstat (not Get-NetTCPConnection) for port checking.
# Get-NetTCPConnection is unreliable in non-interactive sessions and
# can falsely report ports as dead, causing the watchdog to kill
# working services by starting conflicting processes.

$ProjectDir = "D:\StudyPet"
$PythonExe = "C:\Users\20397\AppData\Local\Programs\Python\Python314\python.exe"
$PythonwExe = "C:\Users\20397\AppData\Local\Programs\Python\Python314\pythonw.exe"
$NodeExe = "C:\Program Files\nodejs\node.exe"
$ViteJs = "$ProjectDir\node_modules\vite\bin\vite.js"
$LogFile = Join-Path $ProjectDir "watchdog.log"
$MutexFile = Join-Path $ProjectDir "watchdog.lock"
$MaxLogSize = 5 * 1024 * 1024  # 5 MB

# --- Mutex: prevent multiple watchdog instances ---
# Uses a lock file with PID. If the PID is still alive, exit.
# If the PID is dead (stale lock), take over.
if (Test-Path $MutexFile) {
    try {
        $oldPid = [int](Get-Content $MutexFile -Raw).Trim()
        $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($oldProc -and $oldProc.ProcessName -eq "powershell") {
            # Another watchdog is running, exit silently
            exit 0
        }
    } catch {
        # Stale/corrupt lock file, will overwrite
    }
}
# Write our PID to lock file
"$pid" | Out-File -FilePath $MutexFile -Encoding ASCII -Force

# --- Helper functions ---

function Write-Log {
    param([string]$Msg)
    # Log rotation: truncate if over limit
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt $MaxLogSize)) {
        try { Remove-Item "$LogFile.old" -Force -ErrorAction SilentlyContinue } catch {}
        try { Move-Item $LogFile "$LogFile.old" -Force -ErrorAction SilentlyContinue } catch {}
    }
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts [WD:$pid] $Msg" | Out-File -Append -FilePath $LogFile -Encoding UTF8
}

function Test-PortListening($port) {
    $line = netstat -ano 2>$null | Select-String ":$port " | Select-String "LISTENING" | Select-Object -First 1
    return ($line -ne $null)
}

function Get-PortPid($port) {
    $line = netstat -ano 2>$null | Select-String ":$port " | Select-String "LISTENING" | Select-Object -First 1
    if ($line) {
        $parts = ($line -split '\s+')
        $rawPid = $parts[-1]
        if ($rawPid -match '^\d+$') { return [int]$rawPid }
    }
    return $null
}

# --- Service definitions ---
$Services = @(
    @{
        Name = "API Server"
        Port = 19998
        Exe = $(if (Test-Path $PythonwExe) { $PythonwExe } else { $PythonExe })
        Args = "api_server.py"
        MinUpSecs = 5
    },
    @{
        Name = "Vite"
        Port = 5173
        Exe = $NodeExe
        Args = "`"$ViteJs`" --host 0.0.0.0 --port 5173"
        MinUpSecs = 10
    }
)

# --- Track consecutive failures per service ---
$FailCounts = @{}

Write-Log "=== Watchdog started (netstat mode, ports 19998 5173) ==="

while ($true) {
    foreach ($svc in $Services) {
        if (Test-PortListening $svc.Port) {
            # Port is alive, reset failure counter
            if ($FailCounts[$svc.Name] -gt 0) {
                Write-Log "[$($svc.Name)] recovered after $($FailCounts[$svc.Name]) failures"
            }
            $FailCounts[$svc.Name] = 0
            continue
        }

        # Port is dead — kill any stale process first
        $stalePid = Get-PortPid $svc.Port
        if ($stalePid) {
            Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
            Start-Sleep 1
        }

        # Retry loop with backoff (max 3 attempts)
        $restarted = $false
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            Write-Log "[$($svc.Name)] port $($svc.Port) dead, restarting (attempt $attempt/3)..."
            try {
                $proc = Start-Process -FilePath $svc.Exe -ArgumentList $svc.Args `
                    -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru
                Start-Sleep -Seconds $svc.MinUpSecs

                # Check if process exited prematurely
                if ($proc.HasExited) {
                    Write-Log "[$($svc.Name)] PID $($proc.Id) exited immediately (code $($proc.ExitCode)), will retry"
                    if ($attempt -lt 3) {
                        Start-Sleep -Seconds (5 * $attempt)  # backoff: 5, 10, 15 seconds
                        continue
                    }
                    $FailCounts[$svc.Name]++
                    break
                }

                if (Test-PortListening $svc.Port) {
                    Write-Log "[$($svc.Name)] restarted OK (PID $($proc.Id))"
                    $FailCounts[$svc.Name] = 0
                    $restarted = $true
                    break
                } else {
                    Write-Log "[$($svc.Name)] started PID $($proc.Id) but port not responding, will retry"
                    if ($attempt -lt 3) {
                        Start-Sleep -Seconds (5 * $attempt)
                    }
                }
            } catch {
                Write-Log "[$($svc.Name)] restart attempt $attempt FAILED: $_"
                if ($attempt -lt 3) {
                    Start-Sleep -Seconds (5 * $attempt)
                }
            }
        }

        if (-not $restarted) {
            $FailCounts[$svc.Name]++
            Write-Log "[$($svc.Name)] FAILED all restart attempts ($($FailCounts[$svc.Name]) consecutive failures)"
            if ($FailCounts[$svc.Name] -ge 5) {
                Write-Log "ALERT: [$($svc.Name)] has failed 5+ consecutive restarts — check executable and logs"
            }
        }
    }
    Start-Sleep -Seconds 30
}

# --- Cleanup on exit ---
# Registered in finally-equivalent at script end (PS doesn't have script-level finally)
Remove-Item $MutexFile -Force -ErrorAction SilentlyContinue
