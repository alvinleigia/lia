import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import { createProjectAction } from "../actions";

type NewProjectPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function NewProjectPage({
  searchParams,
}: NewProjectPageProps) {
  const params = await searchParams;
  const { company } = await resolvePageUserAndWorkspace();

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link
          href="/projects"
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to projects
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Plus className="h-6 w-6" />
              New Project
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a chatbot project under {company.name}.
            </p>
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}

            <form action={createProjectAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="projectName">Project Name</Label>
                <Input
                  id="projectName"
                  name="name"
                  placeholder="e.g. Website Support Chatbot"
                  required
                />
              </div>
              <FormSubmitButton
                label="Create Project"
                pendingLabel="Creating..."
                icon={<Plus className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
