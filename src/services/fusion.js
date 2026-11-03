// src/services/fusion.js
//
// Engancha las fuentes rapidas —el sensor, y mas adelante la alerta de Google—
// a la capa de episodio.
//
// Existe como modulo aparte para que el sismografo no tenga que saber que es un
// episodio ni el episodio que existe un sismografo. Aqui es donde se decide que
// cuenta como fuente de un sismo y que es solo ruido, que es una decision de la
// app y no de ninguno de los dos.

import { alMedir, guardarUltimaMedicion, drenarMediciones } from './sismografo';
import { drenarAlertas, registrarAlertaGoogle, vigilarPermisoEscucha } from './escucha';
import { registrarFuente, cerrarSiVencio, marcarAlarmado } from './episodio';

let listo = false;

/**
 * Etiquetas de ventana que NUNCA abren un episodio.
 *
 * Una prueba manual es alguien agitando el telefono a proposito: registrarla
 * como sismo llenaria la bitacora de eventos falsos y, peor, dejaria un
 * episodio abierto que se tragaria el sismo real siguiente por correlacion.
 */
const NO_SON_SISMO = ['prueba'];

export function iniciarFusion() {
  if (listo) return;
  listo = true;
  alMedir(procesarMedicion);
}

async function procesarMedicion(m) {
  if (!m) return;
  // Una ventana reemplazada se abandono a medias: sus numeros son de un trozo
  // de medida, no de la sacudida entera.
  if (m.motivo === 'reemplazada') return;

  await guardarUltimaMedicion(m);

  if (NO_SON_SISMO.includes(m.etiqueta)) return;
  // Sin cruzar el umbral no hubo sacudida que reportar. La vigilancia de
  // replicas cierra ventanas continuamente y casi todas estan en calma:
  // registrarlas todas seria convertir la bitacora en ruido.
  if (m.onsetMs === null || m.onsetMs === undefined) return;

  await registrarFuente('sensor', {
    recibidoEn: Date.now(),
    // El instante en que llego la onda, no el del arranque de la ventana. La
    // ventana pudo abrirla Google 40 s antes de que se sintiera nada.
    onsetEn: m.inicioEn + m.onsetMs,
    inicioEn: m.inicioEn,
    pgaG: m.pgaG,
    mmiEstimada: m.mmiEstimada,
    mmiEnRango: m.mmiEnRango,
    duracionFuerteSeg: m.duracionFuerteSeg,
    giroPicoRads: m.giroPicoRads,
    veredicto: m.veredicto,
    hzReal: m.hzReal,
    disparadaPor: m.etiqueta,
  });
}

/**
 * Procesa una alerta de Google ya recogida del buzon nativo.
 *
 * Aqui NO se dispara sonido. Google ya tomo la pantalla y sono fuerte; añadir
 * un segundo sonido simultaneo confunde mas de lo que aporta. Lo que si se hace
 * es marcar el episodio como ya alarmado, para que el feed del USGS no vuelva a
 * sonar por el mismo sismo cinco minutos despues.
 *
 * El sensor ya arranco en nativo, sin pasar por aqui: cuando este codigo se
 * ejecuta, la ventana de medida lleva corriendo desde que llego la notificacion.
 */
async function procesarAlertaGoogle(alerta) {
  const { episodio } = await registrarFuente('google', {
    recibidoEn: alerta.recibidoEn,
    // Alerta y actualizacion son observaciones distintas del mismo sismo; la
    // misma notificacion repetida comparte version y no se duplica.
    version: `${alerta.canal}:${alerta.recibidoEn}`,
    canal: alerta.canal,
    titulo: alerta.titulo,
    texto: alerta.texto,
    bigText: alerta.bigText,
    subText: alerta.subText,
    magTexto: alerta.magTexto,
    distTexto: alerta.distTexto,
    conocido: alerta.conocido,
    // Un canal que solo actualiza no declara nivel: informa sobre una alerta
    // que ya se dio, no anuncia una nueva.
    nivel: alerta.dispara ? 'red' : null,
  });

  if (alerta.dispara) {
    await marcarAlarmado('red', { fuente: 'google', notificacion: true });
  }

  await registrarAlertaGoogle(alerta, { episodioId: episodio.id });
}

/**
 * Vacia los buzones nativos.
 *
 * El servicio de notificaciones y el sismografo pueden trabajar con el runtime
 * de JavaScript muerto —es justo el caso de una alerta de madrugada con la app
 * cerrada—, asi que dejan lo suyo en un buzon nativo. Esto lo recoge y lo mete
 * en el flujo normal.
 */
async function drenarBuzones() {
  for (const alerta of drenarAlertas()) {
    try {
      await procesarAlertaGoogle(alerta);
    } catch (e) {
      console.log('No se pudo procesar una alerta de Google pendiente:', e);
    }
  }

  for (const m of drenarMediciones()) {
    try {
      await procesarMedicion(m);
    } catch (e) {
      console.log('No se pudo procesar una medición pendiente:', e);
    }
  }
}

/**
 * Mantenimiento por vuelta del bucle de monitoreo.
 *
 * Consolidar al vencer tiene que ocurrir aqui y no solo cuando llega otra
 * fuente: si tras un sismo no vuelve a pasar nada, sin esto el episodio se
 * quedaria abierto para siempre y nunca llegaria a la bitacora.
 */
export async function mantenimientoFusion() {
  // Primero los buzones: una alerta pendiente puede tener que entrar en el
  // episodio que esta a punto de cerrarse. Al reves se perderia la correlacion.
  try {
    await drenarBuzones();
  } catch (e) {
    console.log('No se pudieron vaciar los buzones nativos:', e);
  }

  // Que la via rapida siga viva se comprueba aqui y no en la pantalla de
  // configuracion, porque el usuario no abre esa pantalla y el permiso se cae
  // solo. Va despues de los buzones: si acaba de llegar una alerta, procesarla
  // importa mas que auditar el permiso.
  try {
    await vigilarPermisoEscucha();
  } catch (e) {
    console.log('No se pudo comprobar el permiso de la escucha de Google:', e);
  }

  try {
    return await cerrarSiVencio();
  } catch (e) {
    return null;
  }
}
