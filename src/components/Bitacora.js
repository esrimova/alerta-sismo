// src/components/Bitacora.js
//
// Vista del registro de eventos. Vive al pie de la pantalla de configuracion,
// donde antes estaba el enlace de "Configuracion Tecnica".
//
// Dos decisiones de diseño:
//
//  - Cada entrada se muestra colapsada (nivel, hora, magnitud, lugar) y se
//    expande al tocarla. Se GUARDA todo, pero mostrarlo todo de golpe haria
//    ilegible el registro justo cuando mas se necesita leerlo rapido.
//
//  - Se renderizan de a 50. El almacenamiento no tiene tope —eso es requisito—
//    pero pintar miles de filas dentro de un ScrollView si trabaria la app.

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import {
  cargarBitacora, borrarBitacora, tamanoAproximado, BYTES_AVISO, TIPO,
} from '../services/bitacora';
import { fechaCompleta, duracion } from '../utils/fecha';
import { mmiRomano, describirMmi } from '../services/sismografo';

const PAGINA = 50;

/** Aspecto de cada tipo de entrada en la fila colapsada. */
const NIVEL_VISUAL = {
  red: { icono: '🔴', nombre: 'Informativa de Emergencia', color: '#EF4444' },
  orange: { icono: '🟠', nombre: 'Alerta Naranja', color: '#F97316' },
  yellow: { icono: '🟡', nombre: 'Alerta Amarilla', color: '#EAB308' },
  lejano: { icono: 'ℹ️', nombre: 'Sismo fuerte lejano', color: '#94A3B8' },
};

const TIPO_VISUAL = {
  [TIPO.PROTOCOLO]: { icono: '🆘', nombre: 'Protocolo de emergencia', color: '#F97316' },
  [TIPO.RED]: { icono: '🌐', nombre: 'Conectividad', color: '#38BDF8' },
  // No dice "USGS" porque aqui cae tambien la escucha de Google al quedarse
  // sin permiso, y esa es la fuente rapida. Cual fue lo dice el detalle.
  [TIPO.SERVICIO]: { icono: '📡', nombre: 'Fuente de datos', color: '#A78BFA' },
  [TIPO.SISTEMA]: { icono: '⚙️', nombre: 'Sistema', color: '#64748B' },
};

/** Nombre legible de la regla que disparo la alerta. */
const REGLAS = {
  fuerte_cercano: 'Sismo fuerte y cercano',
  fuerte_lejano: 'Sismo fuerte pero lejano',
  somero_cercano: 'Somero y cercano',
  social_reportes: 'Muchos reportes ciudadanos',
  sacudida_percibida: 'Sacudida percibida',
  enjambre: 'Enjambre sísmico',
  simulacion: 'Simulación manual',
};

/** Quien abrio el episodio. Es lo primero que se quiere saber al auditarlo. */
const DISPAROS = {
  google: 'la alerta de Google',
  sensor: 'el acelerómetro del teléfono',
  usgs: 'el feed del USGS',
};

const VEREDICTOS = {
  suelo: 'El suelo se movió',
  manipulacion: 'Pudo ser el usuario moviendo el teléfono',
  indeterminado: 'No se pudo distinguir',
  sin_sacudida: 'Sin sacudida',
};

function aspecto(entrada) {
  if (entrada.tipo === TIPO.EPISODIO) {
    const base = NIVEL_VISUAL[entrada.nivel];
    // Un episodio conserva el color de su nivel —es el mismo sismo— pero lleva
    // icono propio: lo que lo distingue es que ya cruzo todas las fuentes.
    return {
      icono: '🧩',
      nombre: base ? `Episodio · ${base.nombre}` : 'Episodio sísmico',
      color: base?.color || '#38BDF8',
    };
  }
  if (entrada.tipo === TIPO.ALERTA) {
    return NIVEL_VISUAL[entrada.nivel] || { icono: '•', nombre: entrada.nivel, color: '#94A3B8' };
  }
  return TIPO_VISUAL[entrada.tipo] || { icono: '•', nombre: entrada.tipo, color: '#94A3B8' };
}

/** Una fila etiqueta/valor. Omite el valor vacio en vez de mostrar "null". */
function Dato({ etiqueta, valor, sufijo = '' }) {
  if (valor === null || valor === undefined || valor === '') return null;
  return (
    <View style={styles.fila}>
      <Text style={styles.etiqueta}>{etiqueta}</Text>
      <Text style={styles.valor}>{`${valor}${sufijo}`}</Text>
    </View>
  );
}

