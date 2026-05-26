const CELL_SIZE = 3;

const DIFF_THRESHOLD = 0.04;
const MOTION_THRESHOLD = 0.008;
const DRAW_THRESHOLD = 0.16;

const DOT_MIN = 0.2;
const DOT_MAX = 0.95;
const HALFTONE_LEVELS = 8;
const DOT_ALPHA = 0.86;

const BG_LEARN_IDLE = 0.03;
const BG_LEARN_ACTIVE = 0.0015;
const TEMPORAL_SMOOTH = 0.89;
const HAND_BOOST_GAIN = 0.55;

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

      for (let oy = -4; oy <= 4; oy += 1) {
        const gy = cy + oy;
        if (gy < 0 || gy >= rows) {
          continue;
        }

        for (let ox = -4; ox <= 4; ox += 1) {
          const gx = cx + ox;
          if (gx < 0 || gx >= cols) {
            continue;
          }

          const dist = Math.hypot(ox, oy);
          if (dist > 4.1) {
            continue;
          }

          const idx = gy * cols + gx;
          const influence = Math.exp(-dist * 0.65);
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

      let sum = rawGrid[idx] * 0.36;

      const north = gy > 0 ? idx - cols : idx;
      const south = gy < rows - 1 ? idx + cols : idx;
      const west = gx > 0 ? idx - 1 : idx;
      const east = gx < cols - 1 ? idx + 1 : idx;

      sum += rawGrid[north] * 0.13;
      sum += rawGrid[south] * 0.13;
      sum += rawGrid[west] * 0.13;
      sum += rawGrid[east] * 0.13;

      const northwest = gy > 0 && gx > 0 ? idx - cols - 1 : idx;
      const northeast = gy > 0 && gx < cols - 1 ? idx - cols + 1 : idx;
      const southwest = gy < rows - 1 && gx > 0 ? idx + cols - 1 : idx;
      const southeast = gy < rows - 1 && gx < cols - 1 ? idx + cols + 1 : idx;

      sum += rawGrid[northwest] * 0.032;
      sum += rawGrid[northeast] * 0.032;
      sum += rawGrid[southwest] * 0.032;
      sum += rawGrid[southeast] * 0.032;

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

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const x = gx * CELL_SIZE;
      const y = gy * CELL_SIZE;
      currentLumaGrid[idx] = sampleCellLuma(frame, canvasW, canvasH, x, y, CELL_SIZE);
    }
  }

  if (!initialized) {
    backgroundLumaGrid.set(currentLumaGrid);
    previousLumaGrid.set(currentLumaGrid);
    smoothedSignalGrid.fill(0);
    initialized = true;
  }

  const handBoostGrid = buildHandBoostGrid(cols, rows, results);
  const rawSignalGrid = new Float32Array(cols * rows);

  for (let idx = 0; idx < currentLumaGrid.length; idx += 1) {
    const luma = currentLumaGrid[idx];
    const previous = previousLumaGrid[idx];
    const background = backgroundLumaGrid[idx];

    const diffFromBackground = Math.abs(luma - background);
    const motion = Math.abs(luma - previous);

    let signal =
      Math.max(0, diffFromBackground - DIFF_THRESHOLD) * 8.4 +
      Math.max(0, motion - MOTION_THRESHOLD) * 4.6;

    signal = clamp(signal + handBoostGrid[idx] * HAND_BOOST_GAIN, 0, 1);
    rawSignalGrid[idx] = signal;

    const learnRate = signal < 0.1 ? BG_LEARN_IDLE : BG_LEARN_ACTIVE;
    backgroundLumaGrid[idx] = background * (1 - learnRate) + luma * learnRate;
    previousLumaGrid[idx] = luma;
  }

  const spatialSignalGrid = smoothSpatial(rawSignalGrid, cols, rows);

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = DOT_ALPHA;

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const boosted = handBoostGrid[idx] > 0.1;
      const smoothing = boosted ? 0.62 : TEMPORAL_SMOOTH;
      const targetSignal = spatialSignalGrid[idx];

      const smoothSignal =
        smoothedSignalGrid[idx] * smoothing + targetSignal * (1 - smoothing);
      smoothedSignalGrid[idx] = smoothSignal;

      if (smoothSignal < DRAW_THRESHOLD && !boosted) {
        continue;
      }

      const normalized = clamp(
        (smoothSignal - DRAW_THRESHOLD) / (1 - DRAW_THRESHOLD),
        0,
        1
      );
      const quantized =
        Math.round(normalized * HALFTONE_LEVELS) / HALFTONE_LEVELS;
      const radius = DOT_MIN + quantized * (DOT_MAX - DOT_MIN);

      const centerX = gx * CELL_SIZE + CELL_SIZE * 0.5;
      const centerY = gy * CELL_SIZE + CELL_SIZE * 0.5;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
