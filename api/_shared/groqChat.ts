const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Small chunks + pacing stay under Groq free-tier ~12k TPM. */
const CHUNK_CHARS = Number(process.env.GROQ_FORMAT_CHUNK_CHARS ?? 4_000);
const CHUNK_DELAY_MS = Number(process.env.GROQ_FORMAT_CHUNK_DELAY_MS ?? 6_000);

export type TextFormatMode = 'clean' | 'summary' | 'meeting';

const PROMPTS: Record<TextFormatMode, string> = {
  clean: `You format raw speech-to-text transcripts from South Africa. Speakers often mix English and Afrikaans — keep every word in its original language; do NOT translate.

Improve readability only:
- Add punctuation and capitalisation
- Split into short paragraphs at natural pauses
- Remove obvious duplicate stutter words
- Fix obvious word-boundary glitches from STT

Output plain text only. No markdown, no commentary before or after.`,

  summary: `Summarize this transcript for someone who was not in the room. The audio may mix English and Afrikaans — reflect that naturally (you may use English for the summary but keep important Afrikaans terms or quotes as spoken).

Be concise but cover: main topics, decisions, and anything that sounds like a commitment or next step.

Output plain text in a few short paragraphs. No markdown headings.`,

  meeting: `Turn this transcript into clear meeting notes. The speaker(s) may mix English and Afrikaans — preserve that; do not translate quoted speech.

Use this structure (omit a section if nothing applies):

Participants: (names or roles if mentioned, else "Not specified")

Discussion:
- bullet points

Decisions:
- bullet points

Action items:
- bullet points (include owner if clear)

Plain text only.`,
};

const CHUNK_PREFIX: Record<TextFormatMode, string> = {
  clean: `This is ONE section of a longer transcript. Format only this section. ${PROMPTS.clean}`,
  summary: `This is ONE section of a longer transcript. List the main points from this section only (short bullets). Mixed English/Afrikaans is fine. No preamble.`,
  meeting: `This is ONE section of a longer transcript. Extract any participants, discussion points, decisions, or action items from this section only (short bullets). Mixed English/Afrikaans is fine. No preamble.`,
};

const REDUCE_PROMPTS: Record<'summary' | 'meeting', string> = {
  summary: `You have bullet-point notes from sections of one long conversation (English/Afrikaans mix). Combine into one clear summary for someone who was not there. A few short paragraphs, plain text only.`,
  meeting: `You have bullet-point notes from sections of one long conversation (English/Afrikaans mix). Combine into one set of meeting notes with:

Participants:
Discussion:
Decisions:
Action items:

Plain text only. Omit empty sections.`,
};

function splitIntoChunks(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const p of paragraphs) {
    if (p.length > maxChars) {
      flush();
      for (let i = 0; i < p.length; i += maxChars) {
        chunks.push(p.slice(i, i + maxChars).trim());
      }
      continue;
    }
    const next = current ? `${current}\n\n${p}` : p;
    if (next.length > maxChars) {
      flush();
      current = p;
    } else {
      current = next;
    }
  }
  flush();

  return chunks.length > 0 ? chunks : [trimmed.slice(0, maxChars)];
}

function parseGroqError(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    const msg = j.error?.message ?? body;
    if (status === 413 || /too large|tokens per minute|rate_limit/i.test(msg)) {
      return 'This transcript is very long. We split it into parts — please try again in a moment. If it keeps failing, try Summary instead of Clean up.';
    }
    return msg;
  } catch {
    return body || `Groq chat failed (${status})`;
  }
}

async function groqChat(system: string, user: string, attempt = 0): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey?.trim()) throw new Error('GROQ_API_KEY not configured');

  const model = process.env.GROQ_CHAT_MODEL ?? 'llama-3.1-8b-instant';

  const res = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    if (attempt < 2 && /rate_limit|tokens per minute/i.test(err)) {
      await new Promise((r) => setTimeout(r, 12_000));
      return groqChat(system, user, attempt + 1);
    }
    throw new Error(parseGroqError(res.status, err));
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('Empty response from formatter');
  return text;
}

async function formatSingle(transcript: string, mode: TextFormatMode): Promise<string> {
  return groqChat(PROMPTS[mode], transcript.trim());
}

async function formatChunked(transcript: string, mode: TextFormatMode): Promise<string> {
  const chunks = splitIntoChunks(transcript, CHUNK_CHARS);
  const parts: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (mode === 'clean') {
      parts.push(await groqChat(CHUNK_PREFIX.clean, chunks[i]!));
    } else {
      parts.push(await groqChat(CHUNK_PREFIX[mode], chunks[i]!));
    }
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
    }
  }

  if (mode === 'clean') {
    return parts.join('\n\n');
  }

  const combined = parts.join('\n\n---\n\n');
  if (combined.length <= CHUNK_CHARS) {
    return groqChat(PROMPTS[mode], combined);
  }

  return groqChat(REDUCE_PROMPTS[mode], combined);
}

export async function formatTranscriptWithGroq(
  transcript: string,
  mode: TextFormatMode,
): Promise<{ text: string; parts?: number }> {
  const trimmed = transcript.trim();
  if (!trimmed) throw new Error('Empty transcript');

  if (trimmed.length <= CHUNK_CHARS) {
    return { text: await formatSingle(trimmed, mode) };
  }

  const chunks = splitIntoChunks(trimmed, CHUNK_CHARS);
  const text = await formatChunked(trimmed, mode);
  return { text, parts: chunks.length };
}
