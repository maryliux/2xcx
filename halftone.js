const CELL_SIZE = 5;
const DIFF_THRESHOLD = 0.045;
const CONTRAST_THRESHOLD = 0.06;
const MOTION_THRESHOLD = 0.014;
const MIN_FOREGROUND_SIGNAL = 0.16;
const DOT_MIN = 0.62;
const DOT_MAX = 3.6;
const BG_LEARN_RATE = 0.035;
const BG_HOLD_RATE = 0.003;

const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

let previousLumaGrid = null;
let backgroundLumaGrid = null;
let gridCols = 0;
let gridRows = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureGrid(cols, rows) {
  if (
    cols !== gridCols ||
    rows !== gridRows ||
    !previousLumaGrid ||
    !backgroundLumaGrid
  ) {
    gridCols = cols;
    gridRows = rows;
    previousLumaGrid = new Float32Array(cols * rows);
    backgroundLumaGrid = new Float32Array(cols * rows);
  }
}

function sampleCellLuma(frame, frameW, frameH, x, y, cellSize) {
  const yEnd = Math.min(y + cellSize, frameH);
  const xEnd = Math.min(x + cellSize, frameW);

  let brightnessSum = 0;
  let samples = 0;

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
      const idx = gy * cols + gx;
      const luma = sampleCellLuma(frame, canvasW, canvasH, x, y, CELL_SIZE);
      currentLumaGrid[idx] = luma;
      globalSum += luma;

      // Prime the background model on first pass per cell.
      if (backgroundLumaGrid[idx] === 0 && previousLumaGrid[idx] === 0) {
        backgroundLumaGrid[idx] = luma;
        previousLumaGrid[idx] = luma;
      }
    }
  }

  const globalAverage = globalSum / (cols * rows || 1);

  ctx.save();
  ctx.fillStyle = "#ffffff";

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const luma = currentLumaGrid[idx];
      const previous = previousLumaGrid[idx];
      const background = backgroundLumaGrid[idx];

      const diffFromBackground = Math.abs(luma - background);
      const motion = Math.abs(luma - previous);
      const contrast = Math.abs(luma - globalAverage);

      const signal = clamp(
        (diffFromBackground - DIFF_THRESHOLD) * 7.0 +
          (motion - MOTION_THRESHOLD) * 4.2 +
          (contrast - CONTRAST_THRESHOLD) * 2.2,
        0,
        1
      );

      if (signal >= MIN_FOREGROUND_SIGNAL) {
        const radius = DOT_MIN + signal * (DOT_MAX - DOT_MIN);
        const alpha = 0.2 + signal * 0.8;
        const centerX = gx * CELL_SIZE + CELL_SIZE * 0.5;
        const centerY = gy * CELL_SIZE + CELL_SIZE * 0.5;

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      const learnRate = signal < 0.08 ? BG_LEARN_RATE : BG_HOLD_RATE;
      backgroundLumaGrid[idx] = background * (1 - learnRate) + luma * learnRate;
      previousLumaGrid[idx] = luma;
    }
  }

  ctx.restore();
}
