// src/services/escucha.js
//
// Puente con la escucha de las alertas sismicas de Google.
//
// Es el punto de entrada rapido de la app: Google avisa a los ~18 s del origen,
// cuando el feed del USGS todavia tardara de 4 a 7 minutos. Nunca publicaron
// una API, asi que la unica via es interceptar su notificacion.
//
// LO QUE SE PUEDE CONFIAR Y LO QUE NO:
//
//  - El canal y el instante de recepcion son fiables y estables. El canal da el
//    nivel; el instante es el t0 contra el que se mide todo lo demas.
//  - La magnitud y la distancia vienen en prosa dentro del texto, y ese texto
//    depende del idioma y de como Google decida redactarlo. Se intentan sacar,
//    pero la app NUNCA depende de haberlo conseguido.
//  - La profundidad y las coordenadas no vienen. Google no se las muestra al
//    usuario, asi que no estan en la notificacion. Para eso esta el USGS, que
//    llega tarde pero las trae medidas.

import { registrarEvento, TIPO } from './bitacora';

let nativo = null;
let motivoAusencia = null;
try {
  // eslint-disable-next-line global-require
  nativo = require('../../modules/escucha-alertas');
} catch (e) {
  motivoAusencia = e?.message || 'modulo_no_disponible';
}

export function hayModulo() {
  return nativo != null;
}

/**
 * Estado para el semaforo de fuentes.
 *
 * Devuelve siempre la misma forma, tambien sin modulo, para que la interfaz no
 * tenga que distinguir casos.
 */
export function estadoEscucha() {
  if (!nativo) {
    return {
      permiso: false, vinculado: false, ultimoEstado: null,
      ultimoEstadoEn: null, canalesQueDisparan: [], motivo: motivoAusencia,
    };
  }
  try {
    return { ...nativo.estado(), motivo: null };
  } catch (e) {
    return {
      permiso: false, vinculado: false, ultimoEstado: null,
      ultimoEstadoEn: null, canalesQueDisparan: [],
      motivo: e?.message || 'error_desconocido',
    };
  }
}

export function abrirAjustesEscucha() {
  if (!nativo) return { ok: false, motivo: 'sin_modulo' };
  try {
    return nativo.abrirAjustes();
  } catch (e) {
    return { ok: false, motivo: e?.message || 'no_se_pudo_abrir' };
  }
}

/**
 * Saca la magnitud del texto de Google.
 *
 * Best-effort deliberado. Se prueban varias formas porque no se conoce la
 * redaccion exacta en español para Colombia —no hay manera de forzar una alerta
 * de prueba, solo se sabra con una real— y porque puede cambiar en cualquier
 * actualizacion de Play Services. Si no se consigue, no pasa nada: el canal y
 * la hora ya bastan para abrir el episodio y disparar la medida.
 *
 * Se acepta coma decimal: en español es lo normal escribir "magnitud 5,4".
 */
export function extraerMagnitud(texto) {
  if (!texto) return null;
  const patrones = [
    /magnitud\s*(?:de\s*)?(\d+[.,]\d+)/i,
    /\bM\s?(\d+[.,]\d+)\b/,
    /(\d+[.,]\d+)\s*de\s*magnitud/i,
  ];
  for (const p of patrones) {
    const m = texto.match(p);
    if (m) {
      const n = Number(m[1].replace(',', '.'));
      // Guarda de cordura: fuera de este rango no es una magnitud sismica y
      // seguramente se capturo otro numero de la frase.
      if (!Number.isNaN(n) && n >= 1 && n <= 10) return n;
    }
  }
  return null;
}

/** Saca la distancia en km del texto, con la misma reserva que la magnitud. */
export function extraerDistancia(texto) {
  if (!texto) return null;
  const m = texto.match(/(\d+(?:[.,]\d+)?)\s*(?:km|kil[oó]metros)/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/**
 * Recoge las alertas que llegaron mientras JavaScript no estaba escuchando.
 *
 * El servicio lo vincula el sistema y puede entregar una alerta con el runtime
 * muerto: es exactamente el caso de una alerta de madrugada con la app cerrada.
 * En nativo el sensor ya arranco; esto recupera el registro.
 */
export function drenarAlertas() {
  if (!nativo) return [];
  let crudas = [];
  try {
    crudas = nativo.vaciarPendientes() || [];
  } catch (e) {
    return [];
  }

  return crudas.map((a) => {
    const texto = [a.bigText, a.texto, a.titulo].filter(Boolean).join(' · ');
    return {
      ...a,
      magTexto: extraerMagnitud(texto),
      distTexto: extraerDistancia(texto),
    };
  });
}

/**
 * Deja constancia de una alerta de Google en la bitacora.
 *
 * Se guarda el texto CRUDO ademas de lo parseado. Es la unica forma de
 * reconstruir despues lo que Google dijo de verdad, y de arreglar el parser
 * cuando cambie la redaccion sin haber perdido los eventos anteriores.
 */
export function registrarAlertaGoogle(alerta, extra = {}) {
  return registrarEvento({
    tipo: TIPO.ALERTA,
    fuente: 'google',
    nivel: alerta.dispara ? 'red' : null,
    regla: 'alerta_google',
    canal: alerta.canal,
    detalle: alerta.conocido
      ? `Alerta sísmica de Google (${alerta.canal}).`
      : `Canal desconocido de Google: ${alerta.canal}. Es señal de que cambió el formato.`,
    google: {
      canal: alerta.canal,
      recibidoEn: alerta.recibidoEn,
      titulo: alerta.titulo,
      texto: alerta.texto,
      bigText: alerta.bigText,
      subText: alerta.subText,
      magTexto: alerta.magTexto,
      distTexto: alerta.distTexto,
      conocido: alerta.conocido,
      dispara: alerta.dispara,
    },
    ...extra,
  });
}
