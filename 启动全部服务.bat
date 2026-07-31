@echo off
cd /d "%~dp0"
echo ========================================
echo   StudyPet 一键启动
echo   (API + AI教练 + 前端 + 活动追踪)
echo ========================================
echo.

:: 启动 API Server (含 AI 教练)
echo [1/3] 启动 API Server (端口 19998)...
start "StudyPet-API" /MIN python api_server.py
timeout /t 2 /nobreak >nul

:: 启动活动追踪 (如果没运行)
echo [2/3] 检查活动追踪服务...
:: 由 watchdog/Launcher 后台管理，此脚本不重复启动

:: 启动前端
echo [3/3] 启动前端开发服务器 (端口 5173)...
start "StudyPet-Frontend" /MIN npm run dev
timeout /t 4 /nobreak >nul

echo.
echo ========================================
echo   启动完成！
echo   前端:  http://localhost:5173
echo   API+教练: http://127.0.0.1:19998
echo ========================================
pause
