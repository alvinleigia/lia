import { NextResponse } from "next/server";
import { processUploadQueue } from "@/lib/upload-queue";

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  const secretHeader = req.headers.get("x-upload-queue-secret");

  const cronSecret = process.env.CRON_SECRET;
  const queueSecret = process.env.UPLOAD_QUEUE_SECRET;

  const cronAuthorized =
    Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
  const queueAuthorized =
    Boolean(queueSecret) &&
    (secretHeader === queueSecret || authHeader === `Bearer ${queueSecret}`);

  return cronAuthorized || queueAuthorized;
}

async function runQueue(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processUploadQueue(10);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Upload queue processing failed:", error);
    return NextResponse.json(
      { error: "Failed to process upload queue." },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return runQueue(req);
}

export async function POST(req: Request) {
  return runQueue(req);
}
