const CELL_SIZE = 6;
const MIN_SIGNAL = 0.06;
const BASE_DOT_SIZE = 0.38;
const MAX_DOT_SIZE = 2.8;
const BACKGROUND_ALPHA = 0.055;
const MOTION_GAIN = 2.2;
const SHIFT_GAIN = 7.5;

const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

let previousLumaGrid = null;
let gridCols = 0;
let gridRows = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureGrid(cols, rows) {
  if (cols !== gridCols || rows !== gridRows || !previousLumaGrid) {
    gridCols = cols;
    gridRows = rows;
    previousLumaGrid = new Float32Array(cols * rows);
  }
}

function sampleCellLuma(frame, frameW, frameH, x, y, cellSize) {
  const yEnd = Math.min(y + cellSize, frameH);
  const xEnd = Math.min(x + cellSize, frameW);

  let brightnessSum = 0;
  let samples = 0;

  // Strided sampling keeps this fast while preserving motion detail.
  for (let py = y; py < yEnd; py += 2) {
    for (let px = x; px < xEnd; px += 2) {
      const i = (py * frameW + px) * 4;
      const r = frame[i];
      const g = frame[i + 1];
      const b = frame[i + 2];
      brightnessSum += (r + g + b) / 3 / 255;
      samples += 1;
    }
  }

  if (!samples) {
    return 0;
  }

  return brightnessSum / samples;
}

export function drawHalftone(ctx, video, canvasW, canvasH) {
  if (!offCtx || video.readyState < 2) {
    return;
  }

  if (offscreen.width !== canvasW || offscreen.height !== canvasH) {
    offscreen.width = canvasW;
    offscreen.height = canvasH;
  }

  offCtx.drawImage(video, 0, 0, canvasW, canvasH);
  const frame = offCtx.getImageData(0, 0, canvasW, canvasH).data;

  const cols = Math.ceil(canvasW / CELL_SIZE);
  const rows = Math.ceil(canvasH / CELL_SIZE);
  ensureGrid(cols, rows);

  const currentLumaGrid = new Float32Array(cols * rows);
  let globalSum = 0;

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const x = gx * CELL_SIZE;
      const y = gy * CELL_SIZE;
      const luma = sampleCellLuma(frame, canvasW, canvasH, x, y, CELL_SIZE);
      const idx = gy * cols + gx;
      currentLumaGrid[idx] = luma;
      globalSum += luma;
    }
  }

  const globalAverage = globalSum / (cols * rows || 1);

  ctx.save();
  ctx.fillStyle = "#ffffff";

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const luma = currentLumaGrid[idx];
      const prevLuma = previousLumaGrid[idx];

      const deviation = Math.abs(luma - globalAverage);
      const motion = Math.abs(luma - prevLuma) * MOTION_GAIN;
      const signal = clamp((deviation - MIN_SIGNAL) * 3.8 + motion, 0, 1);

      const left = gx > 0 ? currentLumaGrid[idx - 1] : luma;
      const right = gx < cols - 1 ? currentLumaGrid[idx + 1] : luma;
      const up = gy > 0 ? currentLumaGrid[idx - cols] : luma;
      const down = gy < rows - 1 ? currentLumaGrid[idx + cols] : luma;
      const gradX = right - left;
      const gradY = down - up;

      const centerX = gx * CELL_SIZE + CELL_SIZE * 0.5;
      const centerY = gy * CELL_SIZE + CELL_SIZE * 0.5;
      const shiftX = clamp(gradX * SHIFT_GAIN, -1.7, 1.7);
      const shiftY = clamp(gradY * SHIFT_GAIN, -1.7, 1.7);

      const alpha = BACKGROUND_ALPHA + signal * 0.87;
      const radius = BASE_DOT_SIZE + signal * (MAX_DOT_SIZE - BASE_DOT_SIZE);

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(centerX + shiftX, centerY + shiftY, radius, 0, Math.PI * 2);
      ctx.fill();

      previousLumaGrid[idx] = luma;
    }
  }

  ctx.restore();
}
