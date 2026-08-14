import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BrowserFlowCommandError,
  runBrowserFlowText,
} from "@/lib/browser-flow-runtime";
import { channelInboundSelectionInputV1Schema } from "@/lib/channel-inbound-contract";
import { resolveTraceId } from "@/lib/execution-trace";
import {
  formatRuntimeServerTiming,
  measureRuntimeStage,
  type RuntimeStageTiming,
} from "@/lib/runtime-stage-timing";
import { resolveWidgetTokenAccessForRequest } from "@/lib/widget-keys";

const requestSchema = z
  .object({
    actionId: z.number().int().positive().optional(),
    commandId: z.string().trim().min(1).max(120).optional(),
    conversationId: z.string().trim().min(1).max(120),
    editSection: z
      .enum(["all", "email", "name", "phone", "schedule", "service"])
      .optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    resume: z.boolean().optional(),
    selection: channelInboundSelectionInputV1Schema.optional(),
    text: z.string().max(4000).optional(),
    token: z.string().trim().min(1).max(256),
  })
  .strict();

async function readJsonBody(req: Request) {
  try {
    return { body: await req.json(), isValidJson: true } as const;
  } catch {
    return { body: null, isValidJson: false } as const;
  }
}

export async function POST(req: Request) {
  const requestStartedAt = performance.now();
  const timings: RuntimeStageTiming[] = [];
  const traceId = resolveTraceId(req.headers.get("x-lia-trace-id"));

  try {
    const json = await readJsonBody(req);
    const parsed = requestSchema.safeParse(json.body);

    if (
      !json.isValidJson ||
      !parsed.success ||
      (!parsed.data.actionId &&
        !parsed.data.editSection &&
        !parsed.data.resume &&
        !parsed.data.text?.trim())
    ) {
      return NextResponse.json(
        { message: "A flow action or message is required." },
        { status: 400 },
      );
    }

    if (!parsed.data.resume && !parsed.data.commandId) {
      return NextResponse.json(
        { message: "A command ID is required." },
        { status: 400 },
      );
    }

    const accessResult = await measureRuntimeStage(
      "widget_access",
      (timing) => timings.push(timing),
      () =>
        resolveWidgetTokenAccessForRequest({
          headers: req.headers,
          token: parsed.data.token,
        }),
    );

    if (!accessResult.widgetAccess) {
      return NextResponse.json(
        { message: accessResult.message ?? "Widget is unavailable." },
        { status: accessResult.status ?? 403 },
      );
    }

    const result = await runBrowserFlowText({
      actionId: parsed.data.actionId,
      channelType: "widget",
      commandId: parsed.data.commandId,
      conversationId: parsed.data.conversationId,
      editSection: parsed.data.editSection,
      expectedRevision: parsed.data.expectedRevision,
      projectId: accessResult.widgetAccess.projectId,
      recordTiming: (timing) => timings.push(timing),
      resume: parsed.data.resume,
      selection: parsed.data.selection,
      source: "widget_chat",
      text: parsed.data.text,
      traceId,
    });

    if (parsed.data.actionId && !result.handled) {
      return NextResponse.json(
        { message: "Action is unavailable." },
        { status: 404 },
      );
    }

    if (
      parsed.data.editSection &&
      !result.activeFlow &&
      result.replies.length === 0
    ) {
      return NextResponse.json(
        { message: "No active flow is available to edit." },
        { status: 409 },
      );
    }

    timings.push({
      durationMs: Math.round((performance.now() - requestStartedAt) * 10) / 10,
      stage: "request_total",
    });
    console.info(
      JSON.stringify({
        actionId: parsed.data.actionId ?? null,
        event: "widget_runtime_timing",
        projectId: accessResult.widgetAccess.projectId,
        timings,
        traceId,
      }),
    );

    return NextResponse.json(result, {
      headers: {
        "Server-Timing": formatRuntimeServerTiming(timings),
        "X-Lia-Trace-Id": traceId,
      },
    });
  } catch (error) {
    if (error instanceof BrowserFlowCommandError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: 409 },
      );
    }

    console.error("Widget browser flow runtime error:", error);
    return NextResponse.json(
      { message: "Failed to process the flow message." },
      { status: 500 },
    );
  }
}
