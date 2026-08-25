package com.soreon.grosmonsieur;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Notification persistante à chronomètre décroissant pour les minuteurs.
 *
 * Le décompte n'est PAS dessiné par l'application : on fournit à Android
 * l'instant de fin (setWhen) et on active le chronomètre décroissant
 * (setUsesChronometer + setChronometerCountDown). C'est donc le système qui
 * anime la seconde qui tourne, y compris quand l'app est tuée ou l'écran
 * éteint — et c'est ce que les surcouches type « capsule » (MT Island, qui
 * est un NotificationListenerService) lisent pour afficher un minuteur.
 *
 * Complète, sans remplacer, la notification d'échéance de
 * @capacitor/local-notifications : celle-ci sonne à la fin, celle-là montre
 * le temps restant pendant tout le repos.
 */
@CapacitorPlugin(name = "TimerNotification")
public class TimerNotification extends Plugin {

    // L'importance d'un canal est figée à sa création : la changer impose un
    // nouvel identifiant (l'ancien est supprimé pour ne pas polluer les
    // réglages de l'utilisateur).
    private static final String CHANNEL_ID = "gm_timer_running_v2";
    private static final String CHANNEL_ID_LEGACY = "gm_timer_running";

    /**
     * Canal muet mais d'importance DEFAULT : sans son ni vibration (réglés au
     * niveau du canal), tout en gardant l'icône de barre d'état. Une
     * importance LOW, ou un setSilent() sur la notification, la reléguerait
     * dans la section « Silencieux » et lui retirerait son icône — donc
     * invisible pour la barre d'état comme pour les surcouches « capsule ».
     */
    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        final int importance = NotificationManager.IMPORTANCE_DEFAULT;
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.deleteNotificationChannel(CHANNEL_ID_LEGACY);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Minuteur en cours",
            importance
        );
        channel.setDescription("Décompte du minuteur pendant la séance");
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    @PluginMethod
    public void show(PluginCall call) {
        Integer id = call.getInt("id");
        Long endsAt = call.getLong("endsAt");
        if (id == null || endsAt == null) {
            call.reject("id et endsAt sont requis");
            return;
        }
        String title = call.getString("title", "Minuteur");
        String body = call.getString("body", "");

        ensureChannel();

        Intent intent = new Intent(getContext(), MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            getContext(), id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(contentIntent)
            // Le système dessine le décompte jusqu'à `endsAt`
            .setWhen(endsAt)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(false)
            .setShowWhen(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        // Chronomètre décroissant : API 24+ (minSdk du projet), donc toujours vrai
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            builder.setChronometerCountDown(true);
        }

        // Auto-annulation à l'échéance par le système : indispensable si l'app
        // est tuée avant la fin, sinon la notification persistante resterait
        // affichée à zéro sans personne pour la retirer.
        long remaining = endsAt - System.currentTimeMillis();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && remaining > 0) {
            builder.setTimeoutAfter(remaining);
        }

        Notification notification = builder.build();
        // Non balayable tant que le minuteur tourne
        notification.flags |= Notification.FLAG_ONGOING_EVENT | Notification.FLAG_NO_CLEAR;

        try {
            NotificationManagerCompat.from(getContext()).notify(id, notification);
            call.resolve();
        } catch (SecurityException e) {
            // Permission POST_NOTIFICATIONS refusée : sans gravité, on n'affiche rien
            call.resolve();
        }
    }

    @PluginMethod
    public void hide(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) {
            call.reject("id est requis");
            return;
        }
        NotificationManagerCompat.from(getContext()).cancel(id);
        call.resolve();
    }
}
