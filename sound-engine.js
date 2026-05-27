let ToneLib = null;

let oscillator = null;
let synthGain = null;
let filter = null;
let reverb = null;
let gainNode = null;
let pitchShift = null;

let player = null;
let playerObjectUrl = null;
let loadedTrackName = "no track loaded";
let trackDuration = 0;
let startedAt = null;
let seekOffset = 0;
let isPlaying = false;
let lastGesturePlaybackState = null;

let initialized = false;
let lastHz = 220;
let lastVolume = 0;
let smoothedPitch = 0;

const TIP_INDICES = [4, 8, 12, 16, 20];
const RIGHT_CLOSED_OPENNESS = 0.09;
const RIGHT_OPEN_OPENNESS = 0.33;

function loadToneScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${src}?v=${Date.now()}`;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

async function ensureToneGlobal() {
  if (globalThis.Tone) {
    return;
  }
  await loadToneScript("https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js");
  if (!globalThis.Tone) {
    throw new Error("Tone.js did not load.");
  }
}

function hasRequiredLandmarks(hand, indices) {
  if (!hand) {
    return false;
  }
  return indices.every((i) => hand[i] && Number.isFinite(hand[i].x) && Number.isFinite(hand[i].y));
}

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

function tipControl(hand, index) {
  if (!hand || !hand[index]) {
    return 0;
  }
  return 1 - clamp(hand[index].y, 0, 1);
}

function disposePlayer() {
  if (player) {
    try {
      player.stop();
    } catch {
      // No-op: player may already be stopped/disposed.
    }
    player.dispose();
    player = null;
  }

  if (playerObjectUrl) {
    URL.revokeObjectURL(playerObjectUrl);
    playerObjectUrl = null;
  }

  trackDuration = 0;
  startedAt = null;
  seekOffset = 0;
  isPlaying = false;
  lastGesturePlaybackState = null;
}

function stopPlayerNow() {
  if (player && player.state === "started") {
    player.stop();
  }
}

function getTrackedCurrentTime() {
  if (!player || trackDuration <= 0) {
    return 0;
  }

  if (!isPlaying || startedAt === null) {
    return clamp(seekOffset, 0, trackDuration);
  }

  const current = seekOffset + (ToneLib.now() - startedAt);
  if (current >= trackDuration) {
    stopPlayerNow();
    startedAt = null;
    seekOffset = 0;
    isPlaying = false;
    lastGesturePlaybackState = false;
    return 0;
  }

  return clamp(current, 0, trackDuration);
}

function startFromTime(time) {
  if (!player || trackDuration <= 0) {
    return;
  }

  const target = clamp(time, 0, Math.max(trackDuration - 0.001, 0));
  stopPlayerNow();
  player.start(ToneLib.now(), target);
  seekOffset = target;
  startedAt = ToneLib.now();
  isPlaying = true;
  lastGesturePlaybackState = true;
}

function pauseAtCurrentTime() {
  if (!player) {
    return;
  }

  const current = getTrackedCurrentTime();
  stopPlayerNow();
  seekOffset = current;
  startedAt = null;
  isPlaying = false;
  lastGesturePlaybackState = false;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function getAudioState() {
  const currentTime = getTrackedCurrentTime();

  return {
    hasTrack: Boolean(player),
    fileName: loadedTrackName,
    isPlaying,
    currentTime,
    duration: trackDuration,
    playbackRate: 1,
    pitch: smoothedPitch,
  };
}

export async function initAudio() {
  await ensureToneGlobal();
  ToneLib = globalThis.Tone;

  await ToneLib.start();
  if (initialized) {
    return;
  }

  gainNode = new ToneLib.Gain(0).toDestination();
  reverb = new ToneLib.Reverb({ decay: 2.3, wet: 0.2 });
  filter = new ToneLib.Filter({ type: "lowpass", frequency: 1900, Q: 0.8 });
  pitchShift = new ToneLib.PitchShift({ pitch: 0, wet: 1 });
  synthGain = new ToneLib.Gain(0.18);

  if (typeof reverb.generate === "function") {
    await reverb.generate();
  }

  pitchShift.connect(filter);
  synthGain.connect(filter);
  filter.connect(reverb);
  reverb.connect(gainNode);

  oscillator = new ToneLib.Oscillator({
    type: "sine",
    frequency: lastHz,
    volume: -18,
  });
  oscillator.connect(synthGain);
  oscillator.start();

  initialized = true;
}

export async function loadAudioFile(file) {
  if (!file) {
    throw new Error("No file selected.");
  }

  if (!initialized) {
    await initAudio();
  }

  disposePlayer();

  playerObjectUrl = URL.createObjectURL(file);
  loadedTrackName = file.name || "uploaded track";

  player = new ToneLib.Player({
    autostart: false,
    loop: false,
  });
  player.connect(pitchShift);

  await player.load(playerObjectUrl);

  trackDuration = Number.isFinite(player.buffer.duration) ? player.buffer.duration : 0;
  seekOffset = 0;
  startedAt = null;
  isPlaying = false;
  lastGesturePlaybackState = null;

  return getAudioState();
}

export async function togglePlayback() {
  if (!player) {
    return getAudioState();
  }

  if (!isPlaying) {
    startFromTime(seekOffset);
  } else {
    pauseAtCurrentTime();
  }

  return getAudioState();
}

export async function setPlaybackFromGesture(shouldPlay) {
  if (!player) {
    return getAudioState();
  }

  if (lastGesturePlaybackState === shouldPlay) {
    return getAudioState();
  }

  if (shouldPlay) {
    startFromTime(seekOffset);
  } else {
    pauseAtCurrentTime();
  }

  return getAudioState();
}

export function seekToTime(seconds, options = {}) {
  if (!player) {
    return getAudioState();
  }

  const target = clamp(seconds, 0, trackDuration);
  const shouldResume = options.forceStart ? true : isPlaying;

  stopPlayerNow();
  seekOffset = target;

  if (shouldResume) {
    player.start(ToneLib.now(), target);
    startedAt = ToneLib.now();
    isPlaying = true;
    lastGesturePlaybackState = true;
  } else {
    startedAt = null;
    isPlaying = false;
    lastGesturePlaybackState = false;
  }

  return getAudioState();
}

export function updateSound(rightHand, leftHand) {
  void leftHand;

  if (!initialized || !oscillator || !filter || !reverb || !gainNode || !synthGain || !pitchShift) {
    return {
      hz: lastHz,
      volume: lastVolume,
      ...getAudioState(),
    };
  }

  if (hasRequiredLandmarks(rightHand, [0, 4, 8, 12, 16, 20])) {
    const wristY = rightHand[0].y;
    const openness = opennessFromHand(rightHand);

    const thumbControl = tipControl(rightHand, 4);
    const indexControl = tipControl(rightHand, 8);
    const middleControl = tipControl(rightHand, 12);
    const ringControl = tipControl(rightHand, 16);
    const pinkyControl = tipControl(rightHand, 20);

    const baseHz = mapRange(wristY, 0, 1, 680, 120);
    const closePitchOffset = mapRange(
      openness,
      RIGHT_CLOSED_OPENNESS,
      RIGHT_OPEN_OPENNESS,
      -250,
      10
    );
    const hz = clamp(baseHz + closePitchOffset, 50, 900);

    const volume = mapRange(openness, RIGHT_CLOSED_OPENNESS, RIGHT_OPEN_OPENNESS, 0, 1);
    const synthLevel = mapRange(thumbControl, 0, 1, 0.02, 0.32);
    const filterFreq = mapRange(indexControl, 0, 1, 260, 8200);
    const wet = mapRange(middleControl, 0, 1, 0.06, 0.75);
    const ringPitch = mapRange(ringControl, 0, 1, -8, 8);
    const closePitchBias = mapRange(
      openness,
      RIGHT_CLOSED_OPENNESS,
      RIGHT_OPEN_OPENNESS,
      -5,
      0
    );
    const targetPitch = ringPitch + closePitchBias;
    const oscVolumeDb = mapRange(pinkyControl, 0, 1, -30, -8);

    oscillator.frequency.rampTo(hz, 0.08);
    oscillator.volume.rampTo(oscVolumeDb, 0.1);
    synthGain.gain.rampTo(synthLevel, 0.08);
    filter.frequency.rampTo(filterFreq, 0.1);
    reverb.wet.rampTo(wet, 0.1);
    gainNode.gain.rampTo(volume, 0.05);

    smoothedPitch += (targetPitch - smoothedPitch) * 0.2;
    pitchShift.pitch = smoothedPitch;

    lastHz = hz;
    lastVolume = volume;
  } else {
    synthGain.gain.rampTo(0.02, 0.1);
    oscillator.volume.rampTo(-20, 0.12);
    filter.frequency.rampTo(1900, 0.12);
    reverb.wet.rampTo(0.2, 0.12);
    smoothedPitch += (0 - smoothedPitch) * 0.15;
    pitchShift.pitch = smoothedPitch;
  }

  return {
    hz: lastHz,
    volume: lastVolume,
    ...getAudioState(),
  };
}
