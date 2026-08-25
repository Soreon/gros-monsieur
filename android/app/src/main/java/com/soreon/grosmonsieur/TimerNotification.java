package com.soreon.grosmonsieur;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Pont vers {@link RestTimerService} : affiche ou retire le décompte
 * persistant du minuteur en cours.
 *
 * L'affichage est confié à un service de premier plan, et non à une simple
 * notification, parce que c'est le drapeau FOREGROUND_SERVICE que les
 * surcouches « capsule » (MT Island) reconnaissent — constaté en inspectant
 * la notification de Strong. Voir {@link RestTimerService} pour le détail.
 */
@CapacitorPlugin(name = "TimerNotification")
public class TimerNotification extends Plugin {

    /** Canaux des implémentations précédentes, supprimés au premier usage. */
    private static final String[] LEGACY_CHANNELS = { "gm_timer_running", "gm_timer_running_v2" };

    /**
     * Instance vivante, pour que {@link TimerActionReceiver} puisse remonter
     * un appui de notification vers la couche web. Statique car le récepteur
     * est instancié par le système, hors du pont Capacitor.
     */
    private static TimerNotification instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /**
     * Transmet une action de notification à la couche web.
     * @return false si aucune instance n'est joignable (appelant à traiter le cas)
     */
    static boolean emitAction(String what, String kind, int seconds) {
        TimerNotification plugin = instance;
        if (plugin == null) return false;
        com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
        data.put("action", what);
        data.put("kind", kind);
        data.put("seconds", seconds);
        plugin.notifyListeners("timerAction", data);
        return true;
    }

    private void dropLegacyChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        for (String id : LEGACY_CHANNELS) {
            nm.deleteNotificationChannel(id);
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        Long endsAt = call.getLong("endsAt");
        if (endsAt == null) {
            call.reject("endsAt est requis");
            return;
        }
        dropLegacyChannels();

        Intent intent = new Intent(getContext(), RestTimerService.class);
        intent.putExtra(RestTimerService.EXTRA_ENDS_AT, endsAt);
        intent.putExtra(RestTimerService.EXTRA_TOTAL, call.getInt("totalSeconds", 0));
        intent.putExtra(RestTimerService.EXTRA_TITLE, call.getString("title", "Minuteur"));
        intent.putExtra(RestTimerService.EXTRA_BODY, call.getString("body", ""));
        intent.putExtra(RestTimerService.EXTRA_KIND, call.getString("kind", "rest"));
        intent.putExtra(RestTimerService.EXTRA_SKIP_LABEL, call.getString("skipLabel", "Ignorer"));
        intent.putExtra(RestTimerService.EXTRA_ADD_LABEL, call.getString("addLabel", "+ 1:00"));
        try {
            getContext().startForegroundService(intent);
            call.resolve();
        } catch (Exception e) {
            // Refus possible si l'app est en arrière-plan (restrictions
            // Android 12+) : sans gravité, les minuteurs continuent sans
            // notification persistante.
            call.resolve();
        }
    }

    @PluginMethod
    public void hide(PluginCall call) {
        getContext().stopService(new Intent(getContext(), RestTimerService.class));
        call.resolve();
    }
}
