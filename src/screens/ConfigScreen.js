// src/screens/ConfigScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestPermissions, triggerForegroundAlert, stopForegroundAlert } from '../services/alert';
import { registerBackgroundFetchAsync, unregisterBackgroundFetchAsync } from '../services/background';
import { fetchEarthquakes } from '../services/api';

export default function ConfigScreen({ isFlashing, setIsFlashing }) {
  const [minMagnitude, setMinMagnitude] = useState('4.5');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [latestEarthquake, setLatestEarthquake] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const savedMag = await AsyncStorage.getItem('minMagnitude');
    if (savedMag) setMinMagnitude(savedMag);
    const monitoringState = await AsyncStorage.getItem('isMonitoring');
    setIsMonitoring(monitoringState === 'true');
  };

  const handleToggleMonitoring = async (value) => {
    setIsMonitoring(value);
    await AsyncStorage.setItem('isMonitoring', value.toString());
    await AsyncStorage.setItem('minMagnitude', minMagnitude);

    if (value) {
      const permissionsGranted = await requestPermissions();
      if (!permissionsGranted) {
        Alert.alert('Permisos denegados', 'Se necesitan permisos de notificaciones para que la alarma funcione en segundo plano.');
        setIsMonitoring(false);
        return;
      }
      await registerBackgroundFetchAsync();
      Alert.alert('Monitoreo Activado', `Buscando sismos mayores a ${minMagnitude} cada minuto.`);
      checkCurrentEarthquakes();
    } else {
      await unregisterBackgroundFetchAsync();
      stopForegroundAlert();
      setIsFlashing(false);
    }
  };

  const checkCurrentEarthquakes = async () => {
    setLoading(true);
    const events = await fetchEarthquakes(parseFloat(minMagnitude));
    if (events && events.length > 0) {
      setLatestEarthquake(events[0]);
    }
    setLoading(false);
  };

  const simulateAlert = async () => {
    Alert.alert('Simulacro', 'Iniciando simulación de sismo...');
    setIsFlashing(true);
    await triggerForegroundAlert();
    
    // Stop simulation after 10 seconds
    setTimeout(() => {
      stopForegroundAlert();
      setIsFlashing(false);
    }, 10000);
  };

  const saveSettings = async () => {
    await AsyncStorage.setItem('minMagnitude', minMagnitude);
    Alert.alert('Configuración guardada', 'Magnitud actualizada.');
    if (isMonitoring) checkCurrentEarthquakes();
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Alerta Sismo (Beta)</Text>
        <Text style={styles.subtitle}>Fuente: USGS Global Feed</Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Magnitud mínima de alerta:</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={minMagnitude}
            onChangeText={setMinMagnitude}
            onBlur={saveSettings}
          />
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.label}>Activar Monitoreo (Background):</Text>
          <Switch
            value={isMonitoring}
            onValueChange={handleToggleMonitoring}
            trackColor={{ false: '#767577', true: '#81b0ff' }}
            thumbColor={isMonitoring ? '#f5dd4b' : '#f4f3f4'}
          />
        </View>

        <TouchableOpacity style={styles.simButton} onPress={simulateAlert}>
          <Text style={styles.buttonText}>🔔 Simular Alarma Fuerte</Text>
        </TouchableOpacity>
        
        {isFlashing && (
          <TouchableOpacity style={styles.stopButton} onPress={() => { stopForegroundAlert(); setIsFlashing(false); }}>
            <Text style={styles.buttonText}>Detener Alarma</Text>
          </TouchableOpacity>
        )}

      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" style={styles.loader} />
      ) : latestEarthquake ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Último sismo importante:</Text>
          <Text style={styles.boldText}>Mag: {latestEarthquake.properties.mag}</Text>
          <Text>Ubicación: {latestEarthquake.properties.place}</Text>
          <Text>Hora: {new Date(latestEarthquake.properties.time).toLocaleString()}</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text>No hay sismos recientes mayores a {minMagnitude}.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 20,
    borderRadius: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    color: '#444',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  simButton: {
    backgroundColor: '#f39c12',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  stopButton: {
    backgroundColor: '#e74c3c',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loader: {
    marginTop: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  boldText: {
    fontWeight: 'bold',
    color: '#c0392b',
    fontSize: 16,
    marginBottom: 5,
  }
});
