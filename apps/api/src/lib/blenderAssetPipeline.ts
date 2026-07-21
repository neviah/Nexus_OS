import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BlenderFinishProfile = "draft" | "game-ready-low" | "game-ready-med" | "game-ready-high";

export type BlenderFinishInput = {
  inputPath: string;
  outputFormat: "glb" | "obj";
  profile: BlenderFinishProfile;
};

export type BlenderFinishResult = {
  outputPath: string;
  outputFormat: "glb" | "obj";
  profile: BlenderFinishProfile;
  blenderPath: string;
  stats: {
    vertices: number;
    faces: number;
  };
};

async function commandWorks(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveBlenderExecutable(): Promise<string> {
  const candidates: string[] = [];
  const envHints = [
    process.env.NEXUS_BLENDER_PATH,
    process.env.BLENDER_PATH,
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const hint of envHints) {
    candidates.push(hint.trim());
  }

  if (process.platform === "win32") {
    candidates.push(
      "blender.exe",
      "blender",
      "C:/Program Files/Blender Foundation/Blender/blender.exe",
      "C:/Program Files/Blender Foundation/Blender 4.2/blender.exe",
      "C:/Program Files/Blender Foundation/Blender 4.1/blender.exe",
      "C:/Program Files/Blender Foundation/Blender 4.0/blender.exe",
      "C:/Program Files/Blender Foundation/Blender 3.6/blender.exe",
    );
  } else {
    candidates.push("blender");
  }

  for (const candidate of candidates) {
    if (await commandWorks(candidate, ["--version"])) {
      return candidate;
    }
  }

  throw new Error(
    "Blender was not found. Install Blender and ensure blender is on PATH, or set NEXUS_BLENDER_PATH to blender executable.",
  );
}

function buildBlenderPipelineScript(): string {
  return [
    "import bpy",
    "import json",
    "import os",
    "import sys",
    "import traceback",
    "",
    "def emit_status(message: str):",
    "    print('NEXUS_STATUS:' + str(message), flush=True)",
    "",
    "def emit_result(payload):",
    "    print('NEXUS_RESULT:' + json.dumps(payload), flush=True)",
    "",
    "def clear_scene():",
    "    bpy.ops.object.select_all(action='SELECT')",
    "    bpy.ops.object.delete(use_global=False)",
    "",
    "def import_mesh(input_path: str):",
    "    ext = os.path.splitext(input_path)[1].lower()",
    "    if ext in ['.glb', '.gltf']:",
    "        bpy.ops.import_scene.gltf(filepath=input_path)",
    "        return",
    "    if ext == '.obj':",
    "        if hasattr(bpy.ops.wm, 'obj_import'):",
    "            bpy.ops.wm.obj_import(filepath=input_path)",
    "        else:",
    "            bpy.ops.import_scene.obj(filepath=input_path)",
    "        return",
    "    raise RuntimeError(f'Unsupported input extension: {ext}')",
    "",
    "def export_mesh(output_path: str, output_format: str):",
    "    if output_format == 'glb':",
    "        bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB', use_selection=True)",
    "        return",
    "    if output_format == 'obj':",
    "        if hasattr(bpy.ops.wm, 'obj_export'):",
    "            bpy.ops.wm.obj_export(filepath=output_path, export_selected_objects=True)",
    "        else:",
    "            bpy.ops.export_scene.obj(filepath=output_path, use_selection=True)",
    "        return",
    "    raise RuntimeError(f'Unsupported output format: {output_format}')",
    "",
    "def select_only(obj):",
    "    bpy.ops.object.select_all(action='DESELECT')",
    "    obj.select_set(True)",
    "    bpy.context.view_layer.objects.active = obj",
    "",
    "def ensure_single_mesh(mesh_objects):",
    "    if len(mesh_objects) == 1:",
    "        return mesh_objects[0]",
    "    bpy.ops.object.select_all(action='DESELECT')",
    "    for obj in mesh_objects:",
    "        obj.select_set(True)",
    "    bpy.context.view_layer.objects.active = mesh_objects[0]",
    "    bpy.ops.object.join()",
    "    return bpy.context.view_layer.objects.active",
    "",
    "def cleanup_mesh(obj, ratio: float):",
    "    select_only(obj)",
    "    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)",
    "    bpy.ops.object.mode_set(mode='EDIT')",
    "    bpy.ops.mesh.select_all(action='SELECT')",
    "    if hasattr(bpy.ops.mesh, 'delete_loose'):",
    "        bpy.ops.mesh.delete_loose()",
    "    if hasattr(bpy.ops.mesh, 'merge_by_distance'):",
    "        bpy.ops.mesh.merge_by_distance(distance=0.0001)",
    "    elif hasattr(bpy.ops.mesh, 'remove_doubles'):",
    "        bpy.ops.mesh.remove_doubles(threshold=0.0001)",
    "    bpy.ops.mesh.normals_make_consistent(inside=False)",
    "    bpy.ops.object.mode_set(mode='OBJECT')",
    "",
    "    if ratio < 0.999:",
    "        modifier = obj.modifiers.new(name='NexusDecimate', type='DECIMATE')",
    "        modifier.ratio = max(0.05, min(ratio, 1.0))",
    "        bpy.ops.object.modifier_apply(modifier=modifier.name)",
    "",
    "def auto_uv_unwrap(obj):",
    "    select_only(obj)",
    "    bpy.ops.object.mode_set(mode='EDIT')",
    "    bpy.ops.mesh.select_all(action='SELECT')",
    "    bpy.ops.uv.smart_project(angle_limit=1.15192, island_margin=0.03)",
    "    bpy.ops.object.mode_set(mode='OBJECT')",
    "",
    "def mesh_stats(obj):",
    "    return {",
    "        'vertices': int(len(obj.data.vertices)),",
    "        'faces': int(len(obj.data.polygons)),",
    "    }",
    "",
    "def main():",
    "    if '--' not in sys.argv:",
    "        raise RuntimeError('Missing -- separator for script arguments.')",
    "",
    "    args = sys.argv[sys.argv.index('--') + 1:]",
    "    if len(args) < 2 or args[0] != '--manifest':",
    "        raise RuntimeError('Usage: --manifest <manifest.json>')",
    "",
    "    manifest_path = args[1]",
    "    with open(manifest_path, 'r', encoding='utf-8') as handle:",
    "        manifest = json.load(handle)",
    "",
    "    input_path = manifest['input_path']",
    "    output_path = manifest['output_path']",
    "    output_format = manifest.get('output_format', 'glb')",
    "    profile = manifest.get('profile', 'game-ready-med')",
    "    ratios = {",
    "        'draft': 1.0,",
    "        'game-ready-high': 0.75,",
    "        'game-ready-med': 0.5,",
    "        'game-ready-low': 0.3,",
    "    }",
    "    ratio = float(ratios.get(profile, 0.5))",
    "",
    "    emit_status('Clearing scene...')",
    "    clear_scene()",
    "",
    "    emit_status(f'Importing mesh: {os.path.basename(input_path)}')",
    "    import_mesh(input_path)",
    "",
    "    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']",
    "    if not mesh_objects:",
    "        raise RuntimeError('No mesh objects found after import.')",
    "",
    "    emit_status(f'Merging {len(mesh_objects)} mesh object(s)...')",
    "    mesh = ensure_single_mesh(mesh_objects)",
    "",
    "    emit_status('Running cleanup (non-manifold/loose verts/normals/decimate)...')",
    "    cleanup_mesh(mesh, ratio)",
    "",
    "    emit_status('Running UV unwrap...')",
    "    auto_uv_unwrap(mesh)",
    "",
    "    emit_status(f'Exporting {output_format.upper()}...')",
    "    select_only(mesh)",
    "    export_mesh(output_path, output_format)",
    "",
    "    stats = mesh_stats(mesh)",
    "    emit_result({",
    "        'output_path': output_path,",
    "        'output_format': output_format,",
    "        'profile': profile,",
    "        'stats': stats,",
    "    })",
    "",
    "try:",
    "    main()",
    "except Exception as error:",
    "    emit_status('Blender pipeline failed: ' + str(error))",
    "    emit_status(traceback.format_exc())",
    "    raise",
  ].join("\n");
}

async function terminateChild(childPid: number): Promise<void> {
  if (!Number.isFinite(childPid) || childPid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(childPid), "/T", "/F"], {
        windowsHide: true,
        maxBuffer: 256 * 1024,
      });
    } catch {
      // Ignore cancellation races.
    }
    return;
  }

  try {
    process.kill(childPid, "SIGTERM");
  } catch {
    // Ignore cancellation races.
  }
}

