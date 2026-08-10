// src/services/api.js

/**
 * Fetch earthquake data.
 * Since the SGC API endpoint is not consistently available publicly at the standard FDSN URL,
 * we use the USGS API as a reliable fallback for now. USGS registers global earthquakes > 4.5
 * and localized ones in their regions.
 */
export const fetchEarthquakes = async (minMagnitude = 4.5) => {
  try {
    // URL for all earthquakes in the past hour
    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    // Filter features by minimum magnitude
    const criticalEvents = data.features.filter(
      (feature) => feature.properties.mag >= minMagnitude
    );

    return criticalEvents;
  } catch (error) {
    console.error("Error fetching earthquakes:", error);
    return [];
  }
};
