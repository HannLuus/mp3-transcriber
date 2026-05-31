import type { VercelRequest, VercelResponse } from '@vercel/node';
import { corsHeaders } from './_shared/cors.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const headers = corsHeaders(req.headers.origin ?? null);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.status(200).json({ ok: true });
}
