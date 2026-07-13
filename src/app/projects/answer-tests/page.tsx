import {
  CheckSquare,
  ClipboardCheck,
  MessageSquareText,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { NoProjectState } from "@/components/no-project-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ANSWER_TEST_CHECKLIST,
  getAnswerTestPrompts,
} from "@/lib/answer-tests";
import {
  AI_RESPONSE_PRESET_LABELS,
  normalizeProjectAiSettings,
} from "@/lib/project-ai-settings";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default async function ProjectAnswerTestsPage() {
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Answer tests need a project" />;
  }

  const { project } = context;
  const aiSettings = normalizeProjectAiSettings(project.aiSettings);
  const prompts = getAnswerTestPrompts(aiSettings.responsePreset);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-5xl space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-2xl">
                <ClipboardCheck className="h-6 w-6" />
                Answer Tests: {project.name}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href={`/projects/${project.id}/settings`}>
                    <Settings className="h-4 w-4" />
                    AI Settings
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/projects/chat">
                    <MessageSquareText className="h-4 w-4" />
                    Open Chat
                  </Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Conversation Goal
                </p>
                <p className="mt-1 font-medium">
                  {AI_RESPONSE_PRESET_LABELS[aiSettings.responsePreset]}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Answer Length
                </p>
                <p className="mt-1 font-medium">
                  {formatLabel(aiSettings.answerLength)}
                </p>
              </div>
              <div className="rounded-md border bg-white p-3">
                <p className="text-xs uppercase text-muted-foreground">
                  Follow-Up
                </p>
                <p className="mt-1 font-medium">
                  {formatLabel(aiSettings.followUpPolicy)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <MessageSquareText className="h-5 w-5" />
              Test Prompts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-2">
              {prompts.map((item) => (
                <div
                  key={`${item.category}-${item.prompt}`}
                  className="rounded-md border bg-white p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <Badge variant="outline">{item.category}</Badge>
                  </div>
                  <p className="font-medium">{item.prompt}</p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {item.expected}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckSquare className="h-5 w-5" />
              Evaluation Checklist
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {ANSWER_TEST_CHECKLIST.map((item) => (
                <label
                  key={item.label}
                  className="flex items-start gap-3 rounded-md border bg-white p-4"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-gray-300"
                  />
                  <span>
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-sm text-muted-foreground">
                      {item.standard}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
