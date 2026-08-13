/**
 * Estado de la escucha.
 *
 * `permiso` y `vinculado` son cosas distintas y hay que tratarlas por separado:
 * en Android 14+ el sistema no vincula el servicio hasta el primer desbloqueo
 * tras reiniciar el telefono, asi que se puede tener el permiso concedido y aun
 * asi no estar recibiendo nada. Mostrar solo el permiso diria "todo listo"
 * cuando en realidad ninguna alerta llegaria.
 */
export type EstadoEscucha = {
  permiso: boolean;
  vinculado: boolean;
  ultimoEstado: 'vinculado' | 'desvinculado' | null;
  ultimoEstadoEn: number | null;
  canalesQueDisparan: string[];
};

/**
 * Una notificacion de Google tal como llego.
 *
 * Los campos de texto van CRUDOS a proposito. Google nunca publico una API y su
 * redaccion puede cambiar sin aviso; guardar el texto tal cual es lo unico que
 * permite reconstruir despues lo que dijo, aunque el parseo del momento fallara.
 */
export type AlertaGoogle = {
  canal: string;
  /** Instante en que el telefono recibio el aviso. Es el t0 de todo lo demas. */
  recibidoEn: number;
  vistoEn: number;
  clave: string | null;
  titulo: string | null;
  texto: string | null;
  bigText: string | null;
  subText: string | null;
  /** false = canal 'eew' que no estaba en la lista: Google cambio el formato. */
  conocido: boolean;
  /** true = canal que debe disparar respuesta, no solo registrarse. */
  dispara: boolean;
};

export type Resultado = { ok: boolean; motivo?: string };
