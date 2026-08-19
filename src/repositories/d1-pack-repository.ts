import type { PackRepository } from "./pack-repository";
import type { CommentRecord, PackCreateData, PackRecord, PackUpdateData, PackViewerState } from "../types";

interface PackRow {
  internal_id: string;
  share_id: string;
  owner_id: string;
  owner_display_name: string;
  title: string;
  description: string;
  is_private: number;
  manifest_hash: string;
  rating_average: number | null;
  rating_count: number;
  created_at: string;
  updated_at: string;
  like_count: number;
  comment_count: number;
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
        INSERT INTO packs (id, share_id, owner_id, title, description, is_private, manifest_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(data.internalId, data.shareId, data.ownerId, data.title, data.description, data.isPrivate ? 1 : 0, data.manifestHash, data.now, data.now),
      ...data.beatmapsetIds.map((beatmapsetId, position) =>
        this.db.prepare("INSERT INTO pack_items (pack_id, beatmapset_id, position) VALUES (?, ?, ?)")
          .bind(data.internalId, beatmapsetId, position)),
    ];
    await this.db.batch(statements);
  }

  async findByShareId(shareId: string): Promise<PackRecord | null> {
    const row = await this.db.prepare(`
      SELECT p.id AS internal_id, p.share_id, p.owner_id, u.display_name AS owner_display_name,
             p.title, p.description, p.is_private, p.manifest_hash, p.created_at, p.updated_at,
             AVG(r.score) AS rating_average, COUNT(DISTINCT r.user_id) AS rating_count,
             (SELECT COUNT(*) FROM pack_likes pl WHERE pl.pack_id = p.id) AS like_count,
             (SELECT COUNT(*) FROM pack_comments pc WHERE pc.pack_id = p.id AND pc.deleted_at IS NULL) AS comment_count
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
      isPrivate: row.is_private === 1,
      manifestHash: row.manifest_hash,
      beatmapsetIds: items.results.map((item) => item.beatmapset_id),
      ratingAverage: row.rating_average ?? 0,
      ratingCount: row.rating_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      likeCount: row.like_count,
      commentCount: row.comment_count,
    };
  }

  async listPublic(limit: number): Promise<PackRecord[]> {
    const rows = await this.db.prepare(`
      SELECT p.share_id FROM packs p
      WHERE p.is_private = 0
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT ?
    `).bind(limit).all<{ share_id: string }>();
    const packs = await Promise.all(rows.results.map((row) => this.findByShareId(row.share_id)));
    return packs.filter((pack): pack is PackRecord => pack !== null);
  }

  async searchPublic(query: string, limit: number): Promise<PackRecord[]> {
    const pattern = `%${query}%`;
    const rows = await this.db.prepare(`
      SELECT DISTINCT p.share_id
      FROM packs p
      JOIN users u ON u.id = p.owner_id
      LEFT JOIN pack_items pi ON pi.pack_id = p.id
      WHERE p.is_private = 0
        AND (p.title LIKE ? COLLATE NOCASE
          OR p.description LIKE ? COLLATE NOCASE
          OR u.display_name LIKE ? COLLATE NOCASE
          OR CAST(pi.beatmapset_id AS TEXT) LIKE ?)
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT ?
    `).bind(pattern, pattern, pattern, pattern, limit).all<{ share_id: string }>();
    const packs = await Promise.all(rows.results.map((row) => this.findByShareId(row.share_id)));
    return packs.filter((pack): pack is PackRecord => pack !== null);
  }

  async getViewerState(internalId: string, userId: string): Promise<PackViewerState> {
    const row = await this.db.prepare(`
      SELECT
        (SELECT score FROM ratings WHERE pack_id = ? AND user_id = ?) AS rating,
        EXISTS(SELECT 1 FROM favorites WHERE pack_id = ? AND user_id = ?) AS favorited
        ,EXISTS(SELECT 1 FROM pack_likes WHERE pack_id = ? AND user_id = ?) AS liked
    `).bind(internalId, userId, internalId, userId, internalId, userId).first<{ rating: number | null; favorited: number; liked: number }>();

    return {
      rating: row?.rating ?? null,
      favorited: row?.favorited === 1,
      liked: row?.liked === 1,
    };
  }

  async update(internalId: string, data: PackUpdateData): Promise<void> {
    const statements = [
      this.db.prepare(`
        UPDATE packs SET title = ?, description = ?, is_private = ?, manifest_hash = ?, updated_at = ? WHERE id = ?
      `).bind(data.title, data.description, data.isPrivate ? 1 : 0, data.manifestHash, data.now, internalId),
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

  async addLike(internalId: string, userId: string, now: string): Promise<void> {
    await this.db.prepare("INSERT INTO pack_likes (pack_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(pack_id, user_id) DO NOTHING").bind(internalId, userId, now).run();
  }

  async removeLike(internalId: string, userId: string): Promise<void> {
    await this.db.prepare("DELETE FROM pack_likes WHERE pack_id = ? AND user_id = ?").bind(internalId, userId).run();
  }

  private mapComment(row: any): CommentRecord {
    return { id: row.id, packId: row.share_id, userId: row.user_id, userDisplayName: row.display_name, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async listComments(internalId: string, limit: number): Promise<CommentRecord[]> {
    const rows = await this.db.prepare(`SELECT pc.*, p.share_id, u.display_name FROM pack_comments pc JOIN packs p ON p.id = pc.pack_id JOIN users u ON u.id = pc.user_id WHERE pc.pack_id = ? AND pc.deleted_at IS NULL ORDER BY pc.created_at ASC LIMIT ?`).bind(internalId, limit).all();
    return rows.results.map((row) => this.mapComment(row));
  }

  async createComment(internalId: string, userId: string, content: string, now: string): Promise<CommentRecord> {
    const id = crypto.randomUUID();
    await this.db.prepare("INSERT INTO pack_comments (id, pack_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, internalId, userId, content, now, now).run();
    return (await this.findComment(id))!;
  }

  async findComment(commentId: string): Promise<CommentRecord | null> {
    const row = await this.db.prepare("SELECT pc.*, p.share_id, u.display_name FROM pack_comments pc JOIN packs p ON p.id = pc.pack_id JOIN users u ON u.id = pc.user_id WHERE pc.id = ? AND pc.deleted_at IS NULL").bind(commentId).first();
    return row ? this.mapComment(row) : null;
  }

  async updateComment(commentId: string, content: string, now: string): Promise<CommentRecord | null> {
    await this.db.prepare("UPDATE pack_comments SET content = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").bind(content, now, commentId).run();
    return this.findComment(commentId);
  }

  async deleteComment(commentId: string): Promise<CommentRecord | null> {
    const current = await this.findComment(commentId);
    if (!current) return null;
    await this.db.prepare("UPDATE pack_comments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").bind(new Date().toISOString(), commentId).run();
    return current;
  }
}
