import { NextResponse } from "next/server";
import { processDurableExecutionQueue } from "@/lib/durable-execution-worker";

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  const secretHeader = req.headers.get("x-durable-queue-secret");
  const cronSecret = process.env.CRON_SECRET;
  const queueSecret = process.env.DURABLE_QUEUE_SECRET;

  return (
    (Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`) ||
    (Boolean(queueSecret) &&
      (secretHeader === queueSecret || authHeader === `Bearer ${queueSecret}`))
  );
}

function getBoundedInteger(
  url: URL,
  name: string,
  fallback: number,
  maximum: number,
) {
  const value = Number(url.searchParams.get(name));

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

async function runQueue(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const result = await processDurableExecutionQueue({
      maxItemsPerQueue: getBoundedInteger(url, "maxItems", 10, 25),
      maxProjects: getBoundedInteger(url, "maxProjects", 10, 50),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Durable execution queue processing failed:", error);
    return NextResponse.json(
      { error: "Failed to process the durable execution queue." },
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
