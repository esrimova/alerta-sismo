import Sismografo from './src/SismografoModule';

export * from './src/Sismografo.types';

import type {
  Disponibilidad,
  Medicion,
  ResultadoDetencion,
  ResultadoInicio,
} from './src/Sismografo.types';

/** Que sensores hay y si ya se esta midiendo. Para el semaforo de fuentes. */
export function disponibilidad(): Disponibilidad {
  return Sismografo.disponibilidad();
}

/**
 * Abre una ventana de medida.
 *
 * @param ventanaMs cuanto dura
 * @param hz ritmo de muestreo pedido (Android no lo garantiza; la medicion
 *   devuelve el ritmo real conseguido)
 * @param umbralG a partir de que aceleracion se considera sacudida
 * @param etiqueta quien disparo, para poder cruzarlo con el episodio despues
 */
export function iniciarVentana(
  ventanaMs: number,
  hz: number,
  umbralG: number,
  etiqueta: string
): ResultadoInicio {
  return Sismografo.iniciarVentana(ventanaMs, hz, umbralG, etiqueta);
}

/** Corta la ventana antes de tiempo y devuelve lo medido hasta ese punto. */
export function detenerVentana(): ResultadoDetencion {
  return Sismografo.detenerVentana();
}

/**
 * Recoge las medidas tomadas con JavaScript dormido.
 *
 * Una ventana disparada por la alerta de Google se cierra 90 s despues, y si la
 * app estaba cerrada nadie escuchaba ese cierre. El modulo nativo las guarda en
 * un buzon; esto lo vacia.
 */
export function vaciarPendientes(): Medicion[] {
  return Sismografo.vaciarPendientes();
}

/** Se emite al cerrar cada ventana, con el resumen completo. */
export function alMedir(cb: (medicion: Medicion) => void) {
  return Sismografo.addListener('onMedicion', cb);
}

/**
 * Se emite en cuanto la sacudida cruza el umbral, sin esperar al cierre.
 * En un sismo real la ventana dura 90 s, y esperarla entera desperdiciaria
 * justo los segundos que importan.
 */
export function alSuperarUmbral(cb: (aviso: { etiqueta: string; enMs: number; pgaG: number }) => void) {
  return Sismografo.addListener('onUmbralSuperado', cb);
}

export default Sismografo;
