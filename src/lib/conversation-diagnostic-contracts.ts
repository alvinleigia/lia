import { z } from "zod";

export const CONVERSATION_DIAGNOSTIC_CATEGORIES = [
  "response_quality",
  "routing",
  "validation",
  "lifecycle",
  "privacy",
  "performance",
  "other",
] as const;

export type ConversationDiagnosticCategory =
  (typeof CONVERSATION_DIAGNOSTIC_CATEGORIES)[number];

export const CONVERSATION_DIAGNOSTIC_CATEGORY_LABELS: Record<
  ConversationDiagnosticCategory,
  string
> = {
  response_quality: "Response quality",
  routing: "Routing",
  validation: "Validation",
  lifecycle: "Lifecycle",
  privacy: "Privacy",
  performance: "Performance",
  other: "Other",
};

export const conversationDiagnosticFindingSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  conversationId: z.coerce.number().int().positive(),
  category: z.enum(CONVERSATION_DIAGNOSTIC_CATEGORIES),
  note: z.string().trim().min(10).max(2000),
});

export const conversationRegressionCaseSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  conversationId: z.coerce.number().int().positive(),
  findingId: z.coerce.number().int().positive(),
  title: z.string().trim().min(3).max(120),
  syntheticInput: z.string().trim().min(1).max(2000),
  expectedBehavior: z.string().trim().min(10).max(2000),
  evaluationCategory: z.enum([
    "extraction",
    "correction",
    "clarification",
    "safety",
    "completion",
  ]),
});
