import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildGate3Artifacts, buildGate4Artifacts } from "../lib/gameCreatorGates.js";
import { buildGameCreatorUnityAuthoringProject } from "../lib/gameCreatorUnityAuthoring.js";

const spec = {
  setupWizard: {
    target: "unity-3d",
    genre: "action-adventure",
    perspective: "third-person",
    scopeTier: "medium-prototype",
      artStyle: "stylized-low-poly",
      controls: "keyboard-mouse",
    coreLoopPriority: "combat",
    difficultyTarget: "normal",
    enemyFamilies: 5,
    biomes: 2,
    bosses: 1,
  },
} as const;

test("Game Creator stages a Unity authoring project from Gate 4 manifests", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-unity-authoring-"));
  const gate3 = await buildGate3Artifacts({ workspacePath: tempDir, spec: spec as never });
  const gate4 = await buildGate4Artifacts({ workspacePath: tempDir, spec: spec as never, gate3Artifacts: gate3.artifacts });
  assert.equal(gate4.ready, true);

  const result = await buildGameCreatorUnityAuthoringProject({
    workspacePath: tempDir,
    spec: spec.setupWizard,
    canonDocs: [
      {
        fileName: "GAME_BIBLE.md",
        title: "Game Bible",
        relativePath: "docs/game-creator/GAME_BIBLE.md",
        exists: true,
        content: "# Game Bible\n\n## Core Loop\nCombat and exploration in a stylized low-poly world.\n",
      },
      {
        fileName: "TECHNICAL_DESIGN.md",
        title: "Technical Design",
        relativePath: "docs/game-creator/TECHNICAL_DESIGN.md",
        exists: true,
        content: "# Technical Design\n\n## Runtime Systems\nGameplay loop, encounter director, and shell flow.\n",
      },
      {
        fileName: "UI_UX_SPEC.md",
        title: "UI UX Spec",
        relativePath: "docs/game-creator/UI_UX_SPEC.md",
        exists: true,
        content: "# UI UX Spec\n\n## Screen Map\nSplash screen, main menu, settings, pause menu overlay, gameplay HUD.\n",
      },
      {
        fileName: "CONTROLS_CAMERA_SPEC.md",
        title: "Controls And Camera Spec",
        relativePath: "docs/game-creator/CONTROLS_CAMERA_SPEC.md",
        exists: true,
        content: "# Controls And Camera Spec\n\n## Accessibility\nRemapping and comfort settings.\n",
      },
      {
        fileName: "PRODUCTION_PLAN.md",
        title: "Production Plan",
        relativePath: "docs/game-creator/PRODUCTION_PLAN.md",
        exists: true,
        content: "# Production Plan\n\n## Milestones\nPreproduction, vertical slice, expansion, polish.\n",
      },
      {
        fileName: "ENEMY_ROSTER.md",
        title: "Enemy Roster",
        relativePath: "docs/game-creator/ENEMY_ROSTER.md",
        exists: true,
        content: "# Enemy Roster\n\n## Roles\nTank, flanker, ranged.\n",
      },
      {
        fileName: "DIFFICULTY_CURVE.md",
        title: "Difficulty Curve",
        relativePath: "docs/game-creator/DIFFICULTY_CURVE.md",
        exists: true,
        content: "# Difficulty Curve\n\n## Curve Goals\nScale multiple levels over time.\n",
      },
    ],
  });

  assert.equal(result.methodName, "NexusGenerated.GameCreatorAutomation.GenerateFromGate4");
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Editor/NexusGenerated/GameCreatorAutomation.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorImportPlan.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorShellPlan.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorLevelManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorUiLayoutManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorEnemyBehaviorManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorPrefabStyleManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorArtDirectionManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorAudioPlanManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorLoreProfileManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorTechnicalProfileManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorProductionPlanManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/NexusGenerated/GameCreatorEncounterWireManifest.json")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/SplashController.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/GameFlowBootstrap.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/GameSettingsProfile.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/MenuLayoutController.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/HudLayoutController.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/EnemyBehaviorCatalog.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/ArtStyleGuide.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/AudioCueCatalog.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/LoreCatalog.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/TechnicalRuntimeProfile.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/ProductionMilestones.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/EncounterWiringProfile.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/EncounterRuntimeDirector.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/SceneAudioBootstrap.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/UiAudioTrigger.cs")));
  assert.ok(result.stagedFiles.some((entry) => entry.endsWith("GameBuild/unity/Assets/Scripts/GameCreator/Shell/LevelFlowController.cs")));
  assert.ok(result.plan.shell.scenes.some((scene) => scene.name === "Splash"));
  assert.ok(result.plan.shell.scenes.some((scene) => scene.name === "Settings"));
  assert.ok(result.plan.shell.scenes.some((scene) => scene.name === "Gameplay"));
  assert.ok(result.plan.shell.scenes.some((scene) => scene.name === "Level01"));
  assert.ok(result.plan.shell.scenes.some((scene) => scene.name === "Level02"));
  assert.ok(result.plan.shell.settingsProfile.accessibilityOptions.includes("remapping"));
  assert.ok(result.plan.shell.menuLayout.primaryButtons.includes("Settings"));
  assert.ok(result.plan.shell.hudLayout.widgets.includes("HealthBar"));
  assert.ok(result.plan.shell.enemyLayout.roles.length >= 1);
  assert.ok(result.plan.shell.artDirection.visualPillars.length >= 1);
  assert.ok(result.plan.shell.audioPlan.sfxTaxonomy.includes("UI"));
  assert.ok(result.plan.shell.loreProfile.worldRules.length >= 1);
  assert.ok(result.plan.shell.technicalProfile.runtimeSystems.includes("Scene bootstrap"));
  assert.ok(result.plan.shell.productionPlan.milestones.length >= 1);
  assert.ok(result.plan.shell.encounterWire.spawnRules.length >= 1);
  assert.equal(result.levelManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorLevelManifest.json");
  assert.equal(result.uiLayoutManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorUiLayoutManifest.json");
  assert.equal(result.enemyBehaviorManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorEnemyBehaviorManifest.json");
  assert.equal(result.prefabStyleManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorPrefabStyleManifest.json");
  assert.equal(result.artDirectionManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorArtDirectionManifest.json");
  assert.equal(result.audioPlanManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorAudioPlanManifest.json");
  assert.equal(result.loreProfileManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorLoreProfileManifest.json");
  assert.equal(result.technicalProfileManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorTechnicalProfileManifest.json");
  assert.equal(result.productionPlanManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorProductionPlanManifest.json");
  assert.equal(result.encounterWireManifestRelativePath, "GameBuild/unity/Assets/NexusGenerated/GameCreatorEncounterWireManifest.json");

  const plan = JSON.parse(await fs.readFile(path.join(tempDir, result.planRelativePath), "utf8")) as { gate4: { enemyFamilies: Array<{ familyId: string }> } };
  assert.equal(plan.gate4.enemyFamilies.length, 5);
  assert.equal(plan.gate4.enemyFamilies[0].familyId, "enemy_type_01");

  const levelManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.levelManifestRelativePath), "utf8")) as { levels: Array<{ sceneName: string }> };
  assert.equal(levelManifest.levels.length, 2);
  assert.equal(levelManifest.levels[0].sceneName, "Level01");

  const uiManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.uiLayoutManifestRelativePath), "utf8")) as { menuLayout: { primaryButtons: string[] } };
  assert.ok(uiManifest.menuLayout.primaryButtons.includes("Play"));

  const enemyManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.enemyBehaviorManifestRelativePath), "utf8")) as { enemyLayout: { roles: string[] } };
  assert.ok(enemyManifest.enemyLayout.roles.length >= 1);

  const prefabStyleManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.prefabStyleManifestRelativePath), "utf8")) as {
    prefabStylePlan: {
      player: { materialRole: string };
      enemyBase: { materialRole: string };
    };
  };
  assert.equal(prefabStyleManifest.prefabStylePlan.player.materialRole, "player-primary");
  assert.equal(prefabStyleManifest.prefabStylePlan.enemyBase.materialRole, "enemy-primary");

  const artManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.artDirectionManifestRelativePath), "utf8")) as { artDirection: { visualPillars: string[] } };
  assert.ok(artManifest.artDirection.visualPillars.length >= 1);

  const audioManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.audioPlanManifestRelativePath), "utf8")) as { audioPlan: { sfxTaxonomy: string[] } };
  assert.ok(audioManifest.audioPlan.sfxTaxonomy.includes("UI"));

  const loreManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.loreProfileManifestRelativePath), "utf8")) as { loreProfile: { factions: string[] } };
  assert.ok(loreManifest.loreProfile.factions.length >= 1);

  const techManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.technicalProfileManifestRelativePath), "utf8")) as { technicalProfile: { runtimeSystems: string[] } };
  assert.ok(techManifest.technicalProfile.runtimeSystems.length >= 1);

  const productionManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.productionPlanManifestRelativePath), "utf8")) as { productionPlan: { milestones: string[] } };
  assert.ok(productionManifest.productionPlan.milestones.length >= 1);

  const encounterManifest = JSON.parse(await fs.readFile(path.join(tempDir, result.encounterWireManifestRelativePath), "utf8")) as { encounterWire: { spawnRules: string[] } };
  assert.ok(encounterManifest.encounterWire.spawnRules.length >= 1);

  await fs.rm(tempDir, { recursive: true, force: true });
});
