// src/services/emergencia.js
//
// Protocolo de "hombre muerto": tras una Informativa de Emergencia (sismo
// fuerte Y cercano), arranca un temporizador. Si el usuario no pulsa
// "Estoy bien" antes de que venza, se asume que puede estar incapacitado y
// se activan los mecanismos de localizacion.
//
// Por que estos dos mecanismos:
//  1. Baliza Bluetooth   -> alcanza a quien esta cerca, SIN red. Aparece en la
//     lista de Bluetooth de cualquier telefono, sin apps ni emparejamiento.
//  2. Baliza sonora      -> a las personas bajo escombros se las encuentra por
//     sonido. Es el mecanismo mas probado de los dos.
//
// Hubo un tercer mecanismo, el SMS automatico, que se retiro: Android no
// concede SEND_SMS a esta app, asi que el envio nunca llegaba a ocurrir y solo
// aportaba la ilusion de un aviso remoto que no existia. Los dos mecanismos
// que quedan son de alcance local y no dependen de red ni de permisos que el
// sistema niega.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import {
  iniciarBaliza, detenerBaliza, estadoBluetooth,
  estadoMalla, activarMalla, desactivarMalla,
  subirVolumenBaliza, restaurarVolumen, nivelBateria, hablar,
} from '../../modules/emergencia';
import { cargarUbicacionGuardada } from './location';
import { verificarInternet } from './red';
import { despertarAhora } from './despertador';
import { episodioAbierto } from './episodio';
import { SOUND_URLS } from './alert';
import { registrarEvento, TIPO } from './bitacora';
import { FICHA_DEFECTO, balizaPorDefecto, recortarBaliza, componerFicha, fichaTieneContenido } from './ficha';

const CONFIG_KEY = 'alerta_sismo_emergencia_v1';
const ESTADO_KEY = 'alerta_sismo_emergencia_estado_v1';

export const MINUTOS_ESPERA_DEFECTO = 60;

export const CONFIG_DEFECTO = {
  activo: false,
  /** Nombre y apellido: quien lo lee no conoce al afectado. */
  miNombre: '',
  /**
   * El telefono del PROPIO usuario, no el de un contacto.
   *
   * Solo se ofrece cuando se ha confirmado que hay salida a internet, y sirve
   * para que quien lo encuentre se pase a un canal mas estable que la malla:
   * un mensaje por WhatsApp aguanta lo que una malla Bluetooth de varios saltos
   * no aguanta. Sin internet no se muestra, porque mandar a alguien a escribir
   * a un numero inalcanzable es peor que no darselo.
   */
  miTelefono: '',
  /**
   * Varios contactos, no uno. Si hay un sismo, el unico contacto podria estar
   * igual de incomunicado que el afectado: son vecinos o familia y comparten
   * la misma zona y la misma caida de red.
   */
  contactos: [],
  minutosEspera: MINUTOS_ESPERA_DEFECTO,
  usarBluetooth: true,
  usarSonido: true,
  /**
   * Texto de la baliza. Vacio = se genera solo a partir del nombre y el
   * apartamento. Es editable porque el texto util depende de donde estes: en
   * casa manda el apartamento, fuera de casa no significa nada.
   */
  textoBaliza: '',
  /** Ficha de triaje. Ver src/services/ficha.js. */
  ficha: { ...FICHA_DEFECTO },
};

/**
 * Descarta claves que ya no existen. Sin esto, las instalaciones que vienen de
 * la version con SMS seguirian arrastrando telefonosSms, usarSms y simSubId
 * para siempre, porque la carga fusiona lo guardado sobre los valores por
 * defecto y nunca elimina nada.
 */
