import { z } from "zod";
import { LIMITS } from "./config";

const beatmapsetIds = z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
  .min(1)
  .max(LIMITS.maxBeatmapsetCount);

export const createPackSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.titleMaxLength),
  description: z.string().max(LIMITS.descriptionMaxLength).default(""),
  beatmapset_ids: beatmapsetIds,
  is_private: z.boolean().default(false),
}).strict();

export const updatePackSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.titleMaxLength).optional(),
  description: z.string().max(LIMITS.descriptionMaxLength).optional(),
  beatmapset_ids: beatmapsetIds.optional(),
  is_private: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const ratingSchema = z.object({
  score: z.number().int().min(1).max(5),
}).strict();

const publicKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Expected a base64url-encoded Ed25519 public key");
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/, "Expected a base64url-encoded Ed25519 signature");

export const handshakeSchema = z.object({
  public_key: publicKey,
  display_name: z.string().trim().min(1).max(64),
  device_name: z.string().trim().min(1).max(64),
  signature,
}).strict();

export const challengeSchema = z.object({
  public_key: publicKey,
}).strict();

export const verifySchema = z.object({
  challenge_id: z.string().uuid(),
  signature,
}).strict();

export const linkDeviceSchema = z.object({
  link_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Expected a device link token"),
  public_key: publicKey,
  device_name: z.string().trim().min(1).max(64),
  signature,
}).strict();

export type CreatePackInput = z.infer<typeof createPackSchema>;
export type UpdatePackInput = z.infer<typeof updatePackSchema>;
