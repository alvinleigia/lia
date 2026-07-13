import {
  Archive,
  ArrowLeft,
  Bot,
  CheckCircle2,
  RotateCcw,
  Save,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormSubmitButton } from "@/components/ui/form-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { canAccess } from "@/lib/access-control";
import {
  AI_ANSWER_LENGTHS,
  AI_ASSISTANT_ROLES,
  AI_EXTRA_HELP_POLICIES,
  AI_FOLLOW_UP_POLICIES,
  AI_RESPONSE_PRESET_LABELS,
  AI_RESPONSE_PRESETS,
  AI_TONES,
  normalizeProjectAiSettings,
} from "@/lib/project-ai-settings";
import { getProjectForWorkspaceById } from "@/lib/projects";
import { resolvePageUserAndWorkspace } from "@/lib/protected-page";
import {
  archiveProjectAction,
  renameProjectAction,
  unarchiveProjectAction,
  updateProjectAiSettingsAction,
} from "../../actions";

type ProjectSettingsPageProps = {
  params: Promise<{
    projectId: string;
  }>;
  searchParams: Promise<{
    aiSettings?: string;
    archived?: string;
    renamed?: string;
    unarchived?: string;
    error?: string;
  }>;
};

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: ProjectSettingsPageProps) {
  const { projectId } = await params;
  const query = await searchParams;
  const parsedProjectId = Number(projectId);

  if (!Number.isInteger(parsedProjectId) || parsedProjectId <= 0) {
    notFound();
  }

  const context = await resolvePageUserAndWorkspace();
  const project = await getProjectForWorkspaceById(
    parsedProjectId,
    context.workspace.id,
    true,
  );

  if (!project) {
    notFound();
  }

  const canManageProject = canAccess(
    context.membership,
    "company.project.manage",
  );
  const aiSettings = normalizeProjectAiSettings(project.aiSettings);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link
          href={project.isArchived ? "/projects" : `/projects/${project.id}`}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {project.isArchived ? "Back to projects" : "Back to project"}
        </Link>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Settings className="h-6 w-6" />
              Project Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.renamed === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Project renamed.
              </p>
            )}
            {query.archived === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Project archived and widget disabled.
              </p>
            )}
            {query.unarchived === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                Project unarchived.
              </p>
            )}
            {query.aiSettings === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                <CheckCircle2 className="h-4 w-4 inline mr-2" />
                AI behavior settings saved.
              </p>
            )}
            {query.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {query.error}
              </p>
            )}

            <form action={renameProjectAction} className="space-y-4">
              <input type="hidden" name="projectId" value={project.id} />
              <div className="space-y-2">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  name="name"
                  defaultValue={project.name}
                  required
                />
              </div>
              <FormSubmitButton
                label="Save Project"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Bot className="h-6 w-6" />
              AI Behavior
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateProjectAiSettingsAction} className="space-y-4">
              <input type="hidden" name="projectId" value={project.id} />

              <div className="space-y-2">
                <Label htmlFor="responsePreset">Conversation Goal</Label>
                <select
                  id="responsePreset"
                  name="responsePreset"
                  defaultValue={aiSettings.responsePreset}
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  {AI_RESPONSE_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {AI_RESPONSE_PRESET_LABELS[preset]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assistantName">Assistant Name</Label>
                  <Input
                    id="assistantName"
                    name="assistantName"
                    defaultValue={aiSettings.assistantName ?? ""}
                    placeholder="e.g. Lia"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name</Label>
                  <Input
                    id="businessName"
                    name="businessName"
                    defaultValue={aiSettings.businessName ?? ""}
                    placeholder={context.company.name}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <select
                    id="role"
                    name="role"
                    defaultValue={aiSettings.role}
                    className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    {AI_ASSISTANT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tone">Tone</Label>
                  <select
                    id="tone"
                    name="tone"
                    defaultValue={aiSettings.tone}
                    className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    {AI_TONES.map((tone) => (
                      <option key={tone} value={tone}>
                        {tone}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="answerLength">Answer Length</Label>
                  <select
                    id="answerLength"
                    name="answerLength"
                    defaultValue={aiSettings.answerLength}
                    className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    {AI_ANSWER_LENGTHS.map((length) => (
                      <option key={length} value={length}>
                        {length}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="followUpPolicy">Follow-Up</Label>
                  <select
                    id="followUpPolicy"
                    name="followUpPolicy"
                    defaultValue={aiSettings.followUpPolicy}
                    className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    {AI_FOLLOW_UP_POLICIES.map((policy) => (
                      <option key={policy} value={policy}>
                        {policy.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="extraHelpPolicy">Extra Help</Label>
                  <select
                    id="extraHelpPolicy"
                    name="extraHelpPolicy"
                    defaultValue={aiSettings.extraHelpPolicy}
                    className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    {AI_EXTRA_HELP_POLICIES.map((policy) => (
                      <option key={policy} value={policy}>
                        {policy.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fallbackPhone">Fallback Phone</Label>
                  <Input
                    id="fallbackPhone"
                    name="fallbackPhone"
                    defaultValue={aiSettings.fallbackPhone ?? ""}
                    placeholder="+91 9319 212 233"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fallbackEmail">Fallback Email</Label>
                  <Input
                    id="fallbackEmail"
                    name="fallbackEmail"
                    type="email"
                    defaultValue={aiSettings.fallbackEmail ?? ""}
                    placeholder="sales@example.com"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fallbackMessage">Fallback Message</Label>
                <Input
                  id="fallbackMessage"
                  name="fallbackMessage"
                  defaultValue={aiSettings.fallbackMessage ?? ""}
                  placeholder="Please contact our team for the latest details."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="answerGuidance">Answer Guidance</Label>
                <Textarea
                  id="answerGuidance"
                  name="answerGuidance"
                  defaultValue={aiSettings.answerGuidance ?? ""}
                  placeholder="e.g. Keep project answers under 4 lines. For price questions, say current prices are not published and share the sales phone. Do not offer email drafts."
                  rows={5}
                />
              </div>

              <FormSubmitButton
                label="Save AI Behavior"
                pendingLabel="Saving..."
                icon={<Save className="h-4 w-4" />}
              />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <Archive className="h-6 w-6" />
              Project Availability
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <p className="mt-1 font-medium">
                {project.isArchived ? "Archived" : "Available"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {project.isArchived
                  ? "Unarchive this project to make it available for chat, widget, channels, and automation."
                  : "Archive this project to hide it from active project flows and disable its widget token."}
              </p>
            </div>

            {canManageProject ? (
              project.isArchived ? (
                <form action={unarchiveProjectAction}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input
                    type="hidden"
                    name="redirectTo"
                    value={`/projects/${project.id}/settings`}
                  />
                  <FormSubmitButton
                    label="Unarchive Project"
                    pendingLabel="Updating..."
                    variant="outline"
                    icon={<RotateCcw className="h-4 w-4" />}
                  />
                </form>
              ) : (
                <form action={archiveProjectAction}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input
                    type="hidden"
                    name="redirectTo"
                    value={`/projects/${project.id}/settings`}
                  />
                  <FormSubmitButton
                    label="Archive Project"
                    pendingLabel="Archiving..."
                    variant="outline"
                    icon={<Archive className="h-4 w-4" />}
                  />
                </form>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                You do not have permission to change project availability.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
