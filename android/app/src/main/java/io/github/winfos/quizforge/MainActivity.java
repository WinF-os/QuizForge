package io.github.winfos.quizforge;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // The in-app "Camera Capture" button on the Create screen uses the
    // browser's own getUserMedia() inside the WebView -- there's no native
    // Capacitor camera plugin here. Capacitor's WebView only grants that
    // permission request if CAMERA is already OS-granted, but nothing in
    // this app was ever requesting it (and it wasn't even declared in
    // AndroidManifest.xml), so every in-app camera attempt failed
    // immediately with "Could not access the camera". Requesting it once
    // here on launch fixes that without changing any existing JS.
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, 1001);
    }
  }
}
