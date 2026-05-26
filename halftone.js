const CELL_SIZE = 10;
const MAX_SQUARE_SIZE = 8;

const offscreen = document.createElement("canvas");
const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

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
      const size = brightness * MAX_SQUARE_SIZE;

      if (size <= 0) {
        continue;
      }

      const centerX = x + CELL_SIZE / 2;
      const centerY = y + CELL_SIZE / 2;
      ctx.fillRect(centerX - size / 2, centerY - size / 2, size, size);
    }
  }
}
