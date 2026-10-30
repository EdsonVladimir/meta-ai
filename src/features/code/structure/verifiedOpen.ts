// Verified map/structure navigation: ranges from an analysis are only
// exact while the file content still matches the analyzed hash.
// Re-reads the file and reports match/changed/unreadable; callers
// decide messaging and always open the file (range or top).
import { fnv1aHex } from "../model";

export type VerifyOutcome = "match" | "changed" | "unreadable";

export type HashReader = (rootId: string, rel: string) => Promise<{ text: string }>;

/**
 * Compare current content against the hash captured at analysis time.
 * A null/empty expected hash is unverifiable, never a match.
 */
export async function verifyAnalyzedHash(
  readFile: HashReader,
  rootId: string,
  rel: string,
  expectedHash: string | null,
): Promise<VerifyOutcome> {
  if (expectedHash === null || expectedHash === "") return "unreadable";
  try {
    const current = await readFile(rootId, rel);
    return fnv1aHex(current.text) === expectedHash ? "match" : "changed";
  } catch {
    return "unreadable";
  }
}
