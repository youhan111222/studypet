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
ping 127.0.0.1 -n 4 >nul

echo ==================================================
echo [3/4] 启动数据追踪与前端...
echo ==================================================
start "StudyPet-Tracker" /MIN python tracker.py
start "StudyPet-Frontend(5173)" /MIN npx vite --host 0.0.0.0 --port 5173

echo ==================================================
echo 所有服务已在后台拉起，请访问 http://localhost:5173
echo ==================================================
echo.
echo 检查端口状态:
netstat -ano | findstr "LISTENING" | findstr "19998 19999 5173"
echo.
pause
