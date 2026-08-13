// src/services/vigilante.js
//
// Revive el monitoreo cuando el sistema lo mata.
//
// El problema que resuelve: el interruptor "Activar Monitoreo" guardaba
// isMonitoring='true' en almacenamiento, pero NADIE volvia a arrancar el
// servicio en primer plano despues. Ni al abrir la app (initSettings solo leia
// el valor hacia el estado de React), ni al reiniciar el telefono, ni desde la
// tarea de respaldo. Cuando Android o un gestor de bateria del fabricante
// mataba el servicio —lo tipico tras varios minutos fallando consultas con la
// pantalla apagada— la app se quedaba mostrando "activado" sin nada corriendo,
// y solo se recuperaba si el usuario apagaba y encendia el interruptor a mano.
//
// La deteccion se basa en el latido que escribe el bucle de foreground.js en
// cada vuelta. Si el latido esta viejo, el bucle no esta corriendo.

// No se importa background.js a proposito: esa tarea tambien llama aqui, y el
// import cruzado formaria un ciclo. Ademas seria redundante — si el worker de
// WorkManager se esta ejecutando, la tarea ya esta registrada por definicion.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { iniciarServicioPrimerPlano, LATIDO_KEY } from './foreground';
import { registrarEvento, TIPO } from './bitacora';

/**
 * El bucle late cada 60 s con red y cada 5 min hibernando. El umbral debe
 * quedar por encima del caso hibernando para no confundir "esperando" con
 * "muerto" y reiniciar el servicio sin necesidad.
 */
const LATIDO_MAX_MS = 6 * 60 * 1000;

export async function estaVivoElMonitoreo() {
  try {
    const crudo = await AsyncStorage.getItem(LATIDO_KEY);
    if (!crudo) return false;
    return Date.now() - Number(crudo) < LATIDO_MAX_MS;
  } catch (e) {
    return false;
  }
}

/**
 * Comprueba y, si hace falta, revive el monitoreo.
 *
 * @param {string} origen - quien lo pidio ('app_abierta', 'respaldo'...), para
 *                          poder distinguirlo despues en la bitacora.
 * @returns {Promise<{revisado: boolean, revivido: boolean, motivo?: string}>}
 */
export async function asegurarMonitoreoVivo(origen = 'desconocido') {
  let activo = null;
  try {
    activo = await AsyncStorage.getItem('isMonitoring');
  } catch (e) {
    return { revisado: false, revivido: false, motivo: 'sin_acceso_almacenamiento' };
  }

  // El usuario lo apago a proposito: no hay nada que revivir.
  if (activo !== 'true') return { revisado: true, revivido: false };

  if (await estaVivoElMonitoreo()) return { revisado: true, revivido: false };

  // Android 12+ restringe arrancar un servicio en primer plano desde segundo
  // plano, asi que desde el worker esto puede ser rechazado. No es fatal: el
  // worker ya ejecuta su propio ciclo, y la llamada desde la app abierta —donde
  // hay una actividad visible— siempre esta permitida.
  const ok = await iniciarServicioPrimerPlano();

  await registrarEvento({
    tipo: TIPO.SISTEMA,
    subtipo: ok ? 'monitoreo_revivido' : 'monitoreo_no_revivido',
    origen,
    detalle: ok
      ? 'El servicio de monitoreo estaba detenido y se reinició automáticamente.'
      : 'El servicio estaba detenido y Android rechazó reiniciarlo desde segundo plano. Abre la app para restablecerlo.',
  });

  return { revisado: true, revivido: ok, motivo: ok ? undefined : 'arranque_rechazado' };
}