function sanear(guardada) {
  const limpia = { ...CONFIG_DEFECTO };
  for (const clave of Object.keys(CONFIG_DEFECTO)) {
    if (guardada[clave] !== undefined) limpia[clave] = guardada[clave];
  }
  // La ficha se fusiona campo a campo y descartando claves desconocidas, por el
  // mismo motivo que el resto: copiarla entera dejaria sin valor por defecto a
  // cualquier campo nuevo —que llegaria como undefined justo al componer el
  // mensaje de emergencia— y arrastraria para siempre los campos del formulario
  // largo que se sustituyo por dos bloques de texto.
  const fichaGuardada = guardada.ficha || {};
  limpia.ficha = { ...FICHA_DEFECTO };
  for (const clave of Object.keys(FICHA_DEFECTO)) {
    if (fichaGuardada[clave] !== undefined) limpia.ficha[clave] = fichaGuardada[clave];
  }

  // El contacto unico paso a ser una lista. Sin este traspaso, quien ya tenia
  // la app perderia el telefono que habia configurado —el unico dato que
  // permite avisar a su familia— al actualizar, y no se enteraria hasta la
  // emergencia.
  if (!Array.isArray(limpia.contactos) || limpia.contactos.length === 0) {
    const viejoTel = String(guardada.contactoTelefono || '').trim();
    limpia.contactos = viejoTel
      ? [{ nombre: String(guardada.contactoNombre || '').trim(), telefono: viejoTel }]
      : [];
  }
  limpia.contactos = limpia.contactos
    .map((c) => ({
      nombre: String(c?.nombre || '').trim(),
      telefono: String(c?.telefono || '').trim(),
    }))
    .filter((c) => c.nombre || c.telefono);

  return limpia;
}

export async function cargarConfigEmergencia() {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...CONFIG_DEFECTO };

    const guardada = JSON.parse(raw);
    const limpia = sanear(guardada);
    // Si sobraban claves, se reescribe para que la limpieza sea permanente.
    if (Object.keys(guardada).length !== Object.keys(limpia).length) {
      await guardarConfigEmergencia(limpia);
    }
    return limpia;
  } catch (e) {
    return { ...CONFIG_DEFECTO };
  }
}

export async function guardarConfigEmergencia(cfg) {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export async function cargarEstadoEmergencia() {
  try {
    const raw = await AsyncStorage.getItem(ESTADO_KEY);
    return raw ? JSON.parse(raw) : { esperandoConfirmacion: false, venceEn: null, activada: false };
  } catch (e) {
    return { esperandoConfirmacion: false, venceEn: null, activada: false };
  }
}

async function guardarEstado(e) {
  await AsyncStorage.setItem(ESTADO_KEY, JSON.stringify(e));
}

/** Arranca el temporizador tras un sismo fuerte y cercano. */
export async function iniciarCuentaAtras(evento) {
  const cfg = await cargarConfigEmergencia();
  if (!cfg.activo) return null;

  const venceEn = Date.now() + cfg.minutosEspera * 60000;
  await guardarEstado({
    esperandoConfirmacion: true,
    venceEn,
    activada: false,
    evento: evento ? `M${evento.properties.mag} ${evento.properties.place}` : null,
  });

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '¿Estás bien?',
      body: `Confirma en la app antes de ${cfg.minutosEspera} minutos. Si no, se activarán las balizas de localización.`,
      sound: true,
    },
    trigger: null,
  });

  registrarEvento({
    tipo: TIPO.PROTOCOLO,
    subtipo: 'cuenta_atras_iniciada',
    minutosEspera: cfg.minutosEspera,
    venceEn,
    sismo: evento
      ? { id: evento.id, mag: evento.properties.mag, lugar: evento.properties.place }
      : null,
    detalle: `Se inició la cuenta atrás de "Estoy bien": ${cfg.minutosEspera} minutos.`,
  });

  return venceEn;
}

