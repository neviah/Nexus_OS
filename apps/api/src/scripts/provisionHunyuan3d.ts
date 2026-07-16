import { getHunyuan3dStatus, installHunyuan3d, startHunyuan3dIfNeeded } from "../lib/hunyuan3dRuntime.js";

async function main(): Promise<void> {
  const before = await getHunyuan3dStatus();
  if (before.apiReady) {
    console.log("[hunyuan3d] already ready");
    return;
  }

  console.log("[hunyuan3d] provisioning runtime...");
  await installHunyuan3d();
  await startHunyuan3dIfNeeded();

  const after = await getHunyuan3dStatus();
  if (!after.apiReady) {
    throw new Error(`Hunyuan3D provisioning completed but runtime is not ready. Notes: ${after.notes.join(" | ")}`);
  }

  console.log("[hunyuan3d] ready");
}

main().catch((error) => {
  console.error("[hunyuan3d] provisioning failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
