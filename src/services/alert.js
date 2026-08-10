// src/services/alert.js
import { Vibration, Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';

let soundObject = null;

/**
 * Configure notification handler for background execution
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request necessary permissions
 */
export const requestPermissions = async () => {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  // Setup Android Notification Channel for critical alerts
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('earthquake-alerts', {
      name: 'Earthquake Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 200, 500, 200, 1000],
      lightColor: '#FF0000',
      enableVibrate: true,
      enableLights: true,
    });
  }

  return finalStatus === 'granted';
};

/**
 * Trigger foreground alert: Sound and Vibration
 */
export const triggerForegroundAlert = async () => {
  try {
    // 1. Vibrate heavily
    Vibration.vibrate([0, 500, 200, 500, 200, 1000], true); // true = repeat
    
    // 2. Play sound
    if (!soundObject) {
      const { sound } = await Audio.Sound.createAsync(
        // Using a built-in beep or requires local asset
        // We'll just generate a beep sequence or load an asset if available.
        // Since we don't have an asset yet, we'll just rely on system vibration for this demo,
        // but let's try to load a remote siren sound for testing.
        { uri: 'https://actions.google.com/sounds/v1/alarms/bugle_tune.ogg' },
        { shouldPlay: true, isLooping: true, volume: 1.0 }
      );
      soundObject = sound;
    } else {
      await soundObject.playAsync();
    }
  } catch (error) {
    console.error("Error triggering foreground alert:", error);
  }
};

/**
 * Stop foreground alert
 */
export const stopForegroundAlert = async () => {
  Vibration.cancel();
  if (soundObject) {
    await soundObject.stopAsync();
  }
};

/**
 * Trigger background notification
 */
export const triggerBackgroundNotification = async (events) => {
  const latestEvent = events[0];
  const mag = latestEvent.properties.mag;
  const place = latestEvent.properties.place;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🚨 ALERTA DE SISMO (Mag ${mag}) 🚨`,
      body: `Sismo detectado en: ${place}`,
      data: { eventId: latestEvent.id },
      sound: true, // Will play default notification sound or channel sound
      priority: Notifications.AndroidNotificationPriority.MAX,
      color: '#FF0000',
    },
    trigger: null, // Send immediately
  });
};
