let ToneLib = null;

let gainNode = null;
let filter = null;
let reverb = null;
let pitchShift = null;
let instrumentGain = null;

let keysSynth = null;
let guitarSynth = null;
let bassSynth = null;
let kickSynth = null;
let snareSynth = null;
let snareFilter = null;
let hatSynth = null;

let mediaElement = null;
let mediaSource = null;
let mediaObjectUrl = null;
let loadedTrackName = "no track loaded";

let initialized = false;
let lastHz = 220;
let lastVolume = 0;
let smoothedPitch = 0;
let lastGesturePlaybackState = null;
let lastScaleIndex = null;
let lastTriggerTime = 0;
let lastRightOpen = false;

const TIP_INDICES = [4, 8, 12, 16, 20];
const RIGHT_CLOSED_OPENNESS = 0.09;
const RIGHT_OPEN_OPENNESS = 0.33;
const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11];

const INSTRUMENT_TYPES = new Set(["guitar", "bass", "drums", "keys"]);
const FILTER_TYPES = new Set(["lowpass", "bandpass", "highpass", "notch"]);

const soundConfig = {
  instrument: "guitar",
  filterMode: "lowpass",
  synthEnabled: true,
  synthAmount: 0.95,
  filterEnabled: true,
  filterAmount: 1,
  reverbEnabled: true,
  reverbAmount: 0.9,
  pitchEnabled: true,
  pitchAmount: 0.85,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * t;
}

function hasRequiredLandmarks(hand, indices) {
  if (!hand) {
    return false;
  }
  return indices.every((i) => hand[i] && Number.isFinite(hand[i].x) && Number.isFinite(hand[i].y));
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
  if (!mediaElement) {
    return 0;
  }

  if (Number.isFinite(mediaElement.duration) && mediaElement.duration > 0) {
    return mediaElement.duration;
  }

  if (mediaElement.seekable && mediaElement.seekable.length > 0) {
    const seekableEnd = mediaElement.seekable.end(mediaElement.seekable.length - 1);
    if (Number.isFinite(seekableEnd) && seekableEnd > 0) {
      return seekableEnd;
    }
  }

  return 0;
}

