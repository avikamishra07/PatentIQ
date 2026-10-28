@echo off
REM Runs backend (pytest) and frontend (vitest + production build) checks.
cd /d "%~dp0backend"
call venv\Scripts\activate.bat
python -m pytest tests -q || exit /b 1
cd /d "%~dp0frontend"
call npm test || exit /b 1
call npm run build || exit /b 1
echo All checks passed.
