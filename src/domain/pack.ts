import { SHARE_ID } from "../config";

export function deduplicatePreservingOrder(ids: number[]): number[] {
  return [...new Set(ids)];
}

export function generateShareId(randomValues: (array: Uint8Array) => Uint8Array = crypto.getRandomValues.bind(crypto)): string {
  const bytes = randomValues(new Uint8Array(SHARE_ID.length));
  return Array.from(bytes, (byte) => SHARE_ID.alphabet[byte % SHARE_ID.alphabet.length]).join("");
}

export async function manifestHash(ids: number[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(ids));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
