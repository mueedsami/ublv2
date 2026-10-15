@echo off
setlocal
cd /d %~dp0
if not exist .venv\Scripts\python.exe (
  echo ERROR: .venv is missing. Run .\setup_windows.bat first.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
python -m scraper_worker.check_config
if errorlevel 1 (
  pause
  exit /b 1
)
echo ===== DARAZ CPP FULL PM RUN =====
python -m scraper_worker.cli --accounts daraz --checkpoint pm --target-source cpp --no-db --export-csv
pause
