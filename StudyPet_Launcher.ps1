# StudyPet Launcher (silent - no windows)
# Order: campus auth -> wait for internet -> start services -> verify -> open browser
#
# CRITICAL: All executable paths are absolute. Do NOT rely on PATH lookups.
# This script uses a mutex lock to prevent concurrent runs.

$ScriptDir = "D:\StudyPet"
$PythonExe = "C:\Users\20397\AppData\Local\Programs\Python\Python314\python.exe"
$PythonwExe = "C:\Users\20397\AppData\Local\Programs\Python\Python314\pythonw.exe"
$NodeExe = "C:\Program Files\nodejs\node.exe"
$ViteJs = "$ScriptDir\node_modules\vite\bin\vite.js"
$AutoLogin = "D:\.claude\auto_login_portal.py"
$LogFile = "$ScriptDir\launcher.log"
$MutexFile = "$ScriptDir\launcher.lock"

$ErrorActionPreference = "Stop"

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts $msg" | Out-File -Append -FilePath $LogFile -Encoding UTF8
}

function Test-Port($port, $timeoutSec = 10) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $conn = netstat -ano 2>$null | Select-String ":$port " | Select-String "LISTENING" | Select-Object -First 1
        if ($conn) { return $true }
        Start-Sleep 0.5
    }
    return $false
}

Write-Log "=== StudyPet Launcher Start ==="

try {
# Mutex: prevent concurrent runs. Stale lock (>30 min) is overridden.
if (Test-Path $MutexFile) {
    $lockAge = (Get-Date) - (Get-Item $MutexFile).LastWriteTime
    if ($lockAge.TotalMinutes -lt 30) {
        Write-Log "Another launcher running, exiting"
        exit 0
    }
}
try { New-Item -ItemType File -Path $MutexFile -Force -ErrorAction Stop | Out-Null }
catch {
    Write-Log "FATAL: Cannot create lock file $MutexFile : $_"
    exit 1
}

# Step 1: Campus network auth
Write-Log "[1/4] Campus network auth..."
if (Test-Path $AutoLogin) {
    $result = & $PythonExe $AutoLogin 2>&1
    Write-Log "Auth: $result"
} else {
    Write-Log "WARN: auto_login_portal.py not found at $AutoLogin"
}

# Step 2: Wait for internet (with gateway check)
Write-Log "[2/4] Waiting for internet..."
$online = $false
for ($i = 0; $i -lt 90; $i++) {
    # Gateway reachable?
    $gwOk = $false
    try {
        $s = New-Object System.Net.Sockets.TcpClient
        # BeginConnect + async wait with timeout to avoid blocking forever
        $ar = $s.BeginConnect("172.16.201.238", 80, $null, $null)
        if ($ar.AsyncWaitHandle.WaitOne(2000)) {
            $s.EndConnect($ar)
            $gwOk = $true
        }
        $s.Close()
    } catch {}
    if ($gwOk) {
        # Gateway reachable, try baidu to verify real internet
        try {
            $r = Invoke-WebRequest -Uri "https://www.baidu.com" -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) {
                Write-Log "Internet OK (waited ${i}s)"
                $online = $true
                break
            }
        } catch {
            # Check if we got ANY HTTP response (captive portal redirect, etc.)
            $sc = 0
            try { $sc = $_.Exception.Response.StatusCode } catch {}
            if ($sc -ge 200 -and $sc -lt 400) {
                Write-Log "Internet OK via redirect (waited ${i}s)"
                $online = $true
                break
            }
        }
    }
    Start-Sleep 1
}
if (-not $online) {
    Write-Log "WARN: Internet timeout, starting services anyway"
}

# Step 3: Start services with port verification
Set-Location $ScriptDir

# Release occupied ports only if service is NOT responding (skip healthy ones)
Write-Log "[3/4] Starting services..."
$healthy = @{ 19998 = $false; 19999 = $false; 5173 = $false }
$ports = @(19998, 19999, 5173)
foreach ($p in $ports) {
    $line = netstat -ano 2>$null | Select-String ":$p " | Select-String "LISTENING" | Select-Object -First 1
    if ($line) {
        $parts = ($line -split '\s+')
        $portPid = $parts[-1]
        if ($portPid -match '^\d+$') {
            # Quick check: is this service actually responding?
            $skipKill = $false
            if ($p -eq 5173) {
                try { $r = Invoke-WebRequest "http://localhost:5173/" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $skipKill = $true } } catch {}
            } elseif ($p -eq 19998) {
                try { $r = Invoke-WebRequest "http://localhost:19998/activity/raw" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $skipKill = $true } } catch {}
            } elseif ($p -eq 19999) {
                try { $r = Invoke-WebRequest "http://localhost:19999/api/coach/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $skipKill = $true } } catch {}
            }
            if ($skipKill) {
                $healthy[$p] = $true
                Write-Log "Port $p alive and responding (PID $portPid), skipping restart"
            } else {
                Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
                Write-Log "Released port $p (PID $portPid)"
            }
        }
    }
}
Start-Sleep 3

