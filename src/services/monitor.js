// src/services/monitor.js
//
// Un ciclo completo de monitoreo: consultar, registrar salud, evaluar reglas y
// alertar. Se extrajo de background.js para que lo puedan invocar por igual el
// servicio en primer plano (cada 60 s, sin depender del sistema) y la tarea
// de respaldo de WorkManager.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchRecentEarthquakes } from './api';
import {
  triggerAlert,
  notificarServicioCaido,
  notificarServicioRestablecido,
} from './alert';
import { loadSettings } from './settings';
import { COLOMBIA_CITIES } from '../utils/colombia';
import { getDistanceFromLatLonInKm } from '../utils/haversine';
import { registrarResultado } from './health';
import { cargarUbicacionGuardada } from './location';
import { iniciarCuentaAtras } from './emergencia';
import { registrarEvento, TIPO } from './bitacora';
import { registrarFuente, marcarAlarmado } from './episodio';
import { medir } from './sismografo';

/** Ventana para reglas de evento unico. Independiente de la de enjambre. */
const VENTANA_EVENTO_MIN = 60;

/**
 * Hasta que distancia importa un sismo, segun su tamaño.
 *
 * Un radio fijo es incorrecto: un M4 deja de sentirse a 50 km, pero un M7.5 se
 * percibe a cientos de km. Los 1500 km de M7+ salen de medir casos reales: el
 * M7.5 de Catia La Mar quedo a 1036 km de Bello y el M7.2 de San Felipe a
 * 891 km, asi que un umbral de 1000 km partia la zona sismica de Venezuela
 * justo por la mitad. El radio configurado por el usuario es el PISO.
 */
export function alcanceKm(mag, radioBase) {
  if (mag >= 7.0) return Math.max(radioBase, 1500);
  if (mag >= 6.0) return Math.max(radioBase, 700);
  if (mag >= 5.0) return Math.max(radioBase, 400);
  return radioBase;
}

/**
 * Zona de referencia del usuario.
 *
 * Prioridad: si hay ubicacion automatica del GPS, esa manda. Es lo que hace
 * que la app siga sirviendo si viajas: monitorear Colombia no te protege en
 * Chile. Si no, se usa la ciudad elegida a mano.
 *
 * 'ALL' significa "todo el pais", NO "todo el planeta". Devolver null aqui
 * desactivaba todos los guardas de distancia y hacia que un sismo en Japon
 * disparara alerta.
 */
export function getUserLocationCoordinates(locationName, ubicacionAuto = null) {
  if (ubicacionAuto && typeof ubicacionAuto.lat === 'number') {
    return { lat: ubicacionAuto.lat, lon: ubicacionAuto.lon, radio: 300, auto: true };
  }
  const city = COLOMBIA_CITIES.find((c) => c.value === locationName);
  const pais = COLOMBIA_CITIES.find((c) => c.value === 'ALL');
  if (!city || city.value === 'ALL') {
    return { lat: pais.lat, lon: pais.lon, radio: 900, auto: false };
  }
  return { lat: city.lat, lon: city.lon, radio: 300, auto: false };
}

/**
 * USGS solo calcula mmi (ShakeMap) para eventos significativos: en 90 dias en
 * Colombia solo lo trajeron los tres M7+. Las reglas que exigian mmi nunca
 * llegaban a decidir nada. cdi (reportes ciudadanos) si viene en eventos
 * moderados y sirve de sustituto.
 */
export function intensidadPercibida(props) {
  if (props.mmi !== null && props.mmi !== undefined) return props.mmi;
  if (props.cdi !== null && props.cdi !== undefined) return props.cdi;
  return null;
}

/** Distancia a partir de la cual un sismo fuerte ya no se siente aqui. */
export const KM_CERCANO = 300;

