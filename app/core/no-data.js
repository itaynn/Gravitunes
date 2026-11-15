// Modes with no dataset (mode.json "data": false, or "datasets": "none") and the host bar elements they never get:
// app/core/host.js removes these instead of rendering a timeline, Time slider, Play, colour bar or dataset picker.
export const isNoDataMode = (meta) => meta?.data === false || meta?.datasets === 'none';
export const NO_DATA_REMOVE = ['#timeline', '#time-label', '#colorbar', '#dataset-picker'];
