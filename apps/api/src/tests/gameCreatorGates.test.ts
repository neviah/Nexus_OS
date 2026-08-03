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

test('Gate 4 writes Unity-ready C# handoff scripts', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-gate-unity-'));
  const expectedEnemyFamilies = 7;
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
      enemyFamilies: expectedEnemyFamilies,
      biomes: 1,
      bosses: 0,
    },
  } as any;

  const gate4 = await buildGate4Artifacts({ workspacePath: tempDir, spec, gate3Artifacts: [] });

  const unityScripts = [
    'GameBuild/gates/gate4/unity-handoff/Scripts/Managers/GameManager.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/Controllers/PlayerController.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/Enemies/EnemyController.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/Enemies/EnemyFamilyDefinition.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/Combat/CombatSystem.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/Combat/Health.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/Gameplay/GameplayLoopController.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/Gameplay/EncounterDirector.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/UI/HudController.cs',
    'GameBuild/gates/gate4/unity-handoff/Scripts/UI/MainMenuController.cs',
    'GameBuild/gates/gate4/unity-handoff/Validation/PostImportValidator.cs',
  ];

  for (const relativePath of unityScripts) {
    const fullPath = path.join(tempDir, relativePath);
    const contents = await fs.readFile(fullPath, 'utf8');
    assert.ok(contents.includes('class'));
    assert.ok(gate4.artifacts.some((entry) => entry.relativePath === relativePath));
  }

  const enemyArchetypeRegistryPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Scripts/Enemies/enemy-archetypes.json');
  const enemyArchetypeRegistry = JSON.parse(await fs.readFile(enemyArchetypeRegistryPath, 'utf8')) as { count: number; archetypes: Array<{ id: string }> };
  assert.equal(enemyArchetypeRegistry.count, expectedEnemyFamilies);
  assert.equal(enemyArchetypeRegistry.archetypes.length, expectedEnemyFamilies);

  for (const archetype of enemyArchetypeRegistry.archetypes) {
    const scriptPath = path.join(tempDir, `GameBuild/gates/gate4/unity-handoff/Scripts/Enemies/${archetype.id}.cs`);
    const scriptBody = await fs.readFile(scriptPath, 'utf8');
    assert.match(scriptBody, /class/);
    assert.ok(gate4.artifacts.some((entry) => entry.relativePath.endsWith(`/Enemies/${archetype.id}.cs`)));
  }

  const sceneSetupManifestPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Scenes/scene-setup-manifest.json');
  const sceneSetupManifest = JSON.parse(await fs.readFile(sceneSetupManifestPath, 'utf8')) as { scenes: Array<{ name: string }> };
  assert.ok(sceneSetupManifest.scenes.some((scene) => scene.name === 'MainMenu'));
  assert.ok(sceneSetupManifest.scenes.some((scene) => scene.name === 'Gameplay'));

  const prefabWiringPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Prefabs/prefab-wiring-instructions.md');
  const prefabWiringContents = await fs.readFile(prefabWiringPath, 'utf8');
  assert.match(prefabWiringContents, /Generated enemy archetypes/);

  const prefabWiringManifestPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Prefabs/prefab-wiring-manifest.json');
  const prefabWiringManifest = JSON.parse(await fs.readFile(prefabWiringManifestPath, 'utf8')) as { references: Array<{ from: string; field: string }> };
  assert.ok(prefabWiringManifest.references.some((entry) => entry.from === 'component.systems.loop' && entry.field === 'encounterDirector'));

  const postImportReadinessPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Validation/post-import-readiness.json');
  const postImportReadiness = JSON.parse(await fs.readFile(postImportReadinessPath, 'utf8')) as { checks: Array<{ id: string }>; baselineReadinessScore: number };
  assert.ok(postImportReadiness.checks.some((entry) => entry.id === 'prefab.enemies.generated'));
  assert.ok(postImportReadiness.baselineReadinessScore > 0);

  const spawnTablesPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Data/SpawnTables/biome-spawn-tables.json');
  const spawnTables = JSON.parse(await fs.readFile(spawnTablesPath, 'utf8')) as { spawnTableByBiome: Array<{ biomeId: string }> };
  assert.ok(spawnTables.spawnTableByBiome.length >= 1);

  const enemyFamilyDataPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Data/EnemyFamilies/enemy_type_01.json');
  const enemyFamilyData = JSON.parse(await fs.readFile(enemyFamilyDataPath, 'utf8')) as { familyId: string; combat: { maxHealth: number } };
  assert.equal(enemyFamilyData.familyId, 'enemy_type_01');
  assert.ok(enemyFamilyData.combat.maxHealth > 0);

  const animationStateMapPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Animation/animation-state-map.json');
  const animationStateMap = JSON.parse(await fs.readFile(animationStateMapPath, 'utf8')) as { enemyArchetypes: Array<{ id: string }> };
  assert.equal(animationStateMap.enemyArchetypes.length, expectedEnemyFamilies);

  const animatorScaffoldPath = path.join(tempDir, 'GameBuild/gates/gate4/unity-handoff/Animation/animator-controller-scaffold.md');
  const animatorScaffoldContents = await fs.readFile(animatorScaffoldPath, 'utf8');
  assert.match(animatorScaffoldContents, /Animator Controller Scaffold/);

  await fs.rm(tempDir, { recursive: true, force: true });
});
