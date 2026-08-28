package com.dailyplanner.app;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.view.View;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final String CHANNEL_ID = "reminders";
    private static final String PREFS_NAME = "memory_point_data";
    private static final int REQ_CAMERA = 2001;
    private static final int REQ_GALLERY = 2002;
    private WebView webView;
    private boolean pageLoaded = false;
    private long startTime;
    private static final String[] SPLASH_QUOTES = {"日拱一卒，功不唐捐","把今天过好，明天不会太差","先完成，再完美","你的努力，时间看得见","专注当下，未来可期","开始，就是最好的答案","种一棵树，最好的时间是现在","日日行，不怕千万里"};
    private final List<String> pendingPhotos = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        startTime = System.currentTimeMillis();
        // 原生启动层显示随机激励语
        android.widget.TextView sq = findViewById(R.id.nativeSplashQuote);
        if (sq != null) sq.setText(SPLASH_QUOTES[(int)(Math.random() * SPLASH_QUOTES.length)]);

        // 状态栏：宣纸色背景 + 深色图标，关闭系统遮罩防止变暗
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            getWindow().setStatusBarColor(0xFFF2F2F5);
            // 关闭系统对比度增强（否则浅色状态栏会被叠加暗色遮罩变暗）
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                getWindow().setStatusBarContrastEnforced(false);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 现代 API：设置浅色状态栏图标（替代废弃的 SYSTEM_UI_FLAG_LIGHT_STATUS_BAR）
            getWindow().getInsetsController().setSystemBarsAppearance(
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(
                getWindow().getDecorView().getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        // 软键盘：Android 15+（API 35）adjustResize 默认不生效，需显式开启，
        // 否则输入法唤起时会覆盖居中编辑弹窗（v3 交互：弹窗随视口缩小并保持在键盘上方）
        // 注：setResizable 为 API 35 新增，部分 android.jar stub 缺失，用反射调用
        if (Build.VERSION.SDK_INT >= 35) {
            try {
                android.view.Window.class.getMethod("setResizable", boolean.class).invoke(getWindow(), true);
            } catch (Exception ignored) { }
        }

        // 创建通知渠道
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "任务提醒",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("到时间提醒你完成任务");
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }

        // 配置 WebView
        webView = findViewById(R.id.webview);
        webView.setBackgroundColor(0xFFF5F0E8); // 与页面底色一致，避免加载期黑屏
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        // 允许 file:// 协议下的跨文件访问（WebView 加载本地 CSS/JS 必需）
        webView.getSettings().setAllowFileAccessFromFileURLs(true);
        // 不开启 UniversalAccessFromFileURLs（避免任意 file:// 页面读取设备本地文件的攻击面，B13）
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
        // 视口适配：让页面按设备宽度正确缩放
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setLoadWithOverviewMode(true);
        // 禁用双指缩放/捏合放大（本地应用无需缩放）
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        // 禁用强制深色模式（Android 10+ 会自动反转颜色）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            webView.getSettings().setForceDark(android.webkit.WebSettings.FORCE_DARK_OFF);
        }
        // 本地应用无混合内容需求，不开启 MIXED_CONTENT_ALWAYS_ALLOW（B13）
        webView.getSettings().setAllowContentAccess(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new ReminderBridge(), "AndroidReminder");
        webView.addJavascriptInterface(new StorageBridge(), "AndroidStorage");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoaded = true;
                // 网页已加载：淡出原生启动层（总时长约 1 秒）
                final View ns = findViewById(R.id.nativeSplash);
                if (ns != null) {
                    long elapsed = System.currentTimeMillis() - startTime;
                    long delay = Math.max(200, 1000 - elapsed);
                    ns.postDelayed(() -> ns.animate().alpha(0).setDuration(350)
                        .withEndAction(() -> ns.setVisibility(View.GONE)), delay);
                }
                // 排空 Activity 重建期间暂存的照片回调
                synchronized (pendingPhotos) {
                    for (final String base64 : pendingPhotos) {
                        webView.post(() -> webView.evaluateJavascript(
                            "onNativePhoto('" + base64.replace("'", "\\'") + "')", null));
                    }
                    pendingPhotos.clear();
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    requestPermissions(
                        new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
                        1001
                    );
                }
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");

        // Android 13+ 全面屏手势返回：注册回调，确保返回键先关闭页面浮层而非退出
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                this::handleBackPressed
            );
        }
    }

    private boolean backHandling = false;
    private volatile boolean dialogOpen = false; // 页面浮层状态，由 JS 同步
    private volatile boolean statsOpen = false; // 统计界面状态，由 JS 同步
    private long lastBackTime = 0;
    private void handleBackPressed() {
        if (backHandling) return;
        // 1. 统计界面打开时：返回关闭统计界面，回到回头看
        if (statsOpen) {
            backHandling = true;
            webView.evaluateJavascript("if(typeof closeStats==='function')closeStats()", v -> backHandling = false);
            return;
        }
        // 2. 页面有打开的浮层（如任务编辑弹窗）时：先关闭浮层
        if (dialogOpen) {
            backHandling = true;
            webView.evaluateJavascript("window.closeTopDialog()", v -> backHandling = false);
            return;
        }
        // 3. 主界面：再按一次退出
        long now = System.currentTimeMillis();
        if (now - lastBackTime > 2000) {
            lastBackTime = now;
            android.widget.Toast.makeText(this, "再按一次退出", android.widget.Toast.LENGTH_SHORT).show();
        } else {
            finish();
        }
    }

    @Override
    public void onBackPressed() {
        handleBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK) return;

        try {
            Bitmap bitmap = null;

            if (requestCode == REQ_CAMERA && data != null && data.getExtras() != null) {
                // 相机返回缩略图
                bitmap = (Bitmap) data.getExtras().get("data");
            } else if (requestCode == REQ_GALLERY && data != null && data.getData() != null) {
                // 相册返回 URI：先读尺寸按 inSampleSize 采样解码，避免大图 OOM（B17）
                Uri uri = data.getData();
                final BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                InputStream is = getContentResolver().openInputStream(uri);
                BitmapFactory.decodeStream(is, null, bounds);
                if (is != null) is.close();
                int sample = 1;
                while (bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1600) sample *= 2;
                is = getContentResolver().openInputStream(uri);
                final BitmapFactory.Options dec = new BitmapFactory.Options();
                dec.inSampleSize = sample;
                bitmap = BitmapFactory.decodeStream(is, null, dec);
                if (is != null) is.close();
            }

            if (bitmap != null) {
                // 缩放到合理大小（JS 裁剪最终输出 1280px，这里 1600px 中间态足够且避免超大 base64 跨进程传输截断）
                int maxDim = 1600;
                if (bitmap.getWidth() > maxDim || bitmap.getHeight() > maxDim) {
                    float ratio = (float) maxDim / Math.max(bitmap.getWidth(), bitmap.getHeight());
                    int w = Math.round(bitmap.getWidth() * ratio);
                    int h = Math.round(bitmap.getHeight() * ratio);
                    bitmap = Bitmap.createScaledBitmap(bitmap, w, h, true);
                }
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 85, baos);
                String base64 = "data:image/jpeg;base64," + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                baos.close();

                final String finalBase64 = base64;
                if (pageLoaded) {
                    webView.post(() -> webView.evaluateJavascript(
                        "onNativePhoto('" + finalBase64.replace("'", "\\'") + "')", null));
                } else {
                    // WebView 尚未就绪（Activity 被重建），暂存到队列
                    synchronized (pendingPhotos) {
                        pendingPhotos.add(finalBase64);
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public class ReminderBridge {
        @JavascriptInterface
        public void setDialogOpen(boolean open) { dialogOpen = open; }

        @JavascriptInterface
        public void setStatsOpen(boolean open) { statsOpen = open; }

        @JavascriptInterface
        public void showNotification(String title, String body) {
            android.app.Notification notification = new android.app.Notification.Builder(MainActivity.this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(android.app.Notification.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(buildContentIntent())
                .build();

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.notify((int) System.currentTimeMillis(), notification);
        }

        @JavascriptInterface
        public void vibrate(int milliseconds) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = getSystemService(VibratorManager.class);
                vm.getDefaultVibrator().vibrate(
                    VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE)
                );
            } else {
                Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                v.vibrate(milliseconds);
            }
        }

        @JavascriptInterface
        public void scheduleReminder(long triggerAtMillis, String title, String body, String tag) {
            Intent intent = new Intent(MainActivity.this, ReminderReceiver.class);
            intent.putExtra("title", title);
            intent.putExtra("body", body);
            // 用 tag（task.id）做稳定 requestCode，同一任务多次编辑只保留最新闹钟
            int reqCode = (tag != null ? tag : title + body).hashCode();
            PendingIntent pi = PendingIntent.getBroadcast(MainActivity.this, reqCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            // 优先精确+Doze穿透 → 次选非精确+Doze穿透 → 兜底普通
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.canScheduleExactAlarms()) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
            }
        }

        @JavascriptInterface
        public void cancelReminder(String tag) {
            Intent intent = new Intent(MainActivity.this, ReminderReceiver.class);
            int reqCode = (tag != null ? tag : "").hashCode();
            PendingIntent pi = PendingIntent.getBroadcast(MainActivity.this, reqCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            am.cancel(pi);
        }
    }

    // 通知点击后回到 App（B27）
    private PendingIntent buildContentIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static class ReminderReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            String title = intent.getStringExtra("title");
            String body = intent.getStringExtra("body");
            if (title == null) title = "⏰ 任务提醒";
            if (body == null) body = "";

            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel("reminders", "任务提醒", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("到时间提醒你完成任务");
                nm.createNotificationChannel(ch);
            }

            android.app.Notification notification = new android.app.Notification.Builder(context, "reminders")
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(android.app.Notification.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(context, 0,
                    new Intent(context, MainActivity.class)
                        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .build();
            nm.notify((int) System.currentTimeMillis(), notification);
        }
    }

    public class StorageBridge {
        private SharedPreferences prefs;

        public StorageBridge() {
            prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        }

        @JavascriptInterface
        public void saveBackup(String json) {
            prefs.edit().putString("full_backup", json).apply();
        }

        @JavascriptInterface
        public String loadBackup() {
            return prefs.getString("full_backup", null);
        }

        @JavascriptInterface
        public void clearBackup() {
            prefs.edit().remove("full_backup").apply();
        }

        @JavascriptInterface
        public void openCamera() {
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            if (intent.resolveActivity(getPackageManager()) != null) {
                startActivityForResult(intent, REQ_CAMERA);
            }
        }

        @JavascriptInterface
        public void openGallery() {
            Intent intent = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
            if (intent.resolveActivity(getPackageManager()) != null) {
                startActivityForResult(intent, REQ_GALLERY);
            }
        }
    }
}