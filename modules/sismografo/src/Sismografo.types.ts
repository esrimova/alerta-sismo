/** Que sensores tiene este telefono y si hay una ventana corriendo. */
export type Disponibilidad = {
  acelerometro: boolean;
  giroscopio: boolean;
  midiendo: boolean;
  etiqueta: string | null;
};

/**
 * Como termino la ventana. 'reemplazada' ocurre cuando entra un disparo mas
 * urgente encima de otro que ya corria: el caso real es una alerta de Google
 * durante la vigilancia de replicas.
 */
export type MotivoCierre =
  | 'completada'
  | 'detenida'
  | 'reemplazada'
  | 'modulo_destruido';

/**
 * Veredicto del giroscopio sobre el origen del movimiento.
 * Sus umbrales estan sin calibrar: se registra pero todavia no decide nada.
 */
export type Veredicto =
  | 'suelo'
  | 'manipulacion'
  | 'indeterminado'
  | 'sin_sacudida';

export type Medicion = {
  etiqueta: string;
  motivo: MotivoCierre;
  inicioEn: number;
  duracionMs: number;
  muestras: number;
  hz: number;
  /** Ritmo realmente conseguido. Android no garantiza el pedido. */
  hzReal: number;
  pgaMs2: number;
  pgaG: number;
  /** Mercalli ESTIMADA (Wald 1999). Nunca presentar como medida. */
  mmiEstimada: number | null;
  /** false = el PGA cae fuera del rango donde Wald es valida (MMI V-VIII). */
  mmiEnRango: boolean;
  /**
   * Milisegundos desde el arranque de la ventana hasta que llego la sacudida,
   * o null si nunca llego. Cruzado con la hora de la alerta de Google da los
   * segundos de aviso previo que hubo de verdad.
   */
  onsetMs: number | null;
  duracionFuerteSeg: number;
  umbralG: number;
  giroPicoRads: number;
  veredicto: Veredicto;
  completada: boolean;
};

/** Aviso inmediato al cruzar el umbral, sin esperar a que cierre la ventana. */
export type AvisoUmbral = {
  etiqueta: string;
  enMs: number;
  pgaG: number;
};

export type ResultadoInicio = {
  ok: boolean;
  motivo?: 'sin_sensores' | 'sin_acelerometro';
  etiqueta?: string;
  hz?: number;
  ventanaMs?: number;
  /** Medida parcial de la ventana que este disparo interrumpio, si la habia. */
  reemplazo?: Medicion | null;
};

export type ResultadoDetencion = {
  ok: boolean;
  motivo?: 'no_habia_ventana';
  medicion?: Medicion | null;
};

export type SismografoEvents = {
  onMedicion: (medicion: Medicion) => void;
  onUmbralSuperado: (aviso: AvisoUmbral) => void;
};
