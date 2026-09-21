import assert from "node:assert/strict";
import test from "node:test";
import { readWorkerConfig, runWorker } from "./run-durable-worker.mjs";

const env = {
  DURABLE_WORKER_URL: "https://example.test/api/durable/process-next",
  DURABLE_QUEUE_SECRET: "test-secret-do-not-log",
};

test("default validates locally without fetching or leaking the secret", async () => {
  const result = await runWorker({
    env,
    args: [],
    fetchImpl: () => assert.fail("Validation must not send a request"),
  });
  assert.equal(result.mode, "validation-only");
  assert.equal(result.secretConfigured, true);
  assert.equal(
    JSON.stringify(result).includes(env.DURABLE_QUEUE_SECRET),
    false,
  );
});

test("rejects unsafe targets, missing secrets and unknown flags", () => {
  for (const target of [
    "invalid",
    "http://example.test/api/durable/process-next",
    "https://user:secret@example.test/api/durable/process-next",
    "https://example.test/other",
    `${env.DURABLE_WORKER_URL}?secret=hidden`,
    `${env.DURABLE_WORKER_URL}#fragment`,
  ]) {
    assert.throws(() =>
      readWorkerConfig({ ...env, DURABLE_WORKER_URL: target }, []),
    );
  }
  assert.throws(() =>
    readWorkerConfig({ DURABLE_WORKER_URL: env.DURABLE_WORKER_URL }, []),
  );
  assert.throws(() => readWorkerConfig(env, ["--exec"]));
  assert.equal(
    readWorkerConfig(
      { ...env, DURABLE_QUEUE_SECRET: "", CRON_SECRET: "fallback" },
      [],
    ).secret,
    "fallback",
  );
});

test("execute sends exactly one bounded authenticated POST without following redirects", async () => {
  let requests = 0;
  const result = await runWorker({
    env,
    args: ["--execute"],
    fetchImpl: async (target, options) => {
      requests++;
      const url = new URL(target);
      assert.equal(url.searchParams.get("maxProjects"), "1");
      assert.equal(url.searchParams.get("maxItems"), "1");
      assert.equal(options.method, "POST");
      assert.equal(
        options.headers.Authorization,
        `Bearer ${env.DURABLE_QUEUE_SECRET}`,
      );
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({
        idle: false,
        processedProjects: 1,
        projects: [{ privatePayload: "not for logs" }],
      });
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.processedProjects, 1);
  assert.equal(JSON.stringify(result).includes("privatePayload"), false);
});

test("HTTP failures do not expose response bodies or retry", async () => {
  let requests = 0;
  await assert.rejects(
    runWorker({
      env,
      args: ["--execute"],
      fetchImpl: async () => {
        requests++;
        return new Response("private provider error", { status: 503 });
      },
    }),
    /HTTP 503/,
  );
  assert.equal(requests, 1);
});

test("network failures hide raw errors and explain the uncertain outcome", async () => {
  await assert.rejects(
    runWorker({
      env,
      args: ["--execute"],
      fetchImpl: async () => {
        throw new Error(env.DURABLE_QUEUE_SECRET);
      },
    }),
    (error) =>
      error.message.includes("Processing may have started") &&
      !error.message.includes(env.DURABLE_QUEUE_SECRET),
  );
});

test("invalid success responses fail instead of reporting successful processing", async () => {
  for (const body of [
    "<html>Login</html>",
    "null",
    '{"idle":false,"processedProjects":99}',
  ]) {
    await assert.rejects(
      runWorker({
        env,
        args: ["--execute"],
        fetchImpl: async () => new Response(body),
      }),
      /response/,
    );
  }
});