function Seccion({ titulo, children }) {
  const hayAlgo = React.Children.toArray(children).some((c) => c);
  if (!hayAlgo) return null;
  return (
    <View style={styles.seccion}>
      <Text style={styles.seccionTitulo}>{titulo}</Text>
      {children}
    </View>
  );
}

/** Numero de segundos legible, o nada si la fuente no llego. */
function seg(v) {
  return v === null || v === undefined ? null : duracion(v);
}

function Detalle({ entrada }) {
  const { sismo, evaluacion, acciones, detalleEnjambre, fuentes, desfases } = entrada;
  const google = fuentes?.google;
  const sensor = fuentes?.sensor;

  return (
    <View style={styles.detalle}>
      {entrada.detalle && <Text style={styles.parrafo}>{entrada.detalle}</Text>}

      <Seccion titulo="Contexto">
        <Dato etiqueta="Sismo que lo originó" valor={entrada.sismoTexto} />
        <Dato etiqueta="Plazo de espera" valor={entrada.minutosEspera} sufijo=" min" />
        <Dato etiqueta="Vencía" valor={entrada.venceEn ? fechaCompleta(entrada.venceEn) : null} />
        <Dato
          etiqueta="Confirmación"
          valor={entrada.trasActivacion === true ? 'Llegó tarde' : (entrada.trasActivacion === false ? 'A tiempo' : null)}
        />
        <Dato etiqueta="Origen" valor={entrada.origen} />
        <Dato etiqueta="Modo avión" valor={entrada.modoAvion ? 'Sí' : null} />
        <Dato etiqueta="Motivo" valor={entrada.motivo} />
        <Dato etiqueta="Lo detectó primero" valor={DISPAROS[entrada.disparo]} />
        <Dato
          etiqueta="Alarma"
          valor={entrada.silenciada ? 'No sonó: ya había sonado por otra fuente' : null}
        />
      </Seccion>

      {/* Lo que dijo Google. Se guarda el texto TAL COMO LLEGO, sin depender de
          haberlo sabido interpretar: Google nunca publico una API y su
          redaccion puede cambiar sin aviso. Si el parseo falla, el texto crudo
          sigue siendo la unica prueba de lo que dijo. */}
      <Seccion titulo="Alerta de Google">
        <Dato etiqueta="Canal" valor={google?.canal} />
        <Dato
          etiqueta="Recibida"
          valor={google?.recibidoEn ? fechaCompleta(google.recibidoEn) : null}
        />
        <Dato etiqueta="Tardó en avisar" valor={seg(desfases?.retrasoGoogleSeg)} />
        <Dato etiqueta="Magnitud que estimó" valor={google?.magTexto} />
        <Dato etiqueta="Distancia que dio" valor={google?.distTexto} />
        <Dato etiqueta="Título" valor={google?.titulo} />
        <Dato etiqueta="Texto" valor={google?.texto} />
        <Dato etiqueta="Texto largo" valor={google?.bigText} />
      </Seccion>

      {/* La medida local: lo unico que dice que paso en ESTA direccion. La
          intensidad se calcula a partir de la aceleracion con una relacion
          calibrada con sismometros, no con telefonos, asi que va rotulada como
          estimacion en todas partes. */}
      <Seccion titulo="Medición local">
        <Dato
          etiqueta="Aceleración máxima"
          valor={sensor?.pgaG != null ? sensor.pgaG.toFixed(3) : null}
          sufijo=" g"
        />
        <Dato
          etiqueta="Intensidad estimada"
          valor={sensor?.mmiEstimada != null ? mmiRomano(sensor.mmiEstimada) : null}
          sufijo={sensor && sensor.mmiEnRango === false ? ' (fuera del rango válido)' : ''}
        />
        <Dato etiqueta="Equivale a" valor={sensor ? describirMmi(sensor.mmiEstimada) : null} />
        <Dato
          etiqueta="Sacudida sostenida"
          valor={sensor?.duracionFuerteSeg != null ? sensor.duracionFuerteSeg.toFixed(1) : null}
          sufijo=" s"
        />
        <Dato
          etiqueta="Llegó la onda"
          valor={sensor?.onsetEn ? fechaCompleta(sensor.onsetEn) : null}
        />
        <Dato etiqueta="Origen del movimiento" valor={VEREDICTOS[sensor?.veredicto]} />
        <Dato
          etiqueta="Rotación máxima"
          valor={sensor?.giroPicoRads != null ? sensor.giroPicoRads.toFixed(2) : null}
          sufijo=" rad/s"
        />
        <Dato
          etiqueta="Muestreo real"
          valor={sensor?.hzReal != null ? Math.round(sensor.hzReal) : null}
          sufijo=" Hz"
        />
        <Dato etiqueta="La disparó" valor={DISPAROS[sensor?.disparadaPor] || sensor?.disparadaPor} />
      </Seccion>

      {/* La seccion que permite auditar si esta arquitectura sirve. El aviso
          previo es el numero que decide si la alerta de Google llega a tiempo
          en este sitio, y hasta ahora solo existia calculado en teoria. */}
      <Seccion titulo="Concordancia entre fuentes">
        <Dato etiqueta="Aviso previo a la sacudida" valor={seg(desfases?.avisoPrevioSeg)} />
        <Dato etiqueta="Google se adelantó al USGS" valor={seg(desfases?.googleAUsgsSeg)} />
        <Dato etiqueta="El sensor se adelantó al USGS" valor={seg(desfases?.sensorAUsgsSeg)} />
        <Dato etiqueta="Tardanza del sensor" valor={seg(desfases?.retrasoSensorSeg)} />
        <Dato etiqueta="Tardanza del USGS" valor={seg(desfases?.retrasoUsgsSeg)} />
        <Dato
          etiqueta="Hora del sismo"
          valor={entrada.origenEstimado ? fechaCompleta(entrada.origenEstimado) : null}
          sufijo={entrada.origenExacto ? ' (medida)' : ' (estimada)'}
        />
      </Seccion>

      <Seccion titulo="Sismo">
        <Dato etiqueta="Magnitud" valor={sismo?.mag} sufijo={sismo?.magType ? ` (${sismo.magType})` : ''} />
        <Dato etiqueta="Profundidad" valor={sismo?.profundidadKm != null ? Math.round(sismo.profundidadKm) : null} sufijo=" km" />
        <Dato etiqueta="Lugar" valor={sismo?.lugar} />
        <Dato etiqueta="Hora del sismo" valor={sismo?.hora ? fechaCompleta(sismo.hora) : null} />
        <Dato etiqueta="Coordenadas" valor={sismo?.lat != null ? `${sismo.lat.toFixed(3)}, ${sismo.lon.toFixed(3)}` : null} />
        <Dato etiqueta="Identificador" valor={sismo?.id} />
      </Seccion>

      <Seccion titulo="Evaluación">
        <Dato etiqueta="Distancia a ti" valor={evaluacion?.distanciaKm != null ? Math.round(evaluacion.distanciaKm) : null} sufijo=" km" />
        <Dato etiqueta="Alcance aplicado" valor={evaluacion?.alcanceKm} sufijo=" km" />
        <Dato
          etiqueta="Retraso de detección"
          valor={evaluacion?.retrasoSeg != null ? duracion(evaluacion.retrasoSeg) : null}
        />
        <Dato
          etiqueta="Intensidad percibida"
          valor={evaluacion?.intensidad}
          sufijo={evaluacion?.fuenteIntensidad ? ` (${evaluacion.fuenteIntensidad})` : ''}
        />
        <Dato etiqueta="Reportes ciudadanos" valor={evaluacion?.felt} />
        <Dato etiqueta="Riesgo de tsunami" valor={evaluacion?.tsunami ? 'Sí' : null} />
        <Dato
          etiqueta="Tu zona"
          valor={evaluacion?.zona ? `${evaluacion.zona.etiqueta} · ${evaluacion.zona.origen} · ${evaluacion.zona.radioKm} km` : null}
        />
      </Seccion>

      <Seccion titulo="Calidad del dato">
        <Dato
          etiqueta="Estado"
          valor={sismo?.status === 'reviewed' ? 'Revisado por un experto' : (sismo?.status === 'automatic' ? 'Automático (preliminar)' : sismo?.status)}
        />
        <Dato etiqueta="Actualizado por USGS" valor={sismo?.actualizado ? fechaCompleta(sismo.actualizado) : null} />
        <Dato etiqueta="Estaciones" valor={sismo?.nst} />
        <Dato etiqueta="Estación más cercana" valor={sismo?.dmin} />
        <Dato etiqueta="Error RMS" valor={sismo?.rms} />
        <Dato etiqueta="Gap azimutal" valor={sismo?.gap} sufijo="°" />
      </Seccion>

      <Seccion titulo="Lo que hizo la app">
        <Dato etiqueta="Notificación" valor={acciones?.notificacion ? 'Emitida' : null} />
        <Dato etiqueta="Pantalla completa" valor={acciones?.pantallaCompleta ? 'Encendió la pantalla' : null} />
        <Dato etiqueta="Sonido" valor={acciones?.sonido} />
        <Dato etiqueta="Destello" valor={acciones?.luz} />
        <Dato etiqueta="Linterna" valor={acciones?.linterna ? 'Sí' : null} />
        <Dato etiqueta="Vibración" valor={acciones?.vibracion} />
        <Dato
          etiqueta="Cuenta atrás"
          valor={acciones?.cuentaAtras ? `Iniciada, vence ${fechaCompleta(acciones.cuentaAtras)}` : null}
        />
      </Seccion>

      {detalleEnjambre && (
        <Seccion titulo="Enjambre">
          <Dato etiqueta="Sismos detectados" valor={detalleEnjambre.conteo} />
          <Dato etiqueta="Ventana" valor={detalleEnjambre.ventanaMin} sufijo=" min" />
          <Dato etiqueta="Radio" valor={detalleEnjambre.radioKm} sufijo=" km" />
          {detalleEnjambre.eventos?.map((e) => (
            <Dato key={e.id} etiqueta={`M${e.mag}`} valor={fechaCompleta(e.hora)} />
          ))}
        </Seccion>
      )}

      {entrada.mecanismos && (
        <Seccion titulo="Mecanismos activados">
          <Dato
            etiqueta="Baliza Bluetooth"
            valor={entrada.mecanismos.bluetooth?.ok
              ? `Activa como "${entrada.mecanismos.bluetooth.nombre}"`
              : `Falló: ${entrada.mecanismos.bluetooth?.motivo || 'desconocido'}`}
          />
          <Dato etiqueta="Baliza sonora" valor={entrada.mecanismos.sonido ? 'Activa' : 'No activada'} />
        </Seccion>
      )}
    </View>
  );
}

