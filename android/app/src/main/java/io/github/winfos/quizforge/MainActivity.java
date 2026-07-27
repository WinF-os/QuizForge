package io.github.winfos.quizforge;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

// Was briefly overridden to manually request CAMERA permission in onCreate(),
// on the wrong assumption that Capacitor's WebView needed that pushed to it
// ahead of time. It doesn't: com.getcapacitor.BridgeWebChromeClient's own
// onPermissionRequest() (see node_modules/@capacitor/android) already
// registers a proper ActivityResultLauncher and requests CAMERA itself, live,
// the moment the WebView's getUserMedia() actually asks for it -- the same
// modern permission API BridgeActivity itself relies on. Mixing that with a
// second, old-style ActivityCompat.requestPermissions() call for the same
// permission is very likely what caused a real symptom on-device afterward
// (Settings -> App Info -> Permissions showing greyed out/unopenable) --
// two different permission-request systems racing for the same permission
// on the same Activity. Reverted to bare BridgeActivity; the only actual fix
// needed was declaring CAMERA in AndroidManifest.xml (still there) so
// Capacitor's own launcher is legally allowed to request it at all.
//
// Back-button handling added afterward, for a different real bug: this app
// is a single-page app with no real browser navigation history, and
// Capacitor's core has NO back-button handling of its own (confirmed by
// reading node_modules/@capacitor/android's source directly -- that only
// comes from the separate @capacitor/app plugin, which isn't installed
// here). Left alone, the plain AppCompatActivity default just finishes the
// Activity on every back press -- exiting the app from the camera, a
// results screen, anywhere. Overriding onBackPressed() hands control
// entirely to the JS app (see window.handleAndroidBack in app.js) instead:
// it decides whether "back" means closing the camera, stepping back
// through the Create flow, returning to the Home tab, or -- once there's
// nowhere left to go -- calling AndroidBridge.minimizeApp() below, which
// backgrounds the app (moveTaskToBack) rather than finishing the Activity,
// so reopening it resumes exactly where it was.
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getBridge().getWebView().addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
  }

  @Override
  public void onBackPressed() {
    getBridge().getWebView().evaluateJavascript("window.handleAndroidBack && window.handleAndroidBack();", null);
  }

  public class AndroidBridge {
    @JavascriptInterface
    public void minimizeApp() {
      runOnUiThread(() -> moveTaskToBack(true));
    }
  }
}
