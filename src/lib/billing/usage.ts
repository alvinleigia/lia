import type { BillingEntitlements } from "@/lib/billing/entitlements";
import { PLAN_LIMIT_KEYS, type PlanLimitKey } from "@/lib/billing/plans";

export type BillingUsage = Record<PlanLimitKey, number>;

export type BillingLimitEvaluation = {
  allowed: boolean;
  current: number;
  limit: number | null;
  limitKey: PlanLimitKey;
  next: number;
  percentUsed: number | null;
  remaining: number | null;
};

export function createEmptyBillingUsage(): BillingUsage {
  return PLAN_LIMIT_KEYS.reduce((usage, key) => {
    usage[key] = 0;
    return usage;
  }, {} as BillingUsage);
}

export function normalizeBillingUsage(
  usage: Partial<BillingUsage>,
): BillingUsage {
  const normalized = createEmptyBillingUsage();

  for (const key of PLAN_LIMIT_KEYS) {
    normalized[key] = Math.max(0, Math.floor(usage[key] ?? 0));
  }

  return normalized;
}

export function evaluateBillingLimit(input: {
  entitlements: BillingEntitlements;
  limitKey: PlanLimitKey;
  requested?: number;
  usage: Partial<BillingUsage>;
}): BillingLimitEvaluation {
  const usage = normalizeBillingUsage(input.usage);
  const current = usage[input.limitKey];
  const requested = Math.max(1, Math.floor(input.requested ?? 1));
  const next = current + requested;
  const limit = input.entitlements.limits[input.limitKey];

  if (limit === null) {
    return {
      allowed: true,
      current,
      limit,
      limitKey: input.limitKey,
      next,
      percentUsed: null,
      remaining: null,
    };
  }

  return {
    allowed: next <= limit,
    current,
    limit,
    limitKey: input.limitKey,
    next,
    percentUsed: limit > 0 ? current / limit : 1,
    remaining: Math.max(0, limit - current),
  };
}

export function evaluateBillingUsage(input: {
  entitlements: BillingEntitlements;
  usage: Partial<BillingUsage>;
}) {
  return PLAN_LIMIT_KEYS.map((limitKey) =>
    evaluateBillingLimit({
      entitlements: input.entitlements,
      limitKey,
      requested: 0,
      usage: input.usage,
    }),
  );
}
