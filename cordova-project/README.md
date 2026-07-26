# QuizForge Cordova Project

This is a Cordova-based mobile application version of QuizForge, a web application that turns photos of notes into AI-generated interactive exams.

## Features

- Camera capture for note scanning
- AI-powered exam generation
- Multiple question types (Multiple Choice, True/False, etc.)
- Exam library and management
- Responsive design for mobile devices

## Prerequisites

1. Node.js (latest LTS version)
2. Cordova CLI: `npm install -g cordova`
3. Android Studio with Android SDK
4. JDK 8 or 11

## Setup Instructions

1. **Install Cordova** (if not already installed):
   ```bash
   npm install -g cordova
   ```

2. **Navigate to project directory**:
   ```bash
   cd cordova-project
   ```

3. **Add Android platform**:
   ```bash
   cordova platform add android
   ```

4. **Build the APK**:
   ```bash
   cordova build android --release
   ```

## Directory Structure

```
cordova-project/
├── config.xml          # Cordova configuration
├── www/                # Application files (copied from main QuizForge)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── icons/
│   └── ...other files
└── platforms/          # Android platform files (generated)
```

## Permissions

The application requires the following permissions:
- Camera access for note scanning
- File system access for uploads/downloads
- Internet access for API communication
- Network state monitoring

## Building APK

To create a release APK:
```bash
cordova build android --release
```

To create a debug APK (for testing):
```bash
cordova build android --debug
```

The generated APK will be located in:
```
platforms/android/app/build/outputs/apk/release/app-release.apk
```

## Development

For development, you can run the app directly on an emulator or device:
```bash
cordova run android
```

## Troubleshooting

1. **Cordova not found**: Install with `npm install -g cordova`
2. **Android platform issues**: Make sure Android Studio is properly configured
3. **Build failures**: Ensure all dependencies are installed and paths are correct