import { redirect } from "next/navigation";
import { ChatPageClient } from "@/components/chat-page-client";
import {
  getActiveProjectIdCookie,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { listRuntimeProjectActions } from "@/lib/runtime-actions";

export default async function ProjectChatPage() {
  const activeProjectId = await getActiveProjectIdCookie();
  let context: Awaited<ReturnType<typeof resolveUserAndProject>>;

  try {
    context = await resolveUserAndProject(activeProjectId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message ===
        "No available project found. Create or unarchive a project."
    ) {
      redirect(
        "/projects?error=Create%20a%20project%20before%20opening%20chat.",
      );
    }

    throw error;
  }

  const { project } = context;
  const runtimeActions = await listRuntimeProjectActions(project.id);

  return <ChatPageClient actions={runtimeActions} projectId={project.id} />;
}
