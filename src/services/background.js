// src/services/background.js
//
// Tarea de RESPALDO. El monitoreo principal lo hace el servicio en primer
// plano (foreground.js), que sí controla su propio intervalo.
//
// Esta tarea existe por si el servicio en primer plano fuera detenido por el
// sistema o por un gestor de bateria del fabricante: WorkManager la revive.
// Su intervalo real lo decide Android (minimo 15 minutos, en la practica mas
// con Doze), asi que no sirve como mecanismo primario.

import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ejecutarCiclo } from './monitor';
import { revisarVencimiento } from './emergencia';
import { asegurarMonitoreoVivo } from './vigilante';

const BACKGROUND_FETCH_TASK = 'BACKGROUND_EARTHQUAKE_FETCH';

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    const isMonitoring = await AsyncStorage.getItem('isMonitoring');
    if (isMonitoring !== 'true') {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Con la app cerrada, esta es la unica oportunidad de detectar que el
    // servicio en primer plano murio e intentar revivirlo. Puede fallar por las
    // restricciones de Android 12+, pero cuando funciona devuelve el monitoreo
    // a su cadencia de un minuto sin que el usuario tenga que hacer nada.
    try {
      await asegurarMonitoreoVivo('respaldo');
    } catch (e) {
      console.log('El vigilante fallo:', e);
    }

    const { ok, alerta } = await ejecutarCiclo();

    // El temporizador de "Estoy bien" TAMBIEN se revisa aqui. Si solo lo
    // revisara el servicio en primer plano y el sistema lo matara, el
    // protocolo de emergencia no se activaria nunca. Este respaldo llega
    // tarde (15+ min segun Android), pero llega.
    try {
      await revisarVencimiento();
    } catch (e) {
      console.log('Revision de emergencia fallo:', e);
    }

    if (!ok) return BackgroundFetch.BackgroundFetchResult.Failed;
    return alerta
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error('Background fetch failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export const registerBackgroundFetchAsync = async () => {
  return BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    // Android eleva esto a 15 minutos como minimo; el valor bajo no tiene
    // efecto real. El monitoreo por minuto lo hace foreground.js.
    minimumInterval: 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
};

export const unregisterBackgroundFetchAsync = async () => {
  return BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
};
