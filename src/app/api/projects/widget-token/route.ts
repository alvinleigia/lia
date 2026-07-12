import { NextResponse } from "next/server";
import { z } from "zod";
import { assertPermission } from "@/lib/access-control";
import { writeAuditLog } from "@/lib/audit";
import { resolveStrictUserAndProject } from "@/lib/auth-project";
import {
  createOrRotateProjectWidgetToken,
  getProjectWidgetConfig,
  normalizeDomainsInput,
  updateProjectWidgetAllowedDomains,
  updateProjectWidgetTokenStatus,
} from "@/lib/widget-keys";

const bodySchema = z.object({
  projectId: z.coerce.number().int().positive(),
});
const patchSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  allowedDomains: z.string().optional(),
  isActive: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const context = await resolveStrictUserAndProject(parsed.data.projectId);
    assertPermission(context.membership, "company.widget.manage");
    const { project } = context;
    const token = await createOrRotateProjectWidgetToken(project.id);
    await writeAuditLog({
      ...context,
      action: "widget.token_rotated",
      targetType: "project_widget_key",
      targetId: project.id,
      metadata: { projectId: project.id },
    });

    return NextResponse.json({ token });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Project not found.") {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Failed to create token" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = bodySchema.safeParse({
      projectId: url.searchParams.get("projectId"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
    }

    const { project } = await resolveStrictUserAndProject(
      parsed.data.projectId,
    );
    const config = await getProjectWidgetConfig(project.id);

    return NextResponse.json({
      hasActiveToken: Boolean(config?.isActive),
      allowedDomains: config?.allowedDomains
        ? normalizeDomainsInput(config.allowedDomains)
        : [],
      isActive: Boolean(config?.isActive),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Project not found.") {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch config" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    if (
      parsed.data.allowedDomains === undefined &&
      parsed.data.isActive === undefined
    ) {
      return NextResponse.json(
        { error: "Provide allowedDomains or isActive to update." },
        { status: 400 },
      );
    }

    const context = await resolveStrictUserAndProject(parsed.data.projectId);
    assertPermission(context.membership, "company.widget.manage");
    const { project } = context;
    const config = await getProjectWidgetConfig(project.id);
    if (!config) {
      return NextResponse.json(
        { error: "Generate a widget token first." },
        { status: 400 },
      );
    }

    if (parsed.data.allowedDomains !== undefined) {
      const normalized = normalizeDomainsInput(parsed.data.allowedDomains);
      await updateProjectWidgetAllowedDomains(project.id, normalized);
      await writeAuditLog({
        ...context,
        action: "widget.allowed_domains_updated",
        targetType: "project_widget_key",
        targetId: project.id,
        metadata: { allowedDomains: normalized },
      });
    }

    if (parsed.data.isActive !== undefined) {
      await updateProjectWidgetTokenStatus(project.id, parsed.data.isActive);
      await writeAuditLog({
        ...context,
        action: parsed.data.isActive
          ? "widget.token_enabled"
          : "widget.token_disabled",
        targetType: "project_widget_key",
        targetId: project.id,
      });
    }

    const updated = await getProjectWidgetConfig(project.id);
    const normalized = updated?.allowedDomains
      ? normalizeDomainsInput(updated.allowedDomains)
      : [];

    return NextResponse.json({
      allowedDomains: normalized,
      isActive: Boolean(updated?.isActive),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "Project not found.") {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Failed to update allowed domains" },
      { status: 500 },
    );
  }
}
