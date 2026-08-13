// src/services/sismografo.js
//
// Puente entre el modulo nativo de medida y el resto de la app.
//
// El sismografo NO detecta sismos: mide cuando otra fuente ya dijo "ahora".
// Esa distincion es la que lo mantiene fuera de competir con la red de Google,
// que detecta con millones de telefonos y a la que uno solo no puede igualar.
//
// Lo que aporta y ninguna otra fuente puede: que paso en ESTA direccion. El
// feed del USGS tarda 4-7 minutos y describe el epicentro; Google estima para
// una region entera. La intensidad real varia mucho con el suelo, el edificio
// y el piso, y ese es el numero que decide si conviene evacuar o no.

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * El modulo nativo puede no existir: en web, o en un binario construido antes
 * de que el modulo se añadiera. Se resuelve una sola vez y la app sigue
 * funcionando sin medida local, que es degradacion aceptable.
 */
let nativo = null;
let motivoAusencia = null;
try {
  // eslint-disable-next-line global-require
  nativo = require('../../modules/sismografo');
} catch (e) {
  motivoAusencia = e?.message || 'modulo_no_disponible';
}

export const ULTIMA_MEDICION_KEY = 'alerta_sismo_ultima_medicion_v1';

/**
 * Cuanto dura la ventana segun quien dispare.
 *
 * No son todas iguales porque no miden lo mismo. La de Google llega ANTES de
 * la sacudida y tiene que cubrirla entera. Las del feed llegan 4-7 minutos
 * tarde, cuando la sacudida ya termino: ahi la ventana no mide el sismo
 * principal —eso ya no es posible— sino el estado del telefono y las replicas.
 */
export const VENTANAS_SEG = {
  google: null,     // usa settings.sensor.ventanaSeg; es la unica que llega a tiempo
  red: 60,
  orange: 30,
  yellow: 30,
  prueba: 10,
};

/** Ritmo bajo para vigilar replicas durante horas sin fundir la bateria. */
export const HZ_VIGILANCIA = 5;

export function hayModulo() {
  return nativo != null;
}

/**
 * Que sensores tiene el telefono. Devuelve siempre la misma forma, tambien
 * cuando no hay modulo, para que la interfaz no tenga que distinguir casos.
 */
export function disponibilidad() {
  if (!nativo) {
    return {
      acelerometro: false,
      giroscopio: false,
      midiendo: false,
      etiqueta: null,
      motivo: motivoAusencia,
    };
  }
  try {
    return { ...nativo.disponibilidad(), motivo: null };
  } catch (e) {
    return {
      acelerometro: false,
      giroscopio: false,
      midiendo: false,
      etiqueta: null,
      motivo: e?.message || 'error_desconocido',
    };
  }
}

/**
 * Abre una ventana de medida.
 *
 * `etiqueta` dice quien disparo y es lo que despues permite cruzar la medida
 * con el episodio sismico al que pertenece.
 */
export function medir(etiqueta, settings, opciones = {}) {
  if (!nativo) return { ok: false, motivo: 'sin_modulo' };
  const cfg = settings?.sensor || {};
  if (cfg.habilitado === false && etiqueta !== 'prueba') {
    return { ok: false, motivo: 'desactivado' };
  }

  const seg = opciones.ventanaSeg
    ?? VENTANAS_SEG[etiqueta]
    ?? cfg.ventanaSeg
    ?? 90;
  const hz = opciones.hz ?? cfg.hz ?? 100;
  const umbralG = opciones.umbralG ?? cfg.umbralG ?? 0.02;

  try {
    return nativo.iniciarVentana(Math.round(seg * 1000), hz, umbralG, etiqueta);
  } catch (e) {
    return { ok: false, motivo: e?.message || 'error_al_iniciar' };
  }
}

/**
 * Vigilancia de replicas: ritmo bajo durante horas.
 *
 * Es el caso donde el retraso del feed deja de importar. Una replica ocurre
 * horas o dias despues del evento principal, asi que 4-7 minutos de retraso
 * son irrelevantes; lo que hace falta es estar escuchando cuando llegue.
 */
