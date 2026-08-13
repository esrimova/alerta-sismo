// src/services/foreground.js
//
// Servicio en primer plano: mantiene el monitoreo vivo aunque cierres la app,
// igual que hacen los antivirus. A cambio deja una notificacion permanente en
// la barra de estado, que es justamente lo que Android exige a cambio de no
// matar el proceso.
//
// Por que hace falta: BackgroundFetch usa WorkManager, que impone un minimo de
// 15 minutos y ni siquiera lo garantiza (Doze lo estira mucho mas). Para una
// alerta sismica eso no sirve. Aqui el intervalo lo controlamos nosotros.
//
// El limite de 6 horas de Android 15 para servicios 'dataSync' NO aplica
// porque la app apunta a targetSdkVersion 33 (ver app.json). Esa restriccion
// es exclusiva de apps que apuntan a API 35 o superior.

import notifee, {
  AndroidImportance,
  AndroidForegroundServiceType,
} from 'react-native-notify-kit';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ejecutarCiclo } from './monitor';
import { revisarVencimiento } from './emergencia';
import { hayInternet, suscribirRed, enModoAvion } from './red';
import { marcarSinConexion } from './health';
import { registrarEvento, TIPO } from './bitacora';
import { iniciarFusion, mantenimientoFusion } from './fusion';

const CANAL_MONITOREO = 'monitoreo-activo';
const INTERVALO_MS = 60000;

/**
 * Sin red no tiene sentido consultar cada minuto: cada intento falla igual y
 * solo gasta bateria. Se espacia a 5 minutos, pero ese temporizador es solo
 * una red de seguridad: el despertar de verdad lo dispara el listener de red.
 */
const INTERVALO_HIBERNANDO_MS = 300000;

/** Marca de vida del bucle. La usa el vigilante para saber si sigue corriendo. */
export const LATIDO_KEY = 'alerta_sismo_latido_v1';

let corriendo = false;
let hibernando = false;

/** Canal dedicado: silencioso y no cancelable, solo para el aviso permanente. */
async function crearCanal() {
  return notifee.createChannel({
    id: CANAL_MONITOREO,
    name: 'Monitoreo activo',
    importance: AndroidImportance.LOW, // sin sonido ni interrupcion
    vibration: false,
  });
}

/**
 * Espera cancelable.
 *
 * Sustituye a la espera troceada de un segundo. Ademas de poder cortarse
 * cuando el usuario apaga el monitoreo, permite que el listener de red la
 * interrumpa: es lo que hace que al salir del modo avion el ciclo arranque en
 * el acto en vez de esperar a que venza el temporizador.
 */
let despertar = null;

function esperar(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      despertar = null;
      resolve();
    }, ms);
    despertar = () => {
      clearTimeout(t);
      despertar = null;
      resolve();
    };
  });
}

/**
 * Al recuperar la red se corta la espera en curso. El listener queda registrado
 * al importar el modulo, junto al runner, para que siga vivo con la app cerrada
 * mientras exista el servicio en primer plano.
 */
suscribirRed((hayRed) => {
  if (hayRed && hibernando && despertar) despertar();
});

/**
 * Las fuentes rapidas se enganchan aqui, al importar el modulo, por el mismo
 * motivo que el listener de red: es lo que las mantiene escuchando con la app
 * cerrada. Una medida del sensor llega por evento y no puede depender de que
 * haya una pantalla montada.
 */
iniciarFusion();

/**
 * El runner vive mientras viva el servicio. El bucle hace un ciclo de
 * monitoreo por minuto y no termina hasta que se detenga el servicio.
 */
notifee.registerForegroundService(() => {
  return new Promise(async (resolve) => {
    // Guarda contra un segundo bucle. El vigilante puede pedir arrancar el
    // servicio, y dos bucles concurrentes duplicarian consultas y alertas.
    if (corriendo) {
      resolve();
      return;
    }
    corriendo = true;
    while (corriendo) {
      let conRed = true;
      try {
        conRed = await hayInternet();
      } catch (e) {
        conRed = true;
      }

      if (conRed) {
        if (hibernando) {
          hibernando = false;
          registrarEvento({
            tipo: TIPO.RED,
            subtipo: 'conexion_recuperada',
            detalle: 'Volvió el internet. El monitoreo se reanuda de inmediato.',
          });
        }
        try {
          await ejecutarCiclo();
        } catch (e) {
          console.log('Ciclo de monitoreo fallo:', e);
        }
      } else if (!hibernando) {
        // Se entra en hibernacion una sola vez por episodio, no en cada vuelta.
        hibernando = true;
        try {
          await marcarSinConexion();
        } catch (e) {
          console.log('No se pudo marcar la falta de conexion:', e);
        }
        const avion = await enModoAvion();
        registrarEvento({
          tipo: TIPO.RED,
          subtipo: 'conexion_perdida',
          detalle: avion
            ? 'Sin internet (modo avión activo). El monitoreo hiberna y se reanudará solo al volver la señal.'
            : 'Sin internet. El monitoreo hiberna y se reanudará solo al volver la señal.',
          modoAvion: avion,
        });
      }

      // El temporizador de "Estoy bien" se revisa SIEMPRE, incluso hibernando:
      // la cuenta atras es completamente local y no puede detenerse porque
      // falte internet. Justo cuando no hay red es cuando mas importa.
      try {
        await revisarVencimiento();
      } catch (e) {
        console.log('Revision de emergencia fallo:', e);
      }

      // Tambien SIEMPRE, y por la misma razon: un episodio puede haberlo
      // abierto la alerta de Google sin que haya internet. Sin esta vuelta, si
      // despues no ocurre nada mas, el episodio se quedaria abierto para
      // siempre y jamas llegaria a la bitacora.
      try {
        await mantenimientoFusion();
      } catch (e) {
        console.log('Mantenimiento de episodios fallo:', e);
      }

      // Marca de vida para el vigilante.
      try {
        await AsyncStorage.setItem(LATIDO_KEY, String(Date.now()));
      } catch (e) {
        // Un fallo al escribir el latido no puede tumbar el monitoreo.
      }

      if (!corriendo) break;
      await esperar(hibernando ? INTERVALO_HIBERNANDO_MS : INTERVALO_MS);
    }
    resolve();
  });
});

export async function iniciarServicioPrimerPlano() {
  if (Platform.OS !== 'android') return false;
  try {
    const channelId = await crearCanal();
    await notifee.displayNotification({
      title: 'Monitoreo sísmico activo',
      body: 'Vigilando eventos cada minuto.',
      android: {
        channelId,
        asForegroundService: true,
        // Debe coincidir con el foregroundServiceType del manifiesto, que
        // añade plugins/withForegroundServiceType.js. Android 14 lo exige.
        foregroundServiceTypes: [
          AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        ],
        ongoing: true,
        colorized: false,
        pressAction: { id: 'default' },
      },
    });
    return true;
  } catch (e) {
    console.log('No se pudo iniciar el servicio en primer plano:', e);
    return false;
  }
}

export async function detenerServicioPrimerPlano() {
  corriendo = false;
  hibernando = false;
  // Corta la espera en curso para que el bucle salga en el acto en vez de
  // seguir vivo hasta cinco minutos si estaba hibernando.
  if (despertar) despertar();
  try {
    await notifee.stopForegroundService();
    return true;
  } catch (e) {
    console.log('No se pudo detener el servicio en primer plano:', e);
    return false;
  }
}
