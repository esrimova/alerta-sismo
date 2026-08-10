// src/services/background.js
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchEarthquakes } from './api';
import { triggerBackgroundNotification } from './alert';

const BACKGROUND_FETCH_TASK = 'BACKGROUND_EARTHQUAKE_FETCH';

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    const minMagnitudeStr = await AsyncStorage.getItem('minMagnitude');
    const minMagnitude = minMagnitudeStr ? parseFloat(minMagnitudeStr) : 4.5;
    const lastEventId = await AsyncStorage.getItem('lastEventId');

    const events = await fetchEarthquakes(minMagnitude);
    
    if (events && events.length > 0) {
      const latestEvent = events[0];
      
      // If we found a new event that we haven't alerted for yet
      if (latestEvent.id !== lastEventId) {
        await triggerBackgroundNotification(events);
        await AsyncStorage.setItem('lastEventId', latestEvent.id);
        return BackgroundFetch.BackgroundFetchResult.NewData;
      }
    }
    
    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error("Background fetch failed:", error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export const registerBackgroundFetchAsync = async () => {
  return BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    minimumInterval: 60, // 1 minute interval (Note: Android might throttle this to 15 mins)
    stopOnTerminate: false, // Keep running after app closes
    startOnBoot: true, // Start on device boot
  });
};

export const unregisterBackgroundFetchAsync = async () => {
  return BackgroundFetch.unregisterTaskAsync(BACKGROUND_FETCH_TASK);
};
