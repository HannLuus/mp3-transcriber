import { useCallback, useRef, useState } from 'react';
import { formatTranscript, MAX_FILE_BYTES } from './api';
import { runTranscription } from './transcribeJob';
import type { Language, TextFormatMode, TranscribeProgress } from './types';
import './App.css';

const ACCEPT = '.mp3,.m4a,.wav,.ogg,.flac,audio/mpeg,audio/mp4,audio/wav';

const FORMAT_LABELS: Record<TextFormatMode, string> = {
  clean: 'Clean up',
  summary: 'Summary',
  meeting: 'Meeting notes',
};

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function progressLabel(p: TranscribeProgress): string {
  switch (p.phase) {
    case 'preparing':
      return 'Preparing… first time may take a minute.';
    case 'splitting':
      return p.message;
    case 'uploading':
      return `Uploading part ${p.current} of ${p.total}… ${p.pct}%`;
    case 'transcribing':
      return `Transcribing part ${p.current} of ${p.total}…`;
    case 'merging':
      return 'Putting it all together…';
    case 'done':
      return 'Done!';
    default:
      return '';
  }
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<Language>('auto');
  const [rawTranscript, setRawTranscript] = useState('');
  const [transcript, setTranscript] = useState('');
  const [viewMode, setViewMode] = useState<'raw' | TextFormatMode>('raw');
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formatBusy, setFormatBusy] = useState<TextFormatMode | null>(null);
  const [progress, setProgress] = useState<TranscribeProgress>({ phase: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback((f: File | null) => {
    setError(null);
    setRawTranscript('');
    setTranscript('');
    setViewMode('raw');
    setDetectedLanguage(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError('This file is too large (max 200 MB). Try a shorter recording or compress the MP3.');
      setFile(null);
      return;
    }
    setFile(f);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) pickFile(f);
    },
    [pickFile],
  );

  const onTranscribe = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setRawTranscript('');
    setTranscript('');
    setViewMode('raw');
    setDetectedLanguage(null);
    setProgress({ phase: 'idle' });

    try {
      const result = await runTranscription(file, language, setProgress);
      const text = result.transcript;
      setRawTranscript(text);
      setTranscript(text);
      if (result.detectedLanguage) setDetectedLanguage(result.detectedLanguage);
      if (!text.trim()) {
        setError("We couldn't detect speech. Check the audio isn't silent or corrupted.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      if (/GROQ_API_KEY/i.test(msg)) {
        setError(
          'Transcription service is not configured yet. Add GROQ_API_KEY to .env.local and restart the dev server (vercel dev).',
        );
      } else if (/ffmpeg|wasm|SharedArrayBuffer|worker/i.test(msg)) {
        setError(
          'Could not split this large file in your browser. Try Chrome or Edge on a desktop, or use a shorter clip.',
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
      setProgress({ phase: 'idle' });
    }
  };

  const onFormat = async (mode: TextFormatMode) => {
    if (!rawTranscript.trim()) return;
    setFormatBusy(mode);
    setError(null);
    try {
      const result = await formatTranscript(rawTranscript, mode);
      setTranscript(result.text);
      setViewMode(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Formatting failed');
    } finally {
      setFormatBusy(null);
    }
  };

  const formatBusyLabel =
    formatBusy && rawTranscript.length > 4000
      ? `${FORMAT_LABELS[formatBusy]}… (long transcript, may take 2–3 min)`
      : formatBusy
        ? `${FORMAT_LABELS[formatBusy]}…`
        : null;

  const showOriginal = () => {
    setTranscript(rawTranscript);
    setViewMode('raw');
  };

  const copyTranscript = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
  };

  const downloadTranscript = () => {
    if (!transcript) return;
    const base = file?.name.replace(/\.[^.]+$/, '') ?? 'transcript';
    const suffix = viewMode === 'raw' ? '' : `-${viewMode}`;
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}${suffix}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canTranscribe = Boolean(file && !busy);
  const showLongHint = file && file.size > 10 * 1024 * 1024;
  const showVeryLongHint = file && file.size > 80 * 1024 * 1024;
  const viewLabel =
    viewMode === 'raw' ? 'Raw transcript' : FORMAT_LABELS[viewMode];

  return (
    <div className="app">
      <header className="header">
        <h1>MP3 Transcriber</h1>
        <p className="tagline">
          Drop an MP3 and get your transcript — mixed English &amp; Afrikaans is fine.
        </p>
      </header>

      <main className="main">
        <div
          className={`dropzone ${dragOver ? 'dropzone--active' : ''} ${file ? 'dropzone--has-file' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <>
              <span className="dropzone__title">{file.name}</span>
              <span className="dropzone__meta">{formatBytes(file.size)}</span>
              <span className="dropzone__hint">Click or drop another file to replace</span>
            </>
          ) : (
            <>
              <span className="dropzone__title">Drop your MP3 here</span>
              <span className="dropzone__hint">or click to browse</span>
            </>
          )}
        </div>

        <fieldset className="lang" disabled={busy}>
          <legend className="lang__legend">Language</legend>
          <div className="lang__options lang__options--3">
            <label className={`lang__btn ${language === 'auto' ? 'lang__btn--on' : ''}`}>
              <input
                type="radio"
                name="lang"
                value="auto"
                checked={language === 'auto'}
                onChange={() => setLanguage('auto')}
              />
              Auto (mixed)
            </label>
            <label className={`lang__btn ${language === 'en' ? 'lang__btn--on' : ''}`}>
              <input
                type="radio"
                name="lang"
                value="en"
                checked={language === 'en'}
                onChange={() => setLanguage('en')}
              />
              English
            </label>
            <label className={`lang__btn ${language === 'af' ? 'lang__btn--on' : ''}`}>
              <input
                type="radio"
                name="lang"
                value="af"
                checked={language === 'af'}
                onChange={() => setLanguage('af')}
              />
              Afrikaans
            </label>
          </div>
          {language === 'auto' && (
            <p className="lang__hint">
              Best for South African speech that mixes English and Afrikaans.
            </p>
          )}
        </fieldset>

        {showLongHint && !busy && (
          <p className="hint">
            {showVeryLongHint
              ? 'Large file — may take 10–30 minutes. Keep this tab open.'
              : 'Usually takes 30–90 seconds for files around this size.'}
          </p>
        )}

        {file && file.size > 50 * 1024 * 1024 && /iPhone|iPad|Android/i.test(navigator.userAgent) && (
          <p className="hint hint--warn">
            Large files work best on desktop Chrome or Edge.
          </p>
        )}

        <button
          type="button"
          className="primary"
          disabled={!canTranscribe}
          onClick={onTranscribe}
        >
          {busy ? 'Working…' : 'Transcribe'}
        </button>

        {busy && progress.phase !== 'idle' && (
          <div className="progress" aria-live="polite">
            <div className="progress__bar" />
            <p>{progressLabel(progress)}</p>
          </div>
        )}

        {formatBusyLabel && (
          <div className="progress" aria-live="polite">
            <div className="progress__bar" />
            <p>{formatBusyLabel}</p>
          </div>
        )}

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        {rawTranscript && (
          <section className="result">
            <div className="result__toolbar">
              <span className="result__view-label">{viewLabel}</span>
              {detectedLanguage && viewMode === 'raw' && (
                <span className="result__detected">Detected: {detectedLanguage}</span>
              )}
            </div>

            <div className="result__format">
              <span className="result__format-label">Improve text:</span>
              <div className="result__format-btns">
                {(Object.keys(FORMAT_LABELS) as TextFormatMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={viewMode === mode ? 'format-btn format-btn--on' : 'format-btn'}
                    disabled={Boolean(formatBusy) || busy}
                    onClick={() => onFormat(mode)}
                  >
                    {formatBusy === mode ? '…' : FORMAT_LABELS[mode]}
                  </button>
                ))}
                {viewMode !== 'raw' && (
                  <button
                    type="button"
                    className="format-btn format-btn--ghost"
                    disabled={Boolean(formatBusy) || busy}
                    onClick={showOriginal}
                  >
                    Show original
                  </button>
                )}
              </div>
            </div>

            <div className="result__actions">
              <button type="button" onClick={copyTranscript}>
                Copy
              </button>
              <button type="button" onClick={downloadTranscript}>
                Download .txt
              </button>
            </div>
            <textarea
              className="result__text"
              readOnly
              value={transcript}
              rows={14}
              aria-label={viewLabel}
            />
            <p className="result__meta">
              {transcript.split(/\s+/).filter(Boolean).length} words
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
