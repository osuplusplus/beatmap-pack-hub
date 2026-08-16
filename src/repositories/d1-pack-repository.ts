import type { PackRepository } from "./pack-repository";
import type { PackCreateData, PackRecord, PackUpdateData } from "../types";

interface PackRow {
  internal_id: string;
  share_id: string;
  owner_id: string;
  owner_display_name: string;
  title: string;
  description: string;
  manifest_hash: string;
  rating_average: number | null;
  rating_count: number;
  created_at: string;
  updated_at: string;
}

export class D1PackRepository implements PackRepository {
  constructor(private readonly db: D1Database) {}

  async userExists(userId: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT 1 AS found FROM users WHERE id = ? LIMIT 1").bind(userId).first();
    return row !== null;
  }

  async shareIdExists(shareId: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT 1 AS found FROM packs WHERE share_id = ? LIMIT 1").bind(shareId).first();
    return row !== null;
  }

  async create(data: PackCreateData): Promise<void> {
    const statements = [
      this.db.prepare(`
        INSERT INTO packs (id, share_id, owner_id, title, description, manifest_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(data.internalId, data.shareId, data.ownerId, data.title, data.description, data.manifestHash, data.now, data.now),
      ...data.beatmapsetIds.map((beatmapsetId, position) =>
        this.db.prepare("INSERT INTO pack_items (pack_id, beatmapset_id, position) VALUES (?, ?, ?)")
          .bind(data.internalId, beatmapsetId, position)),
    ];
    await this.db.batch(statements);
  }

  async findByShareId(shareId: string): Promise<PackRecord | null> {
    const row = await this.db.prepare(`
      SELECT p.id AS internal_id, p.share_id, p.owner_id, u.display_name AS owner_display_name,
             p.title, p.description, p.manifest_hash, p.created_at, p.updated_at,
             AVG(r.score) AS rating_average, COUNT(r.score) AS rating_count
      FROM packs p
      JOIN users u ON u.id = p.owner_id
      LEFT JOIN ratings r ON r.pack_id = p.id
      WHERE p.share_id = ?
      GROUP BY p.id
    `).bind(shareId).first<PackRow>();
    if (!row) return null;

    const items = await this.db.prepare(`
      SELECT beatmapset_id FROM pack_items WHERE pack_id = ? ORDER BY position ASC
    `).bind(row.internal_id).all<{ beatmapset_id: number }>();

    return {
      internalId: row.internal_id,
      shareId: row.share_id,
      ownerId: row.owner_id,
      ownerDisplayName: row.owner_display_name,
      title: row.title,
      description: row.description,
      manifestHash: row.manifest_hash,
      beatmapsetIds: items.results.map((item) => item.beatmapset_id),
      ratingAverage: row.rating_average ?? 0,
      ratingCount: row.rating_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async update(internalId: string, data: PackUpdateData): Promise<void> {
    const statements = [
      this.db.prepare(`
        UPDATE packs SET title = ?, description = ?, manifest_hash = ?, updated_at = ? WHERE id = ?
      `).bind(data.title, data.description, data.manifestHash, data.now, internalId),
      this.db.prepare("DELETE FROM pack_items WHERE pack_id = ?").bind(internalId),
      ...data.beatmapsetIds.map((beatmapsetId, position) =>
        this.db.prepare("INSERT INTO pack_items (pack_id, beatmapset_id, position) VALUES (?, ?, ?)")
          .bind(internalId, beatmapsetId, position)),
    ];
    await this.db.batch(statements);
  }

  async delete(internalId: string): Promise<void> {
    await this.db.prepare("DELETE FROM packs WHERE id = ?").bind(internalId).run();
  }

  async upsertRating(internalId: string, userId: string, score: number, now: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO ratings (pack_id, user_id, score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(pack_id, user_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at
    `).bind(internalId, userId, score, now, now).run();
  }

  async addFavorite(internalId: string, userId: string, now: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO favorites (pack_id, user_id, created_at) VALUES (?, ?, ?)
      ON CONFLICT(pack_id, user_id) DO NOTHING
    `).bind(internalId, userId, now).run();
  }

  async removeFavorite(internalId: string, userId: string): Promise<void> {
    await this.db.prepare("DELETE FROM favorites WHERE pack_id = ? AND user_id = ?")
      .bind(internalId, userId).run();
  }
}
