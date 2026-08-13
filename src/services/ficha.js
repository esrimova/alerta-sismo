// src/services/ficha.js
//
// La ficha de triaje: lo que recibe automáticamente quien te encuentre por la
// malla cuando el protocolo de emergencia está activo.
//
// EL CASO DE USO QUE ESTO RESUELVE: pierdes el conocimiento, la baliza se
// activa sola, alguien cerca la ve e instala bitchat. Esa persona no te conoce,
// no sabe qué te pasó y no puede preguntarte nada. La ficha le da en un solo
// mensaje lo que tú no puedes contarle.
//
// DOS DATOS QUE NADIE MÁS PUEDE OBTENER, y por eso son el corazón de la ficha:
//
//  - La BATERÍA marca el plazo en que tu señal va a dejar de existir. Un 8%
//    dice que quedan minutos; un 80% dice que hay tiempo. Es lo que permite
//    priorizar un rescate frente a otro.
//  - El TIEMPO TRANSCURRIDO desde la activación dice cuánto llevas así. Media
//    hora y ocho horas son situaciones clínicas distintas.
//
// Lo demás —edad, sangre, alergias— también está en tu billetera. Estos dos no
// están en ninguna parte más que aquí.
//
// REGLA DE PRIVACIDAD, INNEGOCIABLE: esto solo existe mientras el modo
// emergencia está activo. Componer la ficha fuera de emergencia convierte la
// app en una fuga de historia clínica hacia cualquiera en rango de Bluetooth.
// Quien llame a estas funciones tiene que haberlo verificado antes.

import { nivelBateria } from '../../modules/emergencia';
import { getDistanceFromLatLonInKm } from '../utils/haversine';

/**
 * Dos bloques de texto libre, no un formulario de ocho campos.
 *
 * Van separados por una razón concreta y no por estética: el bloque de casa
 * SOLO se envía si el teléfono cree que estás en casa. Si fuera un único bloque
 * no habría forma de mandar tus datos médicos sin mandar también tu dirección.
 */
export const FICHA_DEFECTO = {
  /** Edad, sangre, alergias, medicamentos, lo que sea. Texto libre. */
  medicos: '',
  /** Apartamento, piso, referencia. Solo sale si estás allí. */
  casa: '',
  /** Coordenadas de casa, para decidir si estás en ella. */
  casaLat: null,
  casaLon: null,
};

/** Límite del anuncio BLE: 31 bytes de paquete, y el nombre es lo único que cabe. */
export const MAX_BALIZA = 26;

/**
 * Radio para dar por buena la cercanía a casa.
 *
 * 1,5 km parece enorme para "estoy en mi apartamento", y lo es. No es un radio
 * de precisión sino un umbral de DESCARTE, y está calibrado sobre lo que el
 * permiso permite: la app usa ACCESS_COARSE_LOCATION con precisión mínima, que
 * ubica en el orden de kilómetros. Con FINE se podría afinar, pero ese permiso
 * está bloqueado a propósito.
 *
 * La asimetría es lo que hace útil el umbral: a 20 km es CIERTO que no estás en
 * casa, y ese es el error peligroso —mandar a un rescatista a tu edificio
 * cuando estás en la calle—. Dentro del radio solo es probable, y por eso el
 * mensaje nunca lo afirma como un hecho.
 */
export const RADIO_CASA_KM = 1.5;

/**
 * A partir de cuántas horas la ubicación guardada deja de ser fiable.
 *
 * La app solo lee el GPS con la aplicación abierta, como mucho cada 12 horas:
 * pedir ubicación en segundo plano exigiría un permiso mucho más intrusivo. La
 * consecuencia es real y hay que asumirla: si sales de casa y no abres la app,
 * el teléfono sigue creyendo que estás allí.
 */
export const FRESCURA_MAX_H = 12;

/**
 * ¿Está el usuario en su casa?
 *
 * Devuelve `true`, `false` o `null` cuando no se puede saber. El null no es un
 * detalle: es la diferencia entre callar una dirección y afirmarla en falso.
 */
