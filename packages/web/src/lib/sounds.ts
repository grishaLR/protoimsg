let ctx: AudioContext | null = null;
let doorOpenBuffer: AudioBuffer | null = null;
let doorCloseBuffer: AudioBuffer | null = null;

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

// Unlock AudioContext on first user interaction
function unlock() {
  const audio = getContext();
  if (audio.state === 'suspended') void audio.resume();
  document.removeEventListener('click', unlock);
  document.removeEventListener('keydown', unlock);
}
document.addEventListener('click', unlock);
document.addEventListener('keydown', unlock);

async function loadBuffer(src: string): Promise<AudioBuffer> {
  const res = await fetch(src);
  const arrayBuf = await res.arrayBuffer();
  return getContext().decodeAudioData(arrayBuf);
}

// Preload both sounds
void loadBuffer('/sounds/door_open.mp3').then((buf) => {
  doorOpenBuffer = buf;
});
void loadBuffer('/sounds/door_closed.mp3').then((buf) => {
  doorCloseBuffer = buf;
});

function playBuffer(buffer: AudioBuffer | null) {
  if (!buffer) return;
  const audio = getContext();
  if (audio.state === 'suspended') return;
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start();
}

export function playDoorOpen() {
  playBuffer(doorOpenBuffer);
}

export function playDoorClose() {
  playBuffer(doorCloseBuffer);
}
