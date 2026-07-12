import {
  getBillingPlan,
  type PlanFeatures,
  type PlanLimitKey,
} from "@/lib/billing/plans";

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "cancelled",
  "expired",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type BillingEntitlements = {
  features: PlanFeatures;
  limits: Record<PlanLimitKey, number | null>;
  planCode: string;
  planName: string;
  subscriptionStatus: SubscriptionStatus;
};

export function isSubscriptionUsable(status: SubscriptionStatus) {
  return status === "trialing" || status === "active";
}

export function getBillingEntitlements(input?: {
  planCode?: string | null;
  subscriptionStatus?: SubscriptionStatus | null;
}): BillingEntitlements {
  const plan = getBillingPlan(input?.planCode);

  return {
    features: plan.features,
    limits: plan.limits,
    planCode: plan.code,
    planName: plan.name,
    subscriptionStatus: input?.subscriptionStatus ?? "trialing",
  };
}

export function hasBillingFeature(
  entitlements: BillingEntitlements,
  feature: keyof PlanFeatures,
) {
  return isSubscriptionUsable(entitlements.subscriptionStatus)
    ? entitlements.features[feature]
    : false;
}

export function getBillingLimit(
  entitlements: BillingEntitlements,
  limitKey: PlanLimitKey,
) {
  return entitlements.limits[limitKey];
}
