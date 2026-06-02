import type { VercelRequest, VercelResponse } from '@vercel/node';
import { corsHeaders } from './_shared/cors.js';
import { formatTranscriptWithGroq, type TextFormatMode } from './_shared/groqChat.js';

const MODES = new Set<TextFormatMode>(['clean', 'summary', 'meeting']);
const MAX_CHARS = Number(process.env.MAX_FORMAT_CHARS ?? 120_000);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = corsHeaders(req.headers.origin ?? null);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const started = Date.now();

  try {
    const body = req.body as { transcript?: unknown; mode?: unknown };
    const transcript = typeof body?.transcript === 'string' ? body.transcript : '';
    const mode = body?.mode as TextFormatMode;

    if (!transcript.trim()) {
      res.status(400).json({ error: 'transcript is required' });
      return;
    }

    if (!MODES.has(mode)) {
      res.status(400).json({ error: 'mode must be clean, summary, or meeting' });
      return;
    }

    if (transcript.length > MAX_CHARS) {
      res.status(413).json({
        error: `Transcript too long to format (max ${MAX_CHARS} characters)`,
      });
      return;
    }

    const text = await formatTranscriptWithGroq(transcript, mode);

    res.status(200).json({
      text,
      mode,
      processingMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[format-text]', err);
    const msg = err instanceof Error ? err.message : 'Format failed';
    res.status(500).json({ error: msg });
  }
}
