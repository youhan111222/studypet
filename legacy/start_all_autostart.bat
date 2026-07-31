@echo off
chcp 65001 >nul
title StudyPet AutoStart

echo [%date% %time%] Starting StudyPet system...

REM Check and start API server
tasklist /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq api_server" 2>nul | findstr /i python.exe >nul
if errorlevel 1 (
    echo [%date% %time%] Starting API server...
    start /B python api_server.py
    timeout /t 2 /nobreak >nul
    
    echo [%date% %time%] Waiting for API server to be ready (max 30 seconds)...
    set timeout_counter=0
    set api_ready=0
    
    :check_api_loop
    if %timeout_counter% GEQ 30 (
        echo [%date% %time%] WARNING: API server health check timeout after 30 seconds
        goto :api_check_complete
    )
    
    powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:19998/api/coach/health' -Method GET -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
    
    if %errorlevel% EQU 0 (
        echo [%date% %time%] API server is ready and responding
        set api_ready=1
        goto :api_check_complete
    ) else (
        echo [%date% %time%] API server not ready yet, waiting...
        timeout /t 1 /nobreak >nul
        set /a timeout_counter+=1
        goto :check_api_loop
    )
    
    :api_check_complete
) else (
    echo [%date% %time%] API server already running.
    set api_ready=1
)

REM Check and start tracker
tasklist /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq tracker" 2>nul | findstr /i python.exe >nul
if errorlevel 1 (
    echo [%date% %time%] Starting activity tracker...
    start /B python tracker.py
    timeout /t 2 /nobreak >nul
    echo [%date% %time%] Tracker started
) else (
    echo [%date% %time%] Tracker already running.
)

REM Open frontend web interface
echo [%date% %time%] Opening web interface...
start "" "dist\index.html"
echo [%date% %time%] Web interface opened

echo.
echo [%date% %time%] System startup complete.
if %api_ready% EQU 1 (
    echo Status: All services ready
) else (
    echo Status: API server may not be responding
)
echo API: http://127.0.0.1:19998
echo Frontend: dist\index.html
echo.
exit