// src/services/api.js

export const ENDPOINT_SISMOS =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson';

const TIMEOUT_MS = 15000;

/**
 * Motivos de fallo. Se distinguen porque significan cosas distintas para el
 * usuario: "no hay internet" lo puede resolver él, "el servicio no responde" no.
 */
export const FALLO = {
  SIN_RED: 'SIN_RED',
  TIMEOUT: 'TIMEOUT',
  HTTP: 'HTTP',
  FORMATO: 'FORMATO',
};

/**
 * Obtiene los sismos de la ultima hora desde el feed global del USGS.
 * El filtrado geografico lo hace el motor de reglas en background.js.
 *
 * IMPORTANTE: devuelve ESTADO, no solo datos. Antes esta funcion capturaba
 * cualquier error y devolvia [], con lo cual un servicio caido era
 * indistinguible de "no hay sismos" y la app se quedaba callada creyendo que
 * todo estaba bien. En una app de alerta ese silencio es el peor fallo posible.
 *
 * @returns {Promise<{ok: boolean, events: Array, error: string|null,
 *                    motivo: string|null, at: number}>}
 */
export const fetchRecentEarthquakes = async () => {
  const at = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT_SISMOS, { signal: controller.signal });

    if (!response.ok) {
      return {
        ok: false,
        events: [],
        motivo: FALLO.HTTP,
        error: `El servicio respondió ${response.status}`,
        at,
      };
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.features)) {
      return {
        ok: false,
        events: [],
        motivo: FALLO.FORMATO,
        error: 'La respuesta no tiene el formato esperado',
        at,
      };
    }

    return { ok: true, events: data.features, motivo: null, error: null, at };
  } catch (e) {
    // AbortError = se agoto el tiempo. Lo demas suele ser falta de red.
    const esTimeout = e && e.name === 'AbortError';
    return {
      ok: false,
      events: [],
      motivo: esTimeout ? FALLO.TIMEOUT : FALLO.SIN_RED,
      error: esTimeout
        ? `El servicio no respondió en ${TIMEOUT_MS / 1000} s`
        : 'No se pudo conectar (¿sin internet?)',
      at,
    };
  } finally {
    clearTimeout(timer);
  }
};
