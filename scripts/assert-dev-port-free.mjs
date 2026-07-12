#!/usr/bin/env node

import net from "node:net";

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

const isBusy =
  (await canConnect("127.0.0.1")) || (await canConnect("localhost"));

if (isBusy) {
  console.error(
    `Port ${port} is already serving an app. Stop the running dev server before cleaning or building.`,
  );
  process.exit(1);
}
