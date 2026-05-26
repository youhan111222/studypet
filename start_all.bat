@echo off
chcp 65001 >nul
title StudyPet AutoStart

echo [%date% %time%] Starting StudyPet system...

REM 检查并启动 API 服务器
tasklist /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq api_server" 2>nul | findstr /i python.exe >nul
if errorlevel 1 (
    echo Starting API server...
    start /B python api_server.py
    timeout /t 2 /nobreak >nul
) else (
    echo API server already running.
)

REM 检查并启动 tracker
tasklist /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq tracker" 2>nul | findstr /i python.exe >nul
if errorlevel 1 (
    echo Starting activity tracker...
    start /B python tracker.py
    timeout /t 2 /nobreak >nul
) else (
    echo Tracker already running.
)

REM 打开前端页面
echo Opening web interface...
start "" "dist\index.html"

echo.
echo System ready.
echo API: http://127.0.0.1:19998
echo Frontend: dist\index.html
echo.
pause