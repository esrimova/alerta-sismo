import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_SETTINGS = {
  location: 'ALL',
  // Si esta activo, la zona de referencia sale del GPS del telefono en vez de
  // la lista fija de ciudades colombianas. Es lo que hace que la app siga
  // sirviendo si viajas: monitorear Colombia no te protege en Chile.
  autoLocation: false,
  alerts: {
    red: {
      soundEnabled: true,
      soundTone: 'sirena_ambulancia',
      lightEnabled: true,
      lightColor: 'red',
      torchEnabled: true,
      vibEnabled: true,
      vibIntensity: 'heavy'
    },
    orange: {
      soundEnabled: true,
      soundTone: 'alerta_precaucion',
      lightEnabled: true,
      lightColor: 'orange',
      torchEnabled: true,
      vibEnabled: true,
      vibIntensity: 'medium'
    },
    yellow: {
      soundEnabled: true,
      soundTone: 'notificacion_simple',
      lightEnabled: false,
      lightColor: 'white',
      torchEnabled: false,
      vibEnabled: true,
      vibIntensity: 'light'
    }
  },
  api: {
    redMag: 5.0,
    redMMI: 4,
    swarmCount: 3,
    swarmRadius: 50,
    swarmMinutes: 30,
    yellowCDI: 4,
    // Calibrado con datos reales: el M5.3 del ultimo trimestre en Colombia
    // registro felt=23. Con el umbral en 100 solo calificaban los M7, que ya
    // son alerta roja, asi que la regla amarilla nunca se disparaba.
    yellowFelt: 15
  },
  // Medida local de la sacudida. No detecta sismos: mide cuando otra fuente ya
  // dijo "ahora". Es lo unico que puede decir que paso en ESTA direccion, que
  // es el dato que decide si conviene evacuar o no.
  sensor: {
    habilitado: true,
    // 90 s cubren la llegada de la onda S (23-58 s en Medellin) mas la
    // duracion de la sacudida.
    ventanaSeg: 90,
    hz: 100,
    // 0,02 g es el piso por debajo del cual no se distingue de un portazo.
    // Sin calibrar contra un sismo real todavia.
    umbralG: 0.02,
    vigilarReplicas: true,
    horasReplicas: 6
  }
};

const SETTINGS_KEY = 'alerta_sismo_settings_v2';

/**
 * Tonos retirados del catalogo y por cual se sustituyen.
 *
 * 'sirena_fuerte' era un tono corto en bucle que sonaba a alarma de
 * electrodomestico: molesto sin ser reconocible como emergencia. Sin este
 * traspaso, quien lo tuviera elegido se quedaba apuntando a un sonido que ya no
 * existe, y la alerta sonaria con el respaldo sin que el usuario entendiera por
 * que le cambio.
 */
const TONOS_RETIRADOS = {
  sirena_fuerte: 'sirena_ambulancia',
};

function conTonoVigente(nivel) {
  const reemplazo = TONOS_RETIRADOS[nivel.soundTone];
  return reemplazo ? { ...nivel, soundTone: reemplazo } : nivel;
}

export async function loadSettings() {
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY);
    if (data !== null) {
      // Merge with defaults in case of new fields
      const parsed = JSON.parse(data);

      // El nivel 'darkYellow' se renombro a 'orange'. Sin este traspaso, quien
      // ya tenia la app perdia su configuracion de sonido, luz y vibracion de
      // ese nivel al actualizar, porque la clave vieja dejaba de leerse.
      const naranjaGuardada = parsed.alerts?.orange || parsed.alerts?.darkYellow || {};

      return {
        location: parsed.location ?? DEFAULT_SETTINGS.location,
        autoLocation: parsed.autoLocation ?? DEFAULT_SETTINGS.autoLocation,
        alerts: {
          red: conTonoVigente({ ...DEFAULT_SETTINGS.alerts.red, ...(parsed.alerts?.red || {}) }),
          orange: conTonoVigente({ ...DEFAULT_SETTINGS.alerts.orange, ...naranjaGuardada }),
          yellow: conTonoVigente({ ...DEFAULT_SETTINGS.alerts.yellow, ...(parsed.alerts?.yellow || {}) })
        },
        api: { ...DEFAULT_SETTINGS.api, ...(parsed.api || {}) },
        sensor: { ...DEFAULT_SETTINGS.sensor, ...(parsed.sensor || {}) }
      };
    }
    return DEFAULT_SETTINGS;
  } catch (error) {
    console.error('Error loading settings', error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings) {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving settings', error);
  }
}
