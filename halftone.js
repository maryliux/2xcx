const CELL_SIZE = 7;
const SAMPLE_STRIDE = 1;

const BACKGROUND_COLOR = "#000000";
const LINE_COLOR = "rgba(143, 200, 169, 0.38)";
const LINE_COLOR_STRONG = "rgba(244, 248, 255, 0.34)";
const NODE_COLOR = "#f4f8ff";

const MIN_NODE_RADIUS = 0.8;
const MAX_NODE_RADIUS = 2.0;

const DIFF_THRESHOLD = 0.07;
const FOREGROUND_MIN = 0.2;
const BG_ADAPT_FAST = 0.045;
const BG_ADAPT_SLOW = 0.002;

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

let backgroundModel = null;
let cachedCols = 0;
let cachedRows = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sampleCellBrightness(frame, frameW, frameH, x, y, cellSize) {
  const yEnd = Math.min(y + cellSize, frameH);
  const xEnd = Math.min(x + cellSize, frameW);

  let sum = 0;
  let count = 0;

  for (let py = y; py < yEnd; py += SAMPLE_STRIDE) {
    for (let px = x; px < xEnd; px += SAMPLE_STRIDE) {
      const i = (py * frameW + px) * 4;
      const r = frame[i];
      const g = frame[i + 1];
      const b = frame[i + 2];
      sum += (r + g + b) / 3 / 255;
      count += 1;
    }
  }

  if (!count) {
    return 0;
  }

  return sum / count;
}

function blurGrid(grid, cols, rows) {
  const out = new Float32Array(cols * rows);

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const north = gy > 0 ? idx - cols : idx;
      const south = gy < rows - 1 ? idx + cols : idx;
      const west = gx > 0 ? idx - 1 : idx;
      const east = gx < cols - 1 ? idx + 1 : idx;

      out[idx] =
        grid[idx] * 0.44 +
        grid[north] * 0.14 +
        grid[south] * 0.14 +
        grid[west] * 0.14 +
        grid[east] * 0.14;
    }
  }

  return out;
}

function ensureBackgroundModel(cols, rows) {
  if (!backgroundModel || cols !== cachedCols || rows !== cachedRows) {
    cachedCols = cols;
    cachedRows = rows;
    backgroundModel = new Float32Array(cols * rows);
    backgroundModel.fill(0.5);
  }
}

function drawDiamond(ctx, cx, cy, radius) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx + radius, cy);
  ctx.lineTo(cx, cy + radius);
  ctx.lineTo(cx - radius, cy);
  ctx.closePath();
  ctx.fill();
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
  ensureBackgroundModel(cols, rows);

  const luma = new Float32Array(cols * rows);
  const active = new Float32Array(cols * rows);

  let lumaSum = 0;
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const brightness = sampleCellBrightness(
        frame,
        canvasW,
        canvasH,
        gx * CELL_SIZE,
        gy * CELL_SIZE,
        CELL_SIZE
      );
      luma[idx] = brightness;
      lumaSum += brightness;
    }
  }

  const meanLuma = lumaSum / Math.max(1, cols * rows);
  const soft = blurGrid(luma, cols, rows);

  ctx.save();
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const current = soft[idx];
      const previousBg = backgroundModel[idx];
      const diff = Math.abs(current - previousBg);

      const brightBias = clamp((current - (meanLuma + 0.02)) * 3.2, 0, 1);
      const motionBias = clamp((diff - DIFF_THRESHOLD) / 0.25, 0, 1);
      const foregroundScore = Math.max(brightBias, motionBias);

      const adapt = foregroundScore > FOREGROUND_MIN ? BG_ADAPT_SLOW : BG_ADAPT_FAST;
      backgroundModel[idx] = previousBg * (1 - adapt) + current * adapt;

      if (foregroundScore <= FOREGROUND_MIN) {
        continue;
      }

      const dither = (BAYER_4X4[(gy & 3) * 4 + (gx & 3)] + 0.5) / 16;
      const presence = clamp(foregroundScore * 1.15, 0, 1);
      if (presence < dither * 0.86) {
        continue;
      }

      active[idx] = presence;
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const p = active[idx];
      if (p <= 0.22) {
        continue;
      }

      const cx = gx * CELL_SIZE + CELL_SIZE * 0.5;
      const cy = gy * CELL_SIZE + CELL_SIZE * 0.5;

      if (gx + 1 < cols) {
        const right = active[idx + 1];
        if (right > 0.22) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + CELL_SIZE, cy);
        }
      }

      if (gy + 1 < rows) {
        const down = active[idx + cols];
        if (down > 0.22) {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy + CELL_SIZE);
        }
      }
    }
  }
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const p = active[idx];
      if (p <= 0.55) {
        continue;
      }

      const cx = gx * CELL_SIZE + CELL_SIZE * 0.5;
      const cy = gy * CELL_SIZE + CELL_SIZE * 0.5;

      if (gx + 1 < cols && active[idx + 1] > 0.55) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + CELL_SIZE, cy);
      }

      if (gy + 1 < rows && active[idx + cols] > 0.55) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + CELL_SIZE);
      }
    }
  }
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = LINE_COLOR_STRONG;
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.fillStyle = NODE_COLOR;
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const p = active[idx];
      if (p <= 0.22) {
        continue;
      }

      const cx = gx * CELL_SIZE + CELL_SIZE * 0.5;
      const cy = gy * CELL_SIZE + CELL_SIZE * 0.5;
      const radius = MIN_NODE_RADIUS + p * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);

      ctx.globalAlpha = 0.34 + p * 0.58;
      drawDiamond(ctx, cx, cy, radius);

      if (p > 0.72) {
        ctx.globalAlpha = 0.68;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.restore();
}
