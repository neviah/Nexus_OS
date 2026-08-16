import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { createUnityMcpBridgeRouter } from "../lib/unityMcpBridge.js";

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("Unity bridge creates a session, runs an image job, and lists images", async () => {
  const upstream = express();
  upstream.get("/api/health", (_req, res) => res.json({ ok: true }));
  upstream.get("/api/tools/wan2gp/status", (_req, res) => res.json({ apiReady: true }));
  upstream.get("/api/tools/hunyuan3d/status", (_req, res) => res.json({ apiReady: false }));
  upstream.get("/api/tools/animation/status", (_req, res) => res.json({ apiReady: false }));
  upstream.get("/api/tools/wan2gp/image/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ type: "status", message: "Generating test image..." })}\n\n`);
    res.end(`data: ${JSON.stringify({
      type: "done",
      result: {
        imageUrl: "/api/tools/wan2gp/file?workspaceId=default&relativePath=Assets%2Fimages%2Ftest.png",
        relativePath: "Assets/images/test.png",
        workspaceId: "default",
        provider: "wan2gp",
        model: "test-model",
        width: 768,
        height: 768,
        steps: 6,
        seed: 123,
        profile: 4,
        prompt: "test image",
        negativePrompt: "",
      },
    })}\n\n`);
  });
  upstream.get("/api/workspaces/:id/tree", (_req, res) => res.json({
    tree: {
      name: "default",
      type: "directory",
      path: ".",
      children: [{
        name: "Assets",
        type: "directory",
        path: "Assets",
        children: [{
          name: "images",
          type: "directory",
          path: "Assets/images",
          children: [{ name: "test.png", type: "file", path: "Assets/images/test.png" }],
        }],
      }],
    },
  }));

  const upstreamServer = await listen(upstream);
  const bridge = express();
  bridge.use(express.json());
  bridge.use("/api/unity", createUnityMcpBridgeRouter({ nexusOsBaseUrl: upstreamServer.baseUrl }));
  const bridgeServer = await listen(bridge);

  try {
    const sessionResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/session`, { method: "POST" });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json() as { data: { token: string } };
    const headers = { "Content-Type": "application/json", "X-Nexus-Session": session.data.token };

    const statusResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/status`, { headers });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json() as { data: { health: { ok: boolean }; wan2gp: { apiReady: boolean } } };
    assert.equal(status.data.health.ok, true);
    assert.equal(status.data.wan2gp.apiReady, true);

    const startResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/tools/nexus.generate.image`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "test image" }),
    });
    assert.equal(startResponse.status, 202);
    const started = await startResponse.json() as { requestId: string };

    type JobResponse = { data: { job: { status: string; result?: { asset: { relativePath: string } } } } };
    let completed: JobResponse | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const jobResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/jobs/${started.requestId}`, { headers });
      const job = await jobResponse.json() as JobResponse;
      if (job.data.job.status === "completed") {
        completed = job;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(completed?.data.job.status, "completed");
    assert.equal(completed?.data.job.result?.asset.relativePath, "Assets/images/test.png");

    const assetsResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/assets?workspaceId=default`, { headers });
    const assets = await assetsResponse.json() as { data: { assets: Array<{ relativePath: string }> } };
    assert.deepEqual(assets.data.assets.map((asset) => asset.relativePath), ["Assets/images/test.png"]);
  } finally {
    await close(bridgeServer.server);
    await close(upstreamServer.server);
  }
});
