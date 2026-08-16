export interface Env {
  DB: D1Database;
}

export interface PackRecord {
  internalId: string;
  shareId: string;
  ownerId: string;
  ownerDisplayName: string;
  title: string;
  description: string;
  manifestHash: string;
  beatmapsetIds: number[];
  ratingAverage: number;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PackCreateData {
  internalId: string;
  shareId: string;
  ownerId: string;
  title: string;
  description: string;
  manifestHash: string;
  beatmapsetIds: number[];
  now: string;
}

export interface PackUpdateData {
  title: string;
  description: string;
  manifestHash: string;
  beatmapsetIds: number[];
  now: string;
}
