@echo off
title Stock Forecast
cd /d "%~dp0"

rem Use the developer's own Python setup if this folder has one.
if exist ".venv\Scripts\python.exe" (
    set "PY=.venv\Scripts\python.exe"
    goto run
)

rem Otherwise use a private copy of Python kept inside this folder (nothing is installed on the PC).
set "PY=python\python.exe"
rem Fast add-on installer (uv), pinned version.
set "UV_VER=0.13.6"
if exist "python\ready.txt" goto run

echo ============================================================
echo  First-time setup. This happens only once.
echo  It downloads a private copy of Python and the add-ons this
echo  app needs (about 0.5 GB) into the "python" folder here.
echo  Nothing is installed on your computer. To remove everything,
echo  just delete this whole folder.
echo  This usually takes 2-5 minutes depending on your internet.
echo ============================================================
echo.
if exist python rmdir /s /q python
mkdir python

echo [1/3] Downloading Python...
curl -L --fail --progress-bar -o python\py.zip https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip || goto fail
tar -xf python\py.zip -C python || goto fail
del python\py.zip

rem Let this private Python load add-ons and the app's own code (the folder above it).
> python\python312._pth (
    echo python312.zip
    echo .
    echo ..
    echo Lib\site-packages
    echo import site
)

echo [2/3] Downloading the fast add-on installer (uv)...
curl -L --fail --progress-bar -o python\uv.zip https://github.com/astral-sh/uv/releases/download/%UV_VER%/uv-x86_64-pc-windows-msvc.zip || goto fail
tar -xf python\uv.zip -C python uv.exe || goto fail
del python\uv.zip

echo [3/3] Installing add-ons...
rem Keep uv's download cache inside this folder too, and remove it when done.
set "UV_CACHE_DIR=%CD%\python\uv-cache"
python\uv.exe pip install --python "%PY%" --target python\Lib\site-packages -r requirements.txt || goto fail
rmdir /s /q python\uv-cache

echo Done.
echo ok> python\ready.txt
echo.

:run
echo Starting Stock Forecast... your browser will open in a moment.
echo Right away the page shows today's forecast from the public website, while
echo this computer makes its own (the first time takes about 15-30 minutes).
echo Keep this window open while you use the website. Close it to stop.
echo.
"%PY%" app.py
pause
exit /b

:fail
echo.
echo Setup did not finish. Check your internet connection, then double-click
echo "Start Stock Forecast" again to retry.
if exist python rmdir /s /q python
pause
exit /b 1
