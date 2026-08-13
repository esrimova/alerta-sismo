// src/components/UltimoEvento.js
//
// Un sismo, las tres fuentes, en una sola tarjeta.
//
// Es la respuesta visual a la pregunta que hace la arquitectura de fusion:
// ¿como encaja lo que dice Google con lo que midio el telefono y con lo que
// acabo confirmando el USGS? Una fila por fuente, ordenadas por lo rapido que
// llegaron, y al pie los dos numeros que solo existen al cruzarlas.
//
// UNA FUENTE QUE NO LLEGO SE MUESTRA EN GRIS, NUNCA SE OCULTA. Que Google no
// avisara es informacion, y de las importantes: significa que la deteccion
// rapida fallo y que solo se supo por el feed, 4-7 minutos tarde. Esconder la
// fila haria parecer que el sistema funciono completo cuando no fue asi.

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { episodioAbierto, ultimoEpisodio, calcularDesfases } from '../services/episodio';
import { mmiRomano } from '../services/sismografo';
import { formatearFecha, duracion } from '../utils/fecha';

const FUENTES = [
  { clave: 'google', icono: '🔔', nombre: 'Google', color: '#A78BFA' },
  { clave: 'sensor', icono: '📳', nombre: 'Sensor', color: '#22C55E' },
  { clave: 'usgs', icono: '🛰️', nombre: 'USGS', color: '#38BDF8' },
];

/** Por que falta una fuente. Cada ausencia significa algo distinto. */
const AUSENCIA = {
  google: 'no avisó',
  sensor: 'no midió sacudida',
  usgs: 'aún no confirma',
};

function datosDeFuente(clave, ep) {
  const f = ep.fuentes?.[clave];
  if (!f) return null;

  if (clave === 'google') {
    const partes = [];
    if (f.magTexto) partes.push(`M${f.magTexto}`);
    if (f.distTexto) partes.push(`a ${f.distTexto}`);
    return {
      dato: partes.join(' · ') || 'Alerta recibida',
      nota: f.canal === 'eew_alert_v2' ? 'Toma medidas' : (f.canal || null),
    };
  }

  if (clave === 'sensor') {
    const romano = mmiRomano(f.mmiEstimada);
    const partes = [];
    if (f.pgaG != null) partes.push(`${f.pgaG.toFixed(3)} g`);
    if (romano) partes.push(`MMI ~${romano}`);
    return {
      dato: partes.join(' · ') || 'Medido',
      nota: {
        suelo: 'sacudida confirmada',
        manipulacion: 'pudo ser el usuario',
        indeterminado: 'origen no distinguible',
      }[f.veredicto] || null,
    };
  }

  // USGS: los datos que ninguna otra fuente trae y que hacen falta si hay
  // catastrofe. Por eso llegar tarde no lo degrada.
  const s = ep.sismo || ep.fuentes?.usgs?.entrada?.sismo || {};
  const partes = [];
  if (s.mag != null) partes.push(`M${s.mag}`);
  if (s.profundidadKm != null) partes.push(`${Math.round(s.profundidadKm)} km prof.`);
  return {
    dato: partes.join(' · ') || 'Confirmado',
    nota: s.status === 'reviewed' ? 'revisado por experto' : 'automático (preliminar)',
  };
}

/** Cuanto tardo esta fuente desde que ocurrio el sismo. */
function retrasoDe(clave, desfases) {
  const v = {
    google: desfases?.retrasoGoogleSeg,
    sensor: desfases?.retrasoSensorSeg,
    usgs: desfases?.retrasoUsgsSeg,
  }[clave];
  return v == null ? null : v;
}

function Fila({ fuente, ep, desfases }) {
  const datos = datosDeFuente(fuente.clave, ep);
  const llego = datos !== null;
  const retraso = llego ? retrasoDe(fuente.clave, desfases) : null;

  return (
    <View style={styles.fila}>
      <Text style={[styles.icono, !llego && styles.apagado]}>{fuente.icono}</Text>

      <Text style={[styles.nombre, { color: llego ? fuente.color : '#475569' }]}>
        {fuente.nombre}
      </Text>

      <Text style={[styles.retraso, !llego && styles.apagado]}>
        {retraso != null ? `+${duracion(retraso)}` : ''}
      </Text>

      <View style={styles.datosCol}>
        <Text style={[styles.dato, !llego && styles.apagado]} numberOfLines={1}>
          {llego ? datos.dato : AUSENCIA[fuente.clave]}
        </Text>
        {llego && datos.nota && (
          <Text style={styles.nota} numberOfLines={1}>{datos.nota}</Text>
        )}
      </View>
    </View>
  );
}