function getCurrentTime() {
  if (!mediaElement || !Number.isFinite(mediaElement.currentTime)) {
    return 0;
  }

  const duration = getDuration();
  if (duration > 0) {
    return clamp(mediaElement.currentTime, 0, duration);
  }

  return Math.max(0, mediaElement.currentTime);
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

function instrumentLevelMultiplier(instrument) {
  if (instrument === "bass") {
    return 1.2;
  }
  if (instrument === "drums") {
    return 1.35;
  }
  if (instrument === "keys") {
    return 1.05;
  }
  return 1;
}

function baseMidiForInstrument(instrument) {
  if (instrument === "bass") {
    return 36;
  }
  if (instrument === "drums") {
    return 43;
  }
  if (instrument === "keys") {
    return 55;
  }
  return 48;
}

function scaleStepsForInstrument(instrument) {
  if (instrument === "bass") {
    return 16;
  }
  if (instrument === "drums") {
    return 12;
  }
  return 24;
}

function midiFromScaleIndex(index, baseMidi) {
  const octave = Math.floor(index / MAJOR_SCALE_STEPS.length);
  const degree = MAJOR_SCALE_STEPS[index % MAJOR_SCALE_STEPS.length];
  return baseMidi + octave * 12 + degree;
}

function noteFromMidi(midi) {
  if (!ToneLib || !ToneLib.Frequency) {
    return "C4";
  }
  return ToneLib.Frequency(midi, "midi").toNote();
}

function hzFromMidi(midi) {
  if (!ToneLib || !ToneLib.Frequency) {
    return 220;
  }
  return ToneLib.Frequency(midi, "midi").toFrequency();
}

function applySoundConfig() {
  if (!initialized || !instrumentGain || !filter || !reverb || !pitchShift) {
    return;
  }

  filter.type = soundConfig.filterMode;

  if (!soundConfig.filterEnabled || soundConfig.filterAmount <= 0) {
    filter.frequency.rampTo(18000, 0.08);
    filter.Q.rampTo(0.0001, 0.08);
  }

  const baseReverbWet = soundConfig.reverbEnabled ? mapRange(soundConfig.reverbAmount, 0, 1, 0.02, 0.95) : 0;
  reverb.wet.rampTo(baseReverbWet, 0.1);

  if (soundConfig.pitchEnabled && soundConfig.pitchAmount > 0) {
    const wet = clamp(mapRange(soundConfig.pitchAmount, 0, 1, 0.18, 1), 0, 1);
    pitchShift.wet.rampTo(wet, 0.1);
  } else {
    smoothedPitch = 0;
    pitchShift.pitch = 0;
    pitchShift.wet.rampTo(0, 0.1);
  }
}

function triggerMelodicInstrument(noteMidi, velocity, now) {
  const note = noteFromMidi(noteMidi);

  if (soundConfig.instrument === "bass" && bassSynth) {
    bassSynth.triggerAttackRelease(note, "8n", now, velocity);
    return;
  }

  if (soundConfig.instrument === "keys" && keysSynth) {
    keysSynth.triggerAttackRelease(note, "8n", now, velocity);
    return;
  }

  if (guitarSynth) {
    guitarSynth.triggerAttack(note, now);
  }
}

function triggerDrumInstrument(scaleIndex, velocity, now) {
  const lane = scaleIndex % 4;

  if (lane === 0 && kickSynth) {
    kickSynth.triggerAttackRelease("C1", "8n", now, velocity);
    return;
  }

  if (lane === 1 && snareSynth) {
    snareSynth.triggerAttackRelease("16n", now, velocity);
    return;
  }

  if (lane === 2 && hatSynth) {
    hatSynth.triggerAttackRelease("16n", now, velocity * 0.8);
    return;
  }

  if (kickSynth) {
    kickSynth.triggerAttackRelease("G1", "8n", now, velocity * 0.9);
  }
}

export function getAudioState() {
  const hasTrack = Boolean(mediaElement);
  const duration = getDuration();
  const currentTime = getCurrentTime();

  return {
    hasTrack,
    fileName: loadedTrackName,
    isPlaying: hasTrack ? !mediaElement.paused : false,
    currentTime,
    duration,
    playbackRate: hasTrack ? mediaElement.playbackRate : 1,
    pitch: smoothedPitch,
  };
}

export function getSoundConfig() {
  return { ...soundConfig };
}

export function setInstrumentType(type) {
  if (!INSTRUMENT_TYPES.has(type)) {
    return getSoundConfig();
  }

  soundConfig.instrument = type;
  lastScaleIndex = null;
  applySoundConfig();
  return getSoundConfig();
}

export function setFilterMode(mode) {
  if (!FILTER_TYPES.has(mode)) {
    return getSoundConfig();
  }

  soundConfig.filterMode = mode;
  applySoundConfig();
  return getSoundConfig();
}

export function setEffectEnabled(effectKey, enabled) {
  const nextValue = Boolean(enabled);

  if (effectKey === "synth") {
    soundConfig.synthEnabled = nextValue;
  } else if (effectKey === "filter") {
    soundConfig.filterEnabled = nextValue;
  } else if (effectKey === "reverb") {
    soundConfig.reverbEnabled = nextValue;
  } else if (effectKey === "pitch") {
    soundConfig.pitchEnabled = nextValue;
  }

  applySoundConfig();
  return getSoundConfig();
}

export function setEffectAmount(effectKey, amount) {
  const nextAmount = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);

  if (effectKey === "synth") {
    soundConfig.synthAmount = nextAmount;
  } else if (effectKey === "filter") {
    soundConfig.filterAmount = nextAmount;
  } else if (effectKey === "reverb") {
    soundConfig.reverbAmount = nextAmount;
  } else if (effectKey === "pitch") {
    soundConfig.pitchAmount = nextAmount;
  }

  applySoundConfig();
  return getSoundConfig();
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

  gainNode = new ToneLib.Gain(0).toDestination();
  reverb = new ToneLib.Reverb({ decay: 2.8, wet: 0.42 });
  filter = new ToneLib.Filter({ type: "lowpass", frequency: 2400, Q: 1.4 });
  pitchShift = new ToneLib.PitchShift({ pitch: 0, wet: 0.75 });
  instrumentGain = new ToneLib.Gain(0);

  if (typeof reverb.generate === "function") {
    await reverb.generate();
  }

  pitchShift.connect(filter);
  instrumentGain.connect(filter);
  filter.connect(reverb);
  reverb.connect(gainNode);

  keysSynth = new ToneLib.PolySynth(ToneLib.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.18, sustain: 0.2, release: 0.4 },
  }).connect(instrumentGain);

  guitarSynth = new ToneLib.PluckSynth({
    attackNoise: 1,
    dampening: 2400,
    resonance: 0.92,
  }).connect(instrumentGain);

  bassSynth = new ToneLib.MonoSynth({
    oscillator: { type: "square" },
    filter: { Q: 3, type: "lowpass", rolloff: -24 },
    envelope: { attack: 0.01, decay: 0.26, sustain: 0.32, release: 0.35 },
    filterEnvelope: {
      attack: 0.005,
      decay: 0.12,
      sustain: 0.08,
      release: 0.2,
      baseFrequency: 80,
      octaves: 3.5,
    },
  }).connect(instrumentGain);

  kickSynth = new ToneLib.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 9,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.15 },
  }).connect(instrumentGain);

  snareSynth = new ToneLib.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
  });
  snareFilter = new ToneLib.Filter({ type: "highpass", frequency: 2200, Q: 0.6 }).connect(instrumentGain);
  snareSynth.connect(snareFilter);

  hatSynth = new ToneLib.MetalSynth({
    frequency: 240,
    envelope: { attack: 0.001, decay: 0.08, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 2600,
    octaves: 1.8,
  }).connect(instrumentGain);

  initialized = true;
  applySoundConfig();
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
  loadedTrackName = file.name || "uploaded track";
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

  if (!initialized || !instrumentGain || !filter || !reverb || !gainNode || !pitchShift) {
    return {
      hz: lastHz,
      volume: lastVolume,
      ...getAudioState(),
    };
  }

  if (mediaElement && mediaElement.playbackRate !== 1) {
    mediaElement.playbackRate = 1;
  }

  if (hasRequiredLandmarks(rightHand, [0, 4, 8, 12, 16, 20])) {
    const wristY = clamp(rightHand[0].y, 0, 1);
    const openness = opennessFromHand(rightHand);

    const indexControl = tipControl(rightHand, 8);
    const middleControl = tipControl(rightHand, 12);
    const ringControl = tipControl(rightHand, 16);

    const volume = mapRange(openness, RIGHT_CLOSED_OPENNESS, RIGHT_OPEN_OPENNESS, 0, 1);
    const synthDepth = soundConfig.synthEnabled ? soundConfig.synthAmount : 0;
    const instrumentGainTarget = clamp(
      volume * mapRange(synthDepth, 0, 1, 0, 1.35) * instrumentLevelMultiplier(soundConfig.instrument),
      0,
      1.4
    );
    gainNode.gain.rampTo(volume, 0.05);
    instrumentGain.gain.rampTo(instrumentGainTarget, 0.05);

    const scaleSteps = scaleStepsForInstrument(soundConfig.instrument);
    const scaleIndex = Math.round((1 - wristY) * (scaleSteps - 1));
    const midi = midiFromScaleIndex(scaleIndex, baseMidiForInstrument(soundConfig.instrument));
    const hz = hzFromMidi(midi);

    const filterDepth = soundConfig.filterEnabled ? soundConfig.filterAmount : 0;
    const filterMin = soundConfig.instrument === "bass" ? 60 : soundConfig.instrument === "drums" ? 120 : 180;
    const filterMax = soundConfig.instrument === "bass" ? 2200 : 9000;
    const gestureFreq = mapRange(indexControl, 0, 1, filterMin, filterMax);
    const filterTarget = clamp(gestureFreq * filterDepth + 18000 * (1 - filterDepth), 40, 18000);
    const filterQ = mapRange(filterDepth, 0, 1, 0.0001, 12) * mapRange(middleControl, 0, 1, 0.8, 1.5);
    filter.frequency.rampTo(filterTarget, 0.08);
    filter.Q.rampTo(filterQ, 0.08);

    const reverbDepth = soundConfig.reverbEnabled ? soundConfig.reverbAmount : 0;
    const reverbGesture = mapRange(middleControl, 0, 1, 0.08, 1);
    const reverbTarget = clamp(reverbGesture * mapRange(reverbDepth, 0, 1, 0, 1.2), 0, 1);
    reverb.wet.rampTo(reverbTarget, 0.1);

    const pitchDepth = soundConfig.pitchEnabled ? soundConfig.pitchAmount : 0;
    if (pitchDepth > 0) {
      const targetPitch = mapRange(ringControl, 0, 1, -12, 12) * mapRange(pitchDepth, 0, 1, 0, 2.4);
      smoothedPitch += (targetPitch - smoothedPitch) * 0.24;
      pitchShift.pitch = smoothedPitch;
      pitchShift.wet.rampTo(clamp(mapRange(pitchDepth, 0, 1, 0.18, 1), 0, 1), 0.08);
    } else {
      smoothedPitch = 0;
      pitchShift.pitch = 0;
      pitchShift.wet.rampTo(0, 0.08);
    }

    const openNow = openness > 0.115;
    const timeNow = ToneLib.now();
    const minTriggerInterval = soundConfig.instrument === "drums" ? 0.09 : 0.11;
    const shouldTrigger =
      openNow &&
      (scaleIndex !== lastScaleIndex || !lastRightOpen) &&
      timeNow - lastTriggerTime > minTriggerInterval;

    if (shouldTrigger) {
      const velocity = clamp(volume, 0.08, 1);
      if (soundConfig.instrument === "drums") {
        triggerDrumInstrument(scaleIndex, velocity, timeNow);
      } else {
        triggerMelodicInstrument(midi, velocity, timeNow);
      }
      lastTriggerTime = timeNow;
    }

    lastRightOpen = openNow;
    lastScaleIndex = scaleIndex;
    lastHz = hz;
    lastVolume = volume;
  } else {
    gainNode.gain.rampTo(0, 0.08);
    instrumentGain.gain.rampTo(0, 0.08);
    lastRightOpen = false;
    lastScaleIndex = null;

    if (!soundConfig.pitchEnabled || soundConfig.pitchAmount <= 0) {
      smoothedPitch = 0;
      pitchShift.pitch = 0;
      pitchShift.wet.rampTo(0, 0.1);
    }
  }

  return {
    hz: lastHz,
    volume: lastVolume,
    ...getAudioState(),
  };
}
