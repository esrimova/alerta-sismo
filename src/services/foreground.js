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
import { revisarVencimiento, cargarEstadoEmergencia } from './emergencia';
import { hayInternet, suscribirRed } from './red';
import { marcarSinConexion } from './health';
import { iniciarFusion, mantenimientoFusion } from './fusion';
import { registrarEspera, olvidarEspera, despertarAhora } from './despertador';
import { hayModulo, estadoEscucha } from './escucha';

const CANAL_MONITOREO = 'monitoreo-activo';

/**
 * Id fijo de la notificacion permanente.
 *
 * Sin el, cada llamada a displayNotification crearia una notificacion nueva en
 * vez de actualizar la que ya existe, y la barra de estado acabaria con una
 * hilera de "Monitoreo activo". Con id fijo, volver a mostrarla la reemplaza.
 */
const ID_NOTIFICACION = 'monitoreo-activo';

const INTERVALO_MS = 60000;

/**
 * Sin red no tiene sentido consultar cada minuto: cada intento falla igual y
 * solo gasta bateria. Se espacia a 5 minutos, pero ese temporizador es solo
 * una red de seguridad: el despertar de verdad lo dispara el listener de red.
 */
const INTERVALO_HIBERNANDO_MS = 300000;

/**
 * Ritmo mientras el protocolo de emergencia esta ACTIVADO.
 *
 * Si el protocolo vencio sin confirmacion, se asume que el usuario no puede
 * responder. Preguntarle al USGS cada minuto en ese estado gasta radio, datos y
 * bateria para producir un aviso que nadie va a leer, y la bateria es
 * literalmente la ventana de rescate: la propia ficha le dice a quien busca que
 * cuando se agote, la señal desaparece.
 *
 * No se apaga del todo a proposito. La bitacora es el registro permanente de lo
 * que ocurrio, y el contexto sismico de esas horas —las replicas, sobre todo—
 * tiene valor despues. Quince minutos conservan el registro quitando el 93% del
 * trabajo de radio.
 */
const INTERVALO_EMERGENCIA_MS = 900000;

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
      olvidarEspera();
      resolve();
    }, ms);
    despertar = () => {
      clearTimeout(t);
      despertar = null;
      resolve();
    };
    // Se publica para que otros servicios puedan cortarla. El caso que lo
    // justifica es "Estoy bien" tras vencer el plazo: en ese instante el
    // usuario vuelve a poder actuar y el bucle no puede seguir en ritmo
    // reducido un cuarto de hora mas.
    registrarEspera(despertar);
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
          // Volver la red no se anota en la bitacora: no aporta nada y la llena.
          hibernando = false;
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
        // Tampoco se anota perder la red: el semaforo del feed ya lo refleja
        // con marcarSinConexion().
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

      // Tambien SIEMPRE: el permiso de escucha se concede y se revoca FUERA de
      // la app, asi que el unico momento fiable para mirarlo es cada vuelta. Es
      // ademas lo que corrige la notificacion sola en cuanto el usuario vuelve
      // de los ajustes, sin tener que reiniciar el monitoreo.
      try {
        await reflejarViaRapida();
      } catch (e) {
        console.log('No se pudo reflejar el estado de la vía rápida:', e);
      }

      // Marca de vida para el vigilante.
      try {
        await AsyncStorage.setItem(LATIDO_KEY, String(Date.now()));
      } catch (e) {
        // Un fallo al escribir el latido no puede tumbar el monitoreo.
      }

      if (!corriendo) break;

      // El protocolo activado manda sobre todo lo demas: el usuario no puede
      // responder y cada consulta le quita minutos de baliza.
      let enEmergencia = false;
      try {
        enEmergencia = !!(await cargarEstadoEmergencia()).activada;
      } catch (e) {
        enEmergencia = false;
      }

      await esperar(
        enEmergencia
          ? INTERVALO_EMERGENCIA_MS
          : (hibernando ? INTERVALO_HIBERNANDO_MS : INTERVALO_MS)
      );
    }
    resolve();
  });
});

/**
 * ¿Esta la app corriendo sin su via rapida?
 *
 * Sin el permiso de acceso a notificaciones no se escucha la alerta de Google y
 * la app pasa de enterarse en ~18 s a enterarse en 4-7 minutos. Si el modulo
 * nativo no existe no se afirma nada: seria acusar de falta de permiso a un
 * equipo donde esa via directamente no esta compilada.
 */
function faltaLaViaRapida() {
  if (!hayModulo()) return false;
  try {
    return !estadoEscucha().permiso;
  } catch (e) {
    return false;
  }
}

/**
 * Que dice la notificacion permanente.
 *
 * Es el unico sitio donde la degradacion se puede contar sin acosar a nadie: la
 * notificacion ya esta ahi de todas formas, obligada por Android a cambio de no
 * matar el proceso. Que diga la verdad no cuesta una interrupcion mas.
 */
function textoServicio(sinViaRapida) {
  if (sinViaRapida) {
    return {
      title: 'Monitoreo activo, sin alertas de Google',
      body: 'Falta el acceso a notificaciones: los avisos llegarán en minutos, '
        + 'no en segundos. Abre la app para concederlo.',
    };
  }
  return {
    title: 'Monitoreo sísmico activo',
    body: 'Vigilando eventos cada minuto.',
  };
}

async function mostrarNotificacionServicio(sinViaRapida) {
  const channelId = await crearCanal();
  await notifee.displayNotification({
    id: ID_NOTIFICACION,
    ...textoServicio(sinViaRapida),
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
}

/** Ultimo estado reflejado, para no reescribir la notificacion cada minuto. */
let sinViaRapidaReflejado = null;

/**
 * Pone al dia la notificacion permanente si la via rapida cambio de estado.
 *
 * Esto es lo que cubre el caso que una comprobacion de transicion NO puede
 * cubrir: al reinstalar la app se borra tambien su memoria, asi que "reinstalada
 * y sin permiso" es indistinguible de "usuario nuevo que nunca lo concedio". La
 * app no puede saber que un dia lo tuvo. Lo que si puede es no correr degradada
 * en silencio, y eso no depende de recordar nada.
 */
export async function reflejarViaRapida() {
  if (Platform.OS !== 'android') return;
  const sinViaRapida = faltaLaViaRapida();
  if (sinViaRapida === sinViaRapidaReflejado) return;
  try {
    await mostrarNotificacionServicio(sinViaRapida);
    sinViaRapidaReflejado = sinViaRapida;
  } catch (e) {
    console.log('No se pudo actualizar la notificación del servicio:', e);
  }
}

export async function iniciarServicioPrimerPlano() {
  if (Platform.OS !== 'android') return false;
  try {
    const sinViaRapida = faltaLaViaRapida();
    await mostrarNotificacionServicio(sinViaRapida);
    sinViaRapidaReflejado = sinViaRapida;
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
