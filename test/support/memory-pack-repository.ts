import type { PackRepository } from "../../src/repositories/pack-repository";
import type { PackCreateData, PackRecord, PackUpdateData, PackViewerState } from "../../src/types";

interface StoredPack extends Omit<PackRecord, "ownerDisplayName" | "ratingAverage" | "ratingCount"> {}

export class MemoryPackRepository implements PackRepository {
  readonly users = new Map<string, string>([
    ["dev-user", "Local Developer"],
    ["other-user", "Other User"],
  ]);
  private readonly packs = new Map<string, StoredPack>();
  private readonly ratings = new Map<string, Map<string, number>>();
  readonly favorites = new Set<string>();

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

  async findByShareId(shareId: string): Promise<PackRecord | null> {
    const pack = this.packs.get(shareId);
    if (!pack) return null;
    const scores = [...(this.ratings.get(pack.internalId)?.values() ?? [])];
    return {
      ...pack,
      beatmapsetIds: [...pack.beatmapsetIds],
      ownerDisplayName: this.users.get(pack.ownerId)!,
      ratingAverage: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
      ratingCount: scores.length,
    };
  }

  async getViewerState(internalId: string, userId: string): Promise<PackViewerState> {
    return {
      rating: this.ratings.get(internalId)?.get(userId) ?? null,
      favorited: this.favorites.has(`${internalId}:${userId}`),
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
}
