import Emergencia from './src/EmergenciaModule';

export type EstadoBluetooth = {
  soportado: boolean;
  encendido: boolean;
  puedeAnunciar: boolean;
  permisos: boolean;
  nombreActual: string | null;
};

export type Resultado = {
  ok: boolean;
  motivo?: string;
  nombre?: string;
};

/** Diagnostico previo: sirve para avisar al usuario ANTES de la emergencia. */
export function estadoBluetooth(): EstadoBluetooth {
  return Emergencia.estadoBluetooth();
}

/**
 * Arranca la baliza BLE con el mensaje dado como nombre visible.
 * Se recorta a 26 caracteres: el paquete BLE son 31 bytes.
 */
export function iniciarBaliza(mensaje: string): Resultado {
  return Emergencia.iniciarBaliza(mensaje);
}

/** Detiene la baliza y restaura el nombre Bluetooth original del telefono. */
export function detenerBaliza(): Resultado {
  return Emergencia.detenerBaliza();
}

export type Bateria = {
  /** null si el sistema no lo reporta. */
  porcentaje: number | null;
  cargando: boolean;
};

/**
 * Carga restante. Va en la ficha de triaje porque marca el plazo en que la
 * señal del telefono va a dejar de existir, y eso determina la prioridad de un
 * rescate frente a otro.
 */
export function nivelBateria(): Bateria {
  return Emergencia.nivelBateria();
}

/**
 * ¿Puede la app encender la pantalla y mostrarse sobre el bloqueo?
 * Android 14 restringio USE_FULL_SCREEN_INTENT a apps de llamadas y alarmas;
 * el resto lo consigue solo si el usuario lo concede a mano.
 */
export function puedePantallaCompleta(): boolean {
  return Emergencia.puedePantallaCompleta();
}

/** Abre los ajustes donde se concede ese permiso. */
export function abrirAjustesPantallaCompleta(): Resultado {
  return Emergencia.abrirAjustesPantallaCompleta();
}

export type EstadoMalla = {
  instalado: boolean;
  esFork: boolean;
  /** 'no_instalado' | 'version_sin_puente' | null */
  motivo: string | null;
};

/**
 * ¿Está el fork de bitchat instalado y expone el puente?
 *
 * Distingue "no está bitchat" de "está la versión de la tienda, que no expone
 * nada": son situaciones distintas y el usuario tiene que saber cuál le pasa.
 */
export function estadoMalla(): EstadoMalla {
  return Emergencia.estadoMalla();
}

/**
 * Enciende la malla de bitchat y le entrega la ficha.
 *
 * Alerta Sismo es el disparador: bitchat no corre todo el tiempo porque
 * mantener la malla viva gastaría batería sin parar para cubrir un evento que
 * puede no ocurrir en años.
 */
export function activarMalla(
  ficha: string,
  apodo: string,
  episodio: string,
  duracionMs: number
): Resultado {
  return Emergencia.activarMalla(ficha, apodo, episodio, duracionMs);
}

/** Apaga la malla y borra la ficha del otro lado. */
export function desactivarMalla(): Resultado {
  return Emergencia.desactivarMalla();
}

/**
 * Sube el volumen del sistema al máximo para la baliza sonora.
 *
 * Poner el reproductor al 1.0 solo da el 100% *del volumen del sistema*: con el
 * teléfono al 20% la baliza suena floja, y de madrugada —cuando menos capaz es
 * el usuario de reaccionar— es lo normal.
 */
export function subirVolumenBaliza(): Resultado & { previo?: number; maximo?: number } {
  return Emergencia.subirVolumenBaliza();
}

/** Devuelve el volumen que tenía el teléfono antes de la emergencia. */
export function restaurarVolumen(): Resultado {
  return Emergencia.restaurarVolumen();
}
