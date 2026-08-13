import { NativeModule, requireNativeModule } from 'expo';

import type { AlertaGoogle, EstadoEscucha, Resultado } from './EscuchaAlertas.types';

declare class EscuchaAlertasModule extends NativeModule<{}> {
  estado(): EstadoEscucha;
  abrirAjustes(): Resultado;
  vaciarPendientes(): AlertaGoogle[];
}

export default requireNativeModule<EscuchaAlertasModule>('EscuchaAlertas');
