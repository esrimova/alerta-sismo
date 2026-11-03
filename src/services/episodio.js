// src/services/episodio.js
//
// Un sismo, varias fuentes, un solo registro.
//
// La app ve el mismo sismo hasta tres veces y en momentos muy distintos: la
// alerta de Google a los ~18 s, la medida del acelerometro cuando llega la onda
// (23-58 s en Medellin) y el feed del USGS a los 4-7 minutos. Sin esta capa
// serian tres entradas sueltas que no se saben hermanas, y se perderia lo unico
// que solo se puede saber cruzandolas: cuantos segundos de aviso hubo de verdad
// y si las fuentes se contradicen.
//
// EL EPISODIO SE ABRE CON LA PRIMERA FUENTE QUE LLEGUE, sea cual sea. Esperar
// al USGS para abrirlo seria esperar 4-7 minutos, que es justo lo que esta capa
// existe para evitar.
//
// El USGS no se degrada por llegar tarde: pasa de ser el disparador a ser el
// REGISTRO AUTORITATIVO. Es el unico que trae magnitud revisada, profundidad y
// coordenadas, que es lo que hace falta si hay catastrofe.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { registrarEvento, TIPO } from './bitacora';

const EPISODIO_KEY = 'alerta_sismo_episodio_abierto_v1';

/**
 * Copia del ultimo episodio ya cerrado, para que la interfaz lo pinte al abrir
 * la app. Se guarda aparte porque se lee en cada render, y recorrer la bitacora
 * entera —que no tiene tope de tamaño— solo para sacar la ultima entrada seria
 * un desperdicio que crece con el uso.
 */
const ULTIMO_KEY = 'alerta_sismo_ultimo_episodio_v1';

/**
 * Cuanto tarda cada fuente en enterarse, para poder estimar hacia atras la hora
 * del sismo y correlacionar sobre ella.
 *
 * Los 18 s de Google salen de su propia cifra publicada: su primera alerta en
 * el M6.7 de Filipinas salio a los 18,3 s. Los 30 s del sensor son el centro de
 * la ventana medida de llegada de onda S (23-58 s). El USGS no necesita
 * estimacion: trae la hora exacta del origen.
 */
export const LATENCIA_SEG = { google: 18, sensor: 30, usgs: 0 };

/**
 * Margen para decidir si dos fuentes hablan del mismo sismo.
 *
 * 120 s es holgado a proposito. Las latencias de arriba son promedios y la
 * distancia al epicentro las mueve decenas de segundos. Partir un episodio en
 * dos por ser estricto pierde justamente la correlacion; unir dos sismos
 * distintos exigiria que ocurrieran con dos minutos de diferencia, que en
 * Colombia pasa una vez cada 39 horas por sismo.
 */
export const TOLERANCIA_MS = 120 * 1000;

/**
 * Cuanto se mantiene abierto un episodio esperando fuentes rezagadas.
 *
 * El USGS tarda para Colombia bastante mas que los 4-7 minutos globales: la
 * version revisada del M5.4 de Rioblanco salio a los 19 minutos. 45 da margen
 * para esa revision. No arriesga comerse la siguiente replica porque un sismo
 * con otro origen cierra el episodio en cuanto llega (ver registrarFuente).
 */
export const VIDA_MS = 45 * 60 * 1000;

/**
 * Cola de escritura, por el mismo motivo que en la bitacora: el bucle del
 * servicio en primer plano y los eventos del sensor escriben aqui desde el
 * mismo contexto JS, y sin serializar dos actualizaciones simultaneas hacen
 * leer-modificar-escribir sobre la misma version y una se pierde.
 */
let cola = Promise.resolve();
function encolar(tarea) {
  const siguiente = cola.then(tarea, tarea);
  cola = siguiente.catch(() => {});
  return siguiente;
}

