import type { Language, TextFormatMode, TranscribeResult, FormatTextResult } from './types';

const API_BASE = '/api';
const TRANSCRIBE_TIMEOUT_MS = 120_000;

/** Vercel Hobby ~4.5 MB body limit — chunk below this even when Groq allows 25 MB. */
export const VERCEL_SAFE_CHUNK_BYTES = 4 * 1024 * 1024;

export const MAX_FILE_BYTES = 200 * 1024 * 1024;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = (await res.json()) as { ok?: boolean };
    return res.ok && data.ok === true;
  } catch {
    return false;
  }
}

export async function transcribeFile(
  file: File,
  language: Language,
  onUploadProgress?: (pct: number) => void,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('file', file);
  if (language !== 'auto') form.append('language', language);

  return transcribeFormData(form, onUploadProgress);
}

export async function transcribeFormData(
  form: FormData,
  onUploadProgress?: (pct: number) => void,
): Promise<TranscribeResult> {
  if (onUploadProgress) {
    return transcribeWithXhr(form, onUploadProgress);
  }

  const res = await fetchWithTimeout(
    `${API_BASE}/transcribe`,
    { method: 'POST', body: form },
    TRANSCRIBE_TIMEOUT_MS,
  );

  return parseTranscribeResponse(res);
}

function transcribeWithXhr(
  form: FormData,
  onUploadProgress: (pct: number) => void,
): Promise<TranscribeResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/transcribe`);
    xhr.timeout = TRANSCRIBE_TIMEOUT_MS;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as TranscribeResult & { error?: string };
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body);
          return;
        }
        reject(new Error(body.error ?? `Transcribe failed (${xhr.status})`));
      } catch {
        reject(new Error(`Transcribe failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Request timed out'));
    xhr.send(form);
  });
}

async function parseTranscribeResponse(res: Response): Promise<TranscribeResult> {
  const body = (await res.json().catch(() => ({}))) as TranscribeResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Transcribe failed (${res.status})`);
  }
  return body;
}

export function needsChunking(file: File): boolean {
  return file.size > VERCEL_SAFE_CHUNK_BYTES;
}

const FORMAT_TIMEOUT_MS = 300_000;

export async function formatTranscript(
  transcript: string,
  mode: TextFormatMode,
): Promise<FormatTextResult> {
  const res = await fetchWithTimeout(
    `${API_BASE}/format-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, mode }),
    },
    FORMAT_TIMEOUT_MS,
  );

  const body = (await res.json().catch(() => ({}))) as FormatTextResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Format failed (${res.status})`);
  }
  return body;
}
