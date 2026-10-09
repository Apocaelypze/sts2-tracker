@echo off
setlocal enabledelayedexpansion
title Deploy Slay the Spire 2 Tracker to Google Firebase Hosting
cd /d "%~dp0"

echo ======================================================================
echo    Deploying Slay the Spire 2 Tracker to Google Firebase Hosting
echo ======================================================================
echo.

where firebase >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [INFO] Google Firebase CLI is not installed on this machine.
    echo [INFO] Installing firebase-tools via npm...
    call npm install -g firebase-tools
    where firebase >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] Firebase CLI installation failed or is not in PATH.
        echo Please ensure Node.js is installed from https://nodejs.org
        pause
        exit /b 1
    )
)

echo [OK] Google Firebase CLI is ready.
echo.

echo ======================================================================
echo  [1/3] Google Account Authentication
echo ======================================================================
echo Launching Google login in your default web browser...
call firebase login
if !ERRORLEVEL! neq 0 (
    echo [WARNING] Login was not completed or had an error.
    echo Trying to proceed if credentials already exist...
)

echo.
echo ======================================================================
echo  [2/3] Link Your Google Firebase Project
echo ======================================================================
if not exist .firebaserc (
    echo.
    echo If you haven't created a project yet, visit the Firebase Console:
    echo   https://console.firebase.google.com/
    echo   1. Click "Add project" (e.g. name it "sts2-tracker" or similar)
    echo   2. Finish the quick wizard (takes ~30 seconds)
    echo.
    set /p PROJ_ID="Enter your Firebase Project ID (or press Enter to select interactively): "
    if defined PROJ_ID (
        (
            echo {
            echo   "projects": {
            echo     "default": "!PROJ_ID!"
            echo   }
            echo }
        ) > .firebaserc
        echo [OK] Project linked: !PROJ_ID!
    ) else (
        echo [INFO] Opening interactive project selector...
        call firebase use --add
    )
) else (
    echo [OK] Existing project link (.firebaserc) detected.
)

echo.
echo ======================================================================
echo  [3/3] Deploying 'web' Folder to Google CDN Edge Network...
echo ======================================================================
call firebase deploy --only hosting

if !ERRORLEVEL! equ 0 (
    echo.
    echo ======================================================================
    echo  [SUCCESS] Deployment complete!
    echo  Your Slay the Spire 2 Tracker is now live on Google's Edge Network!
    echo.
    echo  Anyone can now visit your site to:
    echo    1. Upload / inspect their runs directly in their web browser
    echo    2. Download the standalone 1-click STS2Tracker.exe desktop app
    echo ======================================================================
) else (
    echo.
    echo [ERROR] Deployment encountered an issue. Please review the output above.
)

echo.
pause
