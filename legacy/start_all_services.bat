@echo off
chcp 65001 >nul
title StudyPet Full System

echo ==================================================
echo  WARNING: This script is DEPRECATED.
echo  Use StudyPet_Launcher.ps1 instead:
echo    powershell -File D:\StudyPet\StudyPet_Launcher.ps1
echo  Press Ctrl+C within 10s to abort...
echo ==================================================
timeout /t 10 /nobreak >nul

echo ==================================================
echo [1/4] 正在清理指定端口占用（仅StudyPet端口）...
echo ==================================================
for %%p in (19998 19999 5173) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%%p "') do (
        echo 清理端口 %%p (PID %%a)
        taskkill /F /PID %%a >nul 2>&1
    )
)
ping 127.0.0.1 -n 3 >nul

echo ==================================================
echo [2/4] 启动后端核心服务...
echo ==================================================
set "PY=C:\Users\20397\AppData\Local\Programs\Python\Python314\python.exe"
start "StudyPet-API(19998)" /MIN "%PY%" api_server.py
start "StudyPet-AICoach(19999)" /MIN "%PY%" deepseek_service.py

echo 等待 API 服务就绪 (最多30秒)...
powershell -Command "for ($i=0; $i -lt 30; $i++) { try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:19998/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Write-Host 'API 服务已就绪'; exit 0 } } catch { Start-Sleep 1 } }; Write-Host 'API 服务超时，继续启动...'; exit 1"
echo 等待 AI 教练服务就绪 (最多10秒)...
powershell -Command "for ($i=0; $i -lt 10; $i++) { try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:19999/api/coach/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Write-Host 'AI 教练服务已就绪'; exit 0 } } catch { Start-Sleep 1 } }; Write-Host 'AI 教练服务超时，继续启动...'; exit 1"

echo ==================================================
echo [3/4] 启动数据追踪与前端...
echo ==================================================
echo 启动 tracker（非管理员模式）...
start "StudyPet-Tracker" /MIN "%PY%" tracker.py
set "NODE=C:\Program Files\nodejs\node.exe"
set "VITEJS=D:\StudyPet\node_modules\vite\bin\vite.js"
start "StudyPet-Frontend(5173)" /MIN "%NODE%" "%VITEJS%" --host 0.0.0.0 --port 5173

echo ==================================================
echo [4/4] 验证服务状态...
echo ==================================================
ping 127.0.0.1 -n 6 >nul
echo 检查端口状态:
netstat -ano | findstr "LISTENING" | findstr "19998 19999 5173"
echo.
echo ==================================================
echo 所有服务已启动，请访问 http://localhost:5173
echo ==================================================
echo.
pause
