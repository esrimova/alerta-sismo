import { Vibration, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import notifee, { AndroidImportance, AndroidCategory } from 'react-native-notify-kit';
import Torch from '../utils/torch';

let soundPlayer = null;
let torchInterval = null;
let vibrationInterval = null;
let audioModeReady = false;

export const SOUND_URLS = {
  sirena_fuerte: require('../assets/sounds/sirena_fuerte.ogg'),
  campana: require('../assets/sounds/campana.ogg'),
  alerta_precaucion: require('../assets/sounds/alerta_precaucion.ogg'),
  notificacion_simple: require('../assets/sounds/notificacion_simple.ogg'),
  reloj_mecanico: require('../assets/sounds/reloj_mecanico.ogg'),
  sirena_ambulancia: require('../assets/sounds/sirena_ambulancia.ogg'),
  alarma_espacial: require('../assets/sounds/alarma_espacial.ogg'),
};

const VIBRATION_PATTERNS = {
  heavy: [0, 500, 200, 500, 200, 1000],
  medium: [0, 300, 100, 300],
  light: [0, 200],
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const requestPermissions = async () => {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('earthquake-alerts-red', {
      name: 'Informativa de Emergencia',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: VIBRATION_PATTERNS.heavy,
      lightColor: '#FF0000',
      enableVibrate: true,
      enableLights: true,
    });
    await Notifications.setNotificationChannelAsync('earthquake-alerts-yellow', {
      name: 'Alerta Amarilla',
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
      enableLights: true,
    });
    // Canal aparte para el estado del servicio: solo aviso en pantalla.
    // Sin sonido ni vibracion, para no confundirlo con un sismo en curso.
    await Notifications.setNotificationChannelAsync(CANAL_SERVICIO, {
      name: 'Estado del servicio',
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: false,
      enableLights: false,
      sound: null,
    });
  }

  return finalStatus === 'granted';
};

export const CANAL_SERVICIO = 'service-status';
const CANAL_PANTALLA = 'alerta-pantalla-completa';

/**
 * Notificacion que ENCIENDE la pantalla y se muestra sobre el bloqueo.
 *
 * Se emite con notifee porque expo-notifications no expone fullScreenAction.
 * Requiere el permiso USE_FULL_SCREEN_INTENT, que Android 14 ya no concede
 * solo: el usuario lo activa desde la tarjeta de la app. Si no esta concedido,
 * el sistema la degrada a notificacion normal en vez de fallar.
 */
async function notificarPantallaCompleta(mag, place, dist) {
  try {
    const channelId = await notifee.createChannel({
      id: CANAL_PANTALLA,
      name: 'Alertas en pantalla completa',
      importance: AndroidImportance.HIGH,
      vibration: false, // la vibracion la maneja startVibration, no el canal
      lights: true,
      lightColor: '#FF0000',
    });

    await notifee.displayNotification({
      title: `🔴 SISMO M${mag}`,
      body: `${place}${dist}`,
      android: {
        channelId,
        importance: AndroidImportance.HIGH,
        category: AndroidCategory.ALARM,
        // Esto es lo que enciende la pantalla y la muestra sobre el bloqueo.
        fullScreenAction: { id: 'default' },
        pressAction: { id: 'default' },
        lightUpScreen: true,
        color: '#EF4444',
        autoCancel: true,
      },
    });
    return true;
  } catch (e) {
    console.log('No se pudo emitir la alerta en pantalla completa:', e);
    return false;
  }
}

/**
 * Aviso discreto de que la fuente de datos no responde.
 * NO usa triggerAlert ni los canales de alerta sismica: confundir
 * "servicio caido" con "sismo en curso" seria peor que no avisar.
 */
export const notificarServicioCaido = async (detalle) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📡 Sin datos sísmicos',
        body: `La app no está recibiendo información. ${detalle}`,
        sound: false,
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        data: { tipo: 'servicio' },
      },
      trigger: null,
    });
  } catch (e) {
    console.log('No se pudo notificar la caida del servicio:', e);
  }
};

export const notificarServicioRestablecido = async () => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '✅ Monitoreo restablecido',
        body: 'La app volvió a recibir información sísmica.',
        sound: false,
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        data: { tipo: 'servicio' },
      },
      trigger: null,
    });
  } catch (e) {
    console.log('No se pudo notificar la recuperacion:', e);
  }
};

/**
 * Reproduce la alarma. Reemplaza a Audio.Sound de expo-av, que fue
 * eliminado en el SDK 57 y provocaba UnsatisfiedLinkError al arrancar.
 */
const playAlarm = async (asset, isLooping) => {
  // Que suene aunque el telefono este en silencio y con la app en segundo plano.
  if (!audioModeReady) {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
      audioModeReady = true;
    } catch (e) {
      console.log('No se pudo fijar el modo de audio:', e);
    }
  }

  releasePlayer();
  soundPlayer = createAudioPlayer(asset);
  soundPlayer.loop = isLooping;
  soundPlayer.volume = 1.0;
  soundPlayer.play();
};

/**
 * Detiene y libera el reproductor.
 * Hay que pausar ANTES de remove(): si remove() lanza, el sonido seguiria
 * sonando y ademas perderiamos la referencia, dejandolo imposible de apagar.
 */
const releasePlayer = () => {
  if (!soundPlayer) return;
  const p = soundPlayer;
  soundPlayer = null;
  try {
    p.pause();
  } catch (e) {
    console.log('No se pudo pausar el audio:', e);
  }
  try {
    p.remove();
  } catch (e) {
    console.log('No se pudo liberar el audio:', e);
  }
};

