@echo off
REM PatentIQ - one-time setup for Windows CMD. Run from the project root:  setup-windows.bat
setlocal
cd /d "%~dp0"

echo === Checking tools ===
where python >nul 2>nul || (echo [ERROR] Python not found. Install Python 3.11-3.13 from python.org and tick "Add to PATH". & exit /b 1)
where node >nul 2>nul || (echo [ERROR] Node.js not found. Install Node.js 20 LTS or newer from nodejs.org. & exit /b 1)
python --version
node --version

echo.
echo === Backend: virtual environment + packages ===
cd backend
if not exist venv (python -m venv venv || exit /b 1)
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements-dev.txt || (echo [ERROR] pip install failed. See README "Troubleshooting". & exit /b 1)
cd ..

echo.
echo === Frontend: clean install ===
cd frontend
if exist node_modules (
  echo Removing old node_modules ^(may take a minute^)...
  rmdir /s /q node_modules
  if exist node_modules (echo [ERROR] Could not delete frontend\node_modules - close editors/terminals/dev servers using it and retry. & exit /b 1)
)
call npm cache verify
call npm ci
if errorlevel 1 (
  echo [ERROR] npm ci failed. See README "Troubleshooting" ^(DNS / EPERM / corrupted cache^).
  exit /b 1
)
if not exist node_modules\.bin\vite.cmd (echo [ERROR] Vite was not installed. Re-run setup-windows.bat. & exit /b 1)
cd ..

echo.
echo Setup complete. Start the app with run-backend.bat and run-frontend.bat (two separate windows).
endlocal