export async function runBlenderFinishStreaming(
  input: BlenderFinishInput,
  onStatus: (message: string) => void,
  signal?: AbortSignal,
): Promise<BlenderFinishResult> {
  const blenderPath = await resolveBlenderExecutable();
  const outputFormat = input.outputFormat === "obj" ? "obj" : "glb";
  const profile: BlenderFinishProfile = ["draft", "game-ready-low", "game-ready-med", "game-ready-high"].includes(input.profile)
    ? input.profile
    : "game-ready-med";

  const tempRoot = path.join(os.tmpdir(), `nexus-blender-${Date.now()}-${crypto.randomUUID()}`);
  await fs.mkdir(tempRoot, { recursive: true });

  const scriptPath = path.join(tempRoot, "nexus_blender_pipeline.py");
  const manifestPath = path.join(tempRoot, "manifest.json");
  const outputPath = path.join(tempRoot, `finished.${outputFormat}`);

  await fs.writeFile(scriptPath, buildBlenderPipelineScript(), "utf-8");
  await fs.writeFile(manifestPath, JSON.stringify({
    input_path: input.inputPath,
    output_path: outputPath,
    output_format: outputFormat,
    profile,
  }, null, 2), "utf-8");

  onStatus(`Starting Blender headless pipeline (${profile})...`);

  const child = spawn(blenderPath, ["-b", "-P", scriptPath, "--", "--manifest", manifestPath], {
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
  });

  return await new Promise<BlenderFinishResult>((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let resultPayload: {
      output_path?: string;
      output_format?: string;
      profile?: BlenderFinishProfile;
      stats?: { vertices?: number; faces?: number };
    } | null = null;
    let settled = false;

    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    };

    const settleResolve = (value: BlenderFinishResult) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };

    const onAbort = () => {
      onStatus("Cancellation requested. Stopping Blender pipeline...");
      if (child.pid) {
        void terminateChild(child.pid);
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      while (true) {
        const idx = stdoutBuffer.indexOf("\n");
        if (idx < 0) {
          break;
        }
        const line = stdoutBuffer.slice(0, idx).trim();
        stdoutBuffer = stdoutBuffer.slice(idx + 1);
        if (!line) {
          continue;
        }

        if (line.startsWith("NEXUS_STATUS:")) {
          onStatus(line.slice("NEXUS_STATUS:".length).trim());
          continue;
        }

        if (line.startsWith("NEXUS_RESULT:")) {
          const raw = line.slice("NEXUS_RESULT:".length).trim();
          try {
            resultPayload = JSON.parse(raw) as typeof resultPayload;
          } catch {
            onStatus(`Could not parse Blender result payload: ${raw}`);
          }
          continue;
        }

        onStatus(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrBuffer += text;
      const trimmed = text.trim();
      if (trimmed) {
        onStatus(trimmed);
      }
    });

    child.on("error", (error) => {
      settleReject(new Error(`Could not start Blender process: ${error.message}`));
    });

    child.on("close", async (code) => {
      if (signal?.aborted) {
        settleReject(new Error("Blender pipeline canceled by user."));
        return;
      }

      if (code !== 0) {
        settleReject(new Error(`Blender pipeline failed with exit code ${code}. ${stderrBuffer || "No stderr output."}`));
        return;
      }

      const resolvedOutputPath = resultPayload?.output_path || outputPath;
      const stats = {
        vertices: Number(resultPayload?.stats?.vertices ?? 0),
        faces: Number(resultPayload?.stats?.faces ?? 0),
      };

      try {
        await fs.access(resolvedOutputPath);
      } catch {
        settleReject(new Error("Blender pipeline completed without an output mesh file."));
        return;
      }

      settleResolve({
        outputPath: resolvedOutputPath,
        outputFormat: resultPayload?.output_format === "obj" ? "obj" : outputFormat,
        profile: resultPayload?.profile ?? profile,
        blenderPath,
        stats,
      });
    });
  });
}
