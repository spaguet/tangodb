package app.tangodb.crm;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Turnstile on the live site, inside the app. The shell WebView cannot load the challenge iframe. */
@CapacitorPlugin(name = "InAppCaptcha")
public class InAppCaptchaPlugin extends Plugin {
    private static final String CAPTCHA_URL = "https://tangodb.vercel.app/native-captcha";

    @PluginMethod
    public void requestToken(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> show(activity, call));
    }

    private void show(Activity activity, PluginCall call) {
        Dialog dialog = new Dialog(activity);
        dialog.setCancelable(true);

        WebView webView = new WebView(activity);
        webView.setBackgroundColor(Color.WHITE);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        boolean[] done = {false};
        dialog.setOnDismissListener(d -> {
            webView.destroy();
            if (!done[0]) call.reject("cancelled");
        });

        webView.addJavascriptInterface(
            new Object() {
                @JavascriptInterface
                public void onToken(String token) {
                    if (done[0] || token == null || token.length() < 20) return;
                    done[0] = true;
                    JSObject ret = new JSObject();
                    ret.put("token", token);
                    call.resolve(ret);
                    activity.runOnUiThread(dialog::dismiss);
                }
            },
            "AndroidTurnstile");

        webView.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (!request.isForMainFrame()) return false;
                    String host = request.getUrl().getHost();
                    return host == null || !host.equals("tangodb.vercel.app");
                }
            });

        FrameLayout root = new FrameLayout(activity);
        root.setLayoutParams(
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(
            webView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        dialog.setContentView(root);
        dialog.show();
        if (dialog.getWindow() != null) {
            int height = (int) (280 * activity.getResources().getDisplayMetrics().density);
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, height);
        }
        webView.loadUrl(CAPTCHA_URL);
    }
}
