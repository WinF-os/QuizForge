@echo off
echo.
echo === QuizForge APK Build Script ===
echo.

REM Check if Cordova is installed
echo Checking for Cordova installation...
cordova --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Cordova is installed.
) else (
    echo Cordova is NOT installed. Please install it with:
    echo npm install -g cordova
    echo.
    goto :end
)

echo.
echo Preparing files for build...
echo.

REM Create the www directory if it doesn't exist
if not exist "cordova-project\www" mkdir "cordova-project\www"

REM Copy all QuizForge files to www folder
copy "index.html" "cordova-project\www\" >nul
copy "app.js" "cordova-project\www\" >nul
copy "style.css" "cordova-project\www\" >nul
copy "manifest.webmanifest" "cordova-project\www\" >nul
copy "sw.js" "cordova-project\www\" >nul
copy "README.md" "cordova-project\www\" >nul
copy "config.js" "cordova-project\www\" >nul

REM Copy icons directory
if exist "icons" (
    if not exist "cordova-project\www\icons" mkdir "cordova-project\www\icons"
    xcopy "icons\*" "cordova-project\www\icons\" /E /I >nul
)

REM Copy design files
copy "DESIGN.md" "cordova-project\www\" >nul

echo Files copied successfully!
echo.
echo To build the APK:
echo 1. Navigate to cordova-project directory
echo 2. Run: cordova build android --release
echo.

:end
echo.
echo Build process complete.
pause