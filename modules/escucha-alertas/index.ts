import EscuchaAlertas from './src/EscuchaAlertasModule';

export * from './src/EscuchaAlertas.types';

import type { AlertaGoogle, EstadoEscucha, Resultado } from './src/EscuchaAlertas.types';

/** Permiso concedido, servicio vinculado y canales vigilados. */
export function estado(): EstadoEscucha {
  return EscuchaAlertas.estado();
}

/** Abre los ajustes del sistema donde se concede el acceso a notificaciones. */
export function abrirAjustes(): Resultado {
  return EscuchaAlertas.abrirAjustes();
}

/** Recoge las alertas que llegaron mientras JavaScript no estaba escuchando. */
export function vaciarPendientes(): AlertaGoogle[] {
  return EscuchaAlertas.vaciarPendientes();
}

export default EscuchaAlertas;
