package com.soreon.grosmonsieur;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Enregistré avant super : le pont doit connaître le plugin au démarrage
        registerPlugin(TimerNotification.class);
        super.onCreate(savedInstanceState);
    }
}
