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
