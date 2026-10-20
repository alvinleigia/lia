import { z } from "zod";
import type { TurnFieldStateV1 } from "@/lib/conversation-turn-contracts";

const fieldKey = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_]*$/)
  .max(80);
const priceValue = z.union([
  z.string().trim().min(1).max(200),
  z.number().finite(),
  z.boolean(),
]);
const minorAmount = z.number().int().min(0).max(1_000_000_000);

// Exact combinations deliberately avoid extrapolating saved rates to other
// dates, quantities or occupancy. Money is stored and summed in minor units.
export const taskPriceTableSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("mock"),
    currency: z.string().regex(/^[A-Z]{3}$/),
    minorUnitDigits: z.number().int().min(0).max(3),
    fields: z.array(fieldKey).min(1).max(20),
    alternativeField: fieldKey.optional(),
    aliases: z
      .record(fieldKey, z.record(z.string().max(200), priceValue))
      .default({}),
    offersMessage: z.string().trim().min(1).max(700),
    rows: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(200),
            match: z.record(fieldKey, priceValue),
            lines: z
              .array(
                z
                  .object({
                    quantity: z.number().int().min(1).max(100),
                    unitAmountMinor: minorAmount,
                    unitTaxMinor: minorAmount,
                  })
                  .strict(),
              )
              .min(1)
              .max(20),
            note: z.string().trim().max(300).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((table, ctx) => {
    if (
      table.alternativeField &&
      !table.fields.includes(table.alternativeField)
    )
      ctx.addIssue({
        code: "custom",
        message: "The alternative field must be a pricing field.",
      });
    if (new Set(table.fields).size !== table.fields.length)
      ctx.addIssue({
        code: "custom",
        message: "Pricing fields must be unique.",
      });
    for (const key of Object.keys(table.aliases)) {
      if (!table.fields.includes(key))
        ctx.addIssue({
          code: "custom",
          message: `Unknown pricing alias field ${key}.`,
        });
    }
    const seen = new Set<string>();
    for (const row of table.rows) {
      if (
        Object.keys(row.match).length !== table.fields.length ||
        table.fields.some((key) => !(key in row.match))
      )
        ctx.addIssue({
          code: "custom",
          message: "Every price row must match all pricing fields.",
        });
      const key = JSON.stringify(
        table.fields.map((key) =>
          normalizeValue(row.match[key], table.aliases[key]),
        ),
      );
      if (seen.has(key))
        ctx.addIssue({
          code: "custom",
          message: "Duplicate pricing combination.",
        });
      seen.add(key);
    }
  });

export type TaskPriceTable = z.infer<typeof taskPriceTableSchema>;

function normalizeValue(
  value: unknown,
  aliases?: Record<string, unknown>,
): unknown {
  const normalized =
    typeof value === "string"
      ? value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ")
      : value;
  const alias = Object.entries(aliases ?? {}).find(
    ([key]) => key.trim().toLocaleLowerCase("en") === normalized,
  );
  return alias ? normalizeValue(alias[1]) : normalized;
}

export function isTaskPricingQuestion(text: string) {
  return /\b(?:prices?|pricing|rates?|costs?|totals?|quotes?|discounts?|offers|coupons?|cheaper|bargain|how much|percent off)\b|%\s*off\b/i.test(
    text,
  );
}

// Only pure follow-ups skip extraction; requests containing new details still
// use the normal field extraction and validation path before pricing.
export function isStandaloneTaskPricingQuestion(text: string) {
  return (
    /^(?:please\s+)?(?:(?:what(?:'s| is| are)|how much is|tell me|show me|give me)\s+)?(?:the\s+)?(?:(?:total|normal|best|available|applicable|current)\s+)*(?:price|rates?|cost|total|quote|offers?|discounts?|coupons?)(?:\s+(?:please|for (?:this|that|the stay)|available))?[.!?]*$/i.test(
      text.trim(),
    ) ||
    /^(?:are there|do you have|any|can you (?:offer|give me))\s+(?:any\s+)?(?:offers?|discounts?|coupons?)(?:\s+available)?[.!?]*$/i.test(
      text.trim(),
    )
  );
}

export function answerTaskPricing(input: {
  table: TaskPriceTable;
  fields: TurnFieldStateV1[];
  text: string;
}) {
  const { table } = input;
  const asksOffers =
    /\b(?:discounts?|offers|coupons?|cheaper|bargain|percent off|%\s*off)\b/i.test(
      input.text,
    );
  const fields = new Map(input.fields.map((field) => [field.fieldKey, field]));
  const missing = table.fields.filter((key) => {
    const field = fields.get(key);
    return (
      !field ||
      !["valid", "confirmed"].includes(field.state) ||
      field.value === null
    );
  });
  if (missing.length) {
    return asksOffers
      ? `These are indicative estimates; our team will confirm applicable offers before booking. ${table.offersMessage}`
      : `To estimate the price, I still need: ${missing
          .slice(0, 6)
          .map((key) => fields.get(key)?.label ?? key)
          .join(
            ", ",
          )}${missing.length > 6 ? " and the remaining pricing details" : ""}.`;
  }
  const matches = table.rows.filter((row) =>
    table.fields.every(
      (key) =>
        normalizeValue(fields.get(key)?.value, table.aliases[key]) ===
        normalizeValue(row.match[key], table.aliases[key]),
    ),
  );
  if (matches.length !== 1) {
    return `I can't quote a price for these exact details yet. Our team will need to confirm the price.${asksOffers ? ` ${table.offersMessage}` : ""}`;
  }
  const row = matches[0];
  const base = row.lines.reduce(
    (sum, line) => sum + line.quantity * line.unitAmountMinor,
    0,
  );
  const tax = row.lines.reduce(
    (sum, line) => sum + line.quantity * line.unitTaxMinor,
    0,
  );
  const money = (value: number) =>
    `${table.currency} ${(value / 10 ** table.minorUnitDigits).toLocaleString("en-IN", { minimumFractionDigits: table.minorUnitDigits, maximumFractionDigits: table.minorUnitDigits })}`;
  if (asksOffers) {
    const alternatives = table.alternativeField
      ? table.rows
          .filter((candidate) =>
            table.fields.every(
              (key) =>
                key === table.alternativeField ||
                normalizeValue(candidate.match[key], table.aliases[key]) ===
                  normalizeValue(fields.get(key)?.value, table.aliases[key]),
            ),
          )
          .map((candidate) => ({
            candidate,
            total: candidate.lines.reduce(
              (sum, line) =>
                sum +
                line.quantity * (line.unitAmountMinor + line.unitTaxMinor),
              0,
            ),
          }))
          .filter((alternative) => alternative.total < base + tax)
          .sort((a, b) => a.total - b.total)
          .slice(0, 2)
      : [];
    return `These are indicative estimates; our team will confirm applicable offers before booking. ${table.offersMessage}${alternatives.map(({ candidate, total }) => `\nLower estimated rate — ${candidate.label}: ${money(total)} including tax.${candidate.note ? ` ${candidate.note}` : ""}`).join("")}`;
  }
  return `${row.label}: ${money(base + tax)} total (${money(base)} + ${money(tax)} tax). This is an indicative estimate. Our team will confirm availability and the final price before booking.${row.note ? ` ${row.note}` : ""}`;
}
