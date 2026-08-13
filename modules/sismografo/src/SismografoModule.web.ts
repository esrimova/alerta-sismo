import { registerWebModule, NativeModule } from 'expo';

import type {
  Disponibilidad,
  Medicion,
  ResultadoDetencion,
  ResultadoInicio,
  SismografoEvents,
} from './Sismografo.types';

/**
 * En web no hay sensores utiles: la API de movimiento del navegador exige
 * gesto del usuario y no entrega un ritmo estable. Se declara sin acelerometro
 * para que la interfaz muestre "no disponible" en vez de fingir que mide.
 */
class SismografoModule extends NativeModule<SismografoEvents> {
  disponibilidad(): Disponibilidad {
    return { acelerometro: false, giroscopio: false, midiendo: false, etiqueta: null };
  }

  iniciarVentana(): ResultadoInicio {
    return { ok: false, motivo: 'sin_sensores' };
  }

  detenerVentana(): ResultadoDetencion {
    return { ok: false, motivo: 'no_habia_ventana' };
  }

  vaciarPendientes(): Medicion[] {
    return [];
  }
}

export default registerWebModule(SismografoModule, 'SismografoModule');
