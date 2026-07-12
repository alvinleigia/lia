import { NextResponse } from "next/server";
import {
  FlowMediaUploadError,
  uploadActionFlowMedia,
} from "@/lib/flow-media-upload";
import { resolveWidgetTokenAccessForRequest } from "@/lib/widget-keys";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const token = formData.get("token");
    const widgetAccessResult =
      typeof token === "string" && token.trim()
        ? await resolveWidgetTokenAccessForRequest({
            headers: req.headers,
            token,
          })
        : null;

    if (!widgetAccessResult?.widgetAccess) {
      return NextResponse.json(
        { message: widgetAccessResult?.message ?? "Widget is unavailable." },
        { status: widgetAccessResult?.status ?? 403 },
      );
    }
    const { widgetAccess } = widgetAccessResult;

    const result = await uploadActionFlowMedia({
      formData,
      projectId: widgetAccess.projectId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FlowMediaUploadError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }

    console.error("Widget flow media upload failed:", error);
    return NextResponse.json(
      { message: "Failed to upload media." },
      { status: 500 },
    );
  }
}
