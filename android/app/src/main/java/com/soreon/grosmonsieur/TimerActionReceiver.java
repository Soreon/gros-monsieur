package com.soreon.grosmonsieur;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Reçoit les appuis sur les boutons de la notification du minuteur et les
 * transmet à la couche web, qui applique exactement le même traitement que
 * les boutons de l'écran (une seule logique de minuteur, pas deux).
 */
public class TimerActionReceiver extends BroadcastReceiver {

    public static final String ACTION       = "com.soreon.grosmonsieur.TIMER_ACTION";
    public static final String EXTRA_WHAT   = "what";     // "skip" | "add"
    public static final String EXTRA_KIND   = "kind";     // "rest" | "global"
    public static final String EXTRA_AMOUNT = "seconds";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String what = intent.getStringExtra(EXTRA_WHAT);
        String kind = intent.getStringExtra(EXTRA_KIND);
        int seconds = intent.getIntExtra(EXTRA_AMOUNT, 60);
        if (what == null) return;

        boolean delivered = TimerNotification.emitAction(what, kind, seconds);
        if (!delivered && "skip".equals(what)) {
            // Couche web injoignable (processus relancé pour le broadcast) :
            // on retire au moins le décompte, plutôt que de laisser une
            // notification que plus rien ne pilote.
            context.stopService(new Intent(context, RestTimerService.class));
        }
    }
}
