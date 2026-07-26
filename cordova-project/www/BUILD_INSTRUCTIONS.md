# QuizForge APK Build Instructions

## Prerequisites

To build QuizForge as an Android APK, you'll need:

1. **Node.js** (latest LTS version)
2. **Cordova CLI** (`npm install -g cordova`)
3. **Android Studio** with Android SDK
4. **Java Development Kit (JDK)** 8 or 11

## Setup Steps

### 1. Create Cordova Project Structure

```bash
cordova create quizforge-app com.quizforge.app QuizForge
cd quizforge-app
cordova platform add android
```

### 2. Copy QuizForge Files

Copy all QuizForge files (index.html, app.js, style.css, manifest.webmanifest, icons/) into the `www` folder of your Cordova project.

### 3. Configure Cordova Config

Replace the `config.xml` in your Cordova project with this:

```xml
<?xml version='1.0' encoding='utf-8'?>
<widget id="com.quizforge.app" version="1.0.0">
    <name>QuizForge</name>
    <description>Turn a photo of your notes into an AI-generated interactive exam</description>
    <author email="aldwin@example.com" href="https://quizforge.example.com">
        Aldwin
    </author>
    
    <content src="index.html" />
    
    <access origin="*" />
    <allow-intent href="http://*/*" />
    <allow-intent href="https://*/*" />
    
    <!-- Camera permissions -->
    <feature name="Camera">
        <param name="android-package" value="org.apache.cordova.camera.CameraLauncher" />
    </feature>
    
    <!-- File access -->
    <feature name="File">
        <param name="android-package" value="org.apache.cordova.file.FileUtils" />
    </feature>
    
    <!-- Network access -->
    <feature name="NetworkStatus">
        <param name="android-package" value="org.apache.cordova.networkinformation.NetworkManager" />
    </feature>
    
    <!-- Splash screen -->
    <feature name="SplashScreen">
        <param name="android-package" value="org.apache.cordova.splashscreen.SplashScreen" />
    </feature>
    
    <!-- Status bar -->
    <feature name="StatusBar">
        <param name="android-package" value="org.apache.cordova.statusbar.StatusBar" />
    </feature>
    
    <!-- Permissions -->
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    
    <!-- Android-specific settings -->
    <preference name="AndroidInsecureFileModeEnabled" value="true" />
    <preference name="Fullscreen" value="false" />
    <preference name="SplashScreen" value="screen" />
    <preference name="SplashScreenDelay" value="3000" />
    <preference name="StatusBarOverlaysWebView" value="true" />
    <preference name="StatusBarStyle" value="lightcontent" />
    
    <!-- For Android 10+ -->
    <preference name="android-inherit-all-permissions" value="false" />
</widget>
```

### 4. Build the APK

```bash
cordova build android --release
```

Or for debug builds:
```bash
cordova build android --debug
```

## Important Notes

1. **API Keys**: QuizForge uses Gemini API keys. These should be stored securely and loaded at runtime.

2. **Camera Functionality**: The camera capture feature requires HTTPS/localhost context, so it may behave differently in the APK vs web version.

3. **File Access**: The app needs appropriate permissions for file uploads and downloads.

4. **Testing**: Test on actual Android devices as some features might not work properly in emulators.

## Alternative: Using Capacitor

If Cordova proves difficult to set up, consider using Capacitor instead:

1. `npm install @capacitor/core @capacitor/android`
2. `npx cap init`
3. `npx cap add android`
4. Copy QuizForge files to `src` folder
5. `npx cap build android`

This approach will give you a production-ready APK that can be installed on Android devices.