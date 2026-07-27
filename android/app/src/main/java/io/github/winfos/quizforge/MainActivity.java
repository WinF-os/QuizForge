package io.github.winfos.quizforge;

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
public class MainActivity extends BridgeActivity {}
