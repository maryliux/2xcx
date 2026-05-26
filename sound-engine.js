let oscillator = null;
let filter = null;
let reverb = null;
let gain = null;
let initialized = false;

let lastHz = 220;
let lastVolume = 0;

const TIP_INDICES = [4, 8, 12, 16, 20];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * t;
}

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(dx, dy, dz);
}

function opennessFromHand(landmarks) {
  if (!landmarks || !landmarks[0]) {
    return 0;
  }

  const wrist = landmarks[0];
  let sum = 0;

  TIP_INDICES.forEach((index) => {
    sum += distance3D(landmarks[index], wrist);
  });

  return sum / TIP_INDICES.length;
}

export async function initAudio() {
  const ToneLib = globalThis.Tone;
  if (!ToneLib) {
    throw new Error("Tone.js did not load.");
  }

  await ToneLib.start();
  if (initialized) {
    return;
  }

  oscillator = new ToneLib.Oscillator({ type: "sine", frequency: lastHz });
  filter = new ToneLib.Filter({ type: "lowpass", frequency: 1200 });
  reverb = new ToneLib.Reverb({ decay: 2.2, wet: 0.2 });
  gain = new ToneLib.Gain(lastVolume);

  if (typeof reverb.generate === "function") {
    await reverb.generate();
  }

  oscillator.connect(filter);
  filter.connect(reverb);
  reverb.connect(gain);
  gain.toDestination();
  oscillator.start();
  initialized = true;
}

export function updateSound(rightHand, leftHand) {
  if (!initialized || !oscillator || !filter || !reverb || !gain) {
    return { hz: lastHz, volume: lastVolume };
  }

  if (rightHand && rightHand[0]) {
    const wristY = rightHand[0].y;
    const hz = mapRange(wristY, 0, 1, 600, 80);
    const openness = opennessFromHand(rightHand);
    const volume = mapRange(openness, 0.05, 0.35, 0, 1);

    oscillator.frequency.rampTo(hz, 0.1);
    gain.gain.rampTo(volume, 0.05);

    lastHz = hz;
    lastVolume = volume;
  } else {
    gain.gain.rampTo(0, 0.05);
    lastVolume = 0;
  }

  if (leftHand && leftHand[0]) {
    const leftY = leftHand[0].y;
    const wet = mapRange(leftY, 0, 1, 0.8, 0);
    const openness = opennessFromHand(leftHand);
    const filterFreq = mapRange(openness, 0.05, 0.35, 200, 8000);

    reverb.wet.rampTo(wet, 0.1);
    filter.frequency.rampTo(filterFreq, 0.1);
  }

  return { hz: lastHz, volume: lastVolume };
}