/** Evalua las reglas sobre una lista de eventos ya descargada. */
export function evaluarReglas(events, settings, ahora = Date.now(), ubicacionAuto = null) {
  const zona = getUserLocationCoordinates(settings.location, ubicacionAuto);

  // Ventana amplia para eventos unicos. Usar swarmMinutes para todo hacia que
  // un M7 de hace 31 minutos se descartara en silencio.
  const recientes = events.filter(
    (e) => (ahora - e.properties.time) / 60000 <= VENTANA_EVENTO_MIN
  );

  for (const event of recientes) {
    const p = event.properties;
    const mag = p.mag || 0;
    const intensidad = intensidadPercibida(p);
    const cdi = p.cdi || 0;
    const felt = p.felt || 0;
    const tsunami = p.tsunami || 0;
    const depth = event.geometry.coordinates[2] || 0;

    const distance = getDistanceFromLatLonInKm(
      zona.lat, zona.lon, event.geometry.coordinates[1], event.geometry.coordinates[0]
    );

    if (distance > alcanceKm(mag, zona.radio)) continue;

    // INFORMATIVA DE EMERGENCIA: sismo fuerte confirmado Y CERCANO.
    // No es alerta anticipada (para eso esta el sistema de Google): llega
    // despues del evento y sirve para saber QUE paso, de que magnitud y donde.
    //
    // La cercania es parte de la DEFINICION del nivel, no solo de como suena.
    // Un M7 a 1200 km es una noticia, no una emergencia tuya: se reporta como
    // 'lejano', que informa pero no dispara alarma ni protocolo de emergencia.
    const esFuerte =
      mag >= 6.0 ||
      (mag >= settings.api.redMag && intensidad !== null && intensidad >= settings.api.redMMI) ||
      tsunami === 1;

    if (esFuerte) {
      const cerca = distance <= KM_CERCANO;
      return {
        nivel: cerca ? 'red' : 'lejano',
        regla: cerca ? 'fuerte_cercano' : 'fuerte_lejano',
        evento: event,
        distancia: distance,
        zona,
      };
    }

    // NARANJA: probabilidad de que algo suceda
    if (mag >= 4.0 && depth < 10 && distance < 100) {
      return { nivel: 'orange', regla: 'somero_cercano', evento: event, distancia: distance, zona };
    }

    // AMARILLA: algo no está bien
    if (cdi >= settings.api.yellowCDI && felt >= settings.api.yellowFelt) {
      return { nivel: 'yellow', regla: 'social_reportes', evento: event, distancia: distance, zona };
    }
    if (mag >= 3.5 && intensidad !== null && intensidad >= 3) {
      return { nivel: 'yellow', regla: 'sacudida_percibida', evento: event, distancia: distance, zona };
    }
  }

  // ENJAMBRE (naranja): usa su propia ventana temporal.
  const enjambre = recientes.filter((e) => {
    if ((ahora - e.properties.time) / 60000 > settings.api.swarmMinutes) return false;
    const d = getDistanceFromLatLonInKm(
      zona.lat, zona.lon, e.geometry.coordinates[1], e.geometry.coordinates[0]
    );
    return d <= settings.api.swarmRadius;
  });
  if (enjambre.length >= settings.api.swarmCount) {
    return {
      nivel: 'orange',
      regla: 'enjambre',
      evento: enjambre[0],
      distancia: 0,
      zona,
      // Una alerta de enjambre sin la lista de eventos es una linea sin
      // sentido en la bitacora: no se puede auditar despues.
      detalleEnjambre: {
        conteo: enjambre.length,
        ventanaMin: settings.api.swarmMinutes,
        radioKm: settings.api.swarmRadius,
        eventos: enjambre.map((e) => ({
          id: e.id,
          mag: e.properties.mag,
          hora: e.properties.time,
        })),
      },
    };
  }

  return { nivel: null, regla: null, evento: null, distancia: null, zona };
}

/**
 * Arma la entrada de bitacora de una alerta.
 *
 * Se guarda TODO lo que se sabia en el momento del disparo, aunque la interfaz
 * solo muestre un resumen. El registro no se puede sobrescribir: lo que no se
 * capture aqui se pierde para siempre, y datos como el estado de revision del
 * USGS o el retraso de deteccion solo tienen sentido con la foto de ese
 * instante.
 */
export function construirEntradaAlerta({
  nivel, regla, evento, distancia, zona, settings, acciones, detalleEnjambre, simulado = false,
}) {
  const p = evento.properties || {};
  const coords = evento.geometry?.coordinates || [];
  const intensidad = intensidadPercibida(p);
  const horaSismo = p.time || null;

  return {
    tipo: TIPO.ALERTA,
    nivel,
    regla,
    simulado,
    sismo: {
      id: evento.id,
      mag: p.mag ?? null,
      magType: p.magType ?? null,
      lugar: p.place ?? null,
      hora: horaSismo,
      lat: coords[1] ?? null,
      lon: coords[0] ?? null,
      profundidadKm: coords[2] ?? null,
      status: p.status ?? null,       // 'automatic' o 'reviewed'
      actualizado: p.updated ?? null, // el USGS corrige magnitudes despues
      nst: p.nst ?? null,
      dmin: p.dmin ?? null,
      rms: p.rms ?? null,
      gap: p.gap ?? null,
      url: p.url ?? null,
    },
    evaluacion: {
      distanciaKm: distancia,
      alcanceKm: zona ? alcanceKm(p.mag || 0, zona.radio) : null,
      // Cuanto tardo la app en enterarse. Es el dato que permite medir de
      // verdad si esta fuente sirve para lo que se espera de ella.
      retrasoSeg: horaSismo ? Math.round((Date.now() - horaSismo) / 1000) : null,
      intensidad,
      fuenteIntensidad: p.mmi != null ? 'mmi' : (p.cdi != null ? 'cdi' : null),
      cdi: p.cdi ?? null,
      felt: p.felt ?? null,
      tsunami: p.tsunami ?? 0,
      zona: zona
        ? {
            origen: zona.auto ? 'gps' : (settings.location === 'ALL' ? 'pais' : 'ciudad'),
            etiqueta: settings.location,
            radioKm: zona.radio,
          }
        : null,
      umbrales: { ...settings.api },
    },
    acciones: acciones || null,
    detalleEnjambre: detalleEnjambre || null,
  };
}

/**
 * Un ciclo completo. Devuelve un resumen para que quien lo llame decida.
 */
