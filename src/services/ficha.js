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

/** Campos de la ficha. Todos opcionales: se envía lo que haya. */
export const FICHA_DEFECTO = {
  edad: '',
  tipoSangre: '',
  alergias: '',
  medicamentos: '',
  piso: '',
  apartamento: '',
  /** Referencia para quien no conoce la dirección: "Torre 3, frente al parque". */
  referencia: '',
  /** Cualquier cosa que no encaje arriba: condiciones, prótesis, idioma. */
  notas: '',
};

/** Límite del anuncio BLE: 31 bytes de paquete, y el nombre es lo único que cabe. */
export const MAX_BALIZA = 26;

/**
 * Texto por defecto de la baliza.
 *
 * Lleva a la vez el APARTAMENTO y el puntero al canal, que es la tensión real
 * de estos 26 caracteres: el apartamento es lo accionable para quien está
 * parado en el edificio, y "bitchat" es lo que lleva a todo lo demás. Se
 * abrevian los dos antes que soltar uno.
 *
 * El teléfono se retiró de la baliza a propósito: si la red celular funciona,
 * el afectado habría podido pedir ayuda él mismo; si no funciona, un número no
 * sirve de nada.
 */
export function balizaPorDefecto(cfg) {
  const nombre = (cfg?.miNombre || '').trim().split(/\s+/)[0] || '';
  const apto = (cfg?.ficha?.apartamento || '').trim();
  const partes = ['SOS'];
  if (nombre) partes.push(nombre);
  if (apto) partes.push(`ap${apto}`);
  partes.push('bitchat');
  return recortarBaliza(partes.join(' '));
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
 * con prisa, probablemente de pie y en malas condiciones. Un párrafo corrido
 * obligaría a leerlo entero para encontrar el tipo de sangre.
 *
 * Los campos vacíos se OMITEN en vez de mostrarse en blanco: una línea que dice
 * "Alergias:" sin nada detrás es ambigua —¿no tiene, o no lo sabemos?— y en un
 * triaje esa ambigüedad es peligrosa.
 *
 * @param cfg configuración de emergencia, con la ficha dentro
 * @param estado estado del protocolo, para saber desde cuándo está activo
 * @param ubicacion última ubicación conocida, si el usuario la tiene activada
 */
export function componerFicha(cfg, estado, ubicacion = null) {
  const f = { ...FICHA_DEFECTO, ...(cfg?.ficha || {}) };
  const nombre = (cfg?.miNombre || '').trim();
  const bloques = [];

  bloques.push(
    '⚠️ MENSAJE AUTOMÁTICO — no lo escribió una persona.'
  );

  const quien = nombre ? `Soy ${nombre}.` : 'Soy el dueño de este teléfono.';
  bloques.push(
    `${quien} Es posible que no esté consciente. Mi teléfono envió esto solo, ` +
    'porque no confirmé estar bien después de un sismo.'
  );

  // DÓNDE ESTOY va primero: es lo que decide si quien lee puede hacer algo.
  const donde = [];
  if (f.apartamento) donde.push(`Apartamento ${f.apartamento}`);
  if (f.piso) donde.push(`Piso ${f.piso}`);
  if (f.referencia) donde.push(f.referencia);
  if (ubicacion?.lat != null) {
    donde.push(`Coordenadas aproximadas: ${ubicacion.lat.toFixed(4)}, ${ubicacion.lon.toFixed(4)}`);
  }
  // Recordatorio del alcance: si te llegó esto por Bluetooth, está cerca.
  donde.push('Si recibes esto por la malla, estoy a pocos metros o a pocos saltos.');
  bloques.push(`DÓNDE ESTOY\n${donde.join('\n')}`);

  const medicos = [];
  if (f.edad) medicos.push(`Edad: ${f.edad}`);
  if (f.tipoSangre) medicos.push(`Tipo de sangre: ${f.tipoSangre}`);
  if (f.alergias) medicos.push(`Alergias: ${f.alergias}`);
  if (f.medicamentos) medicos.push(`Medicamentos de los que dependo: ${f.medicamentos}`);
  if (f.notas) medicos.push(f.notas);
  if (medicos.length) bloques.push(`DATOS MÉDICOS\n${medicos.join('\n')}`);

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
  return Object.values(f).some((v) => String(v || '').trim() !== '');
}
