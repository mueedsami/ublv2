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

echo ===== Shajgoj =====
python -m scraper_worker.cli --accounts shajgoj --checkpoint manual --target-source master --limit 5 --no-db --export-csv

echo ===== Othoba =====
python -m scraper_worker.cli --accounts othoba --checkpoint manual --target-source master --limit 5 --no-db --export-csv

echo ===== Daraz =====
python -m scraper_worker.cli --accounts daraz --checkpoint manual --target-source master --limit 3 --no-db --export-csv

echo ===== Pandamart =====
python -m scraper_worker.cli --accounts pandamart --checkpoint manual --target-source master --limit 2 --no-db --export-csv

pause
