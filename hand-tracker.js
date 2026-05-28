const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

export async function initTracker(videoEl, onResults) {
  const HandsCtor = globalThis.Hands;
  const CameraCtor = globalThis.Camera;

  if (!HandsCtor || !CameraCtor) {
    throw new Error("MediaPipe Hands or Camera utils did not load.");
  }

  const hands = new HandsCtor({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5,
  });

  hands.onResults((results) => {
    onResults(results);
  });

  const camera = new CameraCtor(videoEl, {
    onFrame: async () => {
      await hands.send({ image: videoEl });
    },
    width: 1280,
    height: 720,
  });

  await camera.start();

  return { hands, camera };
}

export function drawHands(ctx, results, canvasW, canvasH) {
  const hands = results?.multiHandLandmarks;
  if (!hands || !hands.length) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = "#ffd84d";
  ctx.fillStyle = "#ffd84d";
  ctx.lineWidth = 1;

  hands.forEach((landmarks) => {
    HAND_CONNECTIONS.forEach(([startIndex, endIndex]) => {
      const start = landmarks[startIndex];
      const end = landmarks[endIndex];
      if (!start || !end) {
        return;
      }

      ctx.beginPath();
      ctx.moveTo(start.x * canvasW, start.y * canvasH);
      ctx.lineTo(end.x * canvasW, end.y * canvasH);
      ctx.stroke();
    });

    landmarks.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x * canvasW, point.y * canvasH, 2.25, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  ctx.restore();
}
