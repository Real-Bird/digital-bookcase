@echo off
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
if not exist "data\tmp" mkdir "data\tmp"
set TEMP=%~dp0data\tmp
set TMP=%TEMP%
python -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
echo Setup complete. Run start.cmd.
pause
exit /b 0
:failed
echo Setup failed. Check Python installation and network access.
pause
exit /b 1
