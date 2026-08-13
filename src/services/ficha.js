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
  /**
   * Quién más vive aquí. Va atado a la misma regla que la dirección: si el
   * usuario no está en casa, no se envía. Decirle a un rescatista "aquí también
   * vive mi madre" cuando el afectado está a veinte kilómetros lo mandaría a
   * buscar a alguien que no corre peligro, y peor, le haría perder tiempo.
   */
  convivientes: '',
  /** Coordenadas de casa, para decidir si estás en ella. */
  casaLat: null,
  casaLon: null,
};

/** Un contacto de emergencia. La configuración guarda una lista de estos. */
export const CONTACTO_DEFECTO = { nombre: '', telefono: '' };

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

/**
 * Fecha y hora en el formato que se usa hablando: "el 13 de agosto a las 4:15 p. m.".
 *
 * Lleva la fecha aunque sea de hoy. Este mensaje puede leerse horas despues de
 * haberse enviado —la malla lo retiene y lo entrega cuando el destinatario
 * reaparece— asi que "a las 4:15" sin mas obligaria a quien lo lee a adivinar
 * de que dia habla. En una emergencia esa duda cuesta.
 */
function fechaYHoraDe(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    const fecha = d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
    const hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    return `el ${fecha} a las ${hora}`;
  } catch (e) {
    return null;
  }
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
export function componerFicha(cfg, estado, ubicacion = null, red = null) {
  const f = { ...FICHA_DEFECTO, ...(cfg?.ficha || {}) };
  const nombre = (cfg?.miNombre || '').trim();
  const bloques = [];

  bloques.push('⚠️ MENSAJE AUTOMÁTICO — no lo escribió una persona.');

  // Lo primero tiene que ser quién es y qué necesita. La versión anterior
  // explicaba el mecanismo —"no confirmé estar bien después de un sismo"— y eso
  // no significa nada para alguien que acaba de instalar una app para ayudar:
  // obliga a descifrar cómo funciona la app antes de entender que hay una
  // persona en problemas.
  // Desde cuándo no responde, en fecha y hora. Se dice así y no solo en "hace
  // tanto" porque quien lee puede cruzarlo con lo que ya sabe: cuándo fue el
  // sismo, cuándo se cayó la luz, cuándo habló con él por última vez. Un "hace
  // 2 horas" no se cruza con nada, y además envejece si el mensaje se retiene.
  const sinResponderDesde = fechaYHoraDe(estado?.activadaEn);
  const quien = nombre ? `Soy ${nombre} y necesito ayuda.` : 'Necesito ayuda.';
  bloques.push(
    `${quien} Es posible que esté inconsciente o atrapado` +
    (sinResponderDesde ? ` desde ${sinResponderDesde}` : '') +
    ': este mensaje lo envió mi teléfono por su cuenta, al ver que yo no respondía.'
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

  // POR DONDE SEGUIR HABLANDO. No es un dato de color: es la instrucción más
  // accionable del mensaje. Esta malla es Bluetooth de varios saltos y es
  // frágil; si hay salida a internet, conviene pasarse a un canal que aguante.
  // Y si no la hay, decirlo evita que quien ayuda pierda tiempo escribiendo a
  // un número que no va a recibir nada.
  const canal = componerCanal(cfg, red);
  if (canal) bloques.push(`CÓMO SEGUIR EN CONTACTO\n${canal}`);

  const contactos = (cfg?.contactos || [])
    .filter((c) => String(c?.telefono || '').trim())
    .map((c) => {
      const n = String(c.nombre || '').trim();
      return n ? `${n} — ${String(c.telefono).trim()}` : String(c.telefono).trim();
    });
  if (contactos.length) {
    const titulo = contactos.length === 1 ? 'CONTACTO DE EMERGENCIA' : 'CONTACTOS DE EMERGENCIA';
    bloques.push(`${titulo}\n${contactos.join('\n')}`);
  }

  // Va atado a la misma regla que la dirección y por el mismo motivo: decirle a
  // quien ayuda "aquí también vive mi madre" cuando el afectado está a veinte
  // kilómetros lo manda a buscar a alguien que no corre peligro.
  if (f.convivientes.trim() && casa.enCasa !== false) {
    const encabezado = casa.enCasa === true
      ? 'EN ESTA CASA TAMBIÉN VIVEN'
      : 'SI ESTOY EN CASA, AQUÍ TAMBIÉN VIVEN';
    bloques.push(`${encabezado}\n${f.convivientes.trim()}`);
  }

  bloques.push(
    'Si puedo, te escribiré por mi cuenta. Si no respondo, asume que no puedo hacerlo.'
  );

  return bloques.join('\n\n');
}

/**
 * Qué decir sobre por dónde seguir hablando.
 *
 * Tres casos, y ninguno se puede colapsar en otro:
 *
 *  - CON internet: hay un canal mejor que este, y hay que ofrecerlo. Además
 *    dice algo que no dice ningún otro dato: si el teléfono tiene salida y aun
 *    así nadie responde, el silencio no es de la red sino de la persona.
 *  - SIN internet: esta malla es lo único que queda. Decirlo evita que quien
 *    ayuda pierda minutos escribiendo a un número inalcanzable.
 *  - SIN SABER: no se afirma nada. Prometer un canal que quizá no exista, o
 *    negar uno que quizá sí, son los dos errores caros.
 */
function componerCanal(cfg, red) {
  if (!red?.verificado) return null;

  const mio = String(cfg?.miTelefono || '').trim();

  if (red.conectado) {
    const lineas = [];
    if (mio) {
      lineas.push(
        `Mi teléfono tiene internet. Escríbeme por WhatsApp al ${mio}: esa vía ` +
        'aguanta mucho mejor que esta red y no depende de que sigas cerca.'
      );
    } else {
      lineas.push('Mi teléfono tiene internet, así que puede recibir mensajes.');
    }
    lineas.push(
      'Que no responda no es falta de señal: es que no puedo contestar.'
    );
    return lineas.join('\n');
  }

  // Sin internet no se ofrece el WhatsApp: mandar a alguien a escribir a un
  // numero inalcanzable le hace perder minutos. Y se le advierte de lo que de
  // verdad importa aqui, que es que este canal depende de la distancia.
  const cabecera = red.avion
    ? 'Mi teléfono está en modo avión, así que no tengo internet.'
    : 'Mi teléfono no tiene internet.';

  return (
    `${cabecera} Esta red funciona por Bluetooth, así que si te alejas nos ` +
    'quedamos incomunicados.\n' +
    'Aunque es posible que esté inconsciente, déjame las instrucciones que ' +
    'necesite: en cuanto pueda te contestaré.'
  );
}

/**
 * ¿Hay algo que valga la pena enviar?
 *
 * Una ficha sin ningún dato es peor que ninguna ficha: gasta el canal y hace
 * creer a quien la recibe que ya tiene la información.
 */
export function fichaTieneContenido(cfg) {
  const f = { ...FICHA_DEFECTO, ...(cfg?.ficha || {}) };
  const hayContacto = (cfg?.contactos || []).some((c) => String(c?.telefono || '').trim());
  return Boolean(f.medicos.trim() || f.casa.trim() || f.convivientes.trim() || hayContacto);
}
