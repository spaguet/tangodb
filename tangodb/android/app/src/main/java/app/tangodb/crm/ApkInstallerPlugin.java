package app.tangodb.crm;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        File file;
        if (path.startsWith("file://")) {
            file = new File(Uri.parse(path).getPath());
        } else {
            file = new File(path);
        }
        if (!file.isFile()) {
            call.reject("APK file not found");
            return;
        }

        try {
            Uri uri =
                FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", file);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Install failed", e);
        }
    }

    @PluginMethod
    public void getVersionCode(PluginCall call) {
        try {
            long code =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? getContext()
                        .getPackageManager()
                        .getPackageInfo(getContext().getPackageName(), 0)
                        .getLongVersionCode()
                    : getContext()
                        .getPackageManager()
                        .getPackageInfo(getContext().getPackageName(), 0)
                        .versionCode;

            JSObject ret = new JSObject();
            ret.put("versionCode", code);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
