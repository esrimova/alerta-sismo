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
import { iniciarBaliza, detenerBaliza, estadoBluetooth } from '../../modules/emergencia';
import { SOUND_URLS } from './alert';
import { registrarEvento, TIPO } from './bitacora';
import { FICHA_DEFECTO, balizaPorDefecto, recortarBaliza } from './ficha';

const CONFIG_KEY = 'alerta_sismo_emergencia_v1';
const ESTADO_KEY = 'alerta_sismo_emergencia_estado_v1';

export const MINUTOS_ESPERA_DEFECTO = 60;

export const CONFIG_DEFECTO = {
  activo: false,
  miNombre: '',
  contactoNombre: '',
  contactoTelefono: '',
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

  registrarEvento({
    tipo: TIPO.PROTOCOLO,
    subtipo: 'estoy_bien',
    // Cuanto tardo en confirmar. Si el protocolo ya se habia activado, indica
    // que la confirmacion llego tarde.
    trasActivacion: !!previo.activada,
    detalle: previo.activada
      ? 'El usuario confirmó estar bien DESPUÉS de que el protocolo se activara. Balizas apagadas.'
      : 'El usuario confirmó estar bien. Se canceló la cuenta atrás.',
  });

  return true;
}

let reproductorSos = null;
let intervaloSonido = null;

function iniciarSonido() {
  try {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });
  } catch (e) {}
  detenerSonido();
  const emitir = () => {
    try {
      if (reproductorSos) {
        try { reproductorSos.remove(); } catch (e) {}
      }
      reproductorSos = createAudioPlayer(SOUND_URLS.sirena_fuerte);
      reproductorSos.volume = 1.0;
      reproductorSos.play();
    } catch (e) {
      console.log('No se pudo emitir la baliza sonora:', e);
    }
  };
  emitir();
  // Cada 30 s: audible para quien busca, sin agotar la bateria en minutos.
  intervaloSonido = setInterval(emitir, 30000);
}

export function detenerSonido() {
  if (intervaloSonido) {
    clearInterval(intervaloSonido);
    intervaloSonido = null;
  }
  if (reproductorSos) {
    try { reproductorSos.pause(); } catch (e) {}
    try { reproductorSos.remove(); } catch (e) {}
    reproductorSos = null;
  }
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
    iniciarSonido();
    resultado.sonido = true;
  }

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
