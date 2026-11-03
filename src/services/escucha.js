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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { registrarEvento, TIPO } from './bitacora';
import { notificarEscuchaPerdida, notificarEscuchaActiva } from './alert';

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

/** Donde se recuerda si la escucha tenia permiso la ultima vez que se miro. */
const CLAVE_PERMISO = 'alerta_sismo_escucha_permiso_v1';

/**
 * Vigila que la escucha de Google no se haya quedado sin permiso.
 *
 * Se pierde con mas facilidad de lo que parece: reinstalar la app lo borra
 * —basta un `adb install` sobre una desinstalacion previa—, y HyperOS lo
 * revoca por su cuenta al restringir una app. Y se pierde EN SILENCIO: no
 * falla nada, el monitoreo sigue corriendo y lo unico que cambia es que la app
 * pasa de enterarse en ~18 s a enterarse en 4-7 minutos. Es la degradacion mas
 * grave que puede sufrir sin que nada parezca roto.
 *
 * Se registra el cambio de estado, no el estado: escribir cada 60 s que sigue
 * sin permiso llenaria la bitacora y enterraria lo que si importa.
 *
 * La memoria va a disco porque el servicio en primer plano muere y revive, y
 * una variable de modulo volveria a empezar en blanco cada vez, contando como
 * "perdido" algo que ya se habia contado.
 */
export async function vigilarPermisoEscucha() {
  if (!nativo) return { cambio: null, permiso: false };

  const { permiso } = estadoEscucha();

  let previo = null;
  try {
    const guardado = await AsyncStorage.getItem(CLAVE_PERMISO);
    if (guardado != null) previo = guardado === 'true';
  } catch (e) {
    // Sin memoria previa se trata como la primera vuelta: se toma la foto y no
    // se inventa una transicion que no se puede demostrar.
  }

  if (previo === permiso) return { cambio: null, permiso };

  try {
    await AsyncStorage.setItem(CLAVE_PERMISO, permiso ? 'true' : 'false');
  } catch (e) {
    console.log('No se pudo guardar el estado del permiso de escucha:', e);
  }

  // Primera vez que se mira: no hay transicion, solo un punto de partida. Aqui
  // es donde se evita darle la lata a quien nunca concedio el permiso.
  if (previo === null) return { cambio: null, permiso };

  if (!permiso) {
    // Solo notificacion: perder el permiso es un hecho de la app, no de un
    // sismo, y la bitacora es solo de sismos.
    await notificarEscuchaPerdida();
    return { cambio: 'perdido', permiso };
  }

  await notificarEscuchaActiva();
  return { cambio: 'activa', permiso };
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
