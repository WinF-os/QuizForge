# QuizForge APK Setup Guide

## Prerequisites Installation

### 1. Install Node.js (Required for Cordova)
- Download Node.js LTS version from https://nodejs.org/
- Install with default settings

### 2. Install Cordova CLI
Open Command Prompt as Administrator and run:
```
npm install -g cordova
```

### 3. Install Android Studio (Required for APK building)
- Download Android Studio from https://developer.android.com/studio
- Install with all default options
- During installation, make sure to select "Android SDK" and "Android Virtual Device"

### 4. Configure Environment Variables
After installing Android Studio, add these to your system PATH:
- `C:\Users\[YourUsername]\AppData\Local\Android\Sdk\platform-tools`
- `C:\Users\[YourUsername]\AppData\Local\Android\Sdk\tools`

## Setting Up QuizForge Project

### 1. Navigate to QuizForge Directory
```
cd C:\Users\aldwi\QuizForge\cordova-project
```

### 2. Add Android Platform
```
cordova platform add android
```

### 3. Build the APK
For debug build (for testing):
```
cordova build android --debug
```

For release build (for distribution):
```
cordova build android --release
```

## Finding Your APK

Once built successfully, your APK will be located at:
```
C:\Users\aldwi\QuizForge\cordova-project\platforms\android\app\build\outputs\apk\release\app-release.apk
```

## Troubleshooting Common Issues

### Issue 1: "ANDROID_HOME is not set"
Set the ANDROID_HOME environment variable:
```
set ANDROID_HOME=C:\Users\[YourUsername]\AppData\Local\Android\Sdk
```

### Issue 2: "Could not find any version" when adding platform
Try:
```
cordova platform add android@latest
```

### Issue 3: Build failures due to missing dependencies
Install missing Gradle dependencies through Android Studio's SDK Manager.

## Complete Build Process

1. Open Command Prompt as Administrator
2. Navigate to project directory
3. Run `cordova platform add android`
4. Run `cordova build android --release`
5. Find APK in the output folder

## Important Notes

- The first build may take 10-15 minutes as it downloads required components
- Make sure your computer has at least 4GB RAM for building
- Ensure you have internet connection during the build process
- For release builds, you'll need to create a signing key (this is handled automatically by Cordova)

## Testing Your APK

Once built, you can:
1. Install on Android device via USB debugging
2. Upload to Google Play Store
3. Share with others for testing

The QuizForge application will work exactly as it does in the web browser but now with native mobile capabilities including camera access and file system integration.