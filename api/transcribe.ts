import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import fs from 'node:fs/promises';
import { corsHeaders } from './_shared/cors.js';
import { sniffAudioMime, transcribeWithGroq } from './_shared/groqTranscribe.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

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
    const form = formidable({
      maxFileSize: MAX_BYTES,
      maxFiles: 1,
    });

    const [fields, files] = await form.parse(req);
    const uploaded = files.file?.[0];
    if (!uploaded) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    if (uploaded.size > MAX_BYTES) {
      res.status(413).json({
        error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB per upload)`,
      });
      return;
    }

    const fileBytes = new Uint8Array(await fs.readFile(uploaded.filepath));
    const filename = uploaded.originalFilename ?? 'audio.mp3';
    await fs.unlink(uploaded.filepath).catch(() => {});

    const langRaw = fields.language?.[0];
    const language =
      langRaw === 'en' || langRaw === 'af' ? langRaw : undefined;

    const mime = sniffAudioMime(fileBytes, filename);
    if (!mime) {
      res.status(400).json({ error: 'Unsupported format' });
      return;
    }

    const result = await transcribeWithGroq(fileBytes, filename, language);

    if (!result.transcript) {
      res.status(422).json({ error: 'No speech detected' });
      return;
    }

    res.status(200).json({
      transcript: result.transcript,
      detectedLanguage: result.detectedLanguage,
      model: result.model,
      processingMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[transcribe]', err);
    const msg = err instanceof Error ? err.message : 'Transcribe failed';
    const status = msg.includes('No file') || msg.includes('No file provided') ? 400 : 500;
    res.status(status).json({ error: msg });
  }
}
