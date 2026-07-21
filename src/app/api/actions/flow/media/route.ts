import { NextResponse } from "next/server";
import {
  isInactiveAccountError,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { runBrowserFlowMediaCommand } from "@/lib/browser-flow-media-command";
import { FlowMediaUploadError } from "@/lib/flow-media-upload";

export async function POST(req: Request) {
  try {
    const { project } = await resolveUserAndProject();
    const result = await runBrowserFlowMediaCommand({
      channelType: "project_chat",
      formData: await req.formData(),
      projectId: project.id,
      source: "project_chat",
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FlowMediaUploadError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (isInactiveAccountError(error)) {
      return NextResponse.json(
        { message: "This account is currently disabled." },
        { status: 423 },
      );
    }

    console.error("Project flow media upload failed:", error);
    return NextResponse.json(
      { message: "Failed to upload media." },
      { status: 500 },
    );
  }
}
