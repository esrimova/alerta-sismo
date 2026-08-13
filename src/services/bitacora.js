// src/services/bitacora.js
//
// Registro permanente de todo lo que le pasa a la app durante una emergencia:
// alertas disparadas, protocolo de emergencia, cortes de red y caidas del
// servicio.
//
// Dos reglas de diseño que vienen del requisito, no de la comodidad:
//
//  1. SOLO SE AÑADE. Ninguna entrada se modifica ni se sobrescribe jamas. Si
//     el USGS luego corrige la magnitud de un sismo, eso sera una entrada
//     nueva, no un cambio sobre la vieja: el registro debe reflejar lo que la
//     app sabia EN ESE MOMENTO, que es lo que explica por que actuo asi.
//
//  2. SIN LIMITE. No se descarta nada por antiguedad ni por cantidad. Lo unico
//     que borra es el usuario, explicitamente. Un tope automatico habria
//     tirado justo el registro de la emergencia que se quiere conservar.
//
// El precio de (2) es que el array crece sin cota. Se mide con tamanoAproximado()
// para avisar antes de acercarse al limite practico de AsyncStorage en Android
// (~6 MB); a ~1 KB por entrada eso da miles de eventos de margen.

import AsyncStorage from '@react-native-async-storage/async-storage';

const BITACORA_KEY = 'alerta_sismo_bitacora_v1';

/** A partir de aqui conviene avisarle al usuario que exporte o borre. */
export const BYTES_AVISO = 4 * 1024 * 1024;

export const TIPO = {
  ALERTA: 'alerta',       // se disparo una alerta sismica
  EPISODIO: 'episodio',   // un sismo visto por varias fuentes, ya consolidado
  PROTOCOLO: 'protocolo', // cuenta atras, "Estoy bien", activacion
  RED: 'red',             // internet perdido/recuperado, hibernacion
  SERVICIO: 'servicio',   // el feed del USGS cayo o volvio
  SISTEMA: 'sistema',     // el monitoreo se reinicio solo
};

/**
 * Cola de escritura.
 *
 * El bucle del servicio en primer plano y la interfaz comparten el mismo
 * contexto JS y ambos escriben aqui. Sin serializar, dos registros simultaneos
 * hacen leer-modificar-escribir sobre la misma version y uno de los dos se
 * pierde en silencio: exactamente lo que un registro append-only no puede
 * permitirse. Encadenar las escrituras lo vuelve imposible.
 */
let cola = Promise.resolve();

function encolar(tarea) {
  cola = cola.then(tarea, tarea);
  return cola;
}

async function leerCrudo() {
  try {
    const raw = await AsyncStorage.getItem(BITACORA_KEY);
    if (!raw) return [];
    const datos = JSON.parse(raw);
    return Array.isArray(datos) ? datos : [];
  } catch (e) {
    // Un registro corrupto no puede tumbar el monitoreo. Se prefiere perder la
    // lectura antes que propagar la excepcion al ciclo de alertas.
    console.log('No se pudo leer la bitacora:', e);
    return [];
  }
}

/**
 * Añade una entrada. Nunca lanza: se llama desde el ciclo de monitoreo y desde
 * el protocolo de emergencia, donde un fallo al registrar no puede impedir que
 * suene la alarma.
 *
 * @param {object} entrada - sin id ni ts; los pone esta funcion.
 * @returns {Promise<object|null>} la entrada guardada, o null si fallo.
 */
export function registrarEvento(entrada) {
  return encolar(async () => {
    try {
      const registro = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        ...entrada,
      };
      const actual = await leerCrudo();
      actual.push(registro); // cronologico; la interfaz lo invierte al mostrar
      await AsyncStorage.setItem(BITACORA_KEY, JSON.stringify(actual));
      return registro;
    } catch (e) {
      console.log('No se pudo registrar en la bitacora:', e);
      return null;
    }
  });
}

/** Todas las entradas, de la mas reciente a la mas antigua. */
export async function cargarBitacora() {
  const datos = await leerCrudo();
  return datos.slice().reverse();
}

export async function contarBitacora() {
  const datos = await leerCrudo();
  return datos.length;
}

/**
 * Tamaño aproximado en bytes. Sirve para avisar antes de que AsyncStorage se
 * vuelva un problema, sin imponer un borrado automatico que el usuario no pidio.
 */
export async function tamanoAproximado() {
  try {
    const raw = await AsyncStorage.getItem(BITACORA_KEY);
    return raw ? raw.length : 0;
  } catch (e) {
    return 0;
  }
}

/** Lo unico que borra. Solo lo invoca el usuario desde la interfaz. */
export function borrarBitacora() {
  return encolar(async () => {
    try {
      await AsyncStorage.removeItem(BITACORA_KEY);
      return true;
    } catch (e) {
      console.log('No se pudo borrar la bitacora:', e);
      return false;
    }
  });
}