/**
 * El metodo nativo es switchState(estado, onExito, onError): exige los tres
 * argumentos. Llamarlo con uno solo hace que la invocacion falle en silencio,
 * que es por lo que la linterna no encendia.
 */
const setTorch = (on) => {
  try {
    Torch.switchState(
      on,
      () => {},
      (err) => console.log('Linterna no disponible:', err)
    );
  } catch (error) {
    console.log('Linterna no soportada en este entorno:', error);
  }
};

const toggleTorch = (isLooping) => {
  stopTorch();
  if (isLooping) {
    let state = true;
    setTorch(true);
    torchInterval = setInterval(() => {
      state = !state;
      setTorch(state);
    }, 500);
  } else {
    setTorch(true);
    setTimeout(() => setTorch(false), 1000);
  }
};

const stopTorch = () => {
  if (torchInterval) {
    clearInterval(torchInterval);
    torchInterval = null;
  }
  setTorch(false);
};

/**
 * Vibracion continua propia.
 * Vibration.vibrate(patron, true) se corta sola: la notificacion que enviamos
 * justo antes trae su propio patron en el canal y cancela la vibracion en curso.
 * Reprogramar el patron nosotros mismos la vuelve inmune a esa interrupcion.
 */
const startVibration = (pattern, isLooping) => {
  stopVibration();
  Vibration.vibrate(pattern, false);
  if (!isLooping) return;
  const ciclo = pattern.reduce((a, b) => a + b, 0) + 300;
  vibrationInterval = setInterval(() => {
    Vibration.vibrate(pattern, false);
  }, ciclo);
};

const stopVibration = () => {
  if (vibrationInterval) {
    clearInterval(vibrationInterval);
    vibrationInterval = null;
  }
  Vibration.cancel();
};

/**
 * Dispara la alerta y devuelve un resumen de lo que REALMENTE ejecuto.
 *
 * El resumen lo consume la bitacora. Se devuelve desde aqui en vez de deducirlo
 * de la configuracion porque son cosas distintas: la configuracion dice lo que
 * el usuario pidio, esto dice lo que llego a ocurrir.
 */
export const triggerAlert = async (level, event, settings, distanciaKm = null) => {
  const mag = event.properties.mag;
  const place = event.properties.place;
  const dist = distanciaKm !== null ? ` · a ${Math.round(distanciaKm)} km` : '';

  const acciones = {
    notificacion: false,
    sonido: null,
    luz: null,
    linterna: false,
    vibracion: null,
    pantallaCompleta: false,
  };

  // 'lejano' no es un nivel de alerta: es un sismo fuerte que NO te afecto.
  // Solo informa. Sin sirena, sin vibracion, sin linterna y sin temporizador
  // de emergencia. Un M7 a 1200 km no te dejo atrapado.
  if (level === 'lejano') {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `ℹ️ Sismo fuerte en la región (Mag ${mag})`,
        body: `${place}${dist}. No requiere acción.`,
        sound: false,
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
      },
      trigger: null,
    });
    acciones.notificacion = true;
    return acciones;
  }

  const config = settings.alerts[level];
  if (!config) return acciones;

  const isLooping = level === 'red' || level === 'orange';

  // La informativa de emergencia se emite con notifee y fullScreenAction para
  // que ENCIENDA la pantalla y aparezca sobre el bloqueo. Sin esto, una alerta
  // de madrugada solo suena y no se ve de que se trata.
  if (level === 'red') {
    acciones.pantallaCompleta = await notificarPantallaCompleta(mag, place, dist);
  }

  // 1. Send Push Notification
  let title = '⚠️ Alerta Amarilla';
  if (level === 'red') title = '🔴 INFORMATIVA DE EMERGENCIA';
  if (level === 'orange') title = '🟠 ALERTA NARANJA 🟠';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${title} (Mag ${mag})`,
      body: `Ubicación: ${place}${dist}`,
      data: { eventId: event.id, level },
      sound: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
      color: config.lightColor === 'red' ? '#FF0000' : (config.lightColor === 'orange' ? '#FFA500' : '#FFFFFF'),
    },
    trigger: null,
  });
  acciones.notificacion = true;

  // 2. Hardware
  if (config.vibEnabled) {
    const pattern = VIBRATION_PATTERNS[config.vibIntensity] || VIBRATION_PATTERNS.medium;
    startVibration(pattern, isLooping);
    acciones.vibracion = config.vibIntensity;
  }

  if (config.torchEnabled) {
    toggleTorch(isLooping);
    acciones.linterna = true;
  }

  if (config.lightEnabled) {
    acciones.luz = config.lightColor;
  }

  if (config.soundEnabled) {
    try {
      const soundAsset = SOUND_URLS[config.soundTone] || SOUND_URLS.sirena_fuerte;
      await playAlarm(soundAsset, isLooping);
      acciones.sonido = config.soundTone;
    } catch (error) {
      console.error("Error playing sound:", error);
    }
  }

  return acciones;
};

export const triggerForegroundAlert = async () => {
  // Demo simulation (Red)
  startVibration(VIBRATION_PATTERNS.heavy, true);
  toggleTorch(true);
  try {
    await playAlarm(SOUND_URLS.sirena_fuerte, true);
  } catch (e) {
    console.error(e);
  }
};

/**
 * Apaga TODO: sonido, vibracion y linterna. Es lo que llama "APAGAR ALARMA".
 * Se ejecuta cada paso por separado para que el fallo de uno no impida los otros.
 */
export const stopForegroundAlert = async () => {
  try { stopVibration(); } catch (e) { console.log('stopVibration:', e); }
  try { stopTorch(); }     catch (e) { console.log('stopTorch:', e); }
  try { releasePlayer(); } catch (e) { console.log('releasePlayer:', e); }
};