# API Server (19998) — verify port before continuing
if ($healthy[19998]) {
    Write-Log "API Server (19998) already healthy, skipping start"
} else {
    Write-Log "Starting API Server (19998)..."
    if (Test-Path $PythonwExe) {
        Start-Process $PythonwExe -ArgumentList "api_server.py" -WorkingDirectory $ScriptDir -WindowStyle Hidden
    } else {
        Start-Process $PythonExe -ArgumentList "api_server.py" -WorkingDirectory $ScriptDir -WindowStyle Hidden
    }
    if (Test-Port 19998 -timeoutSec 15) {
        Write-Log "API Server (19998) ready"
    } else {
        Write-Log "ERROR: API Server (19998) failed to start"
    }
}
Start-Sleep 1

# AI Coach (19999)
if ($healthy[19999]) {
    Write-Log "AI Coach (19999) already healthy, skipping start"
} else {
    Write-Log "Starting AI Coach (19999)..."
    if (Test-Path $PythonwExe) {
        Start-Process $PythonwExe -ArgumentList "deepseek_service.py" -WorkingDirectory $ScriptDir -WindowStyle Hidden
    } else {
        Start-Process $PythonExe -ArgumentList "deepseek_service.py" -WorkingDirectory $ScriptDir -WindowStyle Hidden
    }
    if (Test-Port 19999 -timeoutSec 15) {
        Write-Log "AI Coach (19999) ready"
    } else {
        Write-Log "ERROR: AI Coach (19999) failed to start"
    }
}
Start-Sleep 1

# Tracker (background, non-admin mode OK for manual launch)
$trackerRunning = $false
try {
    $trackerProcs = Get-WmiObject Win32_Process -Filter "Name='python.exe'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -match 'tracker\.py' }
    if ($trackerProcs) {
        $trackerRunning = $true
        Write-Log "Tracker already running (PIDs: $($trackerProcs.ProcessId -join ', '))"
    }
} catch {
    Write-Log "WARN: Tracker WMI check failed (non-critical): $_"
}
if (-not $trackerRunning) {
    Start-Process $PythonExe -ArgumentList "tracker.py" -WorkingDirectory $ScriptDir -WindowStyle Hidden
    Write-Log "Tracker started (non-admin, restricted windows show as 'Restricted Window')"
}
Start-Sleep 2

# Vite frontend (5173) — start via node.exe directly (NOT cmd /c npx.cmd,
# which kills the child process when cmd exits)
if ($healthy[5173]) {
    Write-Log "Vite (5173) already healthy, skipping start"
} else {
    Write-Log "Starting Vite (5173)..."
    Start-Process $NodeExe -ArgumentList "`"$ViteJs`" --host 0.0.0.0 --port 5173" -WorkingDirectory $ScriptDir -WindowStyle Hidden
    if (Test-Port 5173 -timeoutSec 25) {
        Start-Sleep 2
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq 200) {
                Write-Log "Vite (5173) ready"
            } else {
                Write-Log "Vite (5173) returned HTTP $($r.StatusCode)"
            }
        } catch {
            Write-Log "WARN: Vite port open but HTTP check failed — may need a moment"
        }
    } else {
        Write-Log "ERROR: Vite (5173) failed to start within 25s"
    }
}

# Step 4: Final verification
Write-Log "[4/4] Verifying all services..."
$apiOk = Test-Port 19998 -timeoutSec 3
$aiOk = Test-Port 19999 -timeoutSec 3
$viteOk = Test-Port 5173 -timeoutSec 3
Write-Log "Final status — API: $apiOk, AI: $aiOk, Vite: $viteOk"

if ($viteOk -and $apiOk) {
    Write-Log "StudyPet ready: http://localhost:5173"
    try {
        Start-Process "http://localhost:5173"
    } catch {
        Write-Log "WARN: Cannot open browser: $_"
    }
} else {
    if (-not $viteOk) { Write-Log "ERROR: Vite frontend not running" }
    if (-not $apiOk) { Write-Log "ERROR: API backend not running" }
    if (-not $aiOk) { Write-Log "WARN: AI Coach not running" }
    Write-Log "Check D:\StudyPet\*.log for details"
}

} catch {
    Write-Log "FATAL launcher error: $_"
    Write-Log "Stack trace: $($_.ScriptStackTrace)"
} finally {
    # Always clean up mutex, even on crash
    Remove-Item $MutexFile -Force -ErrorAction SilentlyContinue
}
Write-Log "=== Launcher Done ==="