/** El usuario confirmo que esta bien: se cancela todo. */
export async function confirmarEstoyBien() {
  const previo = await cargarEstadoEmergencia();
  await guardarEstado({ esperandoConfirmacion: false, venceEn: null, activada: false });
  detenerSonido();
  try { detenerBaliza(); } catch (e) {}

  // Apaga la malla y hace que bitchat BORRE la ficha de su lado. Dejarla
  // guardada seria dejar datos medicos en una app que ya no los necesita, y a
  // merced de que un fallo posterior volviera a encender el modo por error.
  let malla = null;
  try { malla = desactivarMalla(); } catch (e) { malla = { ok: false, motivo: 'excepcion' }; }

  // El usuario vuelve a poder actuar, asi que el monitoreo tiene que volver a
  // su ritmo normal AHORA y no cuando venza la espera larga: con el protocolo
  // disparado el bucle consulta cada 15 minutos, y quedarse asi mientras la
  // secuencia sismica sigue viva seria dejarlo ciego justo al recuperarse.
  const bucleDespertado = despertarAhora();

  // Que el usuario este bien no significa que el sismo haya terminado. Si
  // todavia hay un episodio abierto se deja constancia, porque el estado al que
  // vuelve la app no es el mismo en un caso que en otro.
  let episodio = null;
  try { episodio = await episodioAbierto(); } catch (e) { episodio = null; }

  registrarEvento({
    tipo: TIPO.PROTOCOLO,
    subtipo: 'estoy_bien',
    malla,
    bucleDespertado,
    sismoEnCurso: !!episodio,
    episodioId: episodio?.id || null,
    // Cuanto tardo en confirmar. Si el protocolo ya se habia activado, indica
    // que la confirmacion llego tarde.
    trasActivacion: !!previo.activada,
    detalle: previo.activada
      ? `El usuario confirmó estar bien DESPUÉS de que el protocolo se activara. Balizas apagadas y monitoreo de vuelta a ritmo normal${episodio ? ', con el sismo todavía en curso.' : '.'}`
      : 'El usuario confirmó estar bien. Se canceló la cuenta atrás.',
  });

  return true;
}

let reproductorSos = null;
let intervaloSonido = null;
/** Temporizador del paso actual dentro de una emision (sirena o voz). */
let pasoBaliza = null;

/**
 * Cada cuanto suena la baliza, segun lo que lleve activa.
 *
 * No es un intervalo fijo porque el problema cambia con el tiempo. En la primera
 * hora quien busca son vecinos que estan al lado AHORA, y ahi conviene sonar
 * seguido. Pasado ese rato el rescate se mide en dias, y lo que decide si te
 * encuentran deja de ser la frecuencia y pasa a ser cuanto dura la bateria: una
 * baliza que suena cada 30 s y muere en 8 horas pierde contra una que suena cada
 * media hora durante tres dias.
 *
 * El ultimo tramo es la cadencia de regimen. Los anteriores solo existen para
 * cubrir la ventana en la que todavia hay alguien cerca.
 */
const TRAMOS_SONIDO = [
  { hastaMin: 60, cadaSeg: 30 },
  { hastaMin: 240, cadaSeg: 300 },
  { hastaMin: Infinity, cadaSeg: 1800 },
];

/**
 * Lo que dice la voz de la baliza.
 *
 * Es una INSTRUCCION, no una queja. Quien oye esto no sabe que hacer con la
 * informacion de que hay alguien atrapado; si sabe que hacer con "instala
 * bitchat", porque por ahi llega la ficha con quien es, donde esta y que le
 * pasa.
 *
 * El nombre sale de la configuracion y no esta fijado en el codigo: la app se
 * instala en telefonos de familiares, y una voz que grita el nombre equivocado
 * es peor que una que no diga ninguno. Solo el nombre de pila, que es lo que se
 * entiende a traves de una losa.
 */
function fraseBaliza(cfg) {
  const nombre = String(cfg?.miNombre || '').trim().split(/\s+/)[0];
  return nombre
    ? `Auxilio. Soy ${nombre}. Instala bitchat para ayudarme.`
    : 'Auxilio. Instala bitchat para ayudarme.';
}

/**
 * Que sirena acompaña a la voz.
 *
 * La de ambulancia y no 'sirena_fuerte': aquella es un tono corto en bucle que
 * suena a alarma de electrodomestico, y lo que hace falta aqui es algo que
 * cualquiera reconozca como emergencia sin pensarlo. Ademas su barrido de
 * frecuencias se distingue mejor del ruido de fondo de un derrumbe que un tono
 * plano.
 */
const SIRENA_BALIZA = 'sirena_ambulancia';

/** Cuantas veces se repite el par sirena + voz en cada emision. */
const REPETICIONES = 3;

/** Cuanto se deja sonar la sirena antes de hablar, y la voz antes de repetir. */
const DURACION_SIRENA_MS = 5000;
const DURACION_VOZ_MS = 5000;