/**
 * Las dos lineas que justifican toda la arquitectura.
 *
 * El aviso previo es el numero que la especificacion tiene calculado en teoria
 * (23-58 s en Medellin) pero nunca medido en el sitio. La concordancia es lo
 * que habria delatado el fallo de Turquia 2023, donde Google estimo M4.5-4.9
 * lo que era M7.8.
 */
function Conclusiones({ ep, desfases }) {
  const lineas = [];

  if (desfases?.avisoPrevioSeg != null && desfases.avisoPrevioSeg > 0) {
    lineas.push(`Te avisó ${duracion(desfases.avisoPrevioSeg)} antes de la sacudida.`);
  } else if (ep.fuentes?.google && ep.fuentes?.sensor) {
    lineas.push('La sacudida llegó antes que el aviso: no hubo margen.');
  }

  const magGoogle = ep.fuentes?.google?.magTexto ? Number(ep.fuentes.google.magTexto) : null;
  const magUsgs = ep.sismo?.mag ?? ep.fuentes?.usgs?.entrada?.sismo?.mag ?? null;
  if (magGoogle != null && magUsgs != null && !Number.isNaN(magGoogle)) {
    const dif = Math.abs(magGoogle - magUsgs);
    lineas.push(
      dif >= 0.5
        ? `Google estimó M${magGoogle} y el USGS confirmó M${magUsgs}: se contradicen.`
        : `Google estimó M${magGoogle} · el USGS confirmó M${magUsgs}.`
    );
  }

  if (!ep.fuentes?.google && ep.fuentes?.usgs) {
    lineas.push('Sin alerta de Google: solo se supo por el feed, minutos después.');
  }

  if (desfases && desfases.origenExacto === false) {
    lineas.push('Los tiempos son estimados: el USGS todavía no ha fijado la hora del sismo.');
  }

  if (!lineas.length) return null;

  return (
    <View style={styles.conclusiones}>
      {lineas.map((l, i) => (
        <Text key={i} style={styles.conclusion}>• {l}</Text>
      ))}
    </View>
  );
}

export default function UltimoEvento({ refrescarCada = 15000 }) {
  const [ep, setEp] = useState(null);
  const [abierto, setAbierto] = useState(false);

  const recargar = useCallback(async () => {
    // Un episodio abierto manda sobre el ultimo cerrado: es el que esta
    // ocurriendo ahora, y es cuando esta tarjeta importa de verdad.
    const vivo = await episodioAbierto();
    if (vivo) {
      setEp(vivo);
      setAbierto(true);
      return;
    }
    setEp(await ultimoEpisodio());
    setAbierto(false);
  }, []);

  useEffect(() => {
    recargar();
    const t = setInterval(recargar, refrescarCada);
    return () => clearInterval(t);
  }, [recargar, refrescarCada]);

  if (!ep) return null;

  // Un episodio abierto todavia esta cambiando, asi que sus desfases se
  // recalculan al vuelo; uno cerrado ya los trae congelados.
  const desfases = abierto ? calcularDesfases(ep) : ep.desfases;
  const cuando = ep.origenEstimado || ep.abiertoEn;

  return (
    <View style={[styles.tarjeta, abierto && styles.tarjetaViva]}>
      <TouchableOpacity onPress={recargar} activeOpacity={0.7}>
        <View style={styles.cabecera}>
          <Text style={styles.titulo}>
            {abierto ? '🔴 Evento en curso' : 'Último evento sísmico'}
          </Text>
          <Text style={styles.cuando}>{formatearFecha(cuando)}</Text>
        </View>
      </TouchableOpacity>

      {FUENTES.map((f) => (
        <Fila key={f.clave} fuente={f} ep={ep} desfases={desfases} />
      ))}

      <Conclusiones ep={ep} desfases={desfases} />

      {abierto && (
        <Text style={styles.pie}>
          Sigue abierto por si llegan más fuentes. Se cierra y pasa a la bitácora
          al cabo de 15 minutos.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: {
    backgroundColor: '#1E293B',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
    borderLeftColor: '#38BDF8',
    borderLeftWidth: 5,
  },
  tarjetaViva: {
    borderLeftColor: '#EF4444',
    borderColor: '#7F1D1D',
  },
  cabecera: {
    marginBottom: 16,
  },
  titulo: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  cuando: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#0F172A',
  },
  icono: {
    fontSize: 15,
    width: 24,
  },
  nombre: {
    fontSize: 12,
    fontWeight: '800',
    width: 58,
  },
  retraso: {
    fontSize: 12,
    color: '#E2E8F0',
    fontWeight: '700',
    width: 74,
  },
  datosCol: {
    flex: 1,
  },
  dato: {
    fontSize: 12,
    color: '#E2E8F0',
    fontWeight: '600',
  },
  nota: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  apagado: {
    color: '#475569',
  },
  conclusiones: {
    marginTop: 14,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
  },
  conclusion: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 19,
  },
  pie: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 12,
    lineHeight: 16,
  },
});
