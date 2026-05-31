const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export type SttResult = {
  transcript: string;
  confidence: number;
  model: string;
  detectedLanguage?: string;
};

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
  };
  return map[ext ?? ''] ?? 'application/octet-stream';
}

export async function transcribeWithGroq(
  audioBytes: Uint8Array,
  filename: string,
  language?: 'en' | 'af',
): Promise<SttResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey?.trim()) throw new Error('GROQ_API_KEY not configured');

  const model = process.env.GROQ_MODEL ?? 'whisper-large-v3';
  const mime = guessMime(filename);

  const form = new FormData();
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  const copy = new Uint8Array(audioBytes);
  form.append('file', new Blob([copy], { type: mime }), filename);
  if (language) form.append('language', language);

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq STT ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { text?: string; language?: string };
  const transcript = (data.text ?? '').trim();

  return {
    transcript,
    confidence: transcript ? 0.9 : 0,
    model: `groq_${model}`,
    detectedLanguage: data.language,
  };
}

export function sniffAudioMime(bytes: Uint8Array, filename: string): string | null {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }
  if (bytes.length >= 12) {
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (ftyp === 'ftyp') return 'audio/mp4';
  }
  if (bytes.length >= 4) {
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (riff === 'RIFF') return 'audio/wav';
  }
  const ext = filename.split('.').pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
  };
  return ext ? byExt[ext] ?? null : null;
}
