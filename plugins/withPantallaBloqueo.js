// plugins/withPantallaBloqueo.js
//
// Hace que una alerta sismica ENCIENDA la pantalla y aparezca sobre el
// bloqueo, como hacen las llamadas entrantes y las alarmas.
//
// Sin esto, una alerta de madrugada solo suena: la pantalla sigue apagada y no
// se ve de que se trata. Es lo que hace la diferencia entre "sono algo" y
// "hubo un sismo M6.2 a 40 km".
//
// Tres piezas:
//  1. USE_FULL_SCREEN_INTENT: Android 14 lo restringio a apps de llamadas y
//     alarmas. El resto lo pide al usuario a mano (ver abrirAjustesPantallaCompleta).
//  2. showWhenLocked: la actividad puede dibujarse sobre la pantalla de bloqueo.
//  3. turnScreenOn: al lanzarse, enciende la pantalla.

const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = function withPantallaBloqueo(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;

    // 1. Permiso de intent a pantalla completa
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    const yaEsta = manifest.manifest['uses-permission'].some(
      (p) => p.$ && p.$['android:name'] === 'android.permission.USE_FULL_SCREEN_INTENT'
    );
    if (!yaEsta) {
      manifest.manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.USE_FULL_SCREEN_INTENT' },
      });
    }

    // 2 y 3. Atributos sobre la actividad principal
    const actividad = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    actividad.$['android:showWhenLocked'] = 'true';
    actividad.$['android:turnScreenOn'] = 'true';

    return cfg;
  });
};
