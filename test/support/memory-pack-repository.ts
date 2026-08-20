import type { PackRepository } from "../../src/repositories/pack-repository";
import type { CommentRecord, PackCreateData, PackManifestRecord, PackRecord, PackUpdateData, PackViewerState } from "../../src/types";

interface StoredPack extends Omit<PackRecord, "ownerDisplayName" | "ratingAverage" | "ratingCount"> {}

export class MemoryPackRepository implements PackRepository {
  readonly users = new Map<string, string>([
    ["dev-user", "Local Developer"],
    ["other-user", "Other User"],
  ]);
  private readonly packs = new Map<string, StoredPack>();
  private readonly ratings = new Map<string, Map<string, number>>();
  readonly favorites = new Set<string>();
  readonly likes = new Set<string>();
  private readonly comments = new Map<string, CommentRecord>();

  async userExists(userId: string): Promise<boolean> {
    return this.users.has(userId);
  }

  async shareIdExists(shareId: string): Promise<boolean> {
    return this.packs.has(shareId);
  }

  async create(data: PackCreateData): Promise<void> {
    this.packs.set(data.shareId, {
      internalId: data.internalId,
      shareId: data.shareId,
      ownerId: data.ownerId,
      title: data.title,
      description: data.description,
      isPrivate: data.isPrivate,
      manifestHash: data.manifestHash,
      beatmapsetIds: [...data.beatmapsetIds],
      createdAt: data.now,
      updatedAt: data.now,
      likeCount: 0,
      commentCount: 0,
    });
  }

  async listPublic(limit: number): Promise<PackRecord[]> {
    const packs = await Promise.all([...this.packs.keys()].map((shareId) => this.findByShareId(shareId)));
    return packs.filter((pack): pack is PackRecord => pack !== null && !pack.isPrivate)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async searchPublic(query: string, limit: number): Promise<PackRecord[]> {
    const normalized = query.toLocaleLowerCase();
    const packs = await Promise.all([...this.packs.keys()].map((shareId) => this.findByShareId(shareId)));
    return packs.filter((pack): pack is PackRecord => {
      if (!pack || pack.isPrivate) return false;
      return [pack.title, pack.description, pack.ownerDisplayName, ...pack.beatmapsetIds.map(String)]
        .some((field) => field.toLocaleLowerCase().includes(normalized));
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  async findByShareId(shareId: string): Promise<PackRecord | null> {
    const pack = this.packs.get(shareId);
    if (!pack) return null;
    const scores = [...(this.ratings.get(pack.internalId)?.values() ?? [])];
    return {
      ...pack,
      likeCount: [...this.likes].filter((key) => key.startsWith(`${pack.internalId}:`)).length,
      commentCount: [...this.comments.values()].filter((comment) => comment.packId === pack.shareId).length,
      beatmapsetIds: [...pack.beatmapsetIds],
      ownerDisplayName: this.users.get(pack.ownerId)!,
      ratingAverage: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
      ratingCount: scores.length,
    };
  }

  async findManifestByShareId(shareId: string): Promise<PackManifestRecord | null> {
    const pack = this.packs.get(shareId);
    if (!pack) return null;
    return {
      ownerId: pack.ownerId,
      isPrivate: pack.isPrivate,
      manifestHash: pack.manifestHash,
    };
  }

  async getViewerState(internalId: string, userId: string): Promise<PackViewerState> {
    return {
      rating: this.ratings.get(internalId)?.get(userId) ?? null,
      favorited: this.favorites.has(`${internalId}:${userId}`),
      liked: this.likes.has(`${internalId}:${userId}`),
    };
  }

  async update(internalId: string, data: PackUpdateData): Promise<void> {
    const pack = [...this.packs.values()].find((item) => item.internalId === internalId)!;
    Object.assign(pack, {
      title: data.title,
      description: data.description,
      isPrivate: data.isPrivate,
      manifestHash: data.manifestHash,
      beatmapsetIds: [...data.beatmapsetIds],
      updatedAt: data.now,
    });
  }

  async delete(internalId: string): Promise<void> {
    const entry = [...this.packs.entries()].find(([, item]) => item.internalId === internalId);
    if (entry) this.packs.delete(entry[0]);
  }

  async upsertRating(internalId: string, userId: string, score: number): Promise<void> {
    const packRatings = this.ratings.get(internalId) ?? new Map<string, number>();
    packRatings.set(userId, score);
    this.ratings.set(internalId, packRatings);
  }

  async addFavorite(internalId: string, userId: string): Promise<void> {
    this.favorites.add(`${internalId}:${userId}`);
  }

  async removeFavorite(internalId: string, userId: string): Promise<void> {
    this.favorites.delete(`${internalId}:${userId}`);
  }

  async addLike(internalId: string, userId: string): Promise<void> { this.likes.add(`${internalId}:${userId}`); }
  async removeLike(internalId: string, userId: string): Promise<void> { this.likes.delete(`${internalId}:${userId}`); }
  async listComments(internalId: string, limit: number): Promise<CommentRecord[]> {
    return [...this.comments.values()].filter((c) => c.packId === [...this.packs.values()].find((p) => p.internalId === internalId)?.shareId).slice(0, limit);
  }
  async createComment(internalId: string, userId: string, content: string, now: string): Promise<CommentRecord> {
    const pack = [...this.packs.values()].find((p) => p.internalId === internalId)!;
    const comment = { id: crypto.randomUUID(), packId: pack.shareId, userId, userDisplayName: this.users.get(userId)!, content, createdAt: now, updatedAt: now };
    this.comments.set(comment.id, comment); return comment;
  }
  async findComment(commentId: string): Promise<CommentRecord | null> { return this.comments.get(commentId) ?? null; }
  async updateComment(commentId: string, content: string, now: string): Promise<CommentRecord | null> { const c = this.comments.get(commentId); if (!c) return null; c.content = content; c.updatedAt = now; return c; }
  async deleteComment(commentId: string): Promise<CommentRecord | null> { const c = this.comments.get(commentId); if (!c) return null; this.comments.delete(commentId); return c; }
}