export function vigilarReplicas(settings) {
  const cfg = settings?.sensor || {};
  if (!cfg.vigilarReplicas) return { ok: false, motivo: 'desactivada' };
  const horas = cfg.horasReplicas ?? 6;
  return medir('replicas', settings, {
    ventanaSeg: horas * 3600,
    hz: HZ_VIGILANCIA,
  });
}

/** Ventana corta a demanda, para poder probar el sensor sin esperar un sismo. */
export function medirPrueba(settings) {
  return medir('prueba', settings, { ventanaSeg: VENTANAS_SEG.prueba, hz: 100 });
}

/**
 * Recoge las medidas tomadas con JavaScript dormido.
 *
 * Una ventana disparada por la alerta de Google se cierra 90 segundos despues,
 * y si la app estaba cerrada nadie estaba escuchando ese cierre. El modulo
 * nativo las guarda; esto las recupera.
 */
export function drenarMediciones() {
  if (!nativo) return [];
  try {
    return nativo.vaciarPendientes() || [];
  } catch (e) {
    return [];
  }
}

export function detener() {
  if (!nativo) return { ok: false, motivo: 'sin_modulo' };
  try {
    return nativo.detenerVentana();
  } catch (e) {
    return { ok: false, motivo: e?.message || 'error_al_detener' };
  }
}

/** Se emite al cerrar cada ventana, con el resumen completo. */
export function alMedir(cb) {
  if (!nativo) return { remove: () => {} };
  return nativo.alMedir(cb);
}

/**
 * Se emite en cuanto la sacudida cruza el umbral, sin esperar al cierre de la
 * ventana. En un sismo real la ventana dura 90 s: esperarla entera
 * desperdiciaria justo los segundos que importan.
 */
export function alSuperarUmbral(cb) {
  if (!nativo) return { remove: () => {} };
  return nativo.alSuperarUmbral(cb);
}

/**
 * La ultima medida, para que la interfaz la pueda pintar al abrir la app.
 * Se guarda aparte de la bitacora porque se lee en cada render y recorrer el
 * registro entero para sacar la ultima seria un desperdicio.
 */
export async function guardarUltimaMedicion(medicion) {
  try {
    await AsyncStorage.setItem(ULTIMA_MEDICION_KEY, JSON.stringify(medicion));
  } catch (e) {
    // La medida ya se registro en bitacora; esto es solo la copia rapida.
  }
}

export async function cargarUltimaMedicion() {
  try {
    const s = await AsyncStorage.getItem(ULTIMA_MEDICION_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Nombre romano de la intensidad Mercalli. La escala es romana por convencion
 * y escribirla en arabigo la hace parecer una medida continua, que no es.
 */
const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function mmiRomano(mmi) {
  if (mmi === null || mmi === undefined) return null;
  const n = Math.round(mmi);
  return ROMANOS[Math.max(1, Math.min(12, n))] || null;
}

/**
 * Que significa esa intensidad, en palabras.
 *
 * La escala Mercalli se define por efectos observables, no por un numero, asi
 * que mostrar solo la cifra no le dice nada a quien la lee.
 */
export function describirMmi(mmi) {
  if (mmi === null || mmi === undefined) return null;
  const n = Math.round(mmi);
  if (n <= 2) return 'Casi imperceptible';
  if (n === 3) return 'Se siente en interiores';
  if (n === 4) return 'Vibran ventanas y platos';
  if (n === 5) return 'Se siente claramente, caen objetos pequeños';
  if (n === 6) return 'Se siente de pie, muebles se mueven';
  if (n === 7) return 'Difícil mantenerse en pie, daño en construcción débil';
  if (n === 8) return 'Daño considerable en construcción normal';
  if (n >= 9) return 'Daño grave y generalizado';
  return null;
}
