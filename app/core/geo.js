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

// 8-point compass direction from point 1 toward point 2, by initial great-circle bearing: "north-west".
export function compass(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
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

// Browser only: a 360x180 canvas tinting each region in its center's color (colorOf: id -> css color).
// With blendKm, alpha fades toward borders over the blend zone, so the tint shows where voices mix.
export function regionTint(centers, colorOf, blendKm = 0) {
  const tint = document.createElement('canvas');
  tint.width = 360; tint.height = 180;
  const g = tint.getContext('2d');
  for (let y = 0; y < 180; y += 2) for (let x = 0; x < 360; x += 2) {
    const [n1, n2] = nearestCenters(89 - y, x - 180, centers);
    g.globalAlpha = n2 && blendKm > 0 ? 0.25 + 0.75 * (2 * blendWeight(n1.km, n2.km, blendKm) - 1) : 1;
    g.fillStyle = colorOf.get(n1.center.id); g.fillRect(x, y, 2, 2);
  }
  return tint;
}