export function evaluarSiEstaEnCasa(cfg, ubicacion) {
  const f = { ...FICHA_DEFECTO, ...(cfg?.ficha || {}) };

  if (f.casaLat == null || f.casaLon == null) {
    return { enCasa: null, motivo: 'sin_casa_marcada', distanciaKm: null };
  }
  if (!ubicacion || ubicacion.lat == null) {
    return { enCasa: null, motivo: 'sin_ubicacion', distanciaKm: null };
  }

  const distanciaKm = getDistanceFromLatLonInKm(
    f.casaLat, f.casaLon, ubicacion.lat, ubicacion.lon
  );

  const horas = ubicacion.at ? (Date.now() - ubicacion.at) / 3600000 : Infinity;

  // Lejos es lejos aunque el dato sea viejo: si hace diez horas estabas a 40 km,
  // afirmar tu dirección de casa sigue siendo temerario.
  if (distanciaKm > RADIO_CASA_KM) {
    return { enCasa: false, motivo: 'lejos', distanciaKm };
  }
  if (horas > FRESCURA_MAX_H) {
    return { enCasa: null, motivo: 'ubicacion_vieja', distanciaKm };
  }
  return { enCasa: true, motivo: 'cerca', distanciaKm };
}

/**
 * Texto por defecto de la baliza.
 *
 * Lleva a la vez el APARTAMENTO y el puntero al canal, que es la tensión real
 * de estos 26 caracteres: el apartamento es lo accionable para quien está
 * parado en el edificio, y "bitchat" es lo que lleva a todo lo demás.
 *
 * El teléfono se retiró de la baliza a propósito: si la red celular funciona,
 * el afectado habría podido pedir ayuda él mismo; si no funciona, un número no
 * sirve de nada.
 */
export function balizaPorDefecto(cfg) {
  const nombre = (cfg?.miNombre || '').trim().split(/\s+/)[0] || '';
  const partes = ['SOS'];
  if (nombre) partes.push(nombre);
  const apto = primeraSeña(cfg?.ficha?.casa);
  if (apto) partes.push(apto);
  partes.push('bitchat');
  return recortarBaliza(partes.join(' '));
}

/**
 * Saca una seña corta del bloque de casa para meterla en los 26 caracteres.
 * Busca un número de apartamento; si no lo encuentra, no inventa nada.
 */