function Entrada({ entrada, abierta, onToggle }) {
  const v = aspecto(entrada);
  const esAlerta = entrada.tipo === TIPO.ALERTA;
  const mag = entrada.sismo?.mag;
  const dist = entrada.evaluacion?.distanciaKm;

  return (
    <View style={styles.entrada}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.cabecera}>
          <Text style={styles.icono}>{v.icono}</Text>
          <View style={styles.cabeceraTexto}>
            <Text style={[styles.nombreNivel, { color: v.color }]} numberOfLines={1}>
              {v.nombre}
              {entrada.simulado ? '  · SIMULACIÓN' : ''}
            </Text>
            <Text style={styles.resumen} numberOfLines={1}>
              {esAlerta && mag != null
                ? `M${mag} · ${entrada.sismo.lugar || 'sin ubicación'}${dist != null ? ` · a ${Math.round(dist)} km` : ''}`
                : entrada.detalle || entrada.subtipo}
            </Text>
            <Text style={styles.hora}>{fechaCompleta(entrada.ts)}</Text>
          </View>
          <Text style={styles.flecha}>{abierta ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {abierta && (
        <>
          {esAlerta && entrada.regla && (
            <Text style={styles.regla}>Regla: {REGLAS[entrada.regla] || entrada.regla}</Text>
          )}
          <Detalle entrada={entrada} />
        </>
      )}
    </View>
  );
}

