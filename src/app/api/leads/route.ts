import { auth } from "@/auth";
import {
  isInactiveAccountError,
  resolveUserAndWorkspace,
} from "@/lib/auth-project";
import { leadFiltersSchema, listInboxLeads } from "@/lib/lead-inbox-data";

export async function GET(request: Request) {
  if (!(await auth())?.user?.email)
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  const parsed = leadFiltersSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return Response.json({ message: "Invalid filters." }, { status: 400 });
  try {
    const { company, workspace } = await resolveUserAndWorkspace();
    const result = await listInboxLeads(
      { companyId: company.id, workspaceId: workspace.id },
      parsed.data,
      { forExport: true },
    );
    return Response.json(
      {
        schemaVersion: 1,
        page: result.page,
        hasMore: result.hasMore,
        leads: result.leads.map(
          ({ submission, project, action, management }) => ({
            id: submission.id,
            project,
            workflowId: action.id,
            workflowVersionId: submission.actionVersionId,
            workflowName: action.name,
            source: submission.source,
            fields: submission.fields,
            ...management,
            receivedAt: submission.createdAt,
            updatedAt: submission.updatedAt,
          }),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (isInactiveAccountError(error))
      return Response.json({ message: "Account disabled." }, { status: 423 });
    return Response.json({ message: "Could not load leads." }, { status: 500 });
  }
}
