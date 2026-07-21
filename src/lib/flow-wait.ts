export const FLOW_WAIT_UNITS = ["seconds", "minutes", "hours", "days"] as const;

export type FlowWaitUnit = (typeof FLOW_WAIT_UNITS)[number];

const UNIT_MS: Record<FlowWaitUnit, number> = {
  seconds: 1_000,
  minutes: 60_000,
  hours: 60 * 60_000,
  days: 24 * 60 * 60_000,
};
const MAX_WAIT_MS = 30 * UNIT_MS.days;

function isFlowWaitUnit(value: unknown): value is FlowWaitUnit {
  return FLOW_WAIT_UNITS.includes(value as FlowWaitUnit);
}

export function getFlowWaitDurationMs(settings: Record<string, unknown>) {
  const amount = settings.waitAmount;
  const unit = settings.waitUnit;
  const normalizedAmount =
    typeof amount === "number" && Number.isFinite(amount)
      ? Math.max(1, Math.trunc(amount))
      : 1;
  const normalizedUnit = isFlowWaitUnit(unit) ? unit : "minutes";

  return Math.min(normalizedAmount * UNIT_MS[normalizedUnit], MAX_WAIT_MS);
}

export function getFlowWaitAvailableAt(
  settings: Record<string, unknown>,
  now = new Date(),
) {
  return new Date(now.getTime() + getFlowWaitDurationMs(settings));
}
