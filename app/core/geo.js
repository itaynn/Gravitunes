// Places and regions: lat/lon text, distances, nearest musical center and its blended voice. Pure, runs in node too.
import { blendVoices } from './voices.js';

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

// "12°N, 45°W"
export const formatLatLon = (lat, lon) =>
  `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;

export function distKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The two nearest centers: [{center, km}, {center, km}].
export function nearestCenters(lat, lon, centers) {
  return centers.map((c) => ({ center: c, km: distKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.km - b.km).slice(0, 2);
}

// Weight of the nearest center. Outside the blend zone (d2 - d1 >= blendKm) it is 1;
// on the exact boundary (d1 == d2) it is 0.5.
export function blendWeight(d1, d2, blendKm) {
  if (!(blendKm > 0)) return 1;
  const gap = d2 - d1;
  return gap >= blendKm ? 1 : 0.5 + 0.5 * (gap / blendKm);
}

// The blended voice at a spot: nearest center's instrument, mixed with the second within the blend zone.
export function voiceAt(lat, lon, centers, instruments, blendKm = 800) {
  const [n1, n2] = nearestCenters(lat, lon, centers);
  const w = n2 ? blendWeight(n1.km, n2.km, blendKm) : 1;
  const a = instruments[n1.center.instrument], b = n2 && instruments[n2.center.instrument];
  return { primary: n1.center, secondary: w < 1 ? n2.center : null, weight: w, voice: blendVoices(a, b, w) };
}