export default function Bitacora() {
  const [visible, setVisible] = useState(false);
  const [entradas, setEntradas] = useState([]);
  const [limite, setLimite] = useState(PAGINA);
  const [expandida, setExpandida] = useState(null);
  const [bytes, setBytes] = useState(0);

  const recargar = useCallback(async () => {
    setEntradas(await cargarBitacora());
    setBytes(await tamanoAproximado());
  }, []);

  // Solo se lee al abrir: recorrer un registro grande en cada render de la
  // pantalla de configuracion seria un desperdicio.
  useEffect(() => {
    if (visible) recargar();
  }, [visible, recargar]);

  const confirmarBorrado = () => {
    Alert.alert(
      'Borrar la bitácora',
      `Se eliminarán las ${entradas.length} entradas registradas. Esto no se puede deshacer: es el único registro de lo que ocurrió durante las emergencias.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar todo',
          style: 'destructive',
          onPress: async () => {
            await borrarBitacora();
            setExpandida(null);
            setLimite(PAGINA);
            await recargar();
          },
        },
      ]
    );
  };

  if (!visible) {
    return (
      <View style={styles.toggle}>
        <TouchableOpacity onPress={() => setVisible(true)}>
          <Text style={styles.toggleTexto}>Ver bitácora de eventos</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const mostradas = entradas.slice(0, limite);

  return (
    <>
      <View style={styles.toggle}>
        <TouchableOpacity onPress={() => setVisible(false)}>
          <Text style={styles.toggleTexto}>Ocultar bitácora</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tarjeta}>
        <Text style={styles.titulo}>📓 Bitácora de eventos</Text>

        {entradas.length === 0 ? (
          <Text style={styles.vacio}>
            Sin eventos registrados. Aquí quedará constancia de cada alerta, de las
            activaciones del protocolo de emergencia y de los cortes de conexión.
          </Text>
        ) : (
          <>
            <Text style={styles.conteo}>
              {entradas.length} {entradas.length === 1 ? 'evento registrado' : 'eventos registrados'}
            </Text>

            {bytes > BYTES_AVISO && (
              <View style={styles.aviso}>
                <Text style={styles.avisoTexto}>
                  La bitácora ocupa ya {(bytes / 1048576).toFixed(1)} MB. Nada se borra solo,
                  pero conviene que la revises y la limpies cuando puedas.
                </Text>
              </View>
            )}

            {mostradas.map((e) => (
              <Entrada
                key={e.id}
                entrada={e}
                abierta={expandida === e.id}
                onToggle={() => setExpandida(expandida === e.id ? null : e.id)}
              />
            ))}

            {entradas.length > limite && (
              <TouchableOpacity
                style={styles.boton}
                onPress={() => setLimite(limite + PAGINA)}
              >
                <Text style={styles.botonTexto}>
                  Mostrar {Math.min(PAGINA, entradas.length - limite)} más
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.boton, { backgroundColor: '#EF4444', marginTop: 20 }]}
              onPress={confirmarBorrado}
            >
              <Text style={styles.botonTexto}>Borrar datos</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  toggle: {
    padding: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  toggleTexto: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
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
  titulo: {
    fontSize: 20,
    fontWeight: '800',
    color: '#38BDF8',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  conteo: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 16,
    fontWeight: '600',
  },
  vacio: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 20,
  },
  aviso: {
    backgroundColor: '#78350F',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  avisoTexto: {
    color: '#FDE68A',
    fontSize: 12,
  },
  entrada: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingVertical: 12,
  },
  cabecera: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icono: {
    fontSize: 18,
    marginRight: 12,
  },
  cabeceraTexto: {
    flex: 1,
  },
  nombreNivel: {
    fontSize: 14,
    fontWeight: '800',
  },
  resumen: {
    fontSize: 13,
    color: '#E2E8F0',
    marginTop: 2,
  },
  hora: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  flecha: {
    color: '#64748B',
    fontSize: 12,
    marginLeft: 10,
  },
  regla: {
    fontSize: 12,
    color: '#38BDF8',
    fontWeight: '700',
    marginTop: 10,
  },
  detalle: {
    marginTop: 10,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
  },
  parrafo: {
    fontSize: 13,
    color: '#CBD5E1',
    lineHeight: 19,
    marginBottom: 10,
  },
  seccion: {
    marginBottom: 14,
  },
  seccionTitulo: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  fila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  etiqueta: {
    fontSize: 12,
    color: '#94A3B8',
    flex: 1,
  },
  valor: {
    fontSize: 12,
    color: '#E2E8F0',
    fontWeight: '600',
    textAlign: 'right',
    flex: 1.2,
  },
  boton: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
    backgroundColor: '#334155',
  },
  botonTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
