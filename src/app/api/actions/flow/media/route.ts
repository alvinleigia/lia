import { NextResponse } from "next/server";
import {
  isInactiveAccountError,
  resolveUserAndProject,
} from "@/lib/auth-project";
import { runBrowserFlowMedia } from "@/lib/browser-flow-runtime";
import {
  FlowMediaUploadError,
  uploadActionFlowMedia,
} from "@/lib/flow-media-upload";

export async function POST(req: Request) {
  try {
    const { project } = await resolveUserAndProject();
    const upload = await uploadActionFlowMedia({
      formData: await req.formData(),
      projectId: project.id,
      source: "project_chat",
    });
    const runtime = await runBrowserFlowMedia({
      channelType: "project_chat",
      media: upload.value,
      projectId: project.id,
      source: "project_chat",
      submissionId: upload.submissionId,
    });

    return NextResponse.json({ ...upload, ...runtime });
  } catch (error) {
    if (error instanceof FlowMediaUploadError) {
      return NextResponse.json(
        { message: error.message },
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
