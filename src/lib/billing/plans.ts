export const PLAN_LIMIT_KEYS = [
  "projects",
  "documents",
  "messagesPerMonth",
  "storageMb",
  "whatsappChannels",
  "teamMembers",
  "operations",
] as const;

export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export type PlanLimits = Record<PlanLimitKey, number | null>;

export type PlanFeatures = {
  analytics: boolean;
  customDomains: boolean;
  flowBuilder: boolean;
  whatsapp: boolean;
  widget: boolean;
};

export type BillingPlan = {
  code: string;
  description: string;
  features: PlanFeatures;
  limits: PlanLimits;
  name: string;
  status: "active" | "archived" | "draft";
};

export const BETA_BILLING_PLANS = [
  {
    code: "internal",
    description: "Internal support, demos and migration testing.",
    features: {
      analytics: true,
      customDomains: false,
      flowBuilder: true,
      whatsapp: true,
      widget: true,
    },
    limits: {
      documents: 500,
      messagesPerMonth: 50_000,
      operations: 100,
      projects: 10,
      storageMb: 5_120,
      teamMembers: 10,
      whatsappChannels: 3,
    },
    name: "Internal",
    status: "active",
  },
  {
    code: "starter",
    description: "Small beta tenant with one WhatsApp number and core flows.",
    features: {
      analytics: true,
      customDomains: false,
      flowBuilder: true,
      whatsapp: true,
      widget: true,
    },
    limits: {
      documents: 100,
      messagesPerMonth: 10_000,
      operations: 20,
      projects: 3,
      storageMb: 1_024,
      teamMembers: 3,
      whatsappChannels: 1,
    },
    name: "Starter",
    status: "active",
  },
  {
    code: "growth",
    description:
      "Growing tenant with larger knowledge base and automation use.",
    features: {
      analytics: true,
      customDomains: false,
      flowBuilder: true,
      whatsapp: true,
      widget: true,
    },
    limits: {
      documents: 500,
      messagesPerMonth: 50_000,
      operations: 100,
      projects: 10,
      storageMb: 5_120,
      teamMembers: 10,
      whatsappChannels: 3,
    },
    name: "Growth",
    status: "active",
  },
  {
    code: "scale",
    description: "Larger tenant before enterprise-specific limits are needed.",
    features: {
      analytics: true,
      customDomains: false,
      flowBuilder: true,
      whatsapp: true,
      widget: true,
    },
    limits: {
      documents: 2_000,
      messagesPerMonth: 250_000,
      operations: 500,
      projects: 25,
      storageMb: 20_480,
      teamMembers: 25,
      whatsappChannels: 10,
    },
    name: "Scale",
    status: "active",
  },
] as const satisfies BillingPlan[];

export const DEFAULT_BETA_PLAN_CODE = "starter";

export function getBillingPlan(code: string | null | undefined) {
  if (!code) {
    return getDefaultBillingPlan();
  }

  return (
    BETA_BILLING_PLANS.find((plan) => plan.code === code) ??
    getDefaultBillingPlan()
  );
}

export function getDefaultBillingPlan() {
  const plan = BETA_BILLING_PLANS.find(
    (item) => item.code === DEFAULT_BETA_PLAN_CODE,
  );

  if (!plan) {
    throw new Error("Default beta billing plan is not configured.");
  }

  return plan;
}
