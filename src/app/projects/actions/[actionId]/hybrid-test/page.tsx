import { ArrowLeft, Workflow } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HybridFlowSimulator } from "@/components/hybrid-flow-simulator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getActionFlowVersion, getProjectAction } from "@/lib/action-flows";
import { compiledHybridFlowGraphV1Schema } from "@/lib/hybrid-flow-contracts";
import {
  getActiveProjectIdCookie,
  resolvePageUserAndProject,
} from "@/lib/protected-page";

type HybridFlowTestPageProps = {
  params: Promise<{
    actionId: string;
  }>;
};

export default async function HybridFlowTestPage({
  params,
}: HybridFlowTestPageProps) {
  const routeParams = await params;
  const actionId = Number(routeParams.actionId);

  if (!Number.isInteger(actionId) || actionId <= 0) {
    notFound();
  }

  const activeProjectId = await getActiveProjectIdCookie();
  const { project } = await resolvePageUserAndProject(activeProjectId);
  const action = await getProjectAction(project.id, actionId);

  if (!action) {
    notFound();
  }

  const version = action.publishedVersionId
    ? await getActionFlowVersion(
        project.id,
        action.id,
        action.publishedVersionId,
      )
    : null;
  const graph = version
    ? compiledHybridFlowGraphV1Schema.safeParse(
        (version.snapshot as { hybridGraph?: unknown }).hybridGraph,
      )
    : null;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <Link
          href={`/projects/actions/${action.id}/canvas`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to canvas
        </Link>

        {!version || !graph?.success ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Workflow className="h-6 w-6" />
                Published Flow Test
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Publish a valid flow version before testing its hybrid routes.
              </p>
              <Button asChild>
                <Link href={`/projects/actions/${action.id}`}>
                  Review and Publish
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <HybridFlowSimulator
            actionName={action.name}
            graph={graph.data}
            versionNumber={version.versionNumber}
          />
        )}
      </div>
    </div>
  );
}
