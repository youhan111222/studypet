@echo off
:: StudyPet 服务启动器 - 脱离 Claude Code 独立运行
:: 双击此文件即可启动所有服务，关闭此窗口不影响服务

echo Starting StudyPet services...
cd /d D:\StudyPet

:: 释放端口
for %%p in (19998 19999 5173) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        taskkill /F /PID %%a >nul 2>&1
    )
)
timeout /t 2 /nobreak >nul

:: 启动服务（独立进程，脱离此窗口）
start "StudyPet-API" /MIN cmd /c "python api_server.py"
timeout /t 3 /nobreak >nul

start "StudyPet-AI" /MIN cmd /c "python deepseek_service.py"
timeout /t 3 /nobreak >nul

start "StudyPet-Tracker" /MIN cmd /c "python tracker.py"
timeout /t 6 /nobreak >nul

start "StudyPet-Vite" /MIN cmd /c "npx vite --host 0.0.0.0 --port 5173"

echo.
echo All services started! You can close this window.
echo StudyPet: http://localhost:5173
timeout /t 3 /nobreak >nul
