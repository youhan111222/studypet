# DEPRECATED: Use StudyPet_Launcher.ps1 as the primary entry point.
# This script is kept as a fallback only. It skips campus auth, internet
# check, and port health verification that the Launcher provides.
#
# StudyPet All Services Auto-Start Script (LEGACY)

$studyPath = "D:\StudyPet"

# Absolute paths (SYSTEM account does not have user PATH)
$python = "C:\Users\20397\AppData\Local\Programs\Python\Python314\python.exe"
$pythonw = "C:\Users\20397\AppData\Local\Programs\Python\Python314\pythonw.exe"
$node = "C:\Program Files\nodejs\node.exe"
$vitejs = "$studyPath\node_modules\vite\bin\vite.js"

# Free occupied ports
$ports = @(19998, 19999, 5173)
foreach ($port in $ports) {
    $pids = (netstat -ano | Select-String ":$port " | Select-String "LISTENING" | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique)
    foreach ($pid in $pids) {
        if ($pid -and $pid -ne '0') {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Seconds 2

$pyExe = if (Test-Path $pythonw) { $pythonw } else { $python }

# 1. API Server (19998)
Start-Process $pyExe -ArgumentList "api_server.py" -WorkingDirectory $studyPath -WindowStyle Hidden
Start-Sleep -Seconds 3

# 2. AI Coach (19999)
Start-Process $pyExe -ArgumentList "deepseek_service.py" -WorkingDirectory $studyPath -WindowStyle Hidden
Start-Sleep -Seconds 3

# 3. Tracker (background)
Start-Process $pyExe -ArgumentList "tracker.py" -WorkingDirectory $studyPath -WindowStyle Hidden

# 4. Wait for backends then start Vite (5173) — using node.exe directly (NOT npx.cmd)
Start-Sleep -Seconds 6
Start-Process $node -ArgumentList "`"$vitejs`" --host 0.0.0.0 --port 5173" -WorkingDirectory $studyPath -WindowStyle Hidden

Write-Host "StudyPet all services started"
