type TaskNotes = { description?: string | null; progress_summary?: string | null };

export const TASK_NOTES_LABEL = 'รายละเอียดงานและสรุปความคืบหน้า\n(Description / Progress Summary)';

const normalize = (text?: string | null) => (text ?? '').replace(/\r\n?/g, '\n').trim();
const lines = (text: string) => text.split('\n').map(line => line.trim());
function containsLines(text: string[], fragment: string[]) {
  return text.some((_, index) => fragment.every((line, offset) => text[index + offset] === line));
}

// Deduplicate complete text/paragraphs and overlapping lines, never fuzzy matches or substrings.
export function getTaskNotes(task: TaskNotes | null | undefined): string {
  const description = normalize(task?.description);
  const summary = normalize(task?.progress_summary);
  if (!description) return summary;
  if (!summary) return description;
  const descriptionLines = lines(description);
  const summaryLines = lines(summary);
  if (containsLines(descriptionLines, summaryLines)) return description;
  if (containsLines(summaryLines, descriptionLines)) return summary;
  for (let overlap = Math.min(descriptionLines.length, summaryLines.length); overlap > 0; overlap--) {
    if (descriptionLines.slice(-overlap).every((line, index) => line === summaryLines[index]))
      return `${description}\n${summary.split('\n').slice(overlap).join('\n')}`.trim();
  }
  const additional = summary.split(/\n\s*\n/).filter(paragraph => !containsLines(descriptionLines, lines(paragraph)));
  return [description, ...additional].join('\n\n');
}

export function taskNotesPayload(text: string) {
  const description = normalize(text);
  // Compatibility mirror for existing snapshot builders/import readers; never leave stale notes behind.
  return { description, progress_summary: description || null };
}
