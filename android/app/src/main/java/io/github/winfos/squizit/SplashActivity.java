package io.github.winfos.squizit;

import android.animation.ObjectAnimator;
import android.animation.AnimatorSet;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;
import androidx.appcompat.app.AppCompatActivity;

// Native splash shown from cold start, ahead of MainActivity/the WebView.
// Deliberately NOT using AndroidX's SplashScreen API (installSplashScreen()
// on MainActivity): that API is built around a single brief (<=1000ms) icon
// animation and explicitly discourages holding the screen open longer or
// looping an animation on it -- neither the multi-second minimum nor the
// continuous throbbing glow this screen needs fit that model, and pre-12
// devices get no animation from it at all (falls back to a static themed
// window background, which is what MainActivity's old
// AppTheme.NoActionBarLaunch already did before this change). A real
// Activity with its own layout gives full, consistent control on every
// Android version.
public class SplashActivity extends AppCompatActivity {
  private static final long MIN_DISPLAY_MS = 3000;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_splash);

    View glow = findViewById(R.id.splashGlow);
    ObjectAnimator scaleX = ObjectAnimator.ofFloat(glow, View.SCALE_X, 1f, 1.28f);
    ObjectAnimator scaleY = ObjectAnimator.ofFloat(glow, View.SCALE_Y, 1f, 1.28f);
    ObjectAnimator alpha = ObjectAnimator.ofFloat(glow, View.ALPHA, 0.45f, 0.9f);
    for (ObjectAnimator a : new ObjectAnimator[]{scaleX, scaleY, alpha}) {
      a.setRepeatCount(ObjectAnimator.INFINITE);
      a.setRepeatMode(ObjectAnimator.REVERSE);
    }
    AnimatorSet pulse = new AnimatorSet();
    pulse.playTogether(scaleX, scaleY, alpha);
    pulse.setDuration(900);
    pulse.setInterpolator(new AccelerateDecelerateInterpolator());
    pulse.start();

    new Handler(Looper.getMainLooper()).postDelayed(() -> {
      startActivity(new Intent(this, MainActivity.class));
      finish();
      overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
    }, MIN_DISPLAY_MS);
  }
}
