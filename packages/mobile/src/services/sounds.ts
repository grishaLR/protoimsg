import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { storage } from './storage';

const SOUND_KEY = 'protoimsg:soundEnabled';

let doorOpen: AudioPlayer | null = null;
let doorClosed: AudioPlayer | null = null;
let imNotify: AudioPlayer | null = null;
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument
    doorOpen = createAudioPlayer(require('../../assets/sounds/door_open.mp3'));
    doorOpen.volume = 1.0;
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument
    doorClosed = createAudioPlayer(require('../../assets/sounds/door_closed.mp3'));
    doorClosed.volume = 1.0;
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument
    imNotify = createAudioPlayer(require('../../assets/sounds/im_notify.wav'));
    imNotify.volume = 1.0;
    loaded = true;
  } catch (err) {
    console.warn('[Sounds] Failed to load sounds:', err);
  }
}

function play(player: AudioPlayer | null): void {
  if (!player || !isSoundEnabled()) return;
  try {
    void player.seekTo(0);
    player.play();
  } catch {
    // Silently ignore playback errors
  }
}

export function isSoundEnabled(): boolean {
  return storage.getBoolean(SOUND_KEY) !== false;
}

export function setSoundEnabled(enabled: boolean): void {
  storage.set(SOUND_KEY, enabled);
}

export async function playDoorOpen(): Promise<void> {
  await ensureLoaded();
  play(doorOpen);
}

export async function playDoorClose(): Promise<void> {
  await ensureLoaded();
  play(doorClosed);
}

export async function playImNotify(): Promise<void> {
  await ensureLoaded();
  play(imNotify);
}
