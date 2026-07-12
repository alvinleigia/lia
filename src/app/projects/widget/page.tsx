import { Puzzle } from "lucide-react";
import { NoProjectState } from "@/components/no-project-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetManager } from "@/components/widget-manager";
import { getRequiredAppBaseUrl } from "@/lib/email";
import {
  getActiveProjectIdCookie,
  resolveOptionalPageUserAndProject,
} from "@/lib/protected-page";
import { getProjectWidgetConfig } from "@/lib/widget-keys";

export default async function ProjectWidgetPage() {
  const activeProjectId = await getActiveProjectIdCookie();
  const context = await resolveOptionalPageUserAndProject(activeProjectId);

  if (!context) {
    return <NoProjectState title="Widget setup needs a project" />;
  }

  const { project: selectedProject } = context;
  const widgetConfig = await getProjectWidgetConfig(selectedProject.id);
  const initialAllowedDomains =
    widgetConfig?.allowedDomains
      ?.split(",")
      .map((v) => v.trim())
      .filter(Boolean) ?? [];
  const appBaseUrl = getRequiredAppBaseUrl();

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              <Puzzle className="h-6 w-6 inline mr-2" />
              Widget: {selectedProject.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <WidgetManager
              projectId={selectedProject.id}
              appBaseUrl={appBaseUrl}
              hasActiveToken={Boolean(widgetConfig?.isActive)}
              hasWidgetConfig={Boolean(widgetConfig)}
              initialAllowedDomains={initialAllowedDomains}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
