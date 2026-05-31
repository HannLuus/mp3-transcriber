import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CHUNK_SECONDS = 600;
const OVERLAP_SECONDS = 10;
/** Target max chunk size for Vercel + Groq (stay under 4 MB when possible). */
const TARGET_CHUNK_BYTES = 3.5 * 1024 * 1024;

let ffmpegInstance: FFmpeg | null = null;

function toBlobPart(data: Uint8Array | string): BlobPart {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  return new Uint8Array(data);
}

async function getFfmpeg(onStatus?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  onStatus?.('Loading audio tools (first time may take a minute)…');

  const ffmpeg = new FFmpeg();
  ffmpegInstance = ffmpeg;

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  return ffmpeg;
}

function extFromName(name: string): string {
  const e = name.split('.').pop()?.toLowerCase();
  return e && ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'webm'].includes(e) ? e : 'mp3';
}

export async function splitAudioIntoChunks(
  file: File,
  onStatus?: (msg: string) => void,
): Promise<File[]> {
  const ffmpeg = await getFfmpeg(onStatus);
  const ext = extFromName(file.name);
  const inputName = `input.${ext}`;

  onStatus?.('Reading your audio file…');
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  onStatus?.('Checking duration…');
  const durationSec = await probeDuration(ffmpeg, inputName);
  const segmentStarts: number[] = [];
  let t = 0;
  while (t < durationSec) {
    segmentStarts.push(t);
    t += CHUNK_SECONDS - OVERLAP_SECONDS;
  }
  if (segmentStarts.length === 0) segmentStarts.push(0);

  const chunks: File[] = [];

  for (let i = 0; i < segmentStarts.length; i++) {
    onStatus?.(`Splitting part ${i + 1} of ${segmentStarts.length}…`);
    const start = segmentStarts[i]!;
    const outName = `chunk-${i}.mp3`;

    await ffmpeg.exec([
      '-ss', String(start),
      '-i', inputName,
      '-t', String(CHUNK_SECONDS),
      '-vn',
      '-acodec', 'libmp3lame',
      '-b:a', '64k',
      '-ar', '16000',
      '-ac', '1',
      '-y',
      outName,
    ]);

    let data = await ffmpeg.readFile(outName);
    let blob = new Blob([toBlobPart(data)], { type: 'audio/mpeg' });

    if (blob.size > TARGET_CHUNK_BYTES) {
      await ffmpeg.exec([
        '-i', outName,
        '-vn',
        '-acodec', 'libmp3lame',
        '-b:a', '48k',
        '-ar', '16000',
        '-ac', '1',
        '-y',
        `chunk-${i}-small.mp3`,
      ]);
      data = await ffmpeg.readFile(`chunk-${i}-small.mp3`);
      blob = new Blob([toBlobPart(data)], { type: 'audio/mpeg' });
      await ffmpeg.deleteFile(`chunk-${i}-small.mp3`);
    }

    chunks.push(new File([blob], `chunk-${i}.mp3`, { type: 'audio/mpeg' }));
    await ffmpeg.deleteFile(outName);
  }

  await ffmpeg.deleteFile(inputName);
  return chunks;
}

async function probeDuration(ffmpeg: FFmpeg, inputName: string): Promise<number> {
  const logs: string[] = [];
  const handler = ({ message }: { message: string }) => {
    logs.push(message);
  };
  ffmpeg.on('log', handler);
  await ffmpeg.exec(['-i', inputName, '-f', 'null', '-']).catch(() => {});
  ffmpeg.off('log', handler);

  const text = logs.join('\n');
  const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (durMatch) {
    const h = Number(durMatch[1]);
    const m = Number(durMatch[2]);
    const s = Number(durMatch[3]);
    return h * 3600 + m * 60 + s;
  }

  return CHUNK_SECONDS;
}
