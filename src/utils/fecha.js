// src/utils/fecha.js
//
// Formato de fechas compartido entre la pantalla de configuracion y la
// bitacora. Vivia dentro de ConfigScreen; se extrajo para que las entradas del
// registro se vean igual que el resto de la app.

/** "14:32 (hace 5 min)". Devuelve 'nunca' si no hay marca de tiempo. */
export function formatearFecha(ts) {
  if (!ts) return 'nunca';
  const d = new Date(ts);
  const mins = Math.floor((Date.now() - ts) / 60000);
  const hora = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  if (mins < 1) return `${hora} (hace segundos)`;
  if (mins < 60) return `${hora} (hace ${mins} min)`;
  return `${hora} (hace ${Math.floor(mins / 60)} h)`;
}

/**
 * "12/08/2026 14:32:05". Con segundos y fecha completa porque la bitacora se
 * lee dias despues del evento, cuando "hace 5 min" ya no significa nada, y
 * porque al auditar un sismo los segundos importan.
 */
export function fechaCompleta(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const dia = d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${dia} ${hora}`;
}

/** Duracion legible a partir de segundos: "2 min 5 s". */
export function duracion(segundos) {
  if (segundos === null || segundos === undefined) return '—';
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const resto = s % 60;
  if (m < 60) return resto ? `${m} min ${resto} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
