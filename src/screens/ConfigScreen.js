import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView, AppState, Modal } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Checkbox from 'expo-checkbox';
import { COLOMBIA_CITIES } from '../utils/colombia';
import { loadSettings, saveSettings } from '../services/settings';
import { requestPermissions, triggerAlert, stopForegroundAlert } from '../services/alert';
import { registerBackgroundFetchAsync, unregisterBackgroundFetchAsync } from '../services/background';
import { iniciarServicioPrimerPlano, detenerServicioPrimerPlano } from '../services/foreground';
import { fetchRecentEarthquakes, ENDPOINT_SISMOS } from '../services/api';
import { loadHealth, registrarResultado, calcularEstado, ESTADO } from '../services/health';
import { getUserLocationCoordinates, construirEntradaAlerta } from '../services/monitor';
import { registrarEvento } from '../services/bitacora';
import { formatearFecha } from '../utils/fecha';
import Bitacora from '../components/Bitacora';
import UltimoEvento from '../components/UltimoEvento';
import { actualizarUbicacion, cargarUbicacionGuardada } from '../services/location';
import {
  cargarConfigEmergencia, guardarConfigEmergencia, cargarEstadoEmergencia,
  confirmarEstoyBien, pedirPermisosBluetooth,
  estadoBluetooth, activarProtocolo, textoDeBaliza,
} from '../services/emergencia';
import {
  componerFicha, fichaTieneContenido, balizaPorDefecto, MAX_BALIZA, evaluarSiEstaEnCasa,
} from '../services/ficha';
import { puedePantallaCompleta, abrirAjustesPantallaCompleta } from '../../modules/emergencia';
import {
  disponibilidad as sensorDisponibilidad, medirPrueba, detener as detenerSensor,
  alMedir, cargarUltimaMedicion, mmiRomano, describirMmi, VENTANAS_SEG,
} from '../services/sismografo';
import { estadoEscucha, abrirAjustesEscucha } from '../services/escucha';
import { estadoConexion } from '../services/red';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Colores del destello segun lo configurado por el usuario.
const FLASH_COLORS = { red: '#FF0000', orange: '#FFA500', white: '#FFFFFF' };

/**
 * Permiso y vinculacion son cosas distintas y la interfaz tiene que separarlas.
 * Android 14+ no vincula el servicio hasta el primer desbloqueo tras reiniciar,
 * asi que decir solo "concedido" haria creer que todo esta listo cuando no
 * llegaria ninguna alerta.
 */
function colorEscucha(e) {
  if (!e?.permiso) return '#94A3B8';
  return e.vinculado ? '#22C55E' : '#F59E0B';
}

function textoEscucha(e) {
  if (!e?.permiso) return 'SIN PERMISO';
  return e.vinculado ? 'ESCUCHANDO' : 'EN ESPERA';
}

