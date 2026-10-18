@echo off
setlocal
cd /d "%~dp0"
if exist .venv\Scripts\python.exe (
  set PY=.venv\Scripts\python.exe
) else (
  set PY=python
)
%PY% -m scraper_worker.cli --accounts all --checkpoint manual --target-source cpp --export-csv --parallel --max-workers 6
pause
