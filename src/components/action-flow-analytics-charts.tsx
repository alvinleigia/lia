"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ActionFlowAnalytics } from "@/lib/action-flow-analytics";

type ActionFlowAnalyticsChartsProps = {
  analytics: ActionFlowAnalytics;
};

const stepChartConfig = {
  collectedCount: {
    color: "#16a34a",
    label: "Collected",
  },
  dropOffCount: {
    color: "#dc2626",
    label: "Drop-Off",
  },
  routeDecisionCount: {
    color: "#2563eb",
    label: "Routes",
  },
  validationFailureCount: {
    color: "#ca8a04",
    label: "Fails",
  },
} satisfies ChartConfig;

const sourceChartConfig = {
  count: {
    color: "#111827",
    label: "Starts",
  },
} satisfies ChartConfig;

const statusColors = ["#16a34a", "#2563eb", "#dc2626", "#6b7280"];

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateLabel(value: string) {
  return value.length > 22 ? `${value.slice(0, 19)}...` : value;
}

export function ActionFlowAnalyticsCharts({
  analytics,
}: ActionFlowAnalyticsChartsProps) {
  const stepData = analytics.stepAnalytics.map((step) => ({
    ...step,
    chartLabel: `${step.sortOrder}. ${truncateLabel(step.label)}`,
  }));
  const sourceData = analytics.sourceCounts.map((source) => ({
    ...source,
    sourceLabel: formatLabel(source.source),
  }));
  const statusData = [
    { count: analytics.submittedCount, label: "Submitted" },
    { count: analytics.inProgressCount, label: "In Progress" },
    { count: analytics.cancelledCount, label: "Cancelled" },
    { count: analytics.otherStatusCount, label: "Other" },
  ].filter((status) => status.count > 0);

  if (
    analytics.totalSubmissions === 0 &&
    analytics.stepAnalytics.length === 0
  ) {
    return null;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {stepData.length > 0 && (
        <div className="rounded-md border bg-white p-4">
          <p className="text-sm font-medium">Step Activity</p>
          <ChartContainer config={stepChartConfig} className="mt-4 h-72 w-full">
            <BarChart accessibilityLayer data={stepData} margin={{ top: 20 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="chartLabel"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="collectedCount"
                fill="var(--color-collectedCount)"
                radius={4}
              />
              <Bar
                dataKey="routeDecisionCount"
                fill="var(--color-routeDecisionCount)"
                radius={4}
              />
              <Bar
                dataKey="validationFailureCount"
                fill="var(--color-validationFailureCount)"
                radius={4}
              />
              <Bar
                dataKey="dropOffCount"
                fill="var(--color-dropOffCount)"
                radius={4}
              />
            </BarChart>
          </ChartContainer>
        </div>
      )}

      {statusData.length > 0 && (
        <div className="rounded-md border bg-white p-4">
          <p className="text-sm font-medium">Submission Status</p>
          <ChartContainer config={sourceChartConfig} className="mt-4 h-72">
            <PieChart accessibilityLayer>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={statusData}
                dataKey="count"
                nameKey="label"
                innerRadius={62}
                outerRadius={96}
                paddingAngle={2}
              >
                {statusData.map((entry, index) => (
                  <Cell
                    key={entry.label}
                    fill={statusColors[index % statusColors.length]}
                  />
                ))}
                <LabelList
                  dataKey="label"
                  position="outside"
                  className="fill-foreground"
                  fontSize={12}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
        </div>
      )}

      {sourceData.length > 0 && (
        <div className="rounded-md border bg-white p-4 lg:col-span-2">
          <p className="text-sm font-medium">Source Mix</p>
          <ChartContainer config={sourceChartConfig} className="mt-4 h-64">
            <BarChart accessibilityLayer data={sourceData} layout="vertical">
              <CartesianGrid horizontal={false} />
              <XAxis type="number" allowDecimals={false} hide />
              <YAxis
                dataKey="sourceLabel"
                type="category"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
                width={140}
              />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={4}>
                <LabelList
                  dataKey="count"
                  position="right"
                  className="fill-foreground"
                  fontSize={12}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      )}
    </div>
  );
}
