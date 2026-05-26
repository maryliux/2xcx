const CELL_SIZE = 3;
const SAMPLE_STRIDE = 2;

const MIN_DOT_SIZE = 0.22;
const MAX_DOT_SIZE = 1.18;
const DOT_ALPHA = 0.9;
const LUMA_CUTOFF = 0.06;
const POSTERIZE_LEVELS = 6;
const DENSITY_BIAS = 0.08;

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

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

      const northwest = gy > 0 && gx > 0 ? idx - cols - 1 : idx;
      const northeast = gy > 0 && gx < cols - 1 ? idx - cols + 1 : idx;
      const southwest = gy < rows - 1 && gx > 0 ? idx + cols - 1 : idx;
      const southeast = gy < rows - 1 && gx < cols - 1 ? idx + cols + 1 : idx;

      out[idx] =
        grid[idx] * 0.34 +
        grid[north] * 0.13 +
        grid[south] * 0.13 +
        grid[west] * 0.13 +
        grid[east] * 0.13 +
        grid[northwest] * 0.035 +
        grid[northeast] * 0.035 +
        grid[southwest] * 0.035 +
        grid[southeast] * 0.035;
    }
  }

  return out;
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
  const luma = new Float32Array(cols * rows);

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      luma[idx] = sampleCellBrightness(
        frame,
        canvasW,
        canvasH,
        gx * CELL_SIZE,
        gy * CELL_SIZE,
        CELL_SIZE
      );
    }
  }

  // Double blur intentionally softens detail edges into cleaner dot masses.
  const soft = blurGrid(blurGrid(luma, cols, rows), cols, rows);

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = DOT_ALPHA;

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const idx = gy * cols + gx;
      const brightness = soft[idx];
      if (brightness <= LUMA_CUTOFF) {
        continue;
      }

      const normalized = clamp(
        (brightness - LUMA_CUTOFF) / (1 - LUMA_CUTOFF),
        0,
        1
      );

      const dither = (BAYER_4X4[(gy & 3) * 4 + (gx & 3)] + 0.5) / 16;
      const density = normalized * 0.9 + DENSITY_BIAS;
      if (density < dither) {
        continue;
      }

      const quantized =
        Math.round(normalized * POSTERIZE_LEVELS) / POSTERIZE_LEVELS;
      const dotSize = MIN_DOT_SIZE + quantized * (MAX_DOT_SIZE - MIN_DOT_SIZE);

      const cx = gx * CELL_SIZE + CELL_SIZE * 0.5;
      const cy = gy * CELL_SIZE + CELL_SIZE * 0.5;
      ctx.fillRect(cx - dotSize * 0.5, cy - dotSize * 0.5, dotSize, dotSize);
    }
  }

  ctx.restore();
}
