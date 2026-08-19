import { SHARE_ID } from "../config";
import { AppError, notFound } from "../errors";
import { deduplicatePreservingOrder, generateShareId, manifestHash } from "../domain/pack";
import type { PackRepository } from "../repositories/pack-repository";
import type { CommentRecord, CommentView, PackRecord } from "../types";
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
      isPrivate: input.is_private,
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
    if (pack.isPrivate && pack.ownerId !== viewerId) throw notFound();
    const viewer = viewerId
      ? await this.repository.getViewerState(pack.internalId, viewerId)
      : null;
    return {
      id: pack.shareId,
      title: pack.title,
      description: pack.description,
      is_private: pack.isPrivate,
      owner: { id: pack.ownerId, display_name: pack.ownerDisplayName },
      beatmapset_ids: pack.beatmapsetIds,
      manifest_hash: pack.manifestHash,
      rating: {
        average: pack.ratingCount === 0 ? null : Number(pack.ratingAverage.toFixed(2)),
        count: pack.ratingCount,
      },
      likes: { count: pack.likeCount },
      comments: { count: pack.commentCount },
      ...(viewerId && viewer ? {
        viewer: {
          rating: viewer.rating,
          favorited: viewer.favorited,
          liked: viewer.liked,
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
      isPrivate: input.is_private ?? current.isPrivate,
      manifestHash: await manifestHash(ids),
      beatmapsetIds: ids,
      now: new Date().toISOString(),
    });
  }

  async recommendations(limit = 20) {
    const packs = await this.repository.listPublic(limit);
    return packs.map((pack) => this.serialize(pack));
  }

  private serialize(pack: PackRecord) {
    return {
      id: pack.shareId,
      title: pack.title,
      description: pack.description,
      is_private: pack.isPrivate,
      owner: { id: pack.ownerId, display_name: pack.ownerDisplayName },
      beatmapset_ids: pack.beatmapsetIds,
      manifest_hash: pack.manifestHash,
      rating: { average: pack.ratingCount === 0 ? null : Number(pack.ratingAverage.toFixed(2)), count: pack.ratingCount },
      likes: { count: pack.likeCount },
      comments: { count: pack.commentCount },
      created_at: pack.createdAt,
      updated_at: pack.updatedAt,
    };
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

  private async accessiblePack(shareId: string, viewerId: string): Promise<PackRecord> {
    await this.assertUser(viewerId);
    const pack = await this.repository.findByShareId(shareId);
    if (!pack || (pack.isPrivate && pack.ownerId !== viewerId)) throw notFound();
    return pack;
  }

  async like(userId: string, shareId: string, enabled: boolean): Promise<void> {
    const pack = await this.accessiblePack(shareId, userId);
    if (enabled) await this.repository.addLike(pack.internalId, userId, new Date().toISOString());
    else await this.repository.removeLike(pack.internalId, userId);
  }

  async comments(userId: string | null, shareId: string, limit = 50): Promise<CommentView[]> {
    const pack = await this.repository.findByShareId(shareId);
    if (!pack || (pack.isPrivate && pack.ownerId !== userId)) throw notFound();
    return (await this.repository.listComments(pack.internalId, limit)).map((comment) => ({
      id: comment.id,
      user: { id: comment.userId, display_name: comment.userDisplayName },
      content: comment.content,
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
    }));
  }

  async createComment(userId: string, shareId: string, content: string): Promise<CommentRecord> {
    const pack = await this.accessiblePack(shareId, userId);
    return this.repository.createComment(pack.internalId, userId, content, new Date().toISOString());
  }

  async updateComment(userId: string, commentId: string, content: string): Promise<CommentRecord> {
    await this.assertUser(userId);
    const current = await this.repository.findComment(commentId);
    if (!current) throw notFound();
    if (current.userId !== userId) throw new AppError(403, "NOT_COMMENT_AUTHOR", "Only the comment author can edit this comment");
    const updated = await this.repository.updateComment(commentId, content, new Date().toISOString());
    if (!updated) throw notFound();
    return updated;
  }

  async deleteComment(userId: string, commentId: string): Promise<void> {
    await this.assertUser(userId);
    const comment = await this.repository.findComment(commentId);
    if (!comment) throw notFound();
    const pack = await this.repository.findByShareId(comment.packId);
    if (comment.userId !== userId && pack?.ownerId !== userId) {
      throw new AppError(403, "COMMENT_DELETE_FORBIDDEN", "Only the comment author or pack owner can delete this comment");
    }
    await this.repository.deleteComment(commentId);
  }
}
