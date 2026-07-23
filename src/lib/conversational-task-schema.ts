import { z } from "zod";

export const conversationalTaskIdSchema = z.coerce.number().int().positive();

export const conversationalTaskDetailsSchema = z.object({
  description: z.string().trim().max(2000).optional(),
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(600),
});

export type ConversationalTaskDetails = z.infer<
  typeof conversationalTaskDetailsSchema
>;
