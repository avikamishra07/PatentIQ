@echo off
REM Starts the UI on http://localhost:5173
cd /d "%~dp0frontend"
if not exist node_modules\.bin\vite.cmd (echo Run setup-windows.bat first. & exit /b 1)
call npm run dev
