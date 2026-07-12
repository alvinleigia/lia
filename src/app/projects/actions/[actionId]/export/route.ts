import { NextResponse } from "next/server";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import {
  buildProjectActionFlowExport,
  createActionFlowExportFilename,
} from "@/lib/action-flow-export";
import {
  getActiveProjectIdCookie,
  resolveUserAndProject,
} from "@/lib/auth-project";

type ActionFlowExportRouteContext = {
  params: Promise<{
    actionId: string;
  }>;
};

const actionIdSchema = z.coerce.number().int().positive();

export async function GET(
  _req: Request,
  context: ActionFlowExportRouteContext,
) {
  try {
    const params = await context.params;
    const actionId = actionIdSchema.safeParse(params.actionId);

    if (!actionId.success) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const activeProjectId = await getActiveProjectIdCookie();
    const authContext = await resolveUserAndProject(activeProjectId);
    assertPermission(authContext.membership, "company.project.manage");

    const exportPayload = await buildProjectActionFlowExport({
      actionId: actionId.data,
      project: authContext.project,
    });

    if (!exportPayload) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    return new Response(JSON.stringify(exportPayload, null, 2), {
      headers: {
        "Content-Disposition": `attachment; filename="${createActionFlowExportFilename(
          exportPayload.action.name,
        )}"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(
      { error: "Failed to export action flow" },
      { status: 500 },
    );
  }
}
