// src/services/health.js
import AsyncStorage from '@react-native-async-storage/async-storage';

const HEALTH_KEY = 'alerta_sismo_salud_v1';

/** Fallos consecutivos antes de avisar. Uno suelto es ruido, no una caida. */
export const FALLOS_PARA_AVISAR = 3;

/** Minutos sin una consulta exitosa tras los cuales se considera caido. */
export const MINUTOS_SIN_EXITO = 30;

export const ESTADO = {
  OPERATIVO: 'OPERATIVO',
  DEGRADADO: 'DEGRADADO',
  CAIDO: 'CAIDO',
  SIN_DATOS: 'SIN_DATOS',
  // El telefono no tiene internet. NO es un fallo del servicio sismico, y
  // confundirlos hacia que la app acusara al USGS de estar caido cuando el
  // problema era el modo avion.
  SIN_CONEXION: 'SIN_CONEXION',
};

const SALUD_INICIAL = {
  ultimoExito: null,      // timestamp de la ultima consulta que si funciono
  ultimoIntento: null,    // timestamp del ultimo intento, exitoso o no
  fallosSeguidos: 0,
  ultimoError: null,
  ultimoMotivo: null,
  avisoEnviado: false,    // evita repetir la notificacion en cada ciclo fallido
  hibernando: false,      // sin internet: el monitoreo esta en espera
};

export async function loadHealth() {
  try {
    const raw = await AsyncStorage.getItem(HEALTH_KEY);
    if (!raw) return { ...SALUD_INICIAL };
    return { ...SALUD_INICIAL, ...JSON.parse(raw) };
  } catch (e) {
    return { ...SALUD_INICIAL };
  }
}

async function saveHealth(salud) {
  try {
    await AsyncStorage.setItem(HEALTH_KEY, JSON.stringify(salud));
  } catch (e) {
    console.log('No se pudo guardar el estado de salud:', e);
  }
}

/**
 * Registra el resultado de una consulta y decide si hay que avisar.
 *
 * @returns {Promise<{salud: object, debeAvisarCaida: boolean,
 *                    debeAvisarRecuperacion: boolean}>}
 */
/**
 * El telefono se quedo sin internet.
 *
 * Deliberadamente NO incrementa fallosSeguidos ni dispara el aviso de servicio
 * caido: no se consulto nada, asi que no hay nada que reprocharle al USGS. Solo
 * deja constancia de que el monitoreo esta en espera.
 */
export async function marcarSinConexion() {
  const previa = await loadHealth();
  await saveHealth({ ...previa, hibernando: true, ultimoIntento: Date.now() });
}

export async function registrarResultado(resultado) {
  const previa = await loadHealth();
  // Cualquier consulta real significa que la red volvio.
  const salud = { ...previa, ultimoIntento: resultado.at, hibernando: false };

  let debeAvisarCaida = false;
  let debeAvisarRecuperacion = false;

  if (resultado.ok) {
    salud.ultimoExito = resultado.at;
    salud.fallosSeguidos = 0;
    salud.ultimoError = null;
    salud.ultimoMotivo = null;
    // Solo se avisa la recuperacion si antes se habia avisado la caida.
    if (previa.avisoEnviado) {
      debeAvisarRecuperacion = true;
      salud.avisoEnviado = false;
    }
  } else {
    salud.fallosSeguidos = (previa.fallosSeguidos || 0) + 1;
    salud.ultimoError = resultado.error;
    salud.ultimoMotivo = resultado.motivo;

    const minutosSinExito = previa.ultimoExito
      ? (resultado.at - previa.ultimoExito) / 60000
      : Infinity;

    const superaUmbral =
      salud.fallosSeguidos >= FALLOS_PARA_AVISAR ||
      minutosSinExito >= MINUTOS_SIN_EXITO;

    // Una sola notificacion por episodio, no una por cada intento fallido.
    if (superaUmbral && !previa.avisoEnviado) {
      debeAvisarCaida = true;
      salud.avisoEnviado = true;
    }
  }

  await saveHealth(salud);
  return { salud, debeAvisarCaida, debeAvisarRecuperacion };
}

/** Traduce la salud guardada a un semaforo para la interfaz. */
export function calcularEstado(salud) {
  if (!salud || !salud.ultimoIntento) return ESTADO.SIN_DATOS;
  // Manda sobre todo lo demas: si no hay internet, el estado del feed sismico
  // es irrelevante y mostrarlo solo confunde.
  if (salud.hibernando) return ESTADO.SIN_CONEXION;
  if (salud.fallosSeguidos === 0) return ESTADO.OPERATIVO;

  const minutosSinExito = salud.ultimoExito
    ? (Date.now() - salud.ultimoExito) / 60000
    : Infinity;

  if (salud.fallosSeguidos >= FALLOS_PARA_AVISAR || minutosSinExito >= MINUTOS_SIN_EXITO) {
    return ESTADO.CAIDO;
  }
  return ESTADO.DEGRADADO;
}

export async function resetHealth() {
  await saveHealth({ ...SALUD_INICIAL });
}
