/**
 * Merge consecutive transcript parts, trimming overlap from Groq's 10s segment overlap.
 */
export function mergeOverlappingTranscripts(parts: string[], overlapWordCount = 30): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.trim();

  let merged = parts[0]!.trim();

  for (let i = 1; i < parts.length; i++) {
    const next = parts[i]!.trim();
    if (!next) continue;

    const mergedWords = merged.split(/\s+/);
    const nextWords = next.split(/\s+/);
    const maxCheck = Math.min(overlapWordCount, mergedWords.length, nextWords.length);

    let bestOverlap = 0;
    for (let n = maxCheck; n >= 3; n--) {
      const tail = mergedWords.slice(-n).join(' ').toLowerCase();
      const head = nextWords.slice(0, n).join(' ').toLowerCase();
      if (tail === head) {
        bestOverlap = n;
        break;
      }
    }

    if (bestOverlap > 0) {
      merged = `${merged} ${nextWords.slice(bestOverlap).join(' ')}`;
    } else {
      merged = `${merged} ${next}`;
    }
  }

  return merged.replace(/\s+/g, ' ').trim();
}
