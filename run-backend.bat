@echo off
REM Starts the API on http://localhost:8000  (first start builds the similarity index: ~1-2 min, cached afterwards)
cd /d "%~dp0backend"
if not exist venv\Scripts\activate.bat (echo Run setup-windows.bat first. & exit /b 1)
call venv\Scripts\activate.bat
python -m uvicorn main:app --host 127.0.0.1 --port 8000
