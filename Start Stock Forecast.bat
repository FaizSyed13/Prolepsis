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
if exist "python\ready.txt" goto run

echo ============================================================
echo  First-time setup. This happens only once.
echo  It downloads a private copy of Python and the add-ons this
echo  app needs (about 0.5 GB) into the "python" folder here.
echo  Nothing is installed on your computer. To remove everything,
echo  just delete this whole folder.
echo  This can take 5-15 minutes depending on your internet.
echo ============================================================
echo.
if exist python rmdir /s /q python
mkdir python

echo [1/4] Downloading Python...
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

echo [2/4] Downloading the add-on installer...
curl -L --fail --progress-bar -o python\get-pip.py https://bootstrap.pypa.io/get-pip.py || goto fail
"%PY%" python\get-pip.py --no-warn-script-location -q || goto fail

echo [3/4] Installing add-ons (the slow part)...
"%PY%" -m pip install --no-warn-script-location -q -r requirements.txt || goto fail

echo [4/4] Done.
echo ok> python\ready.txt
echo.

:run
echo Starting Stock Forecast... your browser will open in a moment.
echo The very first start also downloads prices, news and the news AI model,
echo so the page may say "loading" for several minutes. Later starts are faster.
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
