package com.soreon.grosmonsieur;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;

/**
 * Service de premier plan portant le décompte du minuteur.
 *
 * Pourquoi un service et pas une simple notification à chronomètre : une
 * notification adossée à un service de premier plan porte le drapeau
 * FOREGROUND_SERVICE, seul reconnu par les surcouches « capsule » (MT Island)
 * et éligible à la promotion « Live Updates » d'Android 16 (pastille de barre
 * d'état). Structure calquée sur ce que fait Strong : barre de progression
 * (l'arc de la capsule) et « texte critique court » rafraîchis chaque seconde.
 *
 * Le service tourne indépendamment de la WebView : le décompte reste juste
 * même quand l'interface est détruite, et il s'arrête seul à l'échéance.
 */
public class RestTimerService extends Service {

    public static final String EXTRA_ENDS_AT = "endsAt";
    public static final String EXTRA_TOTAL   = "totalSeconds";
    public static final String EXTRA_TITLE   = "title";
    public static final String EXTRA_BODY    = "body";

    private static final String CHANNEL_ID = "gm_timer_fgs";
    private static final int    NOTIF_ID   = 1200;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable ticker;
    private long endsAt;
    private int  totalSeconds;
    private String title = "Minuteur";
    private String body  = "";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        endsAt       = intent.getLongExtra(EXTRA_ENDS_AT, 0L);
        totalSeconds = intent.getIntExtra(EXTRA_TOTAL, 0);
        String t = intent.getStringExtra(EXTRA_TITLE);
        String b = intent.getStringExtra(EXTRA_BODY);
        if (t != null) title = t;
        if (b != null) body = b;

        if (endsAt <= System.currentTimeMillis()) {
            stopNow();
            return START_NOT_STICKY;
        }

        ensureChannel();
        startForegroundCompat(buildNotification());
        startTicking();
        // Pas de redémarrage automatique : à la reprise, la couche web
        // reprogramme le minuteur depuis son échéance persistée.
        return START_NOT_STICKY;
    }

    /** Canal muet (ni son ni vibration) : le décompte informe, il n'alerte pas. */
    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Minuteur en cours", NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Décompte du minuteur pendant la séance");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private void startForegroundCompat(Notification notification) {
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
        }
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, notification, type);
        } catch (Exception e) {
            // Démarrage refusé (restrictions d'arrière-plan) : on abandonne
            // proprement, les minuteurs de l'app continuent sans notification.
            stopSelf();
        }
    }

    private void startTicking() {
        stopTicking();
        ticker = new Runnable() {
            @Override
            public void run() {
                if (System.currentTimeMillis() >= endsAt) {
                    // Échéance atteinte : l'alerte sonore est portée par la
                    // notification programmée séparément (LocalNotifications).
                    stopNow();
                    return;
                }
                NotificationManagerCompat.from(RestTimerService.this)
                    .notify(NOTIF_ID, buildNotification());
                handler.postDelayed(this, 1000);
            }
        };
        handler.postDelayed(ticker, 1000);
    }

    private void stopTicking() {
        if (ticker != null) {
            handler.removeCallbacks(ticker);
            ticker = null;
        }
    }

    private void stopNow() {
        stopTicking();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        NotificationManagerCompat.from(this).cancel(NOTIF_ID);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopTicking();
        super.onDestroy();
    }

    private Notification buildNotification() {
        long remainingMs = Math.max(0, endsAt - System.currentTimeMillis());
        int remaining = (int) Math.ceil(remainingMs / 1000.0);
        int total = Math.max(totalSeconds, remaining);
        int elapsed = Math.max(0, total - remaining);

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, NOTIF_ID, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle(title)
            .setContentText(formatRemaining(remaining))
            .setSubText(body.isEmpty() ? null : body)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setColor(0xFF3DECEC)
            .setColorized(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // La barre de progression est ce que les capsules dessinent en arc
            .setProgress(total, elapsed, false)
            // Android 16+ « Live Updates » : demande la promotion en pastille
            // de barre d'état, avec le temps restant comme texte court. La
            // promotion doit être demandée par l'API — poser le drapeau
            // FLAG_PROMOTED_ONGOING à la main est ignoré par le système.
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(formatRemaining(remaining));

        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_ONGOING_EVENT | Notification.FLAG_NO_CLEAR;
        return notification;
    }

    /** « 2:04 » */
    private static String formatRemaining(int seconds) {
        int s = Math.max(0, seconds);
        return (s / 60) + ":" + String.format(java.util.Locale.US, "%02d", s % 60);
    }
}
