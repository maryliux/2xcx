let ToneLib = null;

let oscillator = null;
let synthGain = null;
let filter = null;
let reverb = null;
let outputGain = null;
let pitchShift = null;

let mediaElement = null;
let mediaSource = null;
let mediaObjectUrl = null;
let loadedTrackName = "no track loaded";

let initialized = false;
let lastHz = 220;
let lastVolume = 0;
let smoothedPitch = 0;
let lastGesturePlaybackState = null;

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

function tipControl(hand, index) {
  if (!hand || !hand[index]) {
    return 0;
  }
  return 1 - clamp(hand[index].y, 0, 1);
}

function disposeMediaSource() {
  if (mediaSource) {
    mediaSource.disconnect();
    mediaSource.dispose();
    mediaSource = null;
  }
}

function revokeMediaObjectUrl() {
  if (mediaObjectUrl) {
    URL.revokeObjectURL(mediaObjectUrl);
    mediaObjectUrl = null;
  }
}

function getDuration() {
  if (!mediaElement || !Number.isFinite(mediaElement.duration) || mediaElement.duration <= 0) {
    return 0;
  }
  return mediaElement.duration;
}

function getCurrentTime() {
  const duration = getDuration();
  if (!mediaElement || !Number.isFinite(mediaElement.currentTime) || duration <= 0) {
    return 0;
  }
  return clamp(mediaElement.currentTime, 0, duration);
}

async function waitForDuration(element) {
  if (Number.isFinite(element.duration) && element.duration > 0) {
    return;
  }

  await new Promise((resolve) => {
    const onMaybeReady = () => {
      if (Number.isFinite(element.duration) && element.duration > 0) {
        cleanup();
        resolve();
      }
    };

    const onTimeout = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener("durationchange", onMaybeReady);
      element.removeEventListener("loadeddata", onMaybeReady);
      element.removeEventListener("canplay", onMaybeReady);
    };

    const timer = setTimeout(onTimeout, 1400);
    element.addEventListener("durationchange", onMaybeReady);
    element.addEventListener("loadeddata", onMaybeReady);
    element.addEventListener("canplay", onMaybeReady);
  });
}

export function getAudioState() {
  const hasTrack = Boolean(mediaElement);
  const duration = getDuration();
  const currentTime = getCurrentTime();

  return {
    hasTrack,
    fileName: hasTrack ? loadedTrackName : "no track loaded",
    isPlaying: hasTrack ? !mediaElement.paused : false,
    currentTime,
    duration,
    playbackRate: hasTrack ? mediaElement.playbackRate : 1,
    pitch: smoothedPitch,
  };
}

export async function initAudio() {
  ToneLib = globalThis.Tone;
  if (!ToneLib) {
    throw new Error("Tone.js did not load.");
  }

  await ToneLib.start();
  if (initialized) {
    return;
  }

  outputGain = new ToneLib.Gain(0).toDestination();
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
  reverb.connect(outputGain);

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

  if (mediaElement) {
    mediaElement.pause();
  }
  disposeMediaSource();
  revokeMediaObjectUrl();

  mediaObjectUrl = URL.createObjectURL(file);
  const element = new Audio();
  element.src = mediaObjectUrl;
  element.preload = "auto";
  element.crossOrigin = "anonymous";
  element.loop = false;
  element.playsInline = true;
  element.playbackRate = 1;

  await new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Failed to load this MP3 file."));
    };

    const cleanup = () => {
      element.removeEventListener("loadedmetadata", onLoaded);
      element.removeEventListener("error", onError);
    };

    element.addEventListener("loadedmetadata", onLoaded, { once: true });
    element.addEventListener("error", onError, { once: true });
  });

  await waitForDuration(element);

  mediaElement = element;
  mediaSource = new ToneLib.MediaElementSource(mediaElement);
  mediaSource.connect(pitchShift);
  loadedTrackName = file.name || "imported track";
  smoothedPitch = 0;
  lastGesturePlaybackState = null;

  return getAudioState();
}

export async function togglePlayback() {
  if (!mediaElement) {
    return getAudioState();
  }

  if (mediaElement.paused) {
    await mediaElement.play();
  } else {
    mediaElement.pause();
  }

  lastGesturePlaybackState = !mediaElement.paused;
  return getAudioState();
}

export async function setPlaybackFromGesture(shouldPlay) {
  if (!mediaElement) {
    return getAudioState();
  }

  if (lastGesturePlaybackState === shouldPlay) {
    return getAudioState();
  }

  lastGesturePlaybackState = shouldPlay;
  if (shouldPlay && mediaElement.paused) {
    await mediaElement.play();
  } else if (!shouldPlay && !mediaElement.paused) {
    mediaElement.pause();
  }

  return getAudioState();
}

export function updateSound(rightHand, leftHand) {
  void leftHand;

  if (!initialized || !oscillator || !filter || !reverb || !outputGain || !synthGain || !pitchShift) {
    return {
      hz: lastHz,
      volume: lastVolume,
      ...getAudioState(),
    };
  }

  if (mediaElement && mediaElement.playbackRate !== 1) {
    mediaElement.playbackRate = 1;
  }

  if (rightHand && rightHand[0]) {
    const wristY = rightHand[0].y;
    const openness = opennessFromHand(rightHand);

    const thumbControl = tipControl(rightHand, 4);
    const indexControl = tipControl(rightHand, 8);
    const middleControl = tipControl(rightHand, 12);
    const ringControl = tipControl(rightHand, 16);
    const pinkyControl = tipControl(rightHand, 20);

    const baseHz = mapRange(wristY, 0, 1, 680, 120);
    const closePitchOffset = mapRange(openness, 0.05, 0.35, -250, 10);
    const hz = clamp(baseHz + closePitchOffset, 50, 900);

    const volume = mapRange(openness, 0.05, 0.35, 0, 1);
    const synthLevel = mapRange(thumbControl, 0, 1, 0.02, 0.32);
    const filterFreq = mapRange(indexControl, 0, 1, 260, 8200);
    const wet = mapRange(middleControl, 0, 1, 0.06, 0.75);
    const ringPitch = mapRange(ringControl, 0, 1, -8, 8);
    const closePitchBias = mapRange(openness, 0.05, 0.35, -5, 0);
    const targetPitch = ringPitch + closePitchBias;
    const oscVolumeDb = mapRange(pinkyControl, 0, 1, -30, -8);

    oscillator.frequency.rampTo(hz, 0.08);
    oscillator.volume.rampTo(oscVolumeDb, 0.1);
    outputGain.gain.rampTo(volume, 0.05);
    synthGain.gain.rampTo(synthLevel, 0.08);
    filter.frequency.rampTo(filterFreq, 0.1);
    reverb.wet.rampTo(wet, 0.1);

    smoothedPitch += (targetPitch - smoothedPitch) * 0.2;
    pitchShift.pitch = smoothedPitch;

    lastHz = hz;
    lastVolume = volume;
  } else {
    outputGain.gain.rampTo(0, 0.08);
    synthGain.gain.rampTo(0.02, 0.1);
    oscillator.volume.rampTo(-20, 0.12);
    filter.frequency.rampTo(1900, 0.12);
    reverb.wet.rampTo(0.2, 0.12);
    smoothedPitch += (0 - smoothedPitch) * 0.15;
    pitchShift.pitch = smoothedPitch;
    lastVolume = 0;
  }

  return {
    hz: lastHz,
    volume: lastVolume,
    ...getAudioState(),
  };
}
