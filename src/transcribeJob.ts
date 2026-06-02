import {
  needsChunking,
  transcribeFile,
  transcribeFormData,
} from './api';
import { splitAudioIntoChunks } from './chunkAudio';
import { mergeOverlappingTranscripts } from './mergeTranscripts';
import type { Language, TranscribeProgress, TranscribeResult } from './types';

export async function runTranscription(
  file: File,
  language: Language,
  onProgress: (p: TranscribeProgress) => void,
): Promise<TranscribeResult> {
  if (!needsChunking(file)) {
    onProgress({ phase: 'uploading', current: 1, total: 1, pct: 0 });
    const result = await transcribeFile(file, language, (pct) => {
      onProgress({ phase: 'uploading', current: 1, total: 1, pct });
    });
    onProgress({ phase: 'done' });
    return result;
  }

  onProgress({ phase: 'preparing' });
  const chunks = await splitAudioIntoChunks(file, (message) => {
    onProgress({ phase: 'splitting', message });
  });

  const parts: string[] = [];
  const total = chunks.length;

  for (let i = 0; i < total; i++) {
    const chunk = chunks[i]!;
    onProgress({ phase: 'transcribing', current: i + 1, total });

    const form = new FormData();
    form.append('file', chunk);
    if (language !== 'auto') form.append('language', language);

    const result = await transcribeFormData(form, (pct) => {
      onProgress({
        phase: 'uploading',
        current: i + 1,
        total,
        pct,
      });
    });

    parts.push(result.transcript);
  }

  onProgress({ phase: 'merging' });
  const transcript = mergeOverlappingTranscripts(parts);
  onProgress({ phase: 'done' });

  return { transcript };
}
