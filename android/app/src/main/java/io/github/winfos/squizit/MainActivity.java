package io.github.winfos.squizit;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import org.jitsi.meet.sdk.JitsiMeetActivity;
import org.jitsi.meet.sdk.JitsiMeetConferenceOptions;
import org.jitsi.meet.sdk.JitsiMeetUserInfo;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
  // Set from a cold-start VIEW intent (app launched fresh by tapping a
  // shared quiz file) and consumed exactly once by AndroidBridge
  // .getPendingSharedQuiz() below. Can't push it into the page directly at
  // that point the way onNewIntent does further down -- the WebView hasn't
  // finished running app.js yet, so window.importSharedQuiz wouldn't exist
  // yet either. Stashing it here and letting app.js pull it once it's
  // actually ready avoids that race entirely.
  private String pendingSharedQuizJson = null;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getBridge().getWebView().addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
    handleSharedQuizIntent(getIntent(), false);
  }

  @Override
  public void onBackPressed() {
    getBridge().getWebView().evaluateJavascript("window.handleAndroidBack && window.handleAndroidBack();", null);
  }

  // Extension of the "open with sQUIZit" intent-filter in AndroidManifest.xml
  // (registered on mime type "text/html", since content:// Uris from another
  // app's share sheet don't carry a filename Android can match against).
  // That means this can fire for ANY .html file the user opens system-wide,
  // not just sQUIZit's own exports -- extractQuizJson() below only returns
  // non-null for a real sQUIZit export (looks for the squizit-quiz-data
  // script block shareQuizAsHtml()/buildStandaloneQuizHtml() in app.js
  // embeds), so anything else is silently ignored and the app just opens
  // normally, same as tapping the launcher icon.
  private void handleSharedQuizIntent(Intent intent, boolean canEvaluateNow) {
    if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
    Uri data = intent.getData();
    if (data == null) return;
    String scheme = data.getScheme();
    // The OAuth redirect (custom app scheme, always carries a #fragment) is
    // handled separately in onNewIntent below -- this path is only for real
    // shared files, which arrive as content:// (almost always) or file://.
    if (!"content".equals(scheme) && !"file".equals(scheme)) return;

    String json = extractQuizJson(data);
    if (json == null) return;

    if (canEvaluateNow) {
      String jsArg = JSONObject.quote(json);
      getBridge().getWebView().evaluateJavascript(
          "window.importSharedQuiz && window.importSharedQuiz(" + jsArg + ");", null);
    } else {
      pendingSharedQuizJson = json;
    }
  }

  private String extractQuizJson(Uri uri) {
    try (InputStream in = getContentResolver().openInputStream(uri)) {
      if (in == null) return null;
      ByteArrayOutputStream buffer = new ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int read;
      while ((read = in.read(chunk)) != -1) buffer.write(chunk, 0, read);
      String html = buffer.toString("UTF-8");
      Matcher m = Pattern
          .compile("<script type=\"application/json\" id=\"squizit-quiz-data\">(.*?)</script>", Pattern.DOTALL)
          .matcher(html);
      return m.find() ? m.group(1) : null;
    } catch (Exception e) {
      return null;
    }
  }

  // Google Drive's OAuth step runs in the system browser, not this WebView
  // (Google Identity Services actively refuses to run inside any embedded
  // WebView -- confirmed on-device, not a bug in our code). oauth-redirect
  // .html hands the result back in through this app's custom URL scheme
  // (see AndroidManifest.xml's intent-filter on this Activity); singleTask
  // launchMode is what makes that redeliver here via onNewIntent() instead
  // of spinning up a second instance of the app.
  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    // singleTask means the app was already running when this fired, so the
    // WebView/app.js are guaranteed loaded already -- safe to push straight
    // in via evaluateJavascript, unlike the cold-start case in onCreate.
    handleSharedQuizIntent(intent, true);
    Uri data = intent.getData();
    if (data == null) return;
    String fragment = data.getFragment();
    if (fragment == null) return;
    String jsFragment = JSONObject.quote(fragment);
    getBridge().getWebView().evaluateJavascript(
        "window.handleOAuthRedirect && window.handleOAuthRedirect(" + jsFragment + ");", null);
  }

  public class AndroidBridge {
    @JavascriptInterface
    public void minimizeApp() {
      runOnUiThread(() -> moveTaskToBack(true));
    }

    // Consume-once: called by app.js right after startup to pick up a quiz
    // that was shared in while the app was cold (see onCreate above). Clears
    // it immediately so relaunching from Recents afterward doesn't re-import
    // the same file again.
    @JavascriptInterface
    public String getPendingSharedQuiz() {
      String json = pendingSharedQuizJson;
      pendingSharedQuizJson = null;
      return json;
    }

    // Class Sessions' native-Android video call path (see openClassCall()'s
    // isNativeApp() branch in app.js) -- real screen sharing needs Android's
    // actual MediaProjection API, which no mobile WebView/browser exposes to
    // web content, so this opens Jitsi's own real call Activity instead of
    // the browser IFrame embed used everywhere else. JitsiMeetActivity
    // manages the MediaProjection permission prompt and foreground service
    // itself; nothing else in this app needs to handle that.
    @JavascriptInterface
    public void launchJitsiCall(String roomName, String displayName) {
      // @JavascriptInterface methods run on the WebView's JS-bridge thread,
      // not the UI thread -- launching an Activity requires the UI thread,
      // same reasoning as minimizeApp() above.
      runOnUiThread(() -> {
        try {
          JitsiMeetUserInfo userInfo = new JitsiMeetUserInfo();
          userInfo.setDisplayName(displayName);
          JitsiMeetConferenceOptions options = new JitsiMeetConferenceOptions.Builder()
              .setServerURL(new URL("https://meet.jit.si"))
              .setRoom(roomName)
              .setUserInfo(userInfo)
              .setFeatureFlag("prejoinpage.enabled", true)
              .build();
          JitsiMeetActivity.launch(MainActivity.this, options);
        } catch (Exception e) {
          // Malformed URL etc. shouldn't happen with a hardcoded server URL
          // -- fail quietly rather than crash the WebView bridge call.
        }
      });
    }

    // App-update path (see app.js applyUpdate's native branch). Was:
    // window.open(apkUrl) handing off to the phone's browser to download,
    // then relying on the browser/OS to hand the file back for install --
    // found stuck indefinitely on-device, downloaded APK sitting at 100%
    // with no install prompt ever appearing, in Chrome AND when opened in
    // an external browser. Root cause: Android/Play Protect scans a
    // downloaded APK from an unrecognized publisher (a debug-signed build
    // has no recognized signing identity) before allowing an install
    // action, and that scan can hang or silently refuse -- an OS-level
    // gate, not something any browser controls. Downloading inside the app
    // and firing the package installer intent directly on the resulting
    // file skips that hand-off entirely.
    @JavascriptInterface
    public void downloadAndInstallApk(String urlString) {
      runOnUiThread(() -> {
        // Android's own one-time security gate for installing anything
        // from outside the Play Store -- can't be skipped or pre-granted,
        // only requested. Send the user to the exact settings screen that
        // grants it; app.js shows a message telling them to tap Update Now
        // again afterward.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !getPackageManager().canRequestPackageInstalls()) {
          Intent settingsIntent = new Intent(
              Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
              Uri.parse("package:" + getPackageName()));
          startActivity(settingsIntent);
          getBridge().getWebView().evaluateJavascript(
              "window.onApkInstallPermissionNeeded && window.onApkInstallPermissionNeeded();", null);
          return;
        }
        new Thread(() -> downloadApkInBackground(urlString)).start();
      });
    }

    private void downloadApkInBackground(String urlString) {
      File apkFile = new File(getCacheDir(), "squizit-update.apk");
      try {
        URL url = new URL(urlString);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.connect();
        try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apkFile)) {
          byte[] buffer = new byte[8192];
          int read;
          while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        }
        runOnUiThread(() -> installDownloadedApk(apkFile));
      } catch (Exception e) {
        runOnUiThread(() -> {
          String jsArg = JSONObject.quote(e.getMessage() == null ? "Download failed" : e.getMessage());
          getBridge().getWebView().evaluateJavascript(
              "window.onApkInstallFailed && window.onApkInstallFailed(" + jsArg + ");", null);
        });
      }
    }

    // Reuses the SAME FileProvider already declared in AndroidManifest.xml
    // for quiz-sharing (authorities="${applicationId}.fileprovider",
    // file_paths.xml already grants access to the whole cache dir) -- a
    // plain file:// Uri would be blocked (StrictMode) on modern Android,
    // this is the standard way to hand a package installer a file this app
    // owns without making it world-readable.
    private void installDownloadedApk(File apkFile) {
      Uri apkUri = FileProvider.getUriForFile(
          MainActivity.this, getPackageName() + ".fileprovider", apkFile);
      Intent installIntent = new Intent(Intent.ACTION_VIEW);
      installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
      installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
      startActivity(installIntent);
    }
  }
}