export default function ConfigScreen({ isFlashing, startAlarm, stopAlarm }) {
  const [settings, setSettings] = useState(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [salud, setSalud] = useState(null);
  const [probando, setProbando] = useState(false);
  const [ubicacion, setUbicacion] = useState(null);
  const [ubicando, setUbicando] = useState(false);
  const [emerg, setEmerg] = useState(null);
  const [estadoEmerg, setEstadoEmerg] = useState(null);
  const [pantallaOk, setPantallaOk] = useState(true);
  const [sensor, setSensor] = useState(null);
  const [medicion, setMedicion] = useState(null);
  const [midiendo, setMidiendo] = useState(0);
  const [escucha, setEscucha] = useState(null);
  const [fichaAbierta, setFichaAbierta] = useState(false);

  useEffect(() => {
    initSettings();
    refrescarSalud();
    // Mantiene el semaforo al dia mientras la pantalla esta abierta.
    const t = setInterval(refrescarSalud, 30000);
    return () => clearInterval(t);
  }, []);

  /**
   * La medida llega por evento, no como respuesta: la ventana dura segundos o
   * minutos y bloquear la interfaz mientras tanto no tendria sentido.
   */
  useEffect(() => {
    setSensor(sensorDisponibilidad());
    setEscucha(estadoEscucha());
    cargarUltimaMedicion().then((m) => { if (m) setMedicion(m); });

    const sub = alMedir((m) => {
      setMedicion(m);
      setMidiendo(0);
      setSensor(sensorDisponibilidad());
    });
    return () => sub.remove();
  }, []);

  /**
   * El permiso de escucha se concede FUERA de la app, en los ajustes del
   * sistema, asi que al volver hay que releerlo: si no, el semaforo seguiria
   * diciendo "sin permiso" despues de haberlo concedido.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') {
        setEscucha(estadoEscucha());
        setSensor(sensorDisponibilidad());
      }
    });
    return () => sub.remove();
  }, []);

  // Cuenta atras visible durante la prueba. Sin ella, pulsar "probar" no
  // produce ninguna señal y parece que la app no hizo nada.
  useEffect(() => {
    if (midiendo <= 0) return undefined;
    const t = setInterval(() => setMidiendo((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [midiendo > 0]);

  const initSettings = async () => {
    const loaded = await loadSettings();
    setSettings(loaded);
    const monitoringState = await AsyncStorage.getItem('isMonitoring');
    setIsMonitoring(monitoringState === 'true');

    // La ubicacion se refresca al abrir la app, no en segundo plano: asi se
    // evita pedir ACCESS_BACKGROUND_LOCATION, que es mucho mas intrusivo.
    setUbicacion(await cargarUbicacionGuardada());
    if (loaded.autoLocation) {
      const r = await actualizarUbicacion(false);
      if (r.ubicacion) setUbicacion(r.ubicacion);
    }

    setEmerg(await cargarConfigEmergencia());
    setEstadoEmerg(await cargarEstadoEmergencia());
    try { setPantallaOk(puedePantallaCompleta()); } catch (e) { setPantallaOk(true); }
  };

  const actualizarEmerg = async (campo, valor) => {
    const nueva = { ...emerg, [campo]: valor };
    setEmerg(nueva);
    await guardarConfigEmergencia(nueva);
  };

  const actualizarFicha = async (campo, valor) => {
    const nueva = { ...emerg, ficha: { ...(emerg.ficha || {}), [campo]: valor } };
    setEmerg(nueva);
    await guardarConfigEmergencia(nueva);
  };

  /**
   * Guarda dónde queda la casa, leyendo el GPS ahora mismo.
   *
   * Se pide en un momento tranquilo y a propósito: durante una emergencia el
   * usuario puede estar inconsciente, y no hay quien conteste un diálogo.
   */
  const marcarCasaAqui = async () => {
    setUbicando(true);
    try {
      const r = await actualizarUbicacion(true);
      if (!r.ok || !r.ubicacion) {
        Alert.alert(
          'No se pudo leer el GPS',
          r.motivo === 'permiso_denegado'
            ? 'Hace falta el permiso de ubicación para marcar dónde queda tu casa.'
            : 'Inténtalo cerca de una ventana o al aire libre.'
        );
        return;
      }
      setUbicacion(r.ubicacion);
      const nueva = {
        ...emerg,
        ficha: { ...(emerg.ficha || {}), casaLat: r.ubicacion.lat, casaLon: r.ubicacion.lon },
      };
      setEmerg(nueva);
      await guardarConfigEmergencia(nueva);
      Alert.alert(
        'Casa marcada',
        'A partir de ahora tu dirección solo se enviará cuando el teléfono crea que estás cerca de aquí.'
      );
    } finally {
      setUbicando(false);
    }
  };

  /**
   * Muestra el mensaje exacto que recibirá quien te encuentre.
   *
   * Es la única forma de que el usuario compruebe qué está a punto de compartir
   * de su historia clínica. Sin verlo, estaría confiando a ciegas en una app que
   * va a repartir sus datos médicos a desconocidos.
   */
  const verFicha = async () => {
    if (!fichaTieneContenido(emerg)) {
      Alert.alert(
        'La ficha está vacía',
        'No has llenado ningún campo, así que quien te encuentre solo recibiría el aviso genérico. Llena al menos el apartamento y el tipo de sangre.'
      );
      return;
    }
    // Se simula "activado justo ahora" para que se vea la sección de situación.
    const simulado = { activadaEn: Date.now() };
    const red = await estadoConexion();
    Alert.alert('Así lo recibirá', componerFicha(emerg, simulado, ubicacion, red));
  };

  const alternarProtocolo = async (valor) => {
    if (valor) {
      // El permiso se pide AL ACTIVAR, no en plena emergencia: si el usuario
      // esta inconsciente no hay quien acepte un diálogo.
      const bt = await pedirPermisosBluetooth();
      // Aunque se deniegue, el protocolo se activa igual: la baliza sonora no
      // necesita ningun permiso. Abortar aqui dejaba al usuario sin nada.
      if (!bt) {
        Alert.alert(
          'Bluetooth no disponible',
          'La baliza Bluetooth quedará desactivada, pero la baliza sonora sí funcionará: es el mecanismo con el que más se encuentra a personas bajo escombros.'
        );
      }
    }
    await actualizarEmerg('activo', valor);
  };

  const pulsarEstoyBien = async () => {
    await confirmarEstoyBien();
    setEstadoEmerg(await cargarEstadoEmergencia());
    Alert.alert('Confirmado', 'Se canceló el aviso a tus contactos.');
  };

  const probarProtocolo = async () => {
    const bt = estadoBluetooth();
    if (!bt.encendido) {
      Alert.alert(
        'Bluetooth apagado',
        'La app no puede encenderlo (Android lo prohíbe desde la versión 12). Enciéndelo y vuelve a probar.'
      );
      return;
    }
    Alert.alert(
      'Probar protocolo',
      `Se activará la baliza Bluetooth con el nombre "${textoDeBaliza(emerg)}".\n\nBusca ese nombre en la lista de Bluetooth de otro teléfono: aparece sin emparejar y sin instalar nada.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Probar',
          onPress: async () => {
            const r = await activarProtocolo();
            setEstadoEmerg(await cargarEstadoEmergencia());
            const okBt = r.bluetooth?.ok;
            Alert.alert(
              okBt ? 'Baliza activa' : 'La baliza falló',
              okBt
                ? `Visible como "${r.bluetooth.nombre}". Búscala desde otro teléfono y luego pulsa ESTOY BIEN para apagarla.`
                : `Motivo: ${r.bluetooth?.motivo || 'desconocido'}`
            );
          },
        },
      ]
    );
  };

  const alternarUbicacionAuto = async (valor) => {
    const nuevas = { ...settings, autoLocation: valor };
    setSettings(nuevas);
    await saveSettings(nuevas);
    if (!valor) return;

    setUbicando(true);
    try {
      const r = await actualizarUbicacion(true);
      if (r.ok && r.ubicacion) {
        setUbicacion(r.ubicacion);
        Alert.alert(
          'Ubicación detectada',
          `${r.ubicacion.etiqueta || 'Coordenadas obtenidas'}\n\nEl monitoreo usará esta zona. Se actualiza cada 12 horas al abrir la app.`
        );
      } else {
        const msg = r.motivo === 'permiso_denegado'
          ? 'Sin permiso de ubicación no se puede detectar la zona. Se seguirá usando la ciudad elegida a mano.'
          : 'No se pudo leer el GPS. Se seguirá usando la ciudad elegida a mano.';
        Alert.alert('No disponible', msg);
        const revertidas = { ...settings, autoLocation: false };
        setSettings(revertidas);
        await saveSettings(revertidas);
      }
    } finally {
      setUbicando(false);
    }
  };

  const refrescarUbicacionAhora = async () => {
    setUbicando(true);
    try {
      const r = await actualizarUbicacion(true);
      if (r.ubicacion) setUbicacion(r.ubicacion);
      Alert.alert(
        r.ok ? 'Ubicación actualizada' : 'No disponible',
        r.ok ? (r.ubicacion.etiqueta || 'Coordenadas obtenidas') : 'No se pudo leer el GPS.'
      );
    } finally {
      setUbicando(false);
    }
  };

  /**
   * Manda al usuario a los ajustes del sistema.
   *
   * El permiso de acceso a notificaciones no se puede pedir con un dialogo:
   * Android obliga a concederlo a mano en su propia pantalla, precisamente por
   * lo amplio que es.
   */
  const pedirEscucha = () => {
    Alert.alert(
      'Escuchar la alerta de Google',
      'Google avisa unos 18 segundos después del sismo; el feed del USGS tarda de 4 a 7 minutos. ' +
      'Para aprovecharlo, la app necesita acceso a las notificaciones.\n\n' +
      'Ten en cuenta que es un permiso amplio: técnicamente permite leer todas las notificaciones ' +
      'del teléfono. La app solo mira las de los canales de sismo de Google.\n\n' +
      'En la lista que se abre, busca "Alerta Sismo" y actívala.',
      [
        { text: 'Ahora no', style: 'cancel' },
        { text: 'Abrir ajustes', onPress: () => abrirAjustesEscucha() },
      ]
    );
  };

  const refrescarSalud = async () => {
    setSalud(await loadHealth());
  };

  const probarServicioAhora = async () => {
    setProbando(true);
    try {
      const resultado = await fetchRecentEarthquakes();
      const { salud: nueva } = await registrarResultado(resultado);
      setSalud(nueva);
      Alert.alert(
        resultado.ok ? 'Servicio operativo' : 'Servicio no disponible',
        resultado.ok
          ? `Se recibieron ${resultado.events.length} eventos en la última hora.`
          : resultado.error
      );
    } finally {
      setProbando(false);
    }
  };

  const actualizarContacto = async (i, campo, valor) => {
    const lista = [...(emerg.contactos || [])];
    lista[i] = { ...lista[i], [campo]: valor };
    const nueva = { ...emerg, contactos: lista };
    setEmerg(nueva);
    await guardarConfigEmergencia(nueva);
  };

  const anadirContacto = async () => {
    const nueva = { ...emerg, contactos: [...(emerg.contactos || []), { nombre: '', telefono: '' }] };
    setEmerg(nueva);
    await guardarConfigEmergencia(nueva);
  };

  const quitarContacto = async (i) => {
    const lista = (emerg.contactos || []).filter((_, n) => n !== i);
    const nueva = { ...emerg, contactos: lista };
    setEmerg(nueva);
    await guardarConfigEmergencia(nueva);
  };

  /**
   * Contactos de emergencia, en lista.
   *
   * Varios y no uno: tras un sismo, el único contacto podría estar tan
   * incomunicado como el afectado, porque suele ser familia o vecinos que
   * comparten la misma zona y la misma caída de red.
   */
  const renderContactos = () => {
    const lista = emerg.contactos || [];
    return (
      <View style={styles.subBloque}>
        <Text style={styles.label}>Contactos de emergencia</Text>

        {lista.length === 0 && (
          <Text style={styles.endpointTexto}>
            Sin contactos. Quien te encuentre no tendrá a quién avisar.
          </Text>
        )}

        {lista.map((c, i) => (
          <View key={i} style={styles.contactoFila}>
            <TextInput
              style={[styles.input, { flex: 1.1, marginRight: 8 }]}
              value={c.nombre}
              onChangeText={(v) => actualizarContacto(i, 'nombre', v)}
              placeholder="María Rivera"
              placeholderTextColor="#64748B"
            />
            <TextInput
              style={[styles.input, { flex: 1, marginRight: 8 }]}
              keyboardType="phone-pad"
              value={c.telefono}
              onChangeText={(v) => actualizarContacto(i, 'telefono', v)}
              placeholder="3001234567"
              placeholderTextColor="#64748B"
            />
            <TouchableOpacity onPress={() => quitarContacto(i)} style={styles.quitar}>
              <Text style={styles.quitarTexto}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.simButton, { backgroundColor: '#334155', marginTop: 8 }]}
          onPress={anadirContacto}
        >
          <Text style={styles.buttonText}>Añadir contacto</Text>
        </TouchableOpacity>

        <Text style={styles.endpointTexto}>
          Estos números los verá quien te encuentre. No pongas el tuyo: si estás
          inconsciente, a ti no te pueden llamar. Pon más de uno, porque tras un sismo
          el primero puede estar tan incomunicado como tú.
        </Text>
      </View>
    );
  };

  /**
   * Editor del texto de la baliza.
   *
   * El contador de caracteres no es un adorno: son 26 y el usuario no tiene por
   * qué saberlo. Sin verlo en vivo escribiría un texto que Android recorta en
   * silencio, y se enteraría en plena emergencia. Por eso se muestra siempre la
   * vista previa de lo que REALMENTE se va a emitir.
   */
  const renderBaliza = () => {
    const efectivo = textoDeBaliza(emerg);
    const escrito = (emerg.textoBaliza || '').trim();
    const seRecorta = escrito.length > MAX_BALIZA;

    return (
      <View style={styles.subBloque}>
        <Text style={styles.label}>Texto de la baliza</Text>
        <TextInput
          style={styles.input}
          value={emerg.textoBaliza}
          onChangeText={(v) => actualizarEmerg('textoBaliza', v)}
          placeholder={balizaPorDefecto(emerg) || 'SOS Esteban ap715 bitchat'}
          placeholderTextColor="#64748B"
        />

        <View style={styles.estadoFila}>
          <Text style={styles.estadoEtiqueta}>Caracteres</Text>
          <Text style={[
            styles.estadoValor,
            { fontWeight: '800', color: seRecorta ? '#EF4444' : '#22C55E' },
          ]}>
            {escrito.length} de {MAX_BALIZA}
          </Text>
        </View>

        <View style={styles.estadoFila}>
          <Text style={styles.estadoEtiqueta}>Se verá como</Text>
          <Text style={[styles.estadoValor, { fontWeight: '800' }]}>{efectivo}</Text>
        </View>

        <Text style={styles.endpointTexto}>
          {seRecorta
            ? 'Tu texto no cabe y se recortará. El anuncio Bluetooth son 31 bytes y solo caben 26 caracteres.'
            : 'Déjalo vacío y se arma solo con tu nombre y tu apartamento. Escribe uno propio si sueles estar fuera de casa: "apartamento 715" no dice nada si te pasa algo en la calle.'}
        </Text>
      </View>
    );
  };

  /**
   * Resumen de la ficha en la tarjeta. El detalle vive en un modal.
   *
   * Ocho campos en línea alargaban la pantalla de configuración hasta hacerla
   * incómoda, y esto se llena una vez en la vida. Aquí solo queda el estado.
   */
  const renderFicha = () => {
    const f = emerg.ficha || {};
    const lleno = fichaTieneContenido(emerg);
    const casaMarcada = f.casaLat != null;

    return (
      <View style={styles.subBloque}>
        <View style={styles.estadoFila}>
          <Text style={styles.estadoEtiqueta}>Ficha para quien te encuentre</Text>
          <Text style={[
            styles.estadoValor,
            { fontWeight: '800', color: lleno ? '#22C55E' : '#F59E0B' },
          ]}>
            {lleno ? 'LISTA' : 'VACÍA'}
          </Text>
        </View>

        {lleno && (
          <View style={styles.estadoFila}>
            <Text style={styles.estadoEtiqueta}>Dirección de casa</Text>
            <Text style={[
              styles.estadoValor,
              { color: casaMarcada ? '#E2E8F0' : '#F59E0B' },
            ]}>
              {!f.casa.trim()
                ? 'sin escribir'
                : (casaMarcada ? 'solo se envía si estás allí' : 'falta marcar dónde queda')}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.simButton, { backgroundColor: '#F97316' }]}
          onPress={() => setFichaAbierta(true)}
        >
          <Text style={styles.buttonText}>
            {lleno ? 'Editar la ficha' : 'Llenar la ficha'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  /**
   * Modal de la ficha: dos bloques de texto libre, no un formulario.
   *
   * Van separados por una razón funcional y no estética: el bloque de casa SOLO
   * se envía si el teléfono cree que estás allí. En un único bloque no habría
   * forma de mandar los datos médicos sin mandar también la dirección.
   */
  const renderModalFicha = () => {
    // La configuracion de emergencia se carga despues que los ajustes, asi que
    // hay un render en el que ya paso el guarda de settings pero emerg sigue
    // siendo null. Sin esto, la app se cae al arrancar.
    if (!emerg) return null;
    const f = emerg.ficha || {};
    const casa = evaluarSiEstaEnCasa(emerg, ubicacion);

    return (
      <Modal
        visible={fichaAbierta}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setFichaAbierta(false)}
      >
        <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
          <Text style={[styles.title, { fontSize: 22, marginTop: 20 }]}>
            Ficha de emergencia
          </Text>
          <Text style={[styles.endpointTexto, { marginBottom: 20 }]}>
            Esto se envía solo, por la malla, a quien te encuentre mientras el protocolo
            esté activo. Fuera de emergencia no se envía nunca. Escribe con tus palabras.
          </Text>

          <Text style={styles.label}>Datos médicos</Text>
          <TextInput
            style={[styles.input, { height: 140, textAlignVertical: 'top' }]}
            multiline
            value={f.medicos}
            onChangeText={(v) => actualizarFicha('medicos', v)}
            placeholder={'38 años, sangre O+.\nAlérgico a la penicilina.\nDependo de losartán 50mg.\nUso audífono en el oído derecho.'}
            placeholderTextColor="#64748B"
          />

          <Text style={[styles.label, { marginTop: 20 }]}>Dónde vivo</Text>
          <TextInput
            style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
            multiline
            value={f.casa}
            onChangeText={(v) => actualizarFicha('casa', v)}
            placeholder={'Apartamento 715, piso 7.\nTorre 3, frente al parque.'}
            placeholderTextColor="#64748B"
          />

          <Text style={[styles.label, { marginTop: 20 }]}>En esta casa también viven</Text>
          <TextInput
            style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
            multiline
            value={f.convivientes}
            onChangeText={(v) => actualizarFicha('convivientes', v)}
            placeholder={'Mi madre, 70 años, camina con bastón.\nDuerme en el cuarto del fondo.'}
            placeholderTextColor="#64748B"
          />
          <Text style={styles.endpointTexto}>
            Solo se envía cuando estás en casa, igual que la dirección: decirle a quien
            ayuda que aquí vive alguien más, estando tú a veinte kilómetros, lo mandaría
            a buscar a una persona que no corre peligro.
          </Text>

          <View style={styles.estadoFila}>
            <Text style={styles.estadoEtiqueta}>Ubicación de casa</Text>
            <Text style={[
              styles.estadoValor,
              { color: f.casaLat != null ? '#22C55E' : '#F59E0B', fontWeight: '700' },
            ]}>
              {f.casaLat != null ? 'MARCADA' : 'SIN MARCAR'}
            </Text>
          </View>

          {f.casaLat != null && casa.distanciaKm != null && (
            <View style={styles.estadoFila}>
              <Text style={styles.estadoEtiqueta}>Ahora mismo estás</Text>
              <Text style={styles.estadoValor}>
                {casa.enCasa === true
                  ? 'cerca de casa: se enviaría'
                  : (casa.enCasa === false
                    ? `a ${Math.round(casa.distanciaKm)} km: no se enviaría`
                    : 'sin poder confirmar: se enviaría con advertencia')}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.simButton, { backgroundColor: '#334155' }]}
            onPress={marcarCasaAqui}
            disabled={ubicando}
          >
            <Text style={styles.buttonText}>
              {ubicando ? 'Leyendo GPS…' : 'Estoy en casa ahora, marcar aquí'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.endpointTexto}>
            Sin marcar tu casa, la dirección se envía siempre con una advertencia de que no
            se pudo confirmar. Con ella marcada, el teléfono la calla cuando estás lejos:
            mandar "apartamento 715" desde la calle enviaría a quien te busca al lugar
            equivocado.{'\n\n'}
            Ojo con la precisión: la app usa ubicación aproximada, de kilómetros, así que
            solo puede descartar con certeza que estés lejos. Y solo lee el GPS con la app
            abierta, así que si saliste y no la abriste, sigue creyendo que estás en casa.
          </Text>

          <TouchableOpacity
            style={[styles.simButton, { backgroundColor: '#334155' }]}
            onPress={verFicha}
          >
            <Text style={styles.buttonText}>Ver el mensaje que se enviará</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.simButton, { backgroundColor: '#22C55E' }]}
            onPress={() => setFichaAbierta(false)}
          >
            <Text style={styles.buttonText}>Listo</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    );
  };

  const renderEmergencia = () => {
    if (!emerg) return null;
    const esperando = estadoEmerg?.esperandoConfirmacion;
    const activada = estadoEmerg?.activada;

    return (
      <View style={[styles.card, { borderLeftColor: '#F97316', borderLeftWidth: 5 }]}>
        <Text style={[styles.cardTitle, { color: '#F97316' }]}>🆘 Protocolo de emergencia</Text>

        {(esperando || activada) && (
          <TouchableOpacity
            style={[styles.stopButton, { backgroundColor: '#22C55E', marginBottom: 16 }]}
            onPress={pulsarEstoyBien}
          >
            <Text style={styles.buttonText}>ESTOY BIEN</Text>
          </TouchableOpacity>
        )}

        {esperando && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTexto}>
              Esperando tu confirmación. Si no pulsas ESTOY BIEN, se avisará a tus contactos.
            </Text>
          </View>
        )}

        <View style={styles.row}>
          <Checkbox value={emerg.activo} onValueChange={alternarProtocolo} />
          <Text style={[styles.checkboxLabel, { width: 'auto', flex: 1 }]}>Activar protocolo</Text>
        </View>

        {emerg.activo && (
          <>
            <Text style={styles.label}>Nombre y apellido</Text>
            <TextInput
              style={styles.input}
              value={emerg.miNombre}
              onChangeText={(v) => actualizarEmerg('miNombre', v)}
              placeholder="Esteban Rivera"
              placeholderTextColor="#64748B"
            />
            <Text style={styles.endpointTexto}>
              Con apellido: quien te encuentre no te conoce, y un nombre suelto no le
              sirve para dar razón de ti a nadie.
            </Text>

            {renderContactos()}

            <Text style={[styles.label, { marginTop: 20 }]}>Minutos de espera</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={String(emerg.minutosEspera)}
              onChangeText={(v) => actualizarEmerg('minutosEspera', parseInt(v, 10) || 60)}
            />

            {renderFicha()}

            <View style={styles.row}>
              <Checkbox value={emerg.usarBluetooth} onValueChange={(v) => actualizarEmerg('usarBluetooth', v)} />
              <Text style={[styles.checkboxLabel, { width: 'auto', flex: 1 }]}>Baliza Bluetooth</Text>
            </View>
            <View style={styles.row}>
              <Checkbox value={emerg.usarSonido} onValueChange={(v) => actualizarEmerg('usarSonido', v)} />
              <Text style={[styles.checkboxLabel, { width: 'auto', flex: 1 }]}>Baliza sonora</Text>
            </View>

            {emerg.usarBluetooth && renderBaliza()}

            <Text style={styles.endpointTexto}>
              El Bluetooth debe estar encendido: Android prohíbe que una app lo encienda.
            </Text>

            <TouchableOpacity
              style={[styles.simButton, { backgroundColor: '#F97316' }]}
              onPress={probarProtocolo}
            >
              <Text style={styles.buttonText}>Probar baliza</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  const renderUbicacion = () => {
    const auto = settings.autoLocation;
    return (
      <View style={[styles.card, { borderLeftColor: '#8B5CF6', borderLeftWidth: 5 }]}>
        <Text style={[styles.cardTitle, { color: '#8B5CF6' }]}>📍 Mi ubicación</Text>

        <View style={styles.row}>
          <Checkbox value={auto} onValueChange={alternarUbicacionAuto} disabled={ubicando} />
          <Text style={[styles.checkboxLabel, { width: 'auto', flex: 1 }]}>
            Detectar automáticamente
          </Text>
        </View>

        {auto ? (
          <>
            <View style={styles.estadoFila}>
              <Text style={styles.estadoEtiqueta}>Zona actual</Text>
              <Text style={styles.estadoValor}>
                {ubicacion?.etiqueta || (ubicacion ? 'Coordenadas guardadas' : 'sin detectar')}
              </Text>
            </View>
            <View style={styles.estadoFila}>
              <Text style={styles.estadoEtiqueta}>Actualizada</Text>
              <Text style={styles.estadoValor}>{formatearFecha(ubicacion?.at)}</Text>
            </View>
            <Text style={styles.endpointTexto}>
              El GPS se lee solo al abrir la app, como máximo cada 12 horas. La ubicación
              nunca sale del teléfono.
            </Text>
            <TouchableOpacity
              style={[styles.simButton, { backgroundColor: '#8B5CF6' }]}
              onPress={refrescarUbicacionAhora}
              disabled={ubicando}
            >
              <Text style={styles.buttonText}>
                {ubicando ? 'Detectando…' : 'Actualizar ahora'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.label}>Ciudad (manual)</Text>
            <Picker
              selectedValue={settings.location}
              onValueChange={updateLocation}
              style={styles.pickerFull}
            >
              {COLOMBIA_CITIES.map((city) => (
                <Picker.Item key={city.value} label={city.label} value={city.value} />
              ))}
            </Picker>
            <Text style={styles.endpointTexto}>
              Si viajas fuera de esta zona, el monitoreo seguirá vigilando la ciudad elegida.
            </Text>
          </>
        )}
      </View>
    );
  };

  const renderEstadoServicios = () => {
    const estado = calcularEstado(salud);
    const visual = {
      [ESTADO.OPERATIVO]: { color: '#22C55E', texto: 'OPERATIVO', icono: '🟢' },
      [ESTADO.DEGRADADO]: { color: '#F59E0B', texto: 'DEGRADADO', icono: '🟡' },
      [ESTADO.CAIDO]: { color: '#EF4444', texto: 'SIN DATOS', icono: '🔴' },
      [ESTADO.SIN_DATOS]: { color: '#94A3B8', texto: 'SIN VERIFICAR', icono: '⚪' },
      [ESTADO.SIN_CONEXION]: { color: '#38BDF8', texto: 'EN ESPERA', icono: '🌐' },
    }[estado];

    return (
      <View style={[styles.card, { borderLeftColor: visual.color, borderLeftWidth: 5 }]}>
        <Text style={[styles.cardTitle, { color: visual.color }]}>
          {visual.icono} Estado de servicios
        </Text>

        <View style={styles.estadoFila}>
          <Text style={styles.estadoEtiqueta}>Estado</Text>
          <Text style={[styles.estadoValor, { color: visual.color, fontWeight: '800' }]}>
            {visual.texto}
          </Text>
        </View>

        <View style={styles.estadoFila}>
          <Text style={styles.estadoEtiqueta}>Última consulta exitosa</Text>
          <Text style={styles.estadoValor}>{formatearFecha(salud?.ultimoExito)}</Text>
        </View>

        <View style={styles.estadoFila}>
          <Text style={styles.estadoEtiqueta}>Último intento</Text>
          <Text style={styles.estadoValor}>{formatearFecha(salud?.ultimoIntento)}</Text>
        </View>

        {salud?.fallosSeguidos > 0 && (
          <View style={styles.estadoFila}>
            <Text style={styles.estadoEtiqueta}>Fallos consecutivos</Text>
            <Text style={[styles.estadoValor, { color: '#EF4444' }]}>
              {salud.fallosSeguidos}
            </Text>
          </View>
        )}

        {estado === ESTADO.SIN_CONEXION ? (
          <View style={[styles.errorBox, { backgroundColor: '#0C4A6E' }]}>
            <Text style={[styles.errorTexto, { color: '#BAE6FD' }]}>
              El teléfono no tiene internet, así que el monitoreo está hibernando para
              ahorrar batería. Se reanudará solo en cuanto vuelva la señal: no tienes
              que hacer nada.
            </Text>
          </View>
        ) : (
          salud?.ultimoError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTexto}>{salud.ultimoError}</Text>
            </View>
          )
        )}

        {/* Las tres fuentes, con sus modos de fallo separados. Que el USGS
            este operativo no dice nada sobre si llegaria una alerta de Google,
            y esa es justamente la razon de tener tres. */}
        <View style={styles.fuentesBloque}>
          <Text style={styles.fuentesTitulo}>Fuentes de detección</Text>

          <View style={styles.estadoFila}>
            <Text style={styles.estadoEtiqueta}>🛰️ Feed del USGS</Text>
            <Text style={[styles.estadoValor, { color: visual.color, fontWeight: '700' }]}>
              {visual.texto}
            </Text>
          </View>

          <View style={styles.estadoFila}>
            <Text style={styles.estadoEtiqueta}>📳 Sensor del teléfono</Text>
            <Text style={[
              styles.estadoValor,
              { color: sensor?.acelerometro ? '#22C55E' : '#94A3B8', fontWeight: '700' },
            ]}>
              {!sensor?.acelerometro
                ? 'NO DISPONIBLE'
                : (settings.sensor?.habilitado === false ? 'DESACTIVADO' : 'LISTO')}
            </Text>
          </View>

          <TouchableOpacity onPress={escucha?.permiso ? undefined : pedirEscucha}>
            <View style={styles.estadoFila}>
              <Text style={styles.estadoEtiqueta}>🔔 Alerta de Google</Text>
              <Text style={[
                styles.estadoValor,
                { color: colorEscucha(escucha), fontWeight: '700' },
              ]}>
                {textoEscucha(escucha)}
              </Text>
            </View>
          </TouchableOpacity>

          {escucha?.permiso && !escucha?.vinculado && (
            <Text style={styles.endpointTexto}>
              Permiso concedido, pero Android aún no ha vinculado el servicio. Tras
              reiniciar el teléfono no lo hace hasta que lo desbloquees por primera vez.
            </Text>
          )}

          {!escucha?.permiso && (
            <Text style={styles.endpointTexto}>
              Sin este permiso la app sigue funcionando, pero solo se entera por el feed,
              4 a 7 minutos después del sismo. Toca la fila para concederlo. Advertencia:
              es un permiso amplio, deja leer todas las notificaciones del teléfono.
            </Text>
          )}
        </View>

        <Text style={styles.endpointTexto} numberOfLines={2}>
          {ENDPOINT_SISMOS.replace('https://', '')}
        </Text>

        <TouchableOpacity
          style={[styles.simButton, { backgroundColor: '#38BDF8' }]}
          onPress={probarServicioAhora}
          disabled={probando}
        >
          <Text style={styles.buttonText}>
            {probando ? 'Probando…' : 'Probar ahora'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const probarSensor = () => {
    const r = medirPrueba(settings);
    if (!r.ok) {
      Alert.alert(
        'No se pudo medir',
        r.motivo === 'sin_modulo' || r.motivo === 'sin_sensores'
          ? 'Este teléfono no expone el acelerómetro a la app.'
          : `Motivo: ${r.motivo}`
      );
      return;
    }
    setMidiendo(VENTANAS_SEG.prueba);
    setSensor(sensorDisponibilidad());
  };

  const cancelarMedicion = () => {
    detenerSensor();
    setMidiendo(0);
    setSensor(sensorDisponibilidad());
  };

  const alternarSensor = async (valor) => {
    const nuevas = { ...settings, sensor: { ...settings.sensor, habilitado: valor } };
    setSettings(nuevas);
    await saveSettings(nuevas);
    if (!valor) cancelarMedicion();
  };

  /**
   * Medida local de la sacudida.
   *
   * El boton de prueba no es un adorno de desarrollo: es la unica forma de
   * comprobar que el sensor funciona sin esperar a que ocurra un sismo. Agitar
   * el telefono debe dar un PGA claramente por encima de cero, y en reposo debe
   * dar practicamente cero.
   */
  const renderSensor = () => {
    const cfg = settings.sensor || {};
    const hayAcel = sensor?.acelerometro;
    const color = !hayAcel ? '#94A3B8' : (cfg.habilitado ? '#22C55E' : '#F59E0B');
    const romano = medicion ? mmiRomano(medicion.mmiEstimada) : null;

    return (
      <View style={[styles.card, { borderLeftColor: color, borderLeftWidth: 5 }]}>
        <Text style={[styles.cardTitle, { color }]}>📳 Medida local de sacudida</Text>

        {!hayAcel ? (
          <Text style={styles.estadoEtiqueta}>
            Este teléfono no expone el acelerómetro a la app. El monitoreo del feed y
            la alerta de Google siguen funcionando igual.
          </Text>
        ) : (
          <>
            <View style={styles.estadoFila}>
              <Text style={styles.estadoEtiqueta}>Sensores</Text>
              <Text style={styles.estadoValor}>
                Acelerómetro{sensor?.giroscopio ? ' y giroscopio' : ' (sin giroscopio)'}
              </Text>
            </View>

            <View style={styles.row}>
              <Checkbox value={cfg.habilitado !== false} onValueChange={alternarSensor} />
              <Text style={styles.checkboxLabel}>Medir al llegar una alerta</Text>
            </View>

            {medicion && (
              <>
                <View style={styles.estadoFila}>
                  <Text style={styles.estadoEtiqueta}>Última medida</Text>
                  <Text style={styles.estadoValor}>
                    {medicion.etiqueta === 'prueba' ? 'Prueba manual' : medicion.etiqueta}
                    {' · '}{formatearFecha(medicion.inicioEn)}
                  </Text>
                </View>

                <View style={styles.estadoFila}>
                  <Text style={styles.estadoEtiqueta}>Aceleración máxima</Text>
                  <Text style={[styles.estadoValor, { fontWeight: '800' }]}>
                    {medicion.pgaG.toFixed(3)} g
                  </Text>
                </View>

                {romano && (
                  <View style={styles.estadoFila}>
                    <Text style={styles.estadoEtiqueta}>Intensidad estimada</Text>
                    <Text style={[styles.estadoValor, { fontWeight: '800' }]}>
                      {romano}{medicion.mmiEnRango ? '' : ' (fuera de rango)'}
                    </Text>
                  </View>
                )}

                {romano && describirMmi(medicion.mmiEstimada) && (
                  <View style={styles.estadoFila}>
                    <Text style={styles.estadoEtiqueta}>Equivale a</Text>
                    <Text style={styles.estadoValor}>{describirMmi(medicion.mmiEstimada)}</Text>
                  </View>
                )}

                <View style={styles.estadoFila}>
                  <Text style={styles.estadoEtiqueta}>Sacudida sostenida</Text>
                  <Text style={styles.estadoValor}>
                    {medicion.duracionFuerteSeg.toFixed(1)} s
                  </Text>
                </View>

                <View style={styles.estadoFila}>
                  <Text style={styles.estadoEtiqueta}>Origen del movimiento</Text>
                  <Text style={styles.estadoValor}>
                    {{
                      suelo: 'El suelo se movió',
                      manipulacion: 'Movió el teléfono',
                      indeterminado: 'No se pudo distinguir',
                      sin_sacudida: 'Sin sacudida',
                    }[medicion.veredicto] || medicion.veredicto}
                  </Text>
                </View>

                {/* El ritmo real importa: Android no garantiza el pedido, y una
                    medida tomada a 30 Hz cuando se pidieron 100 vale menos. */}
                <View style={styles.estadoFila}>
                  <Text style={styles.estadoEtiqueta}>Muestreo real</Text>
                  <Text style={styles.estadoValor}>
                    {Math.round(medicion.hzReal)} Hz de {medicion.hz} pedidos
                  </Text>
                </View>
              </>
            )}

            <TouchableOpacity
              style={[styles.simButton, { backgroundColor: midiendo > 0 ? '#EF4444' : '#22C55E' }]}
              onPress={midiendo > 0 ? cancelarMedicion : probarSensor}
            >
              <Text style={styles.buttonText}>
                {midiendo > 0 ? `Midiendo… ${midiendo} s (cancelar)` : 'Probar sensor 10 s'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.endpointTexto}>
              Agita el teléfono durante la prueba: debe marcar bastante más de 0. En reposo
              sobre una mesa debe quedar casi en cero. La intensidad es una estimación a
              partir de la aceleración, no una medida sísmica.
            </Text>
          </>
        )}
      </View>
    );
  };

  const handleToggleMonitoring = async (value) => {
    setIsMonitoring(value);
    await AsyncStorage.setItem('isMonitoring', value.toString());

    if (value) {
      const permissionsGranted = await requestPermissions();
      if (!permissionsGranted) {
        Alert.alert('Permisos denegados', 'Se necesitan permisos de notificaciones para operar.');
        setIsMonitoring(false);
        return;
      }
      // Servicio en primer plano: es el que mantiene el monitoreo vivo con la
      // app cerrada y revisa cada minuto de verdad.
      const fgOk = await iniciarServicioPrimerPlano();
      // WorkManager queda como respaldo por si el sistema mata el servicio.
      await registerBackgroundFetchAsync();
      Alert.alert(
        'Monitoreo Activado',
        fgOk
          ? 'Revisión cada minuto. Sigue activo aunque cierres la app.\n\nVerás una notificación permanente: es lo que impide que Android detenga el monitoreo.'
          : 'Monitoreo activo, pero sin servicio permanente: con la app cerrada Android puede espaciar las revisiones a 15 minutos o más.'
      );
    } else {
      await detenerServicioPrimerPlano();
      await unregisterBackgroundFetchAsync();
      await stopForegroundAlert();
      stopAlarm();
    }
  };

  const updateAlertSetting = (level, field, value) => {
    const newSettings = { ...settings };
    newSettings.alerts[level][field] = value;
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const updateLocation = (value) => {
    const newSettings = { ...settings };
    newSettings.location = value;
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const simulateAlert = async (level) => {
    const config = settings.alerts[level];
    // El destello solo se enciende si el usuario activo "Iluminacion (Flash)",
    // y usa el color que eligio.
    startAlarm(config.lightEnabled ? (FLASH_COLORS[config.lightColor] || '#FF0000') : null);

    // Misma prioridad que usa el motor real: el GPS solo manda si el usuario
    // activó la ubicación automática.
    const zona = getUserLocationCoordinates(
      settings.location,
      settings.autoLocation ? ubicacion : null
    );
    const mockEvent = {
      id: `sim-${Date.now()}`,
      properties: { mag: 5.5, place: 'Simulación', time: Date.now(), status: 'simulado' },
      geometry: { coordinates: [zona.lon, zona.lat, 30] },
    };
    const acciones = await triggerAlert(level, mockEvent, settings);

    // Queda en la bitacora marcada como simulacion, para que una prueba nunca
    // se confunda con un sismo real al revisar el registro meses despues.
    registrarEvento(
      construirEntradaAlerta({
        nivel: level, regla: 'simulacion', evento: mockEvent, distancia: 0,
        zona, settings, acciones, simulado: true,
      })
    );

    if (level === 'yellow') {
      // La amarilla no es continua: se apaga sola.
      setTimeout(() => {
        stopForegroundAlert();
        stopAlarm();
      }, 3000);
    }
  };

  const handleStopAlarm = async () => {
    await stopForegroundAlert();
    stopAlarm();
  };

  if (!settings) {
    return <ActivityIndicator size="large" color="#0000ff" style={styles.loader} />;
  }

  const renderAlertConfig = (level, title, icon, color) => {
    const config = settings.alerts[level];
    return (
      <View style={[styles.card, { borderLeftColor: color, borderLeftWidth: 5 }]}>
        <Text style={[styles.cardTitle, { color }]}>{icon} {title}</Text>
        
        <View style={styles.row}>
          <Checkbox value={config.soundEnabled} onValueChange={(val) => updateAlertSetting(level, 'soundEnabled', val)} />
          <Text style={styles.checkboxLabel}>Sonido</Text>
          {config.soundEnabled && (
            <Picker selectedValue={config.soundTone} onValueChange={(val) => updateAlertSetting(level, 'soundTone', val)} style={styles.picker}>
              <Picker.Item label="Sirena Fuerte" value="sirena_fuerte" />
              <Picker.Item label="Ambulancia" value="sirena_ambulancia" />
              <Picker.Item label="Alarma Espacial" value="alarma_espacial" />
              <Picker.Item label="Campana" value="campana" />
              <Picker.Item label="Reloj Mecánico" value="reloj_mecanico" />
              <Picker.Item label="Precaución" value="alerta_precaucion" />
              <Picker.Item label="Notificación" value="notificacion_simple" />
            </Picker>
          )}
        </View>

        <View style={styles.row}>
          <Checkbox value={config.lightEnabled} onValueChange={(val) => updateAlertSetting(level, 'lightEnabled', val)} />
          <Text style={styles.checkboxLabel}>Iluminación (Flash)</Text>
          {config.lightEnabled && (
            <Picker selectedValue={config.lightColor} onValueChange={(val) => updateAlertSetting(level, 'lightColor', val)} style={styles.picker}>
              <Picker.Item label="Rojo" value="red" />
              <Picker.Item label="Naranja" value="orange" />
              <Picker.Item label="Blanco" value="white" />
            </Picker>
          )}
        </View>

        <View style={styles.row}>
          <Checkbox value={config.torchEnabled ?? false} onValueChange={(val) => updateAlertSetting(level, 'torchEnabled', val)} />
          <Text style={styles.checkboxLabel}>Linterna del Celular</Text>
        </View>

        <View style={styles.row}>
          <Checkbox value={config.vibEnabled} onValueChange={(val) => updateAlertSetting(level, 'vibEnabled', val)} />
          <Text style={styles.checkboxLabel}>Vibración</Text>
          {config.vibEnabled && (
            <Picker selectedValue={config.vibIntensity} onValueChange={(val) => updateAlertSetting(level, 'vibIntensity', val)} style={styles.picker}>
              <Picker.Item label="Alta" value="heavy" />
              <Picker.Item label="Media" value="medium" />
              <Picker.Item label="Suave" value="light" />
            </Picker>
          )}
        </View>

        {!isFlashing && (
          <TouchableOpacity style={[styles.simButton, { backgroundColor: color }]} onPress={() => simulateAlert(level)}>
            <Text style={styles.buttonText}>Simular</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 50 }}>
      
      {!pantallaOk && (
        <TouchableOpacity
          style={[styles.card, { borderLeftColor: '#F59E0B', borderLeftWidth: 5 }]}
          onPress={() => {
            abrirAjustesPantallaCompleta();
            Alert.alert(
              'Activa el permiso',
              'Busca "Alerta Sismo" y permite las notificaciones a pantalla completa. Sin esto, una alerta de madrugada sonará pero no encenderá la pantalla.'
            );
          }}
        >
          <Text style={[styles.cardTitle, { color: '#F59E0B', marginBottom: 8 }]}>
            ⚠️ Falta un permiso importante
          </Text>
          <Text style={styles.estadoEtiqueta}>
            La app no puede encender la pantalla al llegar una alerta. Toca aquí para
            concederlo.
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.headerCard}>
        <Text style={styles.title}>Alerta Sismo</Text>
        <View style={styles.switchContainer}>
          <Text style={styles.mainLabel}>Activar Monitoreo:</Text>
          <Switch value={isMonitoring} onValueChange={handleToggleMonitoring} trackColor={{ false: '#767577', true: '#81b0ff' }} thumbColor={isMonitoring ? '#f5dd4b' : '#f4f3f4'} />
        </View>
      </View>

      {/* Va arriba del todo a proposito: cuando acaba de ocurrir un sismo, esto
          es lo unico que el usuario quiere ver. Se pinta solo si hay algo. */}
      <UltimoEvento />

      {renderModalFicha()}

      {renderEmergencia()}

      {renderUbicacion()}

      {renderEstadoServicios()}

      {renderSensor()}

      {renderAlertConfig('red', 'Informativa de Emergencia', '🔴', '#e74c3c')}
      {renderAlertConfig('orange', 'Alerta Naranja (Enjambre)', '🟠', '#e67e22')}
      {renderAlertConfig('yellow', 'Alerta Amarilla (Social)', '🟡', '#f1c40f')}

      <Bitacora />

      {isFlashing && (
        <TouchableOpacity style={styles.stopButton} onPress={handleStopAlarm}>
          <Text style={styles.buttonText}>APAGAR ALARMA</Text>
        </TouchableOpacity>
      )}
      
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    padding: 20, 
    backgroundColor: '#0F172A' // Dark premium background (slate-900)
  },
  loader: {
    marginTop: 50
  },
  contactoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  quitar: {
    padding: 10,
  },
  quitarTexto: {
    color: '#EF4444',
    fontSize: 18,
    fontWeight: '800',
  },
  subBloque: {
    marginTop: 8,
    marginBottom: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  fuentesBloque: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  fuentesTitulo: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  headerCard: { 
    backgroundColor: '#1E293B', // Slate-800
    padding: 24, 
    borderRadius: 20, 
    marginBottom: 20, 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  title: { 
    fontSize: 28, 
    fontWeight: '900', 
    color: '#F8FAFC', 
    textAlign: 'center', 
    marginBottom: 20,
    letterSpacing: 1
  },
  card: { 
    backgroundColor: '#1E293B', 
    padding: 20, 
    borderRadius: 16, 
    marginBottom: 20, 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardTitle: { 
    fontSize: 20, 
    fontWeight: '800', 
    marginBottom: 20,
    letterSpacing: 0.5
  },
  row: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 16, 
    flexWrap: 'wrap',
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 12
  },
  checkboxLabel: { 
    marginLeft: 12, 
    fontSize: 16, 
    width: 130,
    color: '#E2E8F0',
    fontWeight: '600'
  },
  picker: { 
    height: 45, 
    flex: 1, 
    minWidth: 120,
    backgroundColor: '#334155', 
    color: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 0
  },
  pickerFull: { 
    height: 50, 
    width: '100%', 
    backgroundColor: '#334155', 
    color: '#F8FAFC',
    borderRadius: 10, 
    marginBottom: 20,
    borderWidth: 0
  },
  switchContainer: { 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155'
  },
  mainLabel: { 
    fontSize: 17, 
    fontWeight: '700',
    color: '#F8FAFC',
    marginRight: 15
  },
  label: {
    fontSize: 14, 
    color: '#94A3B8', 
    marginBottom: 8,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  input: { 
    borderWidth: 1, 
    borderColor: '#475569', 
    borderRadius: 10, 
    padding: 12, 
    fontSize: 16, 
    backgroundColor: '#0F172A', 
    color: '#F8FAFC',
    marginBottom: 20 
  },
  simButton: { 
    padding: 14, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3
  },
  stopButton: { 
    backgroundColor: '#EF4444', 
    padding: 20, 
    borderRadius: 16, 
    alignItems: 'center', 
    marginTop: 10,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  estadoFila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  estadoEtiqueta: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
    flex: 1,
  },
  estadoValor: {
    fontSize: 14,
    color: '#E2E8F0',
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
  },
  errorBox: {
    backgroundColor: '#7F1D1D',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  errorTexto: {
    color: '#FECACA',
    fontSize: 13,
  },
  endpointTexto: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 12,
    fontStyle: 'italic',
  },
});
