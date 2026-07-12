import { ArrowLeft, Upload, Workflow } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getActiveProjectIdCookie,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { importActionFlowBuilderAction } from "../actions";

type ImportActionFlowPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function ImportActionFlowPage({
  searchParams,
}: ImportActionFlowPageProps) {
  const params = await searchParams;
  const activeProjectId = await getActiveProjectIdCookie();
  const { project } = await resolveUserAndProject(activeProjectId);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link
          href="/projects/actions"
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to actions
        </Link>

        {params.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {params.error}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Workflow className="h-6 w-6" />
              Import Action Flow: {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={importActionFlowBuilderAction}
              className="space-y-4"
              encType="multipart/form-data"
            >
              <input
                type="hidden"
                name="sourcePath"
                value="/projects/actions/import"
              />

              <div className="space-y-2">
                <Label htmlFor="flowFile">Exported Flow JSON</Label>
                <Input
                  id="flowFile"
                  name="flowFile"
                  type="file"
                  accept="application/json,.json"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="nameOverride">Imported Action Name</Label>
                <Input
                  id="nameOverride"
                  name="nameOverride"
                  placeholder="Leave blank to use the exported action name"
                />
              </div>

              <FormSubmitButton
                label="Import Flow"
                pendingLabel="Importing..."
                icon={<Upload className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
