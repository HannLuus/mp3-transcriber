const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

export type TextFormatMode = 'clean' | 'summary' | 'meeting';

const PROMPTS: Record<TextFormatMode, string> = {
  clean: `You format raw speech-to-text transcripts from South Africa. Speakers often mix English and Afrikaans in the same conversation — keep every word in its original language; do NOT translate.

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

export async function formatTranscriptWithGroq(
  transcript: string,
  mode: TextFormatMode,
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey?.trim()) throw new Error('GROQ_API_KEY not configured');

  const model = process.env.GROQ_CHAT_MODEL ?? 'llama-3.3-70b-versatile';

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
        { role: 'system', content: PROMPTS[mode] },
        { role: 'user', content: transcript.trim() },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq chat ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('Empty response from formatter');
  return text;
}
