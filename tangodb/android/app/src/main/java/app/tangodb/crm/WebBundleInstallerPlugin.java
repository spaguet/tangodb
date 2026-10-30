package app.tangodb.crm;

import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

@CapacitorPlugin(name = "WebBundleInstaller")
public class WebBundleInstallerPlugin extends Plugin {

    private static final String BUNDLE_ROOT = "crm-web-bundle";
    private static final String META_FILE = "meta.json";

    @PluginMethod
    public void getInstalledMeta(PluginCall call) {
        try {
            File meta = new File(bundleRoot(), META_FILE);
            if (!meta.isFile()) {
                JSObject empty = new JSObject();
                empty.put("empty", true);
                call.resolve(empty);
                return;
            }
            String raw = readUtf8(meta);
            JSONObject json = new JSONObject(raw);
            JSObject ret = new JSObject();
            ret.put("appVersion", json.optString("appVersion", ""));
            ret.put("bundleHash", json.optString("bundleHash", ""));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read bundle meta", e);
        }
    }

    @PluginMethod
    public void rollbackToBackup(PluginCall call) {
        try {
            File base = bundleRoot();
            File active = new File(base, "active");
            File backup = new File(base, "backup");
            if (!backup.isDirectory() || !new File(backup, "index.html").isFile()) {
                JSObject ret = new JSObject();
                ret.put("restored", false);
                call.resolve(ret);
                return;
            }
            deleteRecursive(active);
            if (!backup.renameTo(active)) {
                copyDirectory(backup, active);
                deleteRecursive(backup);
            }
            JSObject ret = new JSObject();
            ret.put("restored", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Rollback failed", e);
        }
    }

    @PluginMethod
    public void installFromZip(PluginCall call) {
        String zipPath = call.getString("zipPath");
        String appVersion = call.getString("appVersion");
        String bundleHash = call.getString("bundleHash");
        if (zipPath == null || zipPath.isEmpty()) {
            call.reject("zipPath is required");
            return;
        }
        if (appVersion == null || appVersion.isEmpty() || bundleHash == null || bundleHash.isEmpty()) {
            call.reject("appVersion and bundleHash are required");
            return;
        }

        File zipFile = resolveLocalFile(zipPath);
        if (zipFile == null || !zipFile.isFile()) {
            call.reject("ZIP file not found");
            return;
        }

        File base = bundleRoot();
        File staging = new File(base, "staging");
        File active = new File(base, "active");
        File backup = new File(base, "backup");

        try {
            deleteRecursive(staging);
            if (!staging.mkdirs()) {
                call.reject("Could not create staging directory");
                return;
            }

            unzipToDirectory(zipFile, staging);

            if (!new File(staging, "index.html").isFile()) {
                deleteRecursive(staging);
                call.reject("Bundle is missing index.html");
                return;
            }

            deleteRecursive(backup);
            if (active.isDirectory()) {
                if (!active.renameTo(backup)) {
                    copyDirectory(active, backup);
                    deleteRecursive(active);
                }
            }

            if (!staging.renameTo(active)) {
                copyDirectory(staging, active);
                deleteRecursive(staging);
            }

            writeMeta(base, appVersion, bundleHash);

            JSObject ret = new JSObject();
            ret.put("path", active.getAbsolutePath());
            ret.put("appVersion", appVersion);
            ret.put("bundleHash", bundleHash);
            call.resolve(ret);
        } catch (Exception e) {
            deleteRecursive(staging);
            call.reject("Install failed", e);
        }
    }

    private File bundleRoot() {
        File dir = new File(getContext().getFilesDir(), BUNDLE_ROOT);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    private static File resolveLocalFile(String path) {
        if (path.startsWith("file://")) {
            return new File(Uri.parse(path).getPath());
        }
        return new File(path);
    }

    private static void writeMeta(File base, String appVersion, String bundleHash) throws IOException {
        JSONObject json = new JSONObject();
        try {
            json.put("appVersion", appVersion);
            json.put("bundleHash", bundleHash);
            json.put("installedAt", System.currentTimeMillis());
        } catch (Exception e) {
            throw new IOException(e);
        }
        File meta = new File(base, META_FILE);
        try (FileOutputStream out = new FileOutputStream(meta)) {
            out.write(json.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String readUtf8(File file) throws IOException {
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream in = new FileInputStream(file)) {
            int read = in.read(bytes);
            if (read <= 0) return "";
            return new String(bytes, 0, read, StandardCharsets.UTF_8);
        }
    }

    private static void unzipToDirectory(File zipFile, File destDir) throws IOException {
        byte[] buffer = new byte[8192];
        try (InputStream raw = new FileInputStream(zipFile);
                BufferedInputStream buffered = new BufferedInputStream(raw);
                ZipInputStream zip = new ZipInputStream(buffered)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (name.contains("..")) {
                    throw new IOException("Invalid zip entry path");
                }
                File outFile = new File(destDir, name);
                if (entry.isDirectory()) {
                    if (!outFile.isDirectory() && !outFile.mkdirs()) {
                        throw new IOException("Could not create directory " + name);
                    }
                } else {
                    File parent = outFile.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                        throw new IOException("Could not create parent for " + name);
                    }
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        int len;
                        while ((len = zip.read(buffer)) > 0) {
                            fos.write(buffer, 0, len);
                        }
                    }
                }
                zip.closeEntry();
            }
        }
    }

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        file.delete();
    }

    private static void copyDirectory(File source, File dest) throws IOException {
        if (!source.isDirectory()) {
            throw new IOException("Source is not a directory");
        }
        if (!dest.exists() && !dest.mkdirs()) {
            throw new IOException("Could not create destination");
        }
        File[] files = source.listFiles();
        if (files == null) return;
        for (File file : files) {
            File target = new File(dest, file.getName());
            if (file.isDirectory()) {
                copyDirectory(file, target);
            } else {
                copyFile(file, target);
            }
        }
    }

    private static void copyFile(File source, File dest) throws IOException {
        byte[] buffer = new byte[8192];
        try (FileInputStream in = new FileInputStream(source);
                FileOutputStream out = new FileOutputStream(dest)) {
            int len;
            while ((len = in.read(buffer)) > 0) {
                out.write(buffer, 0, len);
            }
        }
    }
}
