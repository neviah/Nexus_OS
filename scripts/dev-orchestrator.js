const net = require("node:net");
const { spawn } = require("node:child_process");

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickApiPort(start = 8080, maxAttempts = 20) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = start + offset;
    if (await isPortFree(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No free API port found in range ${start}-${start + maxAttempts - 1}`);
}

function createPrefixWriter(prefix, stream) {
  let buffered = "";
  return (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      stream.write(`${prefix} ${line}\n`);
    }
  };
}

async function main() {
  const apiPort = await pickApiPort();
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const baseEnv = {
    ...process.env,
    PORT: String(apiPort),
    NEXUS_API_PORT: String(apiPort),
  };

  process.stdout.write(`[dev] API port selected: ${apiPort}\n`);

  const api = spawn(npmCmd, ["--prefix", "apps/api", "run", "dev"], {
    env: baseEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const web = spawn(npmCmd, ["--prefix", "apps/web", "run", "dev"], {
    env: baseEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });

  const apiOut = createPrefixWriter("[api]", process.stdout);
  const apiErr = createPrefixWriter("[api]", process.stderr);
  const webOut = createPrefixWriter("[web]", process.stdout);
  const webErr = createPrefixWriter("[web]", process.stderr);

  api.stdout.on("data", apiOut);
  api.stderr.on("data", apiErr);
  web.stdout.on("data", webOut);
  web.stderr.on("data", webErr);

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdout.write(`[dev] Received ${signal}. Stopping child processes...\n`);
    if (!api.killed) {
      api.kill("SIGTERM");
    }
    if (!web.killed) {
      web.kill("SIGTERM");
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const finish = (label, code) => {
    process.stdout.write(`[dev] ${label} exited with code ${code ?? 0}\n`);
    shutdown(`${label}-exit`);
    process.exit(code ?? 0);
  };

  api.on("exit", (code) => finish("api", code));
  web.on("exit", (code) => finish("web", code));
}

main().catch((error) => {
  process.stderr.write(`[dev] Failed to start development services: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
