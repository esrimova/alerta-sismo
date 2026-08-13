import { registerWebModule, NativeModule } from 'expo';

import type { AlertaGoogle, EstadoEscucha, Resultado } from './EscuchaAlertas.types';

/** En web no existen las notificaciones de Android ni sus canales. */
class EscuchaAlertasModule extends NativeModule<{}> {
  estado(): EstadoEscucha {
    return {
      permiso: false,
      vinculado: false,
      ultimoEstado: null,
      ultimoEstadoEn: null,
      canalesQueDisparan: [],
    };
  }

  abrirAjustes(): Resultado {
    return { ok: false, motivo: 'no_disponible_en_web' };
  }

  vaciarPendientes(): AlertaGoogle[] {
    return [];
  }
}

export default registerWebModule(EscuchaAlertasModule, 'EscuchaAlertasModule');