/**
 * Piso de cadencia segun la carga que queda.
 *
 * El tramo por tiempo da por hecho que se empieza con bateria. Si la emergencia
 * arranca al 15%, sonar cada 30 s durante la primera hora apaga el telefono
 * antes de que llegue nadie: se pierden a la vez la baliza, la malla y la
 * posibilidad de pedir ayuda. Con poca carga, cada emision cuesta minutos de
 * seguir existiendo.
 *
 * LOS UMBRALES SON ALTOS A PROPOSITO. La baliza sonora no es la unica que gasta:
 * durante la emergencia tambien corren el anuncio Bluetooth continuo, el
 * escaneo de la malla y el servicio en primer plano, y el usuario esta
 * inconsciente y no va a enchufar nada. La carga baja sola aunque la baliza
 * callara, asi que empezar a racionar al 50% llegaba tarde. Se raciona desde el
 * 80%, cuando todavia queda margen para estirar.
 *
 * Manda SIEMPRE el mas lento de los dos criterios. Con bateria de sobra no
 * estorba; con bateria escasa se impone al reloj.
 */
const TRAMOS_BATERIA = [
  { desdePct: 80, minimoSeg: 0 },      // holgado: manda el tiempo
  { desdePct: 60, minimoSeg: 300 },    // 5 min
  { desdePct: 40, minimoSeg: 1800 },   // media hora
  { desdePct: 0, minimoSeg: 3600 },    // una hora
];

function minimoPorBateria() {
  let bat = null;
  try { bat = nivelBateria(); } catch (e) { bat = null; }

  // Enchufado no hay nada que racionar: si entra corriente, la carga deja de
  // ser el recurso escaso.
  if (bat?.cargando) return 0;

  // Sin lectura se deja mandar al reloj. La lectura casi nunca falla, y asumir
  // lo peor penalizaria a un telefono lleno justo en la hora que mas importa.
  if (bat?.porcentaje == null) return 0;

  const tramo = TRAMOS_BATERIA.find((t) => bat.porcentaje >= t.desdePct)
    || TRAMOS_BATERIA[TRAMOS_BATERIA.length - 1];
  return tramo.minimoSeg * 1000;
}

/**
 * Cuanto esperar hasta la siguiente emision.
 *
 * Se recalcula en CADA emision, asi que la cadencia se va frenando sola a medida
 * que baja la carga, sin necesidad de vigilar la bateria por separado.
 */
function cadenciaSonido(desdeMs) {
  const min = (Date.now() - desdeMs) / 60000;
  const tramo = TRAMOS_SONIDO.find((t) => min < t.hastaMin) || TRAMOS_SONIDO[TRAMOS_SONIDO.length - 1];
  return Math.max(tramo.cadaSeg * 1000, minimoPorBateria());
}

function sonarSirena() {
  try {
    if (reproductorSos) {
      try { reproductorSos.remove(); } catch (e) {}
    }
    reproductorSos = createAudioPlayer(SOUND_URLS[SIRENA_BALIZA]);
    reproductorSos.volume = 1.0;
    reproductorSos.loop = true; // se corta por tiempo, no por duracion del clip
    reproductorSos.play();
  } catch (e) {
    console.log('No se pudo emitir la sirena:', e);
  }
}

function callarSirena() {
  if (reproductorSos) {
    try { reproductorSos.pause(); } catch (e) {}
    try { reproductorSos.remove(); } catch (e) {}
    reproductorSos = null;
  }
}

/**
 * Una emision de la baliza: sirena y voz, alternadas tres veces.
 *
 * POR QUE LAS DOS COSAS Y NO SOLO UNA. La sirena atraviesa mejor los escombros y
 * se oye de lejos, pero no dice nada: quien la oye sabe que hay alguien y no
 * sabe que hacer. La voz sí da una instruccion, pero se pierde antes con la
 * distancia y el ruido. Alternadas, la sirena trae a la persona y la voz le dice
 * que hacer cuando ya esta cerca.
 *
 * Cada tramo dura cinco segundos porque un pitido corto se confunde con
 * cualquier otra cosa entre los ruidos de un derrumbe.
 */
function emitirBaliza(frase, alTerminar, indice = 0) {
  if (indice >= REPETICIONES) {
    callarSirena();
    if (alTerminar) alTerminar();
    return;
  }
  sonarSirena();
  pasoBaliza = setTimeout(() => {
    callarSirena();
    try { hablar(frase); } catch (e) {}
    pasoBaliza = setTimeout(() => emitirBaliza(frase, alTerminar, indice + 1), DURACION_VOZ_MS);
  }, DURACION_SIRENA_MS);
}

