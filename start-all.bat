@echo off
REM Core.fm Complete Startup Script for Windows
REM Starts the ACE-Step 1.5 engine API + the Core.fm backend and frontend
setlocal

echo ==================================
echo   Core.fm Complete Startup
echo ==================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Error: UI dependencies not installed!
    echo Please run setup.bat first.
    pause
    exit /b 1
)

if not exist "server\node_modules" (
    echo Error: Server dependencies not installed!
    echo Please run setup.bat first.
    pause
    exit /b 1
)

REM Get ACE-Step path from environment or use default
if "%ACESTEP_PATH%"=="" (
    set ACESTEP_PATH=..\ACE-Step-1.5
)

REM Check if ACE-Step exists
if not exist "%ACESTEP_PATH%" (
    echo.
    echo Warning: ACE-Step not found at %ACESTEP_PATH%
    echo.
    echo Please set ACESTEP_PATH, or place the ACE-Step-1.5 folder next to this one
    echo Example: set ACESTEP_PATH=C:\ACE-Step-1.5
    echo.
    pause
    exit /b 1
)

REM Detect ACE-Step installation type
REM NOTE (local fix): the UI generates through the Gradio endpoint
REM (/generation_wrapper), which the REST-only api_server.py / acestep-api
REM server does not expose. Always launch the Gradio server with --enable-api,
REM and use the PyTorch LM backend on Windows (vllm is Linux-only).
set API_COMMAND=
if exist "%ACESTEP_PATH%\python_embeded\python.exe" (
    echo [+] Detected Windows Portable Package
    set API_COMMAND=python_embeded\python acestep\acestep_v15_pipeline.py --port 8001 --enable-api --backend pt --server-name 127.0.0.1
) else (
    echo [+] Detected Standard Installation
    set API_COMMAND=uv run acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1
)

REM Get local IP for LAN access
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set LOCAL_IP=%%b
    )
)

echo.
echo ==================================
echo   Starting All Services...
echo ==================================
echo.

REM Start the ACE-Step 1.5 engine API in its own window
echo [1/4] Starting ACE-Step 1.5 engine API...
start "ACE-Step 1.5 Engine" cmd /k "cd /d "%ACESTEP_PATH%" && %API_COMMAND%"

REM Wait for API to start
echo Waiting for API to initialize...
timeout /t 5 /nobreak >nul

REM Start backend in new window
echo [2/4] Starting backend server...
start "Core.fm Backend" cmd /k "cd /d "%~dp0server" && npm run dev"

REM Wait for backend to start
echo Waiting for backend to start...
timeout /t 3 /nobreak >nul

REM Start frontend in new window
echo [3/4] Starting frontend...
start "Core.fm Frontend" cmd /k "cd /d "%~dp0" && npm run dev"

REM Wait a moment
timeout /t 2 /nobreak >nul

echo.
echo ==================================
echo   All Services Running!
REM Start the Trends service (signal aggregator) when present.
REM It powers the "Trends" tab: nation-level charts -> song designs -> renders.
REM Two layouts are supported: vendored inside this repo, or a sibling clone.
REM Pick whichever actually has dependencies installed first - a present but
REM uninstalled vendored copy must not shadow a working sibling clone.
set AGGREGATOR_DIR=
if exist "%~dp0signal-aggregator\node_modules" set AGGREGATOR_DIR=%~dp0signal-aggregator
if not defined AGGREGATOR_DIR if exist "%~dp0..\signal-aggregator\node_modules" set AGGREGATOR_DIR=%~dp0..\signal-aggregator
if not defined AGGREGATOR_DIR if exist "%~dp0signal-aggregator\package.json" set AGGREGATOR_DIR=%~dp0signal-aggregator
if not defined AGGREGATOR_DIR if exist "%~dp0..\signal-aggregator\package.json" set AGGREGATOR_DIR=%~dp0..\signal-aggregator

if not defined AGGREGATOR_DIR goto :aggregator_done
if not exist "%AGGREGATOR_DIR%\node_modules" (
    echo.
    echo [skip] Trends service found at "%AGGREGATOR_DIR%" but dependencies are missing.
    echo        Run: cd /d "%AGGREGATOR_DIR%" ^&^& npm install
    goto :aggregator_done
)
echo [4/4] Starting Trends service (signal aggregator)...
start "Core.fm Trends" cmd /k "cd /d "%AGGREGATOR_DIR%" && npm run serve"
timeout /t 4 /nobreak >nul
:aggregator_done

echo ==================================
echo.
echo   ACE-Step 1.5 engine API: http://localhost:8001
echo   Backend:      http://localhost:3001
echo   Frontend:     http://localhost:3000
echo   Trends/aggregator: http://localhost:3002
echo.
if defined LOCAL_IP (
    echo   LAN Access:   http://%LOCAL_IP%:3000
    echo.
)
echo   Close the terminal windows to stop all services.
echo.
echo ==================================
echo.
echo Opening browser...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo Press any key to close this window (services will keep running)
pause >nul
