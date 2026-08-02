package io.github.winfos.squizit;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
  }
}