async function leer() {
  try {
    const s = await AsyncStorage.getItem(EPISODIO_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

async function escribir(ep) {
  try {
    if (ep === null) await AsyncStorage.removeItem(EPISODIO_KEY);
    else await AsyncStorage.setItem(EPISODIO_KEY, JSON.stringify(ep));
  } catch (e) {
    // Si no se puede persistir, el episodio vive solo en memoria de este
    // proceso. Peor que nada, mejor que tumbar una alerta por un fallo de
    // almacenamiento.
  }
}

/** Hora estimada del sismo segun quien reporta. */
export function estimarOrigen(fuente, datos) {
  if (fuente === 'usgs') return datos.origenEstimado ?? datos.recibidoEn;
  if (fuente === 'sensor') {
    // Si la sacudida cruzo el umbral, ese instante es mejor referencia que el
    // arranque de la ventana: la ventana puede haber empezado mucho antes.
    const onset = datos.onsetEn ?? datos.recibidoEn;
    return onset - LATENCIA_SEG.sensor * 1000;
  }
  return datos.recibidoEn - (LATENCIA_SEG[fuente] ?? 0) * 1000;
}

function nuevoEpisodio(fuente, datos, origen, ahora) {
  return {
    id: `ep-${ahora}-${Math.random().toString(36).slice(2, 7)}`,
    abiertoEn: ahora,
    disparo: fuente,
    origenEstimado: origen,
    // true cuando el origen lo fijo el USGS, que es exacto. Mientras sea false
    // el origen es una estimacion y los desfases calculados sobre el tambien.
    origenExacto: fuente === 'usgs',
    fuentes: {},
    nivel: datos.nivel ?? null,
    alarmado: false,
    acciones: null,
  };
}

/**
 * Registra una fuente. Abre un episodio nuevo o se suma al que este abierto.
 *
 * Devuelve `{ episodio, nuevo, yaAlarmado }`. `yaAlarmado` es la respuesta a la
 * pregunta que importa: ¿ya sono por este mismo sismo? Si si, esta fuente
 * enriquece el registro pero NO vuelve a disparar hardware. Sonar tres veces
 * por un solo sismo seria peor que no sonar.
 */
export function registrarFuente(fuente, datos) {
  return encolar(async () => {
    const ahora = datos.recibidoEn ?? Date.now();
    const origen = estimarOrigen(fuente, datos);
    let ep = await leer();

    // Un episodio vencido se consolida antes de mirar nada mas: si no, una
    // replica de dos horas despues se pegaria al episodio del sismo principal.
    if (ep && ahora - ep.abiertoEn > VIDA_MS) {
      await consolidarInterno(ep);
      ep = null;
    }

    const mismo = ep && Math.abs(origen - ep.origenEstimado) <= TOLERANCIA_MS;

    if (ep && !mismo) {
      // Otro sismo distinto mientras el anterior seguia abierto. Es el caso de
      // una replica temprana, y merece registro propio.
      await consolidarInterno(ep);
      ep = null;
    }

    let nuevo = false;
    if (!ep) {
      ep = nuevoEpisodio(fuente, datos, origen, ahora);
      nuevo = true;
    }

    // UNA FUENTE PUEDE HABLAR VARIAS VECES y ninguna pisa a la anterior: Google
    // manda la alerta y minutos despues una actualizacion; el USGS publica una
    // version automatica y luego la revisada. La entrada de la fuente es la
    // PRIMERA observacion —es la que mide la rapidez, que es lo que importa—, y
    // `observaciones` guarda todas en orden. Si llega otra con la misma
    // `version` se trata de la misma observacion repetida y se completa, no se
    // duplica.
    const obs = { ...datos, recibidoEn: ahora, origenEstimado: origen };
    const lista = ep.fuentes[fuente]?.observaciones || [];
    const repetida = obs.version != null
      ? lista.findIndex((o) => o.version === obs.version)
      : -1;
    if (repetida >= 0) lista[repetida] = { ...lista[repetida], ...obs };
    else lista.push(obs);
    ep.fuentes[fuente] = { ...lista[0], observaciones: lista };

    // El USGS manda sobre la hora del sismo: la trae medida, no estimada. En
    // cuanto llega, todos los desfases se recalculan contra ella y dejan de ser
    // aproximaciones.
    if (fuente === 'usgs') {
      ep.origenEstimado = origen;
      ep.origenExacto = true;
    }

    // El nivel sube pero no baja: si Google dijo "toma medidas" y el feed lo
    // clasifica como amarilla, rebajarlo apagaria una emergencia ya declarada.
    if (datos.nivel && jerarquia(datos.nivel) > jerarquia(ep.nivel)) {
      ep.nivel = datos.nivel;
    }

    ep.desfases = calcularDesfases(ep);
    await escribir(ep);
    return { episodio: ep, nuevo, yaAlarmado: ep.alarmado };
  });
}

const ORDEN = { lejano: 1, yellow: 2, orange: 3, red: 4 };
function jerarquia(nivel) {
  return ORDEN[nivel] || 0;
}

/**
 * Los numeros que solo existen al cruzar fuentes.
 *
 * `avisoPrevioSeg` es el mas valioso: los segundos que de verdad hubo entre que
 * Google aviso y que llego la sacudida. La especificacion lo tiene calculado en
 * teoria (23-58 s) pero nunca medido en el sitio.
 */
export function calcularDesfases(ep) {
  const g = ep.fuentes.google;
  const s = ep.fuentes.sensor;
  const u = ep.fuentes.usgs;
  const seg = (a, b) => (a != null && b != null ? Math.round((a - b) / 1000) : null);

  const onset = s ? (s.onsetEn ?? s.recibidoEn) : null;

  return {
    // Cuanto aviso Google antes de que se sintiera aqui.
    avisoPrevioSeg: seg(onset, g?.recibidoEn),
    // Que tan rapido fue cada fuente respecto a la hora real del sismo.
    retrasoGoogleSeg: seg(g?.recibidoEn, ep.origenEstimado),
    retrasoSensorSeg: seg(onset, ep.origenEstimado),
    retrasoUsgsSeg: seg(u?.recibidoEn, ep.origenEstimado),
    // Cuanto se adelanto cada fuente rapida al registro autoritativo.
    googleAUsgsSeg: seg(u?.recibidoEn, g?.recibidoEn),
    sensorAUsgsSeg: seg(u?.recibidoEn, onset),
    origenExacto: ep.origenExacto,
  };
}

/** Deja constancia de que ya sono, para que las fuentes siguientes no repitan. */
export function marcarAlarmado(nivel, acciones) {
  return encolar(async () => {
    const ep = await leer();
    if (!ep) return null;
    ep.alarmado = true;
    ep.alarmadoEn = Date.now();
    if (nivel && jerarquia(nivel) > jerarquia(ep.nivel)) ep.nivel = nivel;
    ep.acciones = acciones || ep.acciones;
    await escribir(ep);
    return ep;
  });
}

/** El episodio abierto, si lo hay y no ha vencido. Para pintarlo en la interfaz. */
export async function episodioAbierto() {
  const ep = await leer();
  if (!ep) return null;
  if (Date.now() - ep.abiertoEn > VIDA_MS) return null;
  return ep;
}

/**
 * Consolida el episodio vencido, si lo hay. Lo llama el bucle del servicio en
 * cada vuelta: es lo que garantiza que un episodio llegue a la bitacora aunque
 * despues no ocurra ningun otro sismo que fuerce el cierre.
 */
export function cerrarSiVencio() {
  return encolar(async () => {
    const ep = await leer();
    if (!ep) return null;
    if (Date.now() - ep.abiertoEn <= VIDA_MS) return null;
    return consolidarInterno(ep);
  });
}

/**
 * Escribe el episodio a la bitacora y lo cierra.
 *
 * La entrada CONSERVA la forma que ya produce construirEntradaAlerta() para la
 * parte del USGS —sismo, evaluacion, acciones— y le añade encima las fuentes
 * rapidas y los desfases. Asi la bitacora existente sigue pintandola igual y
 * solo hay que añadir secciones, no reescribir la vista.
 */
async function consolidarInterno(ep) {
  const entradaUsgs = ep.fuentes.usgs?.entrada || {};
  const g = ep.fuentes.google;
  const s = ep.fuentes.sensor;

  const entrada = {
    ...entradaUsgs,
    tipo: TIPO.EPISODIO,
    episodioId: ep.id,
    nivel: ep.nivel ?? entradaUsgs.nivel ?? null,
    disparo: ep.disparo,
    abiertoEn: ep.abiertoEn,
    origenEstimado: ep.origenEstimado,
    origenExacto: ep.origenExacto,
    acciones: ep.acciones || entradaUsgs.acciones || null,
    fuentes: {
      google: g ? limpiarFuente(g) : null,
      sensor: s ? limpiarFuente(s) : null,
      usgs: ep.fuentes.usgs
        ? {
            recibidoEn: ep.fuentes.usgs.recibidoEn,
            observaciones: (ep.fuentes.usgs.observaciones || []).map((o) => ({
              recibidoEn: o.recibidoEn,
              version: o.version ?? null,
              mag: o.mag ?? o.entrada?.sismo?.mag ?? null,
              status: o.status ?? o.entrada?.sismo?.status ?? null,
            })),
          }
        : null,
    },
    desfases: ep.desfases || calcularDesfases(ep),
    // Resumen legible para la fila colapsada, sobre todo cuando el USGS nunca
    // llego y no hay magnitud que mostrar.
    detalle: resumir(ep),
  };

  await registrarEvento(entrada);
  try {
    await AsyncStorage.setItem(ULTIMO_KEY, JSON.stringify(entrada));
  } catch (e) {
    // Es solo la copia rapida para la interfaz; en la bitacora ya quedo.
  }
  await escribir(null);
  return entrada;
}

/** Quita el bulto de `entrada` de la fuente y de cada una de sus observaciones. */
function limpiarFuente(f) {
  return {
    ...f,
    entrada: undefined,
    observaciones: (f.observaciones || []).map((o) => ({ ...o, entrada: undefined })),
  };
}

/** El ultimo episodio cerrado. Para la tarjeta de la pantalla principal. */
export async function ultimoEpisodio() {
  try {
    const s = await AsyncStorage.getItem(ULTIMO_KEY);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

/** Fuerza el cierre ahora, sin esperar a que venza. */
export function consolidarAhora() {
  return encolar(async () => {
    const ep = await leer();
    if (!ep) return null;
    return consolidarInterno(ep);
  });
}

function resumir(ep) {
  const partes = [];
  const g = ep.fuentes.google;
  const s = ep.fuentes.sensor;
  const u = ep.fuentes.usgs;

  if (u?.entrada?.sismo?.mag != null) {
    partes.push(`M${u.entrada.sismo.mag} · ${u.entrada.sismo.lugar || 'sin ubicación'}`);
  } else if (g?.magTexto) {
    partes.push(`Google estimó M${g.magTexto}`);
  }

  if (s?.pgaG != null) partes.push(`${s.pgaG.toFixed(3)} g medidos aquí`);

  const nFuentes = [g, s, u].filter(Boolean).length;
  partes.push(nFuentes === 1 ? '1 fuente' : `${nFuentes} fuentes`);

  return partes.join(' · ');
}
