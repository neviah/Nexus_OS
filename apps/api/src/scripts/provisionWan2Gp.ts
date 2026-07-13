import { getWan2GpStatus, installWan2Gp, startWan2GpIfNeeded } from "../lib/wan2gpRuntime.js";

async function main(): Promise<void> {
  const before = await getWan2GpStatus();
  if (before.apiReady) {
    console.log("[wan2gp] already ready");
    return;
  }

  console.log("[wan2gp] provisioning runtime...");
  await installWan2Gp();
  await startWan2GpIfNeeded();

  const after = await getWan2GpStatus();
  if (!after.apiReady) {
    throw new Error(`Wan2GP provisioning completed but API is not ready. Notes: ${after.notes.join(" | ")}`);
  }

  console.log("[wan2gp] ready");
}

main().catch((error) => {
  console.error("[wan2gp] provisioning failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
