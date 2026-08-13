// src/services/location.js
//
// Ubicacion del usuario leida del GPS del propio telefono.
//
// Por que no se usa una API de geolocalizacion:
//  - Privacidad: un endpoint gratuito de geolocalizacion por IP se financia de
//    alguna forma, y le estariamos enviando la IP del usuario cada 12 horas.
//    Con el GPS del dispositivo el dato NUNCA sale del telefono.
//  - Precision: la geolocalizacion por IP en redes moviles ubica al usuario en
//    la pasarela del operador, que puede estar en otra ciudad o pais. Fallaria
//    justo en el caso que importa: distinguir Colombia de Chile.
//
// Se pide precision BAJA a proposito (ACCESS_COARSE_LOCATION): para decidir en
// que region estas no hace falta saber la cuadra, y es el permiso menos
// invasivo y el que menos bateria consume.
//
// Solo se consulta con la app en primer plano. Pedir ubicacion en segundo
// plano exigiria ACCESS_BACKGROUND_LOCATION, un permiso mucho mas intrusivo.
// A cambio: si viajas y nunca abres la app, no se entera del cambio.

import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const UBICACION_KEY = 'alerta_sismo_ubicacion_auto_v1';

/** Cada cuanto refrescar. 12 horas es de sobra para detectar un viaje. */
export const HORAS_ENTRE_ACTUALIZACIONES = 12;

export async function cargarUbicacionGuardada() {
  try {
    const raw = await AsyncStorage.getItem(UBICACION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function guardarUbicacion(u) {
  try {
    await AsyncStorage.setItem(UBICACION_KEY, JSON.stringify(u));
  } catch (e) {
    console.log('No se pudo guardar la ubicacion:', e);
  }
}

export async function pedirPermisoUbicacion() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * Actualiza la ubicacion si hace falta.
 * @param {boolean} forzar ignora el intervalo de 12 h (para el boton manual)
 * @returns {Promise<{ok, ubicacion, motivo}>}
 */
export async function actualizarUbicacion(forzar = false) {
  const guardada = await cargarUbicacionGuardada();

  if (!forzar && guardada) {
    const horas = (Date.now() - guardada.at) / 3600000;
    if (horas < HORAS_ENTRE_ACTUALIZACIONES) {
      return { ok: true, ubicacion: guardada, motivo: 'vigente' };
    }
  }

  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    const concedido = await pedirPermisoUbicacion();
    if (!concedido) {
      return { ok: false, ubicacion: guardada, motivo: 'permiso_denegado' };
    }
  }

  try {
    // Lowest = precision de ciudad. Suficiente para saber en que region estas.
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Lowest,
    });

    let etiqueta = null;
    try {
      // Geocodificacion inversa del propio sistema operativo, sin red externa.
      const lugares = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (lugares && lugares.length) {
        const l = lugares[0];
        etiqueta = [l.city || l.subregion || l.region, l.country]
          .filter(Boolean)
          .join(', ');
      }
    } catch (e) {
      // Sin etiqueta legible, pero las coordenadas sirven igual.
    }

    const ubicacion = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      etiqueta,
      at: Date.now(),
    };
    await guardarUbicacion(ubicacion);
    return { ok: true, ubicacion, motivo: 'actualizada' };
  } catch (e) {
    return { ok: false, ubicacion: guardada, motivo: 'error_gps' };
  }
}
