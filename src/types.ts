export interface Env {
  DB: D1Database;
  ALLOW_DEV_AUTH?: string;
  ENVIRONMENT?: string;
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
  liked: boolean;
}

export interface CommentRecord {
  id: string;
  packId: string;
  userId: string;
  userDisplayName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentView {
  id: string;
  user: { id: string; display_name: string };
  content: string;
  created_at: string;
  updated_at: string;
}
