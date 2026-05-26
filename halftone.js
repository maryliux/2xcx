const CELL_SIZE = 6;

const DIFF_THRESHOLD = 0.05;
const CONTRAST_THRESHOLD = 0.07;
const MOTION_THRESHOLD = 0.012;

const DRAW_THRESHOLD = 0.19;
const DOT_MIN = 0.52;
const DOT_MAX = 2.55;

const BG_LEARN_IDLE = 0.022;
const BG_LEARN_ACTIVE = 0.002;
const TEMPORAL_SMOOTH = 0.82;
const HAND_BOOST_GAIN = 0.42;

const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

let previousLumaGrid = null;
let backgroundLumaGrid = null;
let smoothedSignalGrid = null;
let initialized = false;
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
    !backgroundLumaGrid ||
    !smoothedSignalGrid
  ) {
    gridCols = cols;
    gridRows = rows;
    previousLumaGrid = new Float32Array(cols * rows);
    backgroundLumaGrid = new Float32Array(cols * rows);
    smoothedSignalGrid = new Float32Array(cols * rows);
    initialized = false;
  }
}

function sampleCellLuma(frame, frameW, frameH, x, y, cellSize) {
  const yEnd = Math.min(y + cellSize, frameH);
  const xEnd = Math.min(x + cellSize, frameW);

  let brightnessSum = 0;
  let samples = 0;

  // Subsample in-cell pixels for speed while preserving shape detail.
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

function buildHandBoostGrid(cols, rows, results) {
  const boost = new Float32Array(cols * rows);
  const hands = results?.multiHandLandmarks;
  if (!hands || !hands.length) {
    return boost;
  }

  for (const landmarks of hands) {
    for (const point of landmarks) {
      const cx = Math.round(point.x * (cols - 1));
      const cy = Math.round(point.y * (rows - 1));

      for (let oy = -3; oy <= 3; oy += 1) {
        const gy = cy + oy;
        if (gy < 0 || gy >= rows) {
          continue;
        }
        for (let ox = -3; ox <= 3; ox += 1) {
          const gx = cx + ox;
          if (gx < 0 || gx >= cols) {
            continue;
          }

          const dist = Math.hypot(ox, oy);
          if (dist > 3.3) {
            continue;
          }

          const idx = gy * cols + gx;
          const influence = Math.exp(-dist * 0.75);
          if (influence > boost[idx]) {
            boost[idx] = influence;
          }
        }
      }
    }
  }

  return boost;
}

function smoothSpatial(rawGrid, cols, rows) {
  const smoothed = new Float32Array(cols * rows);

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;

      let sum = rawGrid[idx] * 0.4;

      const north = gy > 0 ? idx - cols : idx;
      const south = gy < rows - 1 ? idx + cols : idx;
      const west = gx > 0 ? idx - 1 : idx;
      const east = gx < cols - 1 ? idx + 1 : idx;

      sum += rawGrid[north] * 0.12;
      sum += rawGrid[south] * 0.12;
      sum += rawGrid[west] * 0.12;
      sum += rawGrid[east] * 0.12;

      const northwest = gy > 0 && gx > 0 ? idx - cols - 1 : idx;
      const northeast = gy > 0 && gx < cols - 1 ? idx - cols + 1 : idx;
      const southwest = gy < rows - 1 && gx > 0 ? idx + cols - 1 : idx;
      const southeast = gy < rows - 1 && gx < cols - 1 ? idx + cols + 1 : idx;

      sum += rawGrid[northwest] * 0.03;
      sum += rawGrid[northeast] * 0.03;
      sum += rawGrid[southwest] * 0.03;
      sum += rawGrid[southeast] * 0.03;

      smoothed[idx] = sum;
    }
  }

  return smoothed;
}

export function drawHalftone(ctx, video, canvasW, canvasH, results = null) {
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
    }
  }

  if (!initialized) {
    backgroundLumaGrid.set(currentLumaGrid);
    previousLumaGrid.set(currentLumaGrid);
    smoothedSignalGrid.fill(0);
    initialized = true;
  }

  const globalAverage = globalSum / (cols * rows || 1);
  const handBoostGrid = buildHandBoostGrid(cols, rows, results);

  const rawSignalGrid = new Float32Array(cols * rows);

  for (let idx = 0; idx < currentLumaGrid.length; idx += 1) {
    const luma = currentLumaGrid[idx];
    const previous = previousLumaGrid[idx];
    const background = backgroundLumaGrid[idx];

    const diffFromBackground = Math.abs(luma - background);
    const motion = Math.abs(luma - previous);
    const contrast = Math.abs(luma - globalAverage);

    let signal =
      (diffFromBackground - DIFF_THRESHOLD) * 7.0 +
      (motion - MOTION_THRESHOLD) * 4.2 +
      (contrast - CONTRAST_THRESHOLD) * 2.0;

    signal = clamp(signal + handBoostGrid[idx] * HAND_BOOST_GAIN, 0, 1);
    rawSignalGrid[idx] = signal;

    const learnRate = signal < 0.09 ? BG_LEARN_IDLE : BG_LEARN_ACTIVE;
    backgroundLumaGrid[idx] = background * (1 - learnRate) + luma * learnRate;
    previousLumaGrid[idx] = luma;
  }

  const spatialSignalGrid = smoothSpatial(rawSignalGrid, cols, rows);

  ctx.save();
  ctx.fillStyle = "#ffffff";

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const boosted = handBoostGrid[idx] > 0.12;
      const targetSignal = spatialSignalGrid[idx];
      const smoothing = boosted ? 0.68 : TEMPORAL_SMOOTH;

      const smoothSignal =
        smoothedSignalGrid[idx] * smoothing + targetSignal * (1 - smoothing);
      smoothedSignalGrid[idx] = smoothSignal;

      if (smoothSignal < DRAW_THRESHOLD && !boosted) {
        continue;
      }

      const normalized = clamp((smoothSignal - DRAW_THRESHOLD) / (1 - DRAW_THRESHOLD), 0, 1);
      const radius = DOT_MIN + normalized * (DOT_MAX - DOT_MIN);
      const alpha = 0.14 + normalized * 0.82;

      const centerX = gx * CELL_SIZE + CELL_SIZE * 0.5;
      const centerY = gy * CELL_SIZE + CELL_SIZE * 0.5;

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
