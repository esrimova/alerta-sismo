// plugins/withForegroundServiceType.js
//
// Android 14 (targetSdk 34) exige que todo servicio en primer plano declare su
// foregroundServiceType en el manifiesto. react-native-notify-kit declara
// app.notifee.core.ForegroundService SIN tipo, asi que el sistema rechazaria
// arrancarlo.
//
// Este plugin le añade el tipo 'dataSync', que es el que corresponde a un
// monitoreo que consulta datos periodicamente.
//
// Nota: el limite de 6 horas que Android 15 impone a 'dataSync' NO aplica aqui,
// porque esa restriccion es exclusiva de apps con targetSdkVersion 35 o mayor.
// Esta app apunta a 34 justamente para quedar fuera de ese limite y a la vez
// ser lo bastante reciente para que el instalador no la marque como insegura.

const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const NOMBRE_SERVICIO = 'app.notifee.core.ForegroundService';
const TIPO = 'dataSync';

module.exports = function withForegroundServiceType(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    app.service = app.service || [];
    let servicio = app.service.find(
      (s) => s.$ && s.$['android:name'] === NOMBRE_SERVICIO
    );

    if (!servicio) {
      servicio = { $: { 'android:name': NOMBRE_SERVICIO, 'android:exported': 'false' } };
      app.service.push(servicio);
    }

    servicio.$['android:foregroundServiceType'] = TIPO;

    return cfg;
  });
};
