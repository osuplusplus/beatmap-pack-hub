import { LIMITS, SHARE_ID } from "../config";
import { manifestHash } from "../domain/pack";
import type { Env } from "../types";

const SOURCE_TYPE = "osu-tournament";
const LIST_URL = "https://osu.ppy.sh/beatmaps/packs?type=tournament&page=";

export interface ImportedPack {
  sourceId: string;
  title: string;
  description: string;
  beatmapsetIds: number[];
}

function decodeHtml(value: string): string {
  return value.replace(/&#(x?[0-9a-f]+);/gi, (_, raw: string) => String.fromCodePoint(parseInt(raw.replace(/^x/i, ""), raw[0].toLowerCase() === "x" ? 16 : 10)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function text(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function listPackIds(html: string): string[] {
  return [...html.matchAll(/href=["']https:\/\/osu\.ppy\.sh\/beatmaps\/packs\/(P\d+)["']/g)].map((m) => m[1]).filter((id, i, all) => all.indexOf(id) === i);
}

function parseDetail(sourceId: string, html: string): ImportedPack {
  const name = html.match(/class=["']beatmap-pack__name["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const date = html.match(/class=["']beatmap-pack__date["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
  const author = html.match(/beatmap-pack__date[\s\S]*?<span>by\s*<strong>([\s\S]*?)<\/strong>/i)?.[1];
  if (!name) throw new Error(`osu pack ${sourceId} has no title`);
  const ids = [...html.matchAll(/href=["']https:\/\/osu\.ppy\.sh\/beatmapsets\/(\d+)(?:["'#?])/g)].map((m) => Number(m[1])).filter((id, i, all) => Number.isSafeInteger(id) && all.indexOf(id) === i).slice(0, LIMITS.maxBeatmapsetCount);
  if (ids.length === 0) throw new Error(`osu pack ${sourceId} has no beatmapsets`);
  const title = text(name).slice(0, 120);
  const details = [date && text(date), author && `by ${text(author)}`].filter(Boolean).join(" · ");
  return { sourceId, title, description: details, beatmapsetIds: ids };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": "BeatmapPackHub importer/1.0 (+server-side metadata import)" } });
  if (!response.ok) throw new Error(`osu returned HTTP ${response.status} for ${url}`);
  return response.text();
}

function shareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_ID.length));
  return Array.from(bytes, (byte) => SHARE_ID.alphabet[byte % SHARE_ID.alphabet.length]).join("");
}

export async function importOsuTournamentPacks(env: Env, maxPages = 1): Promise<{ pages: number; imported: number; updated: number }> {
  const now = new Date().toISOString();
  const packs: ImportedPack[] = [];
  for (let page = 1; page <= Math.max(1, Math.min(maxPages, 100)); page++) {
    const ids = listPackIds(await fetchText(`${LIST_URL}${page}`));
    if (ids.length === 0) break;
    for (const sourceId of ids) packs.push(parseDetail(sourceId, await fetchText(`https://osu.ppy.sh/beatmaps/packs/${sourceId}`)));
  }
  await env.DB.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('osu-importer', 'osu! Tournament Packs', ?) ON CONFLICT(id) DO NOTHING").bind(now).run();
  let imported = 0;
  let updated = 0;
  for (const pack of packs) {
    const hash = await manifestHash(pack.beatmapsetIds);
    const existing = await env.DB.prepare("SELECT id FROM packs WHERE source_type = ? AND source_id = ?").bind(SOURCE_TYPE, pack.sourceId).first<{ id: string }>();
    const internalId = existing?.id ?? crypto.randomUUID();
    const share = existing ? undefined : shareId();
    const statements = [
      existing
        ? env.DB.prepare("UPDATE packs SET title = ?, description = ?, manifest_hash = ?, updated_at = ? WHERE id = ?").bind(pack.title, pack.description, hash, now, internalId)
        : env.DB.prepare("INSERT INTO packs (id, share_id, owner_id, title, description, is_private, manifest_hash, source_type, source_id, created_at, updated_at) VALUES (?, ?, 'osu-importer', ?, ?, 0, ?, ?, ?, ?, ?)").bind(internalId, share, pack.title, pack.description, hash, SOURCE_TYPE, pack.sourceId, now, now),
      env.DB.prepare("DELETE FROM pack_items WHERE pack_id = ?").bind(internalId),
      ...pack.beatmapsetIds.map((id, position) => env.DB.prepare("INSERT INTO pack_items (pack_id, beatmapset_id, position) VALUES (?, ?, ?)").bind(internalId, id, position)),
    ];
    await env.DB.batch(statements);
    existing ? updated++ : imported++;
  }
  return { pages: Math.min(maxPages, 100), imported, updated };
}
