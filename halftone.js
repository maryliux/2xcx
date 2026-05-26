const CELL_SIZE = 4;
const MIN_DOT_SIZE = 0.18;
const MAX_DOT_SIZE = 1.55;
const BRIGHTNESS_THRESHOLD = 0.1;
const HALFTONE_LEVELS = 7;
const DOT_ALPHA = 0.82;

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

  for (let py = y; py < yEnd; py += 2) {
    for (let px = x; px < xEnd; px += 2) {
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

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = DOT_ALPHA;

  for (let y = 0; y < canvasH; y += CELL_SIZE) {
    for (let x = 0; x < canvasW; x += CELL_SIZE) {
      const brightness = sampleCellBrightness(frame, canvasW, canvasH, x, y, CELL_SIZE);
      if (brightness < BRIGHTNESS_THRESHOLD) {
        continue;
      }

      const normalized = clamp(
        (brightness - BRIGHTNESS_THRESHOLD) / (1 - BRIGHTNESS_THRESHOLD),
        0,
        1
      );
      const quantized = Math.round(normalized * HALFTONE_LEVELS) / HALFTONE_LEVELS;
      const radius = MIN_DOT_SIZE + quantized * (MAX_DOT_SIZE - MIN_DOT_SIZE);

      const cx = x + CELL_SIZE * 0.5;
      const cy = y + CELL_SIZE * 0.5;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
