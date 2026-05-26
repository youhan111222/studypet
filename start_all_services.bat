@echo off
chcp 65001 >nul
title StudyPet Full System

echo ==================================================
echo [1/4] 正在清理残留的旧进程和端口占用...
echo ==================================================
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
ping 127.0.0.1 -n 3 >nul

echo ==================================================
echo [2/4] 启动后端核心服务...
echo ==================================================
start "StudyPet-API(19998)" /MIN python api_server.py
start "StudyPet-AICoach(19999)" /MIN python deepseek_service.py

echo 等待 API 服务就绪 (最多30秒)...
powershell -Command "for ($i=0; $i -lt 30; $i++) { try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:19998/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Write-Host 'API 服务已就绪'; exit 0 } } catch { Start-Sleep 1 } }; Write-Host 'API 服务超时，继续启动...'; exit 1"
echo 等待 AI 教练服务就绪 (最多10秒)...
powershell -Command "for ($i=0; $i -lt 10; $i++) { try { $r=Invoke-WebRequest -Uri 'http://127.0.0.1:19999/api/coach/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Write-Host 'AI 教练服务已就绪'; exit 0 } } catch { Start-Sleep 1 } }; Write-Host 'AI 教练服务超时，继续启动...'; exit 1"

echo ==================================================
echo [3/4] 启动数据追踪与前端...
echo ==================================================
echo 请在弹出的 UAC 窗口中点击"是"以授予 tracker 管理员权限...
powershell -Command "Start-Process python -ArgumentList 'tracker.py' -WorkingDirectory '%cd%' -Verb RunAs -WindowStyle Minimized"
start "StudyPet-Frontend(5173)" /MIN npx vite --host 0.0.0.0 --port 5173

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
