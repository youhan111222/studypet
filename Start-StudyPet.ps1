# StudyPet 开机自启动脚本 - PowerShell 版本
# 保存到: C:\Users\20397\AppData\Roaming\Tencent\Marvis\User\oAN1i2ZjLT5YmQ9HqB9GvXbz5HPA\workspace\conv_19e4b810f7c_ce9c80399e5b\output\StudyPet\Start-StudyPet.ps1

$WorkingDir = "C:\Users\20397\AppData\Roaming\Tencent\Marvis\User\oAN1i2ZjLT5YmQ9HqB9GvXbz5HPA\workspace\conv_19e4b810f7c_ce9c80399e5b\output\StudyPet"
$LogFile = "$WorkingDir\startup.log"
$APIUrl = "http://127.0.0.1:19998/api/coach/health"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp $Message" | Out-File -FilePath $LogFile -Append -Encoding UTF8
    Write-Host "[$timestamp] $Message"
}

# 切换到工作目录
Set-Location $WorkingDir
Write-Log "Starting StudyPet system from: $WorkingDir"

# 1. 检查并启动 API 服务器
$portInUse = Get-NetTCPConnection -LocalPort 19998 -State Listen -ErrorAction SilentlyContinue
if (-not $portInUse) {
    Write-Log "Starting API server..."
    Start-Process python -ArgumentList "api_server.py" -WorkingDirectory $WorkingDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
    
    # 等待 API 就绪（最多 30 秒）
    $maxWait = 30
    $apiReady = $false
    for ($i = 0; $i -lt $maxWait; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $APIUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $apiReady = $true
                Write-Log "API server is ready"
                break
            }
        } catch {
            # API 尚未就绪
        }
        if ($i -lt ($maxWait - 1)) {
            Start-Sleep -Seconds 1
        }
    }
    
    if (-not $apiReady) {
        Write-Log "WARNING: API server health check timeout after $maxWait seconds"
    }
} else {
    Write-Log "API server already running on port 19998"
}

# 2. 启动 tracker
$trackerRunning = Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*tracker.py*" }
if (-not $trackerRunning) {
    Write-Log "Starting activity tracker..."
    Start-Process python -ArgumentList "tracker.py" -WorkingDirectory $WorkingDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
    Write-Log "Tracker started"
} else {
    Write-Log "Tracker already running"
}

# 3. 打开前端页面
Write-Log "Opening web interface..."
Start-Process "$WorkingDir\dist\index.html"
Write-Log "Web interface opened"

Write-Log "System startup complete"
Write-Log "API: http://127.0.0.1:19998"
Write-Log "Frontend: dist\index.html"