const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const launchUrlPath = path.resolve(process.cwd(), ".nexus-launch-url");

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

async function pickApiPort(start = 18080, maxAttempts = 50) {
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

function stripAnsi(input) {
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

async function main() {
  const apiPort = await pickApiPort();
  const npmCmd = "npm";
  const useShell = process.platform === "win32";
  const baseEnv = {
    ...process.env,
    PORT: String(apiPort),
    NEXUS_API_PORT: String(apiPort),
  };

  process.stdout.write(`[dev] API port selected: ${apiPort}\n`);

  const api = spawn(npmCmd, ["--prefix", "apps/api", "run", "dev"], {
    env: baseEnv,
    shell: useShell,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const web = spawn(npmCmd, ["--prefix", "apps/web", "run", "dev"], {
    env: baseEnv,
    shell: useShell,
    stdio: ["inherit", "pipe", "pipe"],
  });

  let announcedReadyUrl = false;
  let apiReady = false;
  let webUrl = null;

  const maybeAnnounceReady = () => {
    if (!announcedReadyUrl && apiReady && webUrl) {
      announcedReadyUrl = true;
      fs.writeFileSync(launchUrlPath, `${webUrl}\n`, "utf-8");
      process.stdout.write(`[dev] NEXUS_WEB_URL=${webUrl}\n`);
    }
  };

  const apiOut = createPrefixWriter("[api]", process.stdout);
  const apiErr = createPrefixWriter("[api]", process.stderr);
  const webOut = createPrefixWriter("[web]", process.stdout);
  const webErr = createPrefixWriter("[web]", process.stderr);

  api.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    apiOut(chunk);
    if (!apiReady) {
      const clean = stripAnsi(text);
      if (clean.includes("NEXUS OS API running on http://localhost:")) {
        apiReady = true;
        maybeAnnounceReady();
      }
    }
  });
  api.stderr.on("data", apiErr);
  web.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    webOut(chunk);
    if (!webUrl) {
      const clean = stripAnsi(text);
      const match = clean.match(/Local:\s+(http:\/\/localhost:\d+\/)/);
      if (match?.[1]) {
        webUrl = match[1];
        maybeAnnounceReady();
      }
    }
  });
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
