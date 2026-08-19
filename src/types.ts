export interface Env {
  DB: D1Database;
  ALLOW_DEV_AUTH?: string;
  IMPORT_SECRET?: string;
}

export interface PackRecord {
  internalId: string;
  shareId: string;
  ownerId: string;
  ownerDisplayName: string;
  title: string;
  description: string;
  isPrivate: boolean;
  manifestHash: string;
  beatmapsetIds: number[];
  ratingAverage: number;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  commentCount: number;
}

export interface PackCreateData {
  internalId: string;
  shareId: string;
  ownerId: string;
  title: string;
  description: string;
  isPrivate: boolean;
  manifestHash: string;
  beatmapsetIds: number[];
  now: string;
}

export interface PackUpdateData {
  title: string;
  description: string;
  isPrivate: boolean;
  manifestHash: string;
  beatmapsetIds: number[];
  now: string;
}

export interface PackViewerState {
  rating: number | null;
  favorited: boolean;
}
