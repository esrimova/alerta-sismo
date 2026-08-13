import { NativeModule, requireNativeModule } from 'expo';

import type {
  Disponibilidad,
  Medicion,
  ResultadoDetencion,
  ResultadoInicio,
  SismografoEvents,
} from './Sismografo.types';

declare class SismografoModule extends NativeModule<SismografoEvents> {
  disponibilidad(): Disponibilidad;
  iniciarVentana(
    ventanaMs: number,
    hz: number,
    umbralG: number,
    etiqueta: string
  ): ResultadoInicio;
  detenerVentana(): ResultadoDetencion;
  vaciarPendientes(): Medicion[];
}

export default requireNativeModule<SismografoModule>('Sismografo');
