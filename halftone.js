const CELL_SIZE = 4;
const BASE_STAR_SIZE = 1.7;
const MIN_BRIGHTNESS = 0.08;

const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

function sparkleValue(x, y, time) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + time * 1.8) * 43758.5453;
  return n - Math.floor(n);
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
  const time = performance.now() * 0.001;

  ctx.save();
  ctx.fillStyle = "#ffffff";

  for (let y = 0; y < canvasH; y += CELL_SIZE) {
    for (let x = 0; x < canvasW; x += CELL_SIZE) {
      let brightnessSum = 0;
      let pixelCount = 0;

      const yEnd = Math.min(y + CELL_SIZE, canvasH);
      const xEnd = Math.min(x + CELL_SIZE, canvasW);

      for (let py = y; py < yEnd; py += 1) {
        for (let px = x; px < xEnd; px += 1) {
          const i = (py * canvasW + px) * 4;
          const r = frame[i];
          const g = frame[i + 1];
          const b = frame[i + 2];
          brightnessSum += (r + g + b) / 3 / 255;
          pixelCount += 1;
        }
      }

      if (!pixelCount) {
        continue;
      }

      const brightness = brightnessSum / pixelCount;
      if (brightness < MIN_BRIGHTNESS) {
        continue;
      }

      const intensity = (brightness - MIN_BRIGHTNESS) / (1 - MIN_BRIGHTNESS);
      const sparkle = 0.58 + sparkleValue(x, y, time) * 0.42;
      const size = Math.max(0.55, BASE_STAR_SIZE * intensity * sparkle + 0.3);
      const alpha = 0.13 + intensity * 0.62;

      const centerX = Math.round(x + CELL_SIZE * 0.5);
      const centerY = Math.round(y + CELL_SIZE * 0.5);

      ctx.globalAlpha = alpha;
      ctx.fillRect(centerX - size * 0.5, centerY - size * 0.5, size, size);

      if (intensity > 0.55) {
        const arm = Math.max(1, size * 0.62);
        ctx.globalAlpha = alpha * 0.75;
        ctx.fillRect(centerX - 0.5, centerY - arm, 1, arm * 2);
        ctx.fillRect(centerX - arm, centerY - 0.5, arm * 2, 1);
      }
    }
  }

  ctx.restore();
}
