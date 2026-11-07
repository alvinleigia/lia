import { auth } from "@/auth";
import {
  isInactiveAccountError,
  resolveUserAndWorkspace,
} from "@/lib/auth-project";
import { getInboxLead } from "@/lib/lead-inbox-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  if (!(await auth())?.user?.email)
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  const id = Number((await params).leadId);
  if (!Number.isSafeInteger(id) || id <= 0)
    return Response.json({ message: "Invalid lead ID." }, { status: 400 });
  try {
    const { company, workspace } = await resolveUserAndWorkspace();
    const lead = await getInboxLead(
      { companyId: company.id, workspaceId: workspace.id },
      id,
    );
    if (!lead)
      return Response.json({ message: "Lead not found." }, { status: 404 });
    if (!lead.exportAllowed)
      return Response.json(
        { message: "Export is disabled for this project." },
        { status: 403 },
      );
    return Response.json(
      {
        schemaVersion: 1,
        id,
        project: lead.project,
        workflow: {
          id: lead.action.id,
          name: lead.action.name,
          versionId: lead.version?.id ?? null,
          versionNumber: lead.version?.number ?? null,
        },
        source: lead.submission.source,
        ...lead.management,
        fields: lead.submission.fields,
        fieldDefinitions: lead.fields.map(
          ({ value: _value, ...definition }) => definition,
        ),
        receivedAt: lead.submission.createdAt,
        updatedAt: lead.submission.updatedAt,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (isInactiveAccountError(error))
      return Response.json({ message: "Account disabled." }, { status: 423 });
    return Response.json(
      { message: "Could not load this lead." },
      { status: 500 },
    );
  }
}
