export type Language = 'en' | 'af';

export type TranscribeResult = {
  transcript: string;
  detectedLanguage?: string;
  model?: string;
  processingMs?: number;
};

export type TranscribeProgress =
  | { phase: 'idle' }
  | { phase: 'preparing' }
  | { phase: 'splitting'; message: string }
  | { phase: 'uploading'; current: number; total: number; pct: number }
  | { phase: 'transcribing'; current: number; total: number }
  | { phase: 'merging' }
  | { phase: 'done' };
