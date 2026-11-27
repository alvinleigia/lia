import { z } from "zod";
import type { ConversationalTaskDefinitionV1 } from "@/lib/conversation-contracts";
import type {
  TurnFieldStateV1,
  TurnResultV1,
} from "@/lib/conversation-turn-contracts";

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

// Only consume a whole, unambiguous selection. Richer requests and competing
// options continue through normal model extraction and field validation.
export function extractPricedChoice(
  definition: ConversationalTaskDefinitionV1,
  requestedKey: string | null | undefined,
  text: string,
): TurnResultV1["fieldCandidates"] | null {
  const table = definition.priceTable;
  const item = definition.fields.find((field) => field.key === requestedKey);
  if (
    !table ||
    !item ||
    !table.fields.includes(item.key) ||
    item.optionSource?.kind !== "static"
  )
    return null;
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ];
  const value = text
    .trim()
    .toLowerCase()
    .replace(/(?:,?\s+please)?[.!]?$/, "")
    .trim();
  const match = /^(\d+|[a-z]+)\s+(.+)$/.exec(value);
  if (!match) return null;
  const quantity = /^\d+$/.test(match[1])
    ? Number(match[1])
    : words.indexOf(match[1]);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;

  const visitorFields = definition.fields.filter(
    (field) =>
      table.fields.includes(field.key) &&
      field.cardinality === "single" &&
      field.sourcePriority.includes("visitor") &&
      field.sensitivity === "standard",
  );
  if (!visitorFields.includes(item)) return null;
  // Require the same named item and exactly one quantity field. A participant
  // count or another related measurement must never become the item count.
  const subjects = (field: typeof item, quantityField: boolean) =>
    [field.key, field.label]
      .map((name) =>
        name
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " "),
      )
      .filter(
        (name) => !quantityField || /\b(?:number|count|quantity)\b/.test(name),
      )
      .map((name) =>
        name
          .replace(
            /\b(?:the|of|number|quantity|count|preferred|requested|selected|category|choice|type|option|tier)\b/g,
            "",
          )
          .replace(/s\b/g, "")
          .trim()
          .replace(/\s+/g, " "),
      )
      .filter(Boolean);
  const itemSubjects = subjects(item, false);
  const quantities = visitorFields.filter(
    (field) =>
      field.type === "integer" &&
      subjects(field, true).some((name) => itemSubjects.includes(name)),
  );
  if (quantities.length !== 1) return null;
  const plan = visitorFields.find(
    (field) =>
      field.key === table.alternativeField &&
      field.key !== item.key &&
      (field.type === "text" || field.type === "enum") &&
      field.optionSource?.kind !== "project_resource",
  );
  const selections: TurnResultV1["fieldCandidates"][] = [];
  for (const option of item.optionSource.options) {
    const aliases = Object.entries(table.aliases[item.key] ?? {}).filter(
      ([, canonical]) => canonical === option.value,
    );
    const names = new Set(
      [option.value, option.label, ...aliases.map(([alias]) => alias)].map(
        (name) => name.toLowerCase(),
      ),
    );
    for (const name of names) {
      if (match[2] !== name && !match[2].startsWith(name + " ")) continue;
      const remainder = match[2].slice(name.length).trim();
      const candidates: TurnResultV1["fieldCandidates"] = [
        {
          fieldKey: item.key,
          naturalValue: option.value,
          confidence: 1,
          source: "visitor",
        },
        {
          fieldKey: quantities[0].key,
          naturalValue: quantity,
          confidence: 1,
          source: "visitor",
        },
      ];
      if (remainder) {
        const planName = /^(?:on|with|under)\s+(?:the\s+)?(.+)$/.exec(
          remainder,
        )?.[1];
        if (!plan || !planName) continue;
        const selected = normalizeValue(planName, table.aliases[plan.key]);
        const plans = new Set(
          table.rows
            .map((row) => row.match[plan.key])
            .filter(
              (name) =>
                normalizeValue(name, table.aliases[plan.key]) === selected,
            ),
        );
        if (plans.size !== 1) continue;
        candidates.push({
          fieldKey: plan.key,
          naturalValue: [...plans][0],
          confidence: 1,
          source: "visitor",
        });
      }
      selections.push(candidates);
    }
  }
  return selections.length === 1 ? selections[0] : null;
}