function iniciarSonido(cfg) {
  try {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
  } catch (e) {}
  // El volumen del reproductor es relativo al del sistema, asi que sin esto la
  // baliza suena a lo que estuviera puesto el telefono.
  try { subirVolumenBaliza(); } catch (e) {}
  detenerSonido();

  const desde = Date.now();
  const frase = fraseBaliza(cfg);
  const cicloCompleto = () => {
    // La siguiente emision se programa cuando TERMINA la actual, no cuando
    // empieza. Cada emision dura media docena de segundos por repeticion, asi
    // que medir desde el arranque haria que se solaparan en el tramo mas rapido:
    // la sirena de la siguiente pisaria la voz de la anterior y no se entenderia
    // ninguna de las dos.
    emitirBaliza(frase, () => {
      // Se recalcula aqui, no al empezar: asi la cadencia se va espaciando sola
      // conforme pasa el tiempo y baja la bateria.
      intervaloSonido = setTimeout(cicloCompleto, cadenciaSonido(desde));
    });
  };
  cicloCompleto();
}

export function detenerSonido() {
  if (intervaloSonido) {
    // clearTimeout y no clearInterval: la baliza se reprograma en cada emision
    // para poder ir espaciando la cadencia.
    clearTimeout(intervaloSonido);
    intervaloSonido = null;
  }
  // Y el paso interno: sin esto, una emision a medias seguiria alternando
  // sirena y voz despues de que el usuario pulsara "Estoy bien".
  if (pasoBaliza) {
    clearTimeout(pasoBaliza);
    pasoBaliza = null;
  }
  if (reproductorSos) {
    try { reproductorSos.pause(); } catch (e) {}
    try { reproductorSos.remove(); } catch (e) {}
    reproductorSos = null;
  }
  // Se devuelve el volumen que tenia el telefono. Dejarlo al maximo despues de
  // la emergencia seria un efecto secundario que el usuario no pidio, y que
  // descubriria de la peor forma: con el primer video que reproduzca.
  try { restaurarVolumen(); } catch (e) {}
}

export async function pedirPermisosBluetooth() {
  if (Platform.OS !== 'android' || Platform.Version < 31) return true;
  try {
    const r = await PermissionsAndroid.requestMultiple([
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
    ]);
    return Object.values(r).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  } catch (e) {
    return false;
  }
}

/**
 * El texto que va a emitir la baliza.
 *
 * Si el usuario escribio uno propio, manda ese: el texto util depende de donde
 * este, y "apartamento 715" no significa nada si le pasa algo en la calle.
 * Si no, se genera a partir del nombre y el apartamento.
 */
export function textoDeBaliza(cfg) {
  const propio = (cfg?.textoBaliza || '').trim();
  return propio ? recortarBaliza(propio) : balizaPorDefecto(cfg);
}

/**
 * Enciende la malla de bitchat con la ficha ya compuesta.
 *
 * La ficha se compone AQUI y no en bitchat porque solo esta app sabe lo que
 * hace falta para armarla: si el usuario esta en su casa, cuanta bateria queda
 * y cuanto lleva activada la emergencia. bitchat solo la reenvia tal cual.
 *
 * Devuelve siempre un objeto con motivo, nunca lanza: que falle la malla no
 * puede impedir que suenen la baliza sonora y la de Bluetooth, que son las que
 * no dependen de que nadie tenga una app instalada.
 */
async function encenderMalla(cfg, estado) {
  try {
    const est = estadoMalla();
    if (!est.instalado) return { ok: false, motivo: 'bitchat_no_instalado' };
    if (!est.esFork) return { ok: false, motivo: 'bitchat_sin_puente' };
    if (!fichaTieneContenido(cfg)) return { ok: false, motivo: 'ficha_vacia' };

    const ubicacion = await cargarUbicacionGuardada();
    const red = await verificarInternet();
    const texto = componerFicha(cfg, estado, ubicacion, red);
    const episodio = String(estado?.activadaEn || Date.now());
    // La malla vive exactamente lo que viva la baliza: se enciende aqui y se
    // apaga al confirmar "Estoy bien". Sin plazos: si esta app muriera mientras
    // el usuario sigue atrapado, apagar la malla seria lo ultimo que convendria.
    const r = activarMalla(texto, textoDeBaliza(cfg), episodio);
    return { ...r, enviadoEn: Date.now() };
  } catch (e) {
    return { ok: false, motivo: e?.message || 'excepcion' };
  }
}

