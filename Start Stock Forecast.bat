@echo off
title Stock Forecast
cd /d "%~dp0"
echo Starting Stock Forecast... your browser will open in a moment.
echo Keep this window open while you use the website. Close it to stop.
echo.
".venv\Scripts\python.exe" app.py
pause
