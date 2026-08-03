import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildAnimationReadinessManifest, buildArtifactPreviewMetadata, buildGate3Artifacts, buildGate4Artifacts, evaluateGate3Readiness, evaluateGate4Readiness } from '../lib/gameCreatorGates.js';

test('artifact preview metadata is generated for image and text assets', () => {
  const svgPreview = buildArtifactPreviewMetadata({ workspaceId: 'workspace-1', relativePath: 'GameBuild/gates/gate3/hero-silhouette.svg' });
  assert.equal(svgPreview.kind, 'image');
  assert.match(svgPreview.previewUrl ?? '', /\/api\/tools\/image\/local\/file/);

  const jsonPreview = buildArtifactPreviewMetadata({ workspaceId: 'workspace-1', relativePath: 'GameBuild/animation-readiness.json' });
  assert.equal(jsonPreview.kind, 'text');
  assert.match(jsonPreview.previewUrl ?? '', /\/api\/tools\/game-creator\/artifact-preview/);
});

test('Gate 3 and Gate 4 artifacts become production-ready', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-gate-'));
  const spec = {
    setupWizard: {
      target: 'unity-3d',
      genre: 'action-adventure',
      perspective: 'third-person',
      scopeTier: 'medium-prototype',
      artStyle: 'stylized low-poly',
      controls: 'keyboard+mouse',
      coreLoopPriority: 'combat',
      difficultyTarget: 'normal',
      enemyFamilies: 2,
      biomes: 1,
      bosses: 0,
    },
  } as any;

  const gate3 = await buildGate3Artifacts({ workspacePath: tempDir, spec });
  assert.equal(gate3.ready, true);
  assert.ok(gate3.artifacts.some((entry) => entry.relativePath.includes('gate3')));

  const gate3Readiness = await evaluateGate3Readiness({ workspacePath: tempDir, spec });
  assert.equal(gate3Readiness.ready, true);
  assert.deepEqual(gate3Readiness.blockers, []);

  const gate4 = await buildGate4Artifacts({ workspacePath: tempDir, spec, gate3Artifacts: gate3.artifacts });
  assert.equal(gate4.ready, true);
  assert.ok(gate4.artifacts.some((entry) => entry.relativePath.includes('gate4')));

  const gate4Readiness = await evaluateGate4Readiness({ workspacePath: tempDir, spec });
  assert.equal(gate4Readiness.ready, true);
  assert.deepEqual(gate4Readiness.blockers, []);

  const animationReadiness = await buildAnimationReadinessManifest({ workspacePath: tempDir, spec, gate3Artifacts: gate3.artifacts, gate4Artifacts: gate4.artifacts });
  assert.equal(animationReadiness.ready, true);
  assert.ok(animationReadiness.relativePath.includes('animation-readiness.json'));

  const manifestText = await fs.readFile(path.join(tempDir, animationReadiness.relativePath), 'utf8');
  assert.match(manifestText, /readyForAnimation/);

  await fs.rm(tempDir, { recursive: true, force: true });
});
