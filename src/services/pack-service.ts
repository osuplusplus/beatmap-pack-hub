import { SHARE_ID } from "../config";
import { AppError, notFound } from "../errors";
import { deduplicatePreservingOrder, generateShareId, manifestHash } from "../domain/pack";
import type { PackRepository } from "../repositories/pack-repository";
import type { CreatePackInput, UpdatePackInput } from "../validation";

export class PackService {
  constructor(private readonly repository: PackRepository) {}

  private async assertUser(userId: string): Promise<void> {
    if (!(await this.repository.userExists(userId))) {
      throw new AppError(401, "UNKNOWN_IDENTITY", "Unknown client identity");
    }
  }

  private async uniqueShareId(): Promise<string> {
    for (let attempt = 0; attempt < SHARE_ID.maxAttempts; attempt++) {
      const candidate = generateShareId();
      if (!(await this.repository.shareIdExists(candidate))) return candidate;
    }
    throw new Error("Unable to allocate a unique share ID");
  }

  async create(userId: string, input: CreatePackInput): Promise<{ id: string }> {
    await this.assertUser(userId);
    const ids = deduplicatePreservingOrder(input.beatmapset_ids);
    const shareId = await this.uniqueShareId();
    const now = new Date().toISOString();
    await this.repository.create({
      internalId: crypto.randomUUID(),
      shareId,
      ownerId: userId,
      title: input.title,
      description: input.description,
      manifestHash: await manifestHash(ids),
      beatmapsetIds: ids,
      now,
    });
    return { id: shareId };
  }

  async get(shareId: string, viewerId: string | null = null) {
    const pack = await this.repository.findByShareId(shareId);
    if (!pack) throw notFound();
    if (viewerId) await this.assertUser(viewerId);
    const viewer = viewerId
      ? await this.repository.getViewerState(pack.internalId, viewerId)
      : null;
    return {
      id: pack.shareId,
      title: pack.title,
      description: pack.description,
      owner: { id: pack.ownerId, display_name: pack.ownerDisplayName },
      beatmapset_ids: pack.beatmapsetIds,
      manifest_hash: pack.manifestHash,
      rating: {
        average: pack.ratingCount === 0 ? null : Number(pack.ratingAverage.toFixed(2)),
        count: pack.ratingCount,
      },
      ...(viewerId && viewer ? {
        viewer: {
          rating: viewer.rating,
          favorited: viewer.favorited,
          can_edit: pack.ownerId === viewerId,
        },
      } : {}),
      created_at: pack.createdAt,
      updated_at: pack.updatedAt,
    };
  }

  async update(userId: string, shareId: string, input: UpdatePackInput): Promise<void> {
    await this.assertUser(userId);
    const current = await this.repository.findByShareId(shareId);
    if (!current) throw notFound();
    if (current.ownerId !== userId) throw new AppError(403, "NOT_PACK_OWNER", "Only the owner can modify this pack");
    const ids = input.beatmapset_ids
      ? deduplicatePreservingOrder(input.beatmapset_ids)
      : current.beatmapsetIds;
    await this.repository.update(current.internalId, {
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      manifestHash: await manifestHash(ids),
      beatmapsetIds: ids,
      now: new Date().toISOString(),
    });
  }

  async delete(userId: string, shareId: string): Promise<void> {
    await this.assertUser(userId);
    const current = await this.repository.findByShareId(shareId);
    if (!current) throw notFound();
    if (current.ownerId !== userId) throw new AppError(403, "NOT_PACK_OWNER", "Only the owner can delete this pack");
    await this.repository.delete(current.internalId);
  }

  async rate(userId: string, shareId: string, score: number): Promise<void> {
    await this.assertUser(userId);
    const current = await this.repository.findByShareId(shareId);
    if (!current) throw notFound();
    await this.repository.upsertRating(current.internalId, userId, score, new Date().toISOString());
  }

  async favorite(userId: string, shareId: string, enabled: boolean): Promise<void> {
    await this.assertUser(userId);
    const current = await this.repository.findByShareId(shareId);
    if (!current) throw notFound();
    if (enabled) {
      await this.repository.addFavorite(current.internalId, userId, new Date().toISOString());
    } else {
      await this.repository.removeFavorite(current.internalId, userId);
    }
  }
}
