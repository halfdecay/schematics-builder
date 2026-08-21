import { GRID_SIZE } from './config.js';

let snapEnabled = false;
let gridSize = GRID_SIZE;

export function isGridSnapEnabled() {
  return snapEnabled;
}

export function setGridSnapEnabled(enabled) {
  snapEnabled = !!enabled;
  return snapEnabled;
}

export function getGridSize() {
  return gridSize;
}

export function setGridSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return gridSize;
  gridSize = Math.max(5, Math.min(500, numeric));
  return gridSize;
}

export function snapValue(value) {
  if (!snapEnabled) return value;
  return Math.round(value / gridSize) * gridSize;
}

export function snapPoint(x, y) {
  return { x: snapValue(x), y: snapValue(y) };
}
