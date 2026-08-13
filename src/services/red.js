// src/services/red.js
//
// Estado de la conexion. Antes la app solo sabia que no habia internet porque
// fetch lanzaba una excepcion: se enteraba DESPUES de intentar y fallar, y no
// tenia forma de enterarse de que la red habia vuelto. Con esto la sabe de
// antemano y, sobre todo, recibe un aviso en el instante en que regresa.

import * as Network from 'expo-network';

/**
 * ¿Hay internet ahora mismo?
 *
 * isInternetReachable puede venir indefinido en algunos equipos, asi que solo
 * se descarta cuando dice explicitamente que no. Ante la duda se asume que si:
 * un intento fallido cuesta un ciclo, pero hibernar por error deja la app
 * ciega, que es mucho peor en una app de alertas.
 */
export async function hayInternet() {
  try {
    const estado = await Network.getNetworkStateAsync();
    return !!estado.isConnected && estado.isInternetReachable !== false;
  } catch (e) {
    return true;
  }
}

/**
 * Avisa cuando cambia el estado de la red.
 * @param {(hayRed: boolean) => void} cb
 * @returns {{remove: () => void}} suscripcion
 */
export function suscribirRed(cb) {
  try {
    return Network.addNetworkStateListener((estado) => {
      cb(!!estado.isConnected && estado.isInternetReachable !== false);
    });
  } catch (e) {
    console.log('No se pudo suscribir a los cambios de red:', e);
    return { remove: () => {} };
  }
}

/**
 * Estado detallado de la conexion, para la ficha de emergencia.
 *
 * Que el telefono tenga internet o no le dice a quien encuentra al afectado dos
 * cosas que no puede deducir de otra forma:
 *
 *  - CON internet y sin respuesta: el silencio no es un problema de red, es un
 *    problema de la persona. Nadie con cobertura deja de pedir ayuda porque si.
 *    Sube la urgencia.
 *  - SIN internet: la zona esta incomunicada. Avisar a la familia por telefono
 *    probablemente tampoco va a funcionar, y la malla es el unico canal que
 *    queda.
 *
 * Nunca lanza: es un dato de apoyo y no puede impedir que salga el mensaje.
 */
export async function estadoConexion() {
  try {
    const estado = await Network.getNetworkStateAsync();
    const conectado = !!estado.isConnected && estado.isInternetReachable !== false;
    const tipo = {
      WIFI: 'wifi',
      CELLULAR: 'datos móviles',
      ETHERNET: 'cable',
      NONE: null,
    }[estado.type] || null;
    let avion = false;
    if (!conectado) {
      try { avion = await Network.isAirplaneModeEnabledAsync(); } catch (e) { avion = false; }
    }
    return { conectado, tipo, avion, sabido: true };
  } catch (e) {
    // Sin dato es distinto de "sin conexion", y confundirlos haria decir a la
    // ficha que la zona esta incomunicada cuando quiza no lo esta.
    return { conectado: null, tipo: null, avion: false, sabido: false };
  }
}

/** Solo Android. Util para explicarle al usuario por que no hay conexion. */
export async function enModoAvion() {
  try {
    return await Network.isAirplaneModeEnabledAsync();
  } catch (e) {
    return false;
  }
}
