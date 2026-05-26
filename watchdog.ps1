# StudyPet 守护进程
# 监控三个服务端口，自动拉起死掉的进程
# 运行方式: powershell -WindowStyle Hidden -File watchdog.ps1

$ProjectDir = "C:\Users\20397\AppData\Roaming\Tencent\Marvis\User\oAN1i2ZjLT5YmQ9HqB9GvXbz5HPA\workspace\conv_19e4b810f7c_ce9c80399e5b\output\StudyPet"

$Services = @(
    @{
        Name = "AICoach"
        Port = 19999
        Command = "python"
        Args = "deepseek_service.py"
        MinUpSecs = 3
    },
    @{
        Name = "Frontend"
        Port = 5173
        Command = "npm"
        Args = "run dev"
        MinUpSecs = 6
    },
    @{
        Name = "ActivityTracker"
        Port = 19998
        Command = $null  # 由 Marvis 后台管理，此脚本不启动
        Args = $null
    }
)

$LogFile = Join-Path $ProjectDir "watchdog.log"

function Write-Log {
    param([string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts $Msg" | Out-File -Append -FilePath $LogFile -Encoding UTF8
}

Write-Log "=== 守护进程启动 ==="

while ($true) {
    foreach ($svc in $Services) {
        if ($svc.Name -eq "ActivityTracker") {
            # 活动追踪由 Marvis 管理，只报告状态
            $alive = (Get-NetTCPConnection -LocalPort $svc.Port -ErrorAction SilentlyContinue).Count -gt 0
            if (-not $alive) {
                Write-Log "[${svc.Name}] 端口 $($svc.Port) 未监听 (由 Marvis 后台管理)"
            }
            continue
        }

        $alive = (Get-NetTCPConnection -LocalPort $svc.Port -ErrorAction SilentlyContinue).Count -gt 0
        
        if (-not $alive) {
            Write-Log "[${svc.Name}] 端口 $($svc.Port) 已死，尝试拉起..."
            
            try {
                $proc = Start-Process -FilePath $svc.Command -ArgumentList $svc.Args `
                    -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru
                
                Start-Sleep -Seconds $svc.MinUpSecs
                
                $aliveNow = (Get-NetTCPConnection -LocalPort $svc.Port -ErrorAction SilentlyContinue).Count -gt 0
                if ($aliveNow) {
                    Write-Log "[${svc.Name}] 成功拉起 (PID: $($proc.Id))"
                } else {
                    Write-Log "[${svc.Name}] 启动命令已发出但端口尚未响应，下次检查继续观察"
                }
            } catch {
                Write-Log "[${svc.Name}] 启动失败: $_"
            }
        }
    }
    
    Start-Sleep -Seconds 30
}