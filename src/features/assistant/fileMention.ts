// `@file` in the Muse composer: finding the token under the cursor,
// ranking files, and adding the picked one to what is sent. Pure and
// tested; the panel owns the menu.
export interface Mention {
  /** Index of the `@`. */
  start: number;
  /** Text typed after the `@`. */
  query: string;
}

/** Files offered at once: more than this is a reason to type more. */
export const MENTION_MAX_RESULTS = 8;

/** The `@` token ending at the cursor; an e-mail address is not one. */
export function mentionAt(text: string, cursor: number): Mention | null {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf("@");
  if (start === -1) return null;
  if (start > 0 && !/\s/.test(before[start - 1])) return null;
  const query = before.slice(start + 1);
  return /\s/.test(query) ? null : { start, query };
}

function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

/** File names starting with the query first, then any path holding it. */
export function matchMentions(rels: string[], query: string): string[] {
  const wanted = query.toLowerCase();
  const rank = (rel: string): number => {
    if (baseName(rel).toLowerCase().startsWith(wanted)) return 0;
    return rel.toLowerCase().includes(wanted) ? 1 : 2;
  };
  return rels
    .map((rel) => ({ rel, order: rank(rel) }))
    .filter((item) => item.order < 2)
    .sort((a, b) => a.order - b.order || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .slice(0, MENTION_MAX_RESULTS)
    .map((item) => item.rel);
}

/** Replaces the token with the file name, ready for more typing. */
export function applyMention(
  text: string,
  mention: Mention,
  cursor: number,
  rel: string,
): { text: string; cursor: number } {
  const inserted = `@${baseName(rel)} `;
  return {
    text: `${text.slice(0, mention.start)}${inserted}${text.slice(cursor)}`,
    cursor: mention.start + inserted.length,
  };
}

/**
 * The files to send after mentioning `rel`. An automatic pick makes
 * room by dropping its last file; a choice the person made is never
 * changed behind their back, so a full one returns null.
 */
export function addMentioned(
  picked: string[],
  rel: string,
  automatic: boolean,
  max: number,
): string[] | null {
  if (picked.includes(rel)) return picked;
  if (picked.length < max) return [...picked, rel];
  return automatic ? [...picked.slice(0, max - 1), rel] : null;
}

const FILE_TOKEN = /[\w@.\-/]+\.[A-Za-z]{1,5}\b/g;

/**
 * Files a text names that exist here, in order. A path matches a file
 * that ends with it; a bare name only when one file has it. Anything
 * unknown or ambiguous is left out, never guessed.
 */
export function requestedFiles(texts: string[], rels: string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const raw of text.match(FILE_TOKEN) ?? []) {
      const token = raw.replace(/^\.?\/+/, "");
      const byPath = rels.filter((rel) => rel === token || rel.endsWith(`/${token}`));
      const base = baseName(token);
      const found =
        byPath.length > 0 ? byPath : rels.filter((rel) => baseName(rel) === base);
      if (found.length === 1 && !out.includes(found[0])) out.push(found[0]);
    }
  }
  return out;
}
