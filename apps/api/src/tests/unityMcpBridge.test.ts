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
  upstream.get("/api/tools/music/stable-audio/status", (_req, res) => res.json({ apiReady: true }));
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
  upstream.get("/api/tools/wan2gp/video/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ type: "done", result: {
      videoUrl: "/api/tools/wan2gp/file?workspaceId=default&relativePath=Assets%2Fvideos%2Ftest.mp4",
      relativePath: "Assets/videos/test.mp4", workspaceId: "default", provider: "wan2gp", model: "test-video",
      width: 640, height: 384, steps: 6, durationSeconds: 3, fps: 16, frameCount: 49, seed: 1, profile: 4, prompt: "test video",
    } })}\n\n`);
  });
  upstream.post("/api/tools/music/stable-audio/generate", (_req, res) => res.json({
    ok: true,
    mode: "small-sfx",
    duration: 3,
    prompt: "test sound",
    workspaceId: "default",
    relativePath: "Assets/music/test.wav",
    playbackUrl: "/api/tools/music/file?workspaceId=default&relativePath=Assets%2Fmusic%2Ftest.wav",
  }));
  upstream.post("/api/tools/hunyuan3d/generate/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ type: "status", message: "Generating mesh..." })}\n\n`);
    res.end(`data: ${JSON.stringify({ type: "done", result: {
      modelUrl: "/api/tools/hunyuan3d/file?workspaceId=default&relativePath=Assets%2Fmodels%2Ftest.obj",
      relativePath: "Assets/models/test.obj",
      workspaceId: "default",
      provider: "hunyuan3d",
      format: "obj",
      sourceKind: "text",
    } })}\n\n`);
  });
  upstream.post("/api/tools/hunyuan3d/finish/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ type: "done", result: {
      modelUrl: "/api/tools/hunyuan3d/file?workspaceId=default&relativePath=Assets%2Fmodels%2Ftest-finished.obj",
      relativePath: "Assets/models/test-finished.obj",
      workspaceId: "default",
      provider: "blender-headless",
      format: "obj",
      profile: "game-ready-med",
      sourceRelativePath: "Assets/models/test.obj",
    } })}\n\n`);
  });
  upstream.post("/api/tools/animation/generate/stream", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ type: "done", result: { workspaceId: "default", clips: [
      { variation: 1, prompt: "run one", modelUrl: "/api/tools/hunyuan3d/file?workspaceId=default&relativePath=Assets%2Fmodels%2Fanimato-run-v1.glb", relativePath: "Assets/models/animato-run-v1.glb", format: "glb" },
      { variation: 2, prompt: "run two", modelUrl: "/api/tools/hunyuan3d/file?workspaceId=default&relativePath=Assets%2Fmodels%2Fanimato-run-v2.glb", relativePath: "Assets/models/animato-run-v2.glb", format: "glb" },
    ] } })}\n\n`);
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
        }, {
          name: "music",
          type: "directory",
          path: "Assets/music",
          children: [{ name: "test.wav", type: "file", path: "Assets/music/test.wav" }],
        }, {
          name: "models",
          type: "directory",
          path: "Assets/models",
          children: [
            { name: "test.obj", type: "file", path: "Assets/models/test.obj" },
            { name: "animato-run-v1.glb", type: "file", path: "Assets/models/animato-run-v1.glb" },
          ],
        }, {
          name: "videos",
          type: "directory",
          path: "Assets/videos",
          children: [{ name: "test.mp4", type: "file", path: "Assets/videos/test.mp4" }],
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
    const status = await statusResponse.json() as { data: { health: { ok: boolean }; wan2gp: { apiReady: boolean }; stableAudio: { apiReady: boolean } } };
    assert.equal(status.data.health.ok, true);
    assert.equal(status.data.wan2gp.apiReady, true);
    assert.equal(status.data.stableAudio.apiReady, true);

    const startResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/tools/nexus.generate.image`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: "test image" }),
    });
    assert.equal(startResponse.status, 202);
    const started = await startResponse.json() as { requestId: string };

    type JobResponse = { data: { job: { status: string; result?: { asset?: { relativePath: string }; assets?: Array<{ relativePath: string }> } } } };
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
    assert.equal(completed?.data.job.result?.asset?.relativePath, "Assets/images/test.png");

    const assetsResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/assets?workspaceId=default`, { headers });
    const assets = await assetsResponse.json() as { data: { assets: Array<{ relativePath: string }> } };
    assert.deepEqual(assets.data.assets.map((asset) => asset.relativePath), ["Assets/images/test.png"]);

    const audioStartResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/tools/nexus.generate.audio`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: "small-sfx", prompt: "test sound", duration: 3 }),
    });
    assert.equal(audioStartResponse.status, 202);
    const audioStarted = await audioStartResponse.json() as { requestId: string };

    let audioCompleted: JobResponse | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const jobResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/jobs/${audioStarted.requestId}`, { headers });
      const job = await jobResponse.json() as JobResponse;
      if (job.data.job.status === "completed") {
        audioCompleted = job;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(audioCompleted?.data.job.result?.asset?.relativePath, "Assets/music/test.wav");

    const audioAssetsResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/assets?workspaceId=default&kind=audio`, { headers });
    const audioAssets = await audioAssetsResponse.json() as { data: { assets: Array<{ relativePath: string }> } };
    assert.deepEqual(audioAssets.data.assets.map((asset) => asset.relativePath), ["Assets/music/test.wav"]);

    const modelStartResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/tools/nexus.generate.model3d`, {
      method: "POST",
      headers,
      body: JSON.stringify({ textPrompt: "test model", format: "obj" }),
    });
    assert.equal(modelStartResponse.status, 202);
    const modelStarted = await modelStartResponse.json() as { requestId: string };
    let modelCompleted: JobResponse | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${bridgeServer.baseUrl}/api/unity/jobs/${modelStarted.requestId}`, { headers });
      const job = await response.json() as JobResponse;
      if (job.data.job.status === "completed") { modelCompleted = job; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(modelCompleted?.data.job.result?.asset?.relativePath, "Assets/models/test.obj");

    const finishResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/tools/nexus.finish.model3d`, {
      method: "POST",
      headers,
      body: JSON.stringify({ relativePath: "Assets/models/test.obj", outputFormat: "obj", profile: "game-ready-med" }),
    });
    assert.equal(finishResponse.status, 202);
    const finishStarted = await finishResponse.json() as { requestId: string };
    let finishCompleted: JobResponse | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${bridgeServer.baseUrl}/api/unity/jobs/${finishStarted.requestId}`, { headers });
      const job = await response.json() as JobResponse;
      if (job.data.job.status === "completed") { finishCompleted = job; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(finishCompleted?.data.job.result?.asset?.relativePath, "Assets/models/test-finished.obj");

    const modelAssetsResponse = await fetch(`${bridgeServer.baseUrl}/api/unity/assets?workspaceId=default&kind=model3d`, { headers });
    const modelAssets = await modelAssetsResponse.json() as { data: { assets: Array<{ relativePath: string }> } };
    assert.deepEqual(modelAssets.data.assets.map((asset) => asset.relativePath), ["Assets/models/test.obj"]);

    const videoStart = await fetch(`${bridgeServer.baseUrl}/api/unity/tools/nexus.generate.video`, {
      method: "POST", headers, body: JSON.stringify({ prompt: "test video" }),
    });
    assert.equal(videoStart.status, 202);
    const videoId = (await videoStart.json() as { requestId: string }).requestId;
    let videoCompleted: JobResponse | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const job = await (await fetch(`${bridgeServer.baseUrl}/api/unity/jobs/${videoId}`, { headers })).json() as JobResponse;
      if (job.data.job.status === "completed") { videoCompleted = job; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(videoCompleted?.data.job.result?.asset?.relativePath, "Assets/videos/test.mp4");

    const animationStart = await fetch(`${bridgeServer.baseUrl}/api/unity/tools/nexus.generate.animation`, {
      method: "POST", headers, body: JSON.stringify({ prompt: "run", sourceRelativePath: "Assets/models/rigged.glb", variations: 2 }),
    });
    assert.equal(animationStart.status, 202);
    const animationId = (await animationStart.json() as { requestId: string }).requestId;
    let animationCompleted: JobResponse | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const job = await (await fetch(`${bridgeServer.baseUrl}/api/unity/jobs/${animationId}`, { headers })).json() as JobResponse;
      if (job.data.job.status === "completed") { animationCompleted = job; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(animationCompleted?.data.job.result?.assets?.map((asset) => asset.relativePath), ["Assets/models/animato-run-v1.glb", "Assets/models/animato-run-v2.glb"]);

    const videoAssets = await (await fetch(`${bridgeServer.baseUrl}/api/unity/assets?workspaceId=default&kind=video`, { headers })).json() as { data: { assets: Array<{ relativePath: string }> } };
    assert.deepEqual(videoAssets.data.assets.map((asset) => asset.relativePath), ["Assets/videos/test.mp4"]);
    const animationAssets = await (await fetch(`${bridgeServer.baseUrl}/api/unity/assets?workspaceId=default&kind=animation`, { headers })).json() as { data: { assets: Array<{ relativePath: string }> } };
    assert.deepEqual(animationAssets.data.assets.map((asset) => asset.relativePath), ["Assets/models/animato-run-v1.glb"]);
  } finally {
    await close(bridgeServer.server);
    await close(upstreamServer.server);
  }
});
