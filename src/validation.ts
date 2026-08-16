import { z } from "zod";
import { LIMITS } from "./config";

const beatmapsetIds = z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
  .min(1)
  .max(LIMITS.maxBeatmapsetCount);

export const createPackSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.titleMaxLength),
  description: z.string().max(LIMITS.descriptionMaxLength).default(""),
  beatmapset_ids: beatmapsetIds,
}).strict();

export const updatePackSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.titleMaxLength).optional(),
  description: z.string().max(LIMITS.descriptionMaxLength).optional(),
  beatmapset_ids: beatmapsetIds.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const ratingSchema = z.object({
  score: z.number().int().min(1).max(5),
}).strict();

export type CreatePackInput = z.infer<typeof createPackSchema>;
export type UpdatePackInput = z.infer<typeof updatePackSchema>;