export async function ejecutarCiclo() {
  const settings = await loadSettings();
  // Ubicacion del GPS si el usuario activo el modo automatico. No se pide aqui
  // (eso exigiria permiso de segundo plano): se lee la ultima guardada, que la
  // pantalla principal refresca al abrir la app.
  const ubicacionAuto = settings.autoLocation ? await cargarUbicacionGuardada() : null;
  const resultado = await fetchRecentEarthquakes();

  // La salud se registra SIEMPRE. Antes un fallo devolvia [] y era
  // indistinguible de un dia tranquilo: la app callaba creyendo que todo bien.
  const { debeAvisarCaida, debeAvisarRecuperacion } = await registrarResultado(resultado);
  if (debeAvisarCaida) {
    await notificarServicioCaido(resultado.error || 'Causa desconocida.');
    registrarEvento({
      tipo: TIPO.SERVICIO,
      subtipo: 'caido',
      motivo: resultado.motivo || null,
      detalle: resultado.error || 'Causa desconocida.',
    });
  }
  if (debeAvisarRecuperacion) {
    await notificarServicioRestablecido();
    registrarEvento({
      tipo: TIPO.SERVICIO,
      subtipo: 'restablecido',
      detalle: 'La app volvió a recibir información sísmica del USGS.',
    });
  }

  if (!resultado.ok) return { ok: false, alerta: null };
  if (!resultado.events.length) return { ok: true, alerta: null };

  const { nivel, regla, evento, distancia, zona, detalleEnjambre } = evaluarReglas(
    resultado.events, settings, Date.now(), ubicacionAuto
  );
  if (!nivel || !evento) return { ok: true, alerta: null };

  const lastEventId = await AsyncStorage.getItem('lastEventId');
  if (evento.id === lastEventId) return { ok: true, alerta: null };
  await AsyncStorage.setItem('lastEventId', evento.id);

  const entrada = construirEntradaAlerta({
    nivel, regla, evento, distancia, zona, settings, detalleEnjambre, acciones: null,
  });

  // El USGS entra como FUENTE de un episodio, no como hecho aislado. Si Google
  // o el sensor ya abrieron uno por este mismo sismo —y lo normal es que si,
  // porque llegan minutos antes—, esto se suma a el en vez de abrir un registro
  // paralelo que nadie sabria que es el mismo sismo.
  const { episodio, yaAlarmado } = await registrarFuente('usgs', {
    recibidoEn: Date.now(),
    origenEstimado: evento.properties.time,
    eventoId: evento.id,
    nivel,
    entrada,
  });

  // Repetir la alarma por un sismo del que el usuario ya se entero hace cinco
  // minutos es solo ruido. Pero SOLO se calla el hardware: todo lo demas tiene
  // que ocurrir igual, porque no depende de avisar sino de proteger.
  let acciones = null;
  if (!yaAlarmado) {
    acciones = await triggerAlert(nivel, evento, settings, distancia);
  }

  // Ventana de medida. Llega tarde para el sismo principal —la sacudida termino
  // hace minutos— asi que aqui no mide el evento: mide lo que si esta por venir,
  // que son las replicas, y si el telefono se mueve o quedo inmovil.
  try {
    medir(nivel, settings);
  } catch (e) {
    console.log('No se pudo abrir la ventana de medida:', e);
  }

  // El temporizador de "Estoy bien" arranca AUNQUE la alarma se haya callado.
  // Que Google avisara antes no significa que el usuario este bien: significa
  // justo lo contrario, que hubo un sismo fuerte y cercano de verdad. Atar el
  // protocolo a que sonara la alarma lo habria dejado sin arrancar en el unico
  // caso en que de verdad hace falta.
  //
  // Solo un sismo fuerte Y cercano lo dispara. Uno lejano no te pudo dejar
  // atrapado, y avisar a tu familia por eso seria un falso positivo que causa
  // panico sin motivo.
  let cuentaAtras = null;
  if (nivel === 'red') {
    try {
      cuentaAtras = await iniciarCuentaAtras(evento);
    } catch (e) {
      console.log('No se pudo iniciar la cuenta atras de emergencia:', e);
    }
  }

  const conAcciones = { ...(acciones || {}), cuentaAtras: cuentaAtras ? cuentaAtras : null };
  await marcarAlarmado(nivel, conAcciones);

  // Se registra al final, cuando ya se sabe todo lo que ocurrio. Sin await: la
  // bitacora nunca puede retrasar ni tumbar el disparo de una alerta.
  //
  // Esta entrada es inmediata y describe lo que la app sabia AL DISPARAR. La
  // vision cruzada de las tres fuentes llega despues, como entrada de episodio
  // aparte: son dos registros distintos y el segundo no sustituye al primero.
  registrarEvento({
    ...entrada,
    episodioId: episodio.id,
    acciones: conAcciones,
    silenciada: yaAlarmado || undefined,
    motivoSilencio: yaAlarmado ? 'ya_alarmado_por_fuente_rapida' : undefined,
  });

  return { ok: true, alerta: yaAlarmado ? null : nivel };
}