function primeraSeña(textoCasa) {
  const t = (textoCasa || '').trim();
  if (!t) return null;
  const m = t.match(/(?:apto|apartamento|apt|casa)\.?\s*#?\s*(\w{1,5})/i);
  if (m) return `ap${m[1]}`;
  const soloNumero = t.match(/\b(\d{2,5})\b/);
  return soloNumero ? `ap${soloNumero[1]}` : null;
}

/** Recorta al límite del anuncio, sin cortar a mitad de palabra si se puede. */
export function recortarBaliza(texto) {
  const t = (texto || '').trim();
  if (t.length <= MAX_BALIZA) return t;
  const corte = t.slice(0, MAX_BALIZA);
  const ultimo = corte.lastIndexOf(' ');
  // Solo se corta por palabra si eso no tira más de un tercio del texto: si no,
  // es peor un texto mutilado que uno cortado a mitad de palabra.
  if (ultimo > MAX_BALIZA * 0.66) return corte.slice(0, ultimo);
  return corte;
}

/** Duración legible en palabras, para quien lee con prisa. */
function haceCuanto(ms) {
  if (!ms || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'menos de un minuto';
  if (min < 60) return `${min} minuto${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (h < 24) return resto ? `${h} h ${resto} min` : `${h} hora${h === 1 ? '' : 's'}`;
  const d = Math.floor(h / 24);
  return `${d} día${d === 1 ? '' : 's'} y ${h % 24} h`;
}

/**
 * Compone el mensaje que se envía por la malla.
 *
 * Va en secciones cortas y encabezados en mayúscula porque quien lo lee lo hace
 * con prisa, probablemente de pie y en malas condiciones.
 *
 * LA DIRECCIÓN DE CASA SOLO SALE SI EL TELÉFONO CREE QUE ESTÁS EN ELLA. Mandar
 * "apartamento 715" cuando estás en la calle no es información incompleta: es
 * información falsa, y manda a quien te busca al lugar equivocado. Cuando no se
 * puede saber, se dice que no se pudo saber en vez de elegir por el usuario.
 */
export function componerFicha(cfg, estado, ubicacion = null) {
  const f = { ...FICHA_DEFECTO, ...(cfg?.ficha || {}) };
  const nombre = (cfg?.miNombre || '').trim();
  const bloques = [];

  bloques.push('⚠️ MENSAJE AUTOMÁTICO — no lo escribió una persona.');

  const quien = nombre ? `Soy ${nombre}.` : 'Soy el dueño de este teléfono.';
  bloques.push(
    `${quien} Es posible que no esté consciente. Mi teléfono envió esto solo, ` +
    'porque no confirmé estar bien después de un sismo.'
  );

  // DÓNDE ESTOY va primero: es lo que decide si quien lee puede hacer algo.
  const casa = evaluarSiEstaEnCasa(cfg, ubicacion);
  const donde = [];

  if (f.casa && casa.enCasa === true) {
    donde.push(f.casa);
  } else if (f.casa && casa.enCasa === null) {
    // Se ofrece, pero marcada como no confirmada. Ocultarla del todo perdería
    // el único dato de dirección que existe; afirmarla sería mentir.
    donde.push(`No pude confirmar dónde estoy. Si no me he movido, vivo en: ${f.casa}`);
  } else if (casa.enCasa === false) {
    donde.push('NO estoy en mi casa. Mi dirección habitual no sirve para buscarme.');
  }

  if (ubicacion?.lat != null) {
    const edadH = ubicacion.at ? (Date.now() - ubicacion.at) / 3600000 : null;
    const cuando = edadH != null && edadH > 1
      ? ` (leída hace ${Math.round(edadH)} h)`
      : '';
    donde.push(
      `Ubicación aproximada: ${ubicacion.lat.toFixed(4)}, ${ubicacion.lon.toFixed(4)}${cuando}` +
      (ubicacion.etiqueta ? ` — ${ubicacion.etiqueta}` : '')
    );
  } else {
    donde.push('Mi teléfono no tiene una ubicación reciente.');
  }

  // Recordatorio del alcance: si te llegó esto por Bluetooth, está cerca.
  donde.push('Si recibes esto por la malla, estoy a pocos metros o a pocos saltos.');
  bloques.push(`DÓNDE ESTOY\n${donde.join('\n')}`);

  if (f.medicos.trim()) {
    bloques.push(`DATOS MÉDICOS\n${f.medicos.trim()}`);
  }

  // Los dos datos que no están en ninguna otra parte.
  const situacion = [];
  const desde = estado?.activadaEn ? haceCuanto(Date.now() - estado.activadaEn) : null;
  if (desde) situacion.push(`Llevo así: ${desde}`);
  let bat = null;
  try {
    bat = nivelBateria();
  } catch (e) {
    bat = null;
  }
  if (bat?.porcentaje != null) {
    situacion.push(
      `Batería del teléfono: ${bat.porcentaje}%${bat.cargando ? ' (cargando)' : ''}. ` +
      'Cuando se agote, esta señal desaparece.'
    );
  }
  if (situacion.length) bloques.push(`SITUACIÓN\n${situacion.join('\n')}`);

  if (cfg?.contactoTelefono) {
    const c = cfg.contactoNombre ? `${cfg.contactoNombre} ` : '';
    bloques.push(`CONTACTO DE EMERGENCIA\n${c}${cfg.contactoTelefono}`);
  }

  bloques.push(
    'Si puedo, te escribiré por mi cuenta. Si no respondo, asume que no puedo hacerlo.'
  );

  return bloques.join('\n\n');
}

/**
 * ¿Hay algo que valga la pena enviar?
 *
 * Una ficha sin ningún dato es peor que ninguna ficha: gasta el canal y hace
 * creer a quien la recibe que ya tiene la información.
 */
export function fichaTieneContenido(cfg) {
  const f = { ...FICHA_DEFECTO, ...(cfg?.ficha || {}) };
  return Boolean(f.medicos.trim() || f.casa.trim());
}