export function missingTaskPriceFields(
  table: TaskPriceTable,
  fields: TurnFieldStateV1[],
) {
  return table.fields.filter(
    (key) =>
      !fields.some(
        (field) =>
          field.fieldKey === key &&
          ["valid", "confirmed"].includes(field.state) &&
          field.value !== null,
      ),
  );
}

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
  // A price mention does not make an inclusion/policy question arithmetic.
  // Keep these on grounded knowledge rather than repeating a numeric quote.
  if (
    /\b(?:includes?|included|inclusions?|covers?|covered|refundable|refunds?|cancellation|polic(?:y|ies))\b/i.test(
      text,
    )
  )
    return false;
  return /\b(?:prices?|pricing|rates?|costs?|totals?|quotes?|discounts?|offers|coupons?|cheaper|bargain|how much|percent off)\b|%\s*off\b/i.test(
    text,
  );
}

// Only pure follow-ups skip extraction; requests containing new details still
// use the normal field extraction and validation path before pricing.
export function isStandaloneTaskPricingQuestion(text: string) {
  return (
    isStandaloneDiscountRequest(text) ||
    /^(?:are there|do you have|show me|any)\s+(?:any\s+)?(?:offers?|discounts?|cheaper (?:rate plans?|rates?|options?)|coupon codes?)(?:(?:,\s*|\s+(?:or|and)\s+)(?:offers?|discounts?|cheaper (?:rate plans?|rates?|options?)|coupon codes?))*(?:\s+(?:available|for (?:this|that)(?: stay|booking|request|service)?))?[.!?]*$/i.test(
      text.trim(),
    ) ||
    /^(?:please\s+)?(?:(?:what(?:'s| is| are)|how much is|tell me|show me|give me)\s+)?(?:the\s+)?(?:(?:total|normal|best|available|applicable|current)\s+)*(?:price|rates?|cost|total|quote|offers?|discounts?|coupons?)(?:\s+(?:please|for (?:this|that|the stay)|available))?[.!?]*$/i.test(
      text.trim(),
    ) ||
    /^(?:are there|do you have|any|can you (?:offer|give me))\s+(?:any\s+)?(?:offers?|discounts?|coupons?)(?:\s+available)?[.!?]*$/i.test(
      text.trim(),
    )
  );
}

function isStandaloneDiscountRequest(text: string) {
  return /^(?:please\s+)?(?:can|could|would) you (?:take|give|offer|apply|do|make)(?: me)?(?: an? extra| another| an additional)? \d+(?:\.\d+)?\s*(?:percent|%)(?: off| discount| reduction)(?:\s+please)?[.!?]*(?:\s+I(?: will|'ll) book (?:immediately|now|today)[.!?]*)?$/i.test(
    text.trim(),
  );
}

export function answerTaskPricing(input: {
  table: TaskPriceTable;
  fields: TurnFieldStateV1[];
  text: string;
  intent?: "quote" | "offers" | "discount" | null;
}) {
  const { table } = input;
  if (
    input.intent === "discount" ||
    (!input.intent && isStandaloneDiscountRequest(input.text))
  ) {
    return "Any extra discount needs our team's approval. I can request a callback for the best available price.";
  }
  const asksOffers = input.intent
    ? input.intent === "offers"
    : /\b(?:discounts?|offers|coupons?|cheaper|bargain|percent off|%\s*off)\b/i.test(
        input.text,
      );
  const fields = new Map(input.fields.map((field) => [field.fieldKey, field]));
  const missing = missingTaskPriceFields(table, input.fields);
  if (missing.length) {
    return asksOffers
      ? table.offersMessage
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
    return [
      ...alternatives.map(
        ({ candidate, total }) =>
          `${table.alternativeField ? candidate.match[table.alternativeField] : candidate.label}: estimated ${money(total)} including tax.${candidate.note ? ` ${candidate.note}` : " Our team will confirm eligibility and the final price."}`,
      ),
      table.offersMessage,
    ].join("\n");
  }
  return `${row.label}: ${money(base + tax)} total (${money(base)} + ${money(tax)} tax). This is an indicative estimate. Our team will confirm availability and the final price before booking.${row.note ? ` ${row.note}` : ""}`;
}
