const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const urlFilePath = path.resolve(process.cwd(), ".nexus-launch-url");

function readLaunchUrl() {
  if (!fs.existsSync(urlFilePath)) {
    throw new Error("Launch URL not ready yet. Start NEXUS OS first and wait for startup to complete.");
  }

  const raw = fs.readFileSync(urlFilePath, "utf-8").trim();
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(`Invalid launch URL in ${urlFilePath}: ${raw}`);
  }

  return raw;
}

function openInBrowser(url) {
  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  if (process.platform === "darwin") {
    const child = spawn("open", [url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  const child = spawn("xdg-open", [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

try {
  const url = readLaunchUrl();
  openInBrowser(url);
  // Pinokio terminal log hint.
  // eslint-disable-next-line no-console
  console.log(`Opened NEXUS OS in external browser: ${url}`);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
