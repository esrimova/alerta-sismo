// src/services/red.js
//
// Estado de la conexion. Antes la app solo sabia que no habia internet porque
// fetch lanzaba una excepcion: se enteraba DESPUES de intentar y fallar, y no
// tenia forma de enterarse de que la red habia vuelto. Con esto la sabe de
// antemano y, sobre todo, recibe un aviso en el instante en que regresa.

import * as Network from 'expo-network';
import { ENDPOINT_SISMOS } from './api';

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
 * ¿Hay internet DE VERDAD?
 *
 * Distinto de hayInternet(), y la diferencia importa. Aquella es optimista a
 * proposito —ante la duda asume que si, porque hibernar por error deja ciega a
 * una app de alertas— y se conforma con lo que diga el sistema. Eso vale para
 * decidir si merece la pena intentar una consulta.
 *
 * Aqui no sirve. La ficha de emergencia va a decirle a quien encuentre al
 * afectado por que via contactarlo, y mandarlo a WhatsApp cuando no hay salida
 * a internet lo pone a esperar una respuesta que no va a llegar nunca. Asi que
 * se confirma con una peticion real.
 *
 * Se sondea el MISMO endpoint del USGS que la app ya consulta, y no un servicio
 * de comprobacion de conectividad, para no abrir un destino saliente nuevo: la
 * app promete que lo unico que sale del telefono es la consulta sismica, y esa
 * promesa vale mas que la comodidad de usar el sondeo estandar de Android.
 *
 * Devuelve `conectado: null` cuando no se pudo determinar. Es un tercer estado
 * de verdad: afirmar "no tengo internet" sin saberlo cambiaria las decisiones
 * de quien lee la ficha.
 */
export async function verificarInternet(timeoutMs = 5000) {
  let tipo = null;
  try {
    const estado = await Network.getNetworkStateAsync();
    tipo = { WIFI: 'wifi', CELLULAR: 'datos móviles', ETHERNET: 'cable' }[estado.type] || null;
    // Si el sistema dice que no hay ninguna red, no hace falta sondear nada.
    if (estado.isConnected === false) {
      let avion = false;
      try { avion = await Network.isAirplaneModeEnabledAsync(); } catch (e) { avion = false; }
      return { conectado: false, tipo: null, avion, verificado: true };
    }
  } catch (e) {
    // Se sigue al sondeo: es mas fiable que el estado del sistema.
  }

  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);
  try {
    // HEAD: solo interesa si la respuesta llega, no su contenido. Sin cache,
    // porque una respuesta guardada diria que hay internet sin haberlo.
    const r = await fetch(ENDPOINT_SISMOS, {
      method: 'HEAD',
      cache: 'no-store',
      signal: control.signal,
    });
    return { conectado: !!r.ok, tipo, avion: false, verificado: true };
  } catch (e) {
    // Abortado o fallo de red: no hay salida a internet utilizable.
    return { conectado: false, tipo, avion: false, verificado: true };
  } finally {
    clearTimeout(reloj);
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
