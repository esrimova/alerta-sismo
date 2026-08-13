import { StatusBar } from 'expo-status-bar';
import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Animated, AppState } from 'react-native';
import ConfigScreen from './src/screens/ConfigScreen';
import { asegurarMonitoreoVivo } from './src/services/vigilante';
import { registerBackgroundFetchAsync } from './src/services/background';

export default function App() {
  // Alarma activa (controla el boton APAGAR) y color del destello (null = sin destello).
  const [alarmActive, setAlarmActive] = useState(false);
  const [flashColor, setFlashColor] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const loopRef = useRef(null);

  /**
   * Reparacion del monitoreo al abrir o volver a la app.
   *
   * Es la red de seguridad principal: aqui hay una actividad visible, asi que
   * Android SIEMPRE permite arrancar el servicio en primer plano. Antes, si el
   * sistema mataba el servicio, ni siquiera abrir la app lo restablecia.
   */
  useEffect(() => {
    const revisar = async () => {
      try {
        const r = await asegurarMonitoreoVivo('app_abierta');
        // Re-registrar el respaldo solo si hubo que revivir: es barato y cubre
        // el caso de que WorkManager tambien se hubiera perdido.
        if (r.revivido) await registerBackgroundFetchAsync();
      } catch (e) {
        console.log('No se pudo verificar el monitoreo:', e);
      }
    };

    revisar();
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') revisar();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (flashColor) {
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.85, duration: 250, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        ])
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      opacity.setValue(0);
    }
    return () => loopRef.current?.stop();
  }, [flashColor, opacity]);

  return (
    <View style={styles.container}>
      <ConfigScreen
        isFlashing={alarmActive}
        startAlarm={(color) => {
          setAlarmActive(true);
          setFlashColor(color);
        }}
        stopAlarm={() => {
          setAlarmActive(false);
          setFlashColor(null);
        }}
      />

      {/* Capa de destello POR ENCIMA del contenido. Sin esto queda tapada por
          el fondo opaco del ScrollView y el destello no se ve.
          pointerEvents="none" deja que el boton APAGAR siga siendo pulsable. */}
      {flashColor && (
        <Animated.View
          pointerEvents="none"
          style={[styles.flashOverlay, { backgroundColor: flashColor, opacity }]}
        />
      )}

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
});