/**
 * Vencio el plazo sin confirmacion. Activa todo lo configurado.
 * Cada mecanismo se ejecuta por separado: que falle uno no impide los otros.
 */
export async function activarProtocolo() {
  const cfg = await cargarConfigEmergencia();
  const estado = await cargarEstadoEmergencia();
  const resultado = { bluetooth: null, sonido: false };

  if (cfg.usarBluetooth) {
    try {
      // La baliza ya NO lleva telefono. Si la red celular funciona, el afectado
      // habria podido pedir ayuda el mismo; si no funciona, un numero es
      // inutil. Con esos 26 caracteres se gana mas diciendo DONDE estas y por
      // que canal se sabe el resto.
      resultado.bluetooth = iniciarBaliza(textoDeBaliza(cfg));
    } catch (e) {
      resultado.bluetooth = { ok: false, motivo: 'excepcion' };
    }
  }

  if (cfg.usarSonido) {
    iniciarSonido(cfg);
    resultado.sonido = true;
  }

  // Tercera capa de alcance: la malla. Llega mucho mas lejos que la baliza
  // —varios saltos, y conversacion real— pero exige que quien te encuentre
  // tenga la app. Por eso no sustituye a las otras dos, se suma.
  //
  // Aqui es donde Alerta Sismo enciende bitchat. No corre antes: mantener la
  // malla viva todo el tiempo gastaria bateria sin parar para cubrir un evento
  // que puede no ocurrir en años.
  resultado.malla = await encenderMalla(cfg, estado);

  await guardarEstado({ ...estado, esperandoConfirmacion: false, activada: true, activadaEn: Date.now() });

  // El cuerpo describe lo que REALMENTE quedo activo. Antes decia siempre
  // "se aviso a tus contactos", que era falso incluso cuando ningun mecanismo
  // habia arrancado.
  const activos = [];
  if (resultado.bluetooth?.ok) activos.push(`visible por Bluetooth como "${resultado.bluetooth.nombre}"`);
  if (resultado.sonido) activos.push('emitiendo una señal sonora cada 30 s');

  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🆘 Protocolo de emergencia activado',
      body: activos.length
        ? `Tu teléfono está ${activos.join(' y ')}, para que puedan localizarte. Pulsa ESTOY BIEN para apagarlo.`
        : 'Ningún mecanismo pudo activarse. Revisa la configuración del protocolo en la app.',
      sound: true,
    },
    trigger: null,
  });

  registrarEvento({
    tipo: TIPO.PROTOCOLO,
    subtipo: 'protocolo_activado',
    // estado.evento es el texto "M5.3 Bello" que guardo iniciarCuentaAtras,
    // no el objeto del sismo. Va en su propio campo para no confundirlo con la
    // estructura 'sismo' que usan las entradas de alerta.
    sismoTexto: estado.evento || null,
    mecanismos: {
      bluetooth: resultado.bluetooth
        ? { ok: !!resultado.bluetooth.ok, motivo: resultado.bluetooth.motivo || null, nombre: resultado.bluetooth.nombre || null }
        : { ok: false, motivo: 'desactivado' },
      sonido: resultado.sonido,
    },
    detalle: activos.length
      ? `Venció el plazo sin confirmación. Activo: ${activos.join(' y ')}.`
      : 'Venció el plazo sin confirmación, pero ningún mecanismo pudo activarse.',
  });

  return resultado;
}

/** Revisa si el plazo vencio. La llama el servicio en primer plano. */
export async function revisarVencimiento() {
  const estado = await cargarEstadoEmergencia();
  if (!estado.esperandoConfirmacion || !estado.venceEn) return false;
  if (Date.now() < estado.venceEn) return false;
  await activarProtocolo();
  return true;
}

export { estadoBluetooth };
