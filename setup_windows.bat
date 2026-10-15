@echo off
setlocal
cd /d %~dp0

echo ============================================
echo Unilever Stock Intelligence - Scraper Setup
echo ============================================

where python >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python was not found on PATH.
  echo Install Python 3.12+ from python.org and enable "Add Python to PATH".
  pause
  exit /b 1
)

echo Creating local virtual environment with Python...
python -m venv .venv
if errorlevel 1 (
  echo ERROR: Could not create .venv.
  pause
  exit /b 1
)

call .venv\Scripts\activate.bat
if errorlevel 1 (
  echo ERROR: Could not activate .venv.
  pause
  exit /b 1
)

python -m pip install --upgrade pip
if errorlevel 1 goto :fail

python -m pip install -r scraper_worker\requirements.txt
if errorlevel 1 goto :fail

python -m playwright install chromium
if errorlevel 1 goto :fail

if not exist .env copy .env.example .env >nul

echo.
echo Setup complete.
echo.
echo IMPORTANT NEXT STEP:
echo Open .env and paste your backend Supabase secret/service-role key.
echo The project URL is already filled in.
echo Do NOT commit .env to GitHub.
echo.
pause
exit /b 0

:fail
echo.
echo ERROR: Setup failed. Copy the terminal output and send it back.
pause
exit /b 1
