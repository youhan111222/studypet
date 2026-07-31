@echo off
chcp 65001 >nul
title StudyPet AutoStart (DEPRECATED)

echo ==================================================
echo  DEPRECATED - Use StudyPet_Launcher.ps1 instead.
echo  This script uses an obsolete working directory.
echo  Press Ctrl+C within 5s to abort...
echo ==================================================
timeout /t 5 /nobreak >nul

set "PY=C:\Users\20397\AppData\Local\Programs\Python\Python314\python.exe"

echo [%date% %time%] Starting StudyPet system...

REM 检查并启动 API 服务器
tasklist /FI "IMAGENAME eq python.exe" 2>nul | findstr /i python.exe >nul
if errorlevel 1 (
    echo Starting API server...
    start /B "%PY%" api_server.py
    timeout /t 2 /nobreak >nul
) else (
    echo API server already running.
)

REM 检查并启动 tracker
tasklist /FI "IMAGENAME eq python.exe" 2>nul | findstr /i python.exe >nul
if errorlevel 1 (
    echo Starting activity tracker...
    start /B "%PY%" tracker.py
    timeout /t 2 /nobreak >nul
) else (
    echo Tracker already running.
)

echo.
echo System ready.
echo API: http://127.0.0.1:19998
echo Frontend: http://localhost:5173
echo.
pause