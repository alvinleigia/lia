#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
const cacheDirs = [".next", "next-cache"];
const port = Number(process.env.PORT || process.env.NEXT_DEV_PORT || 3000);

function canConnect(host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const isDevServerRunning =
  (await canConnect("127.0.0.1")) || (await canConnect("localhost"));

if (isDevServerRunning) {
  console.error(
    `Port ${port} is already serving an app. Stop the running dev server before cleaning generated Next files.`,
  );
  process.exit(1);
}

for (const cacheDir of cacheDirs) {
  const target = path.resolve(root, cacheDir);
  const relative = path.relative(root, target);

  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.basename(target) !== cacheDir
  ) {
    throw new Error(`Refusing to clean unsafe path: ${target}`);
  }

  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`Cleaned ${cacheDir} cache.`);
  } else {
    console.log(`${cacheDir} cache already clean.`);
  }
}
