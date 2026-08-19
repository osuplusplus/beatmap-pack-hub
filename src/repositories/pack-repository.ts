import type { PackCreateData, PackRecord, PackUpdateData, PackViewerState } from "../types";

export interface PackRepository {
  userExists(userId: string): Promise<boolean>;
  shareIdExists(shareId: string): Promise<boolean>;
  create(data: PackCreateData): Promise<void>;
  findByShareId(shareId: string): Promise<PackRecord | null>;
  listPublic(limit: number): Promise<PackRecord[]>;
  getViewerState(internalId: string, userId: string): Promise<PackViewerState>;
  update(internalId: string, data: PackUpdateData): Promise<void>;
  delete(internalId: string): Promise<void>;
  upsertRating(internalId: string, userId: string, score: number, now: string): Promise<void>;
  addFavorite(internalId: string, userId: string, now: string): Promise<void>;
  removeFavorite(internalId: string, userId: string): Promise<void>;
}
