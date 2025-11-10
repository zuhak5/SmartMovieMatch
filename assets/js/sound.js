let audioCtx;

function ensureAudioContext() {
  if (typeof window === "undefined") {
    return null;
  }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  if (!audioCtx) {
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone({ frequency, duration, type = "sine", volume = 0.15 }) {
  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + duration);
}

export function playUiClick() {
  try {
    playTone({ frequency: 420, duration: 0.09, type: "sine" });
  } catch (error) {
    console.warn("Failed to play UI click", error);
  }
}

export function playExpandSound(expanded) {
  try {
    playTone({
      frequency: expanded ? 540 : 360,
      duration: expanded ? 0.14 : 0.1,
      type: expanded ? "triangle" : "sine",
      volume: expanded ? 0.18 : 0.14
    });
  } catch (error) {
    console.warn("Failed to play expand sound", error);
  }
}

export function playFavoriteSound(isAdding) {
  try {
    if (isAdding) {
      playTone({ frequency: 660, duration: 0.16, type: "triangle", volume: 0.2 });
    } else {
      playTone({ frequency: 320, duration: 0.12, type: "sawtooth", volume: 0.13 });
    }
  } catch (error) {
    console.warn("Failed to play favorite toggle sound", error);
  }
}
