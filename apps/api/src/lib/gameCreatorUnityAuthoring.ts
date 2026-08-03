import fs from "node:fs/promises";
import path from "node:path";
import type { GameCreatorSetupWizardDraft } from "../types.js";

export type GameCreatorUnityAuthoringSpec = Pick<
  GameCreatorSetupWizardDraft,
  | "target"
  | "genre"
  | "perspective"
  | "scopeTier"
  | "artStyle"
  | "controls"
  | "coreLoopPriority"
  | "difficultyTarget"
  | "enemyFamilies"
  | "biomes"
  | "bosses"
>;

export type GameCreatorCanonDocSource = {
  fileName: string;
  title: string;
  relativePath: string;
  content: string;
  exists: boolean;
  locked?: boolean;
  reviewStatus?: string;
};

export type GameCreatorUnityShellScene = {
  name: string;
  kind: "splash" | "menu" | "settings" | "gameplay" | "level";
  rootObjects: string[];
  sourceDocs: string[];
  notes: string;
};

export type GameCreatorUnityShellPlan = {
  generatedAt: string;
  docsUsed: string[];
  artDirection: {
    visualPillars: string[];
    palette: string[];
    uiStyle: string[];
    silhouetteRules: string[];
    environmentStyle: string[];
  };
  audioPlan: {
    musicDirection: string[];
    sfxTaxonomy: string[];
    priorityScenes: string[];
    loudnessStandard: string;
  };
  loreProfile: {
    worldRules: string[];
    factions: string[];
    characterAnchors: string[];
    namingConventions: string[];
  };
  technicalProfile: {
    runtimeSystems: string[];
    projectStructure: string[];
    buildPipeline: string[];
    performanceTargets: string[];
  };
  productionPlan: {
    milestones: string[];
    backlog: string[];
    risks: string[];
    owners: string[];
  };
  settingsProfile: {
    defaultFullscreen: boolean;
    defaultMasterVolume: number;
    defaultInputProfile: string;
    accessibilityOptions: string[];
    qualityPreset: string;
  };
  menuLayout: {
    primaryButtons: string[];
    secondaryPanels: string[];
    footerItems: string[];
  };
  hudLayout: {
    anchors: string[];
    widgets: string[];
  };
  enemyLayout: {
    roles: string[];
    families: string[];
    sourceDocs: string[];
  };
  encounterWire: {
    spawnRules: string[];
    compositionTemplates: string[];
    bossHooks: string[];
    sourceDocs: string[];
  };
  screens: Array<{
    id: string;
    title: string;
    sourceDocs: string[];
    notes: string;
  }>;
  levelManifest: Array<{
    levelId: string;
    sceneName: string;
    displayName: string;
    biomeIndex: number;
    sourceDocs: string[];
  }>;
  scenes: GameCreatorUnityShellScene[];
  levelNames: string[];
  flow: {
    splashToMenu: boolean;
    menuToSettings: boolean;
    menuToGameplay: boolean;
    gameplayToLevels: boolean;
    gameplayHasPauseOverlay: boolean;
  };
  evidence: string[];
};

export type GameCreatorUnityAuthoringPlan = {
  generatedAt: string;
  workspacePath: string;
  unityProjectPath: string;
  gate4RootRelativePath: string;
  methodName: string;
  logRelativePath: string;
  shellPlanRelativePath: string;
  levelManifestRelativePath: string;
  uiLayoutManifestRelativePath: string;
  enemyBehaviorManifestRelativePath: string;
  prefabStyleManifestRelativePath: string;
  artDirectionManifestRelativePath: string;
  audioPlanManifestRelativePath: string;
  loreProfileManifestRelativePath: string;
  technicalProfileManifestRelativePath: string;
  productionPlanManifestRelativePath: string;
  encounterWireManifestRelativePath: string;
  readinessReportRelativePath: string;
  stageRelativePaths: string[];
  spec: GameCreatorUnityAuthoringSpec;
  shell: GameCreatorUnityShellPlan;
  gate4: {
    assetManifest: unknown;
    importPackage: unknown;
    prefabWiringManifest: unknown;
    spawnTables: unknown;
    animationStateMap: unknown;
    postImportReadiness: unknown;
    enemyFamilies: Array<{ familyId: string; displayName: string; role: string; combat: { moveSpeed: number; maxHealth: number; attackDamage: number; attackRange: number; attackCooldown: number } }>;
  };
};

export type BuildGameCreatorUnityAuthoringProjectResult = {
  unityProjectPath: string;
  logRelativePath: string;
  methodName: string;
  stagedFiles: string[];
  planRelativePath: string;
  shellPlanRelativePath: string;
  levelManifestRelativePath: string;
  uiLayoutManifestRelativePath: string;
  enemyBehaviorManifestRelativePath: string;
  prefabStyleManifestRelativePath: string;
  artDirectionManifestRelativePath: string;
  audioPlanManifestRelativePath: string;
  loreProfileManifestRelativePath: string;
  technicalProfileManifestRelativePath: string;
  productionPlanManifestRelativePath: string;
  encounterWireManifestRelativePath: string;
  readinessReportRelativePath: string;
  plan: GameCreatorUnityAuthoringPlan;
};

function toPascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

type EnemyFamilySource = {
  familyId?: unknown;
  displayName?: unknown;
  role?: unknown;
  combat?: {
    moveSpeed?: unknown;
    maxHealth?: unknown;
    attackDamage?: unknown;
    attackRange?: unknown;
    attackCooldown?: unknown;
  };
};

async function copyDirectoryFiles(sourceDir: string, targetDir: string): Promise<string[]> {
  const copied: string[] = [];
  const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => [] as Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>);
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await copyDirectoryFiles(sourcePath, targetPath);
      copied.push(...nested);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    copied.push(targetPath);
  }
  return copied;
}

function normalizeDocContent(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildGameCreatorUnityShellPlan(input: { spec: GameCreatorUnityAuthoringSpec; canonDocs: GameCreatorCanonDocSource[] }): GameCreatorUnityShellPlan {
  const docsByName = new Map(input.canonDocs.map((doc) => [doc.fileName, doc] as const));
  const docsUsed = input.canonDocs.filter((doc) => normalizeDocContent(doc.content).length > 0).map((doc) => doc.fileName);
  const uiDoc = normalizeDocContent(docsByName.get("UI_UX_SPEC.md")?.content);
  const controlsDoc = normalizeDocContent(docsByName.get("CONTROLS_CAMERA_SPEC.md")?.content);
  const techDoc = normalizeDocContent(docsByName.get("TECHNICAL_DESIGN.md")?.content);
  const gameBibleDoc = normalizeDocContent(docsByName.get("GAME_BIBLE.md")?.content);
  const productionDoc = normalizeDocContent(docsByName.get("PRODUCTION_PLAN.md")?.content);
  const enemyRosterDoc = normalizeDocContent(docsByName.get("ENEMY_ROSTER.md")?.content);
  const difficultyDoc = normalizeDocContent(docsByName.get("DIFFICULTY_CURVE.md")?.content);
  const artDoc = normalizeDocContent(docsByName.get("ART_BIBLE.md")?.content);
  const audioDoc = normalizeDocContent(docsByName.get("AUDIO_BIBLE.md")?.content);
  const loreDoc = normalizeDocContent(docsByName.get("LORE_BOOK.md")?.content);

  const levelCount = Math.max(2, Math.min(4, Number(input.spec.biomes) || 2));
  const levelNames = Array.from({ length: levelCount }, (_, index) => `Level${String(index + 1).padStart(2, "0")}`);
  const roleMatches = Array.from(new Set((enemyRosterDoc.match(/\b(tank|flanker|ranged|support|bruiser|chaser)\b/gi) ?? []).map((role) => role.toLowerCase())));
  const enemyRoles = roleMatches.length > 0 ? roleMatches : ["tank", "flanker", "ranged"];
  const enemyFamilies = Array.from({ length: Math.max(1, Number(input.spec.enemyFamilies) || 1) }, (_, index) => `enemy_type_${String(index + 1).padStart(2, "0")}`);
  const visualPillars = artDoc.length > 0
    ? ["Readable silhouettes", "Material contrast", "Gameplay-first color separation"]
    : ["Readable silhouettes", "Clear gameplay contrast"];
  const palette = [input.spec.artStyle, input.spec.genre, input.spec.target].filter(Boolean);
  const uiStyle = ["Bold contrast", "High readability", "Minimal noise", "Actionable affordances"];
  const silhouetteRules = ["Distinct player silhouette", "Distinct enemy role silhouettes", "Boss silhouette reads at distance"];
  const environmentStyle = ["Biome contrast by color and shape", "Interactive landmarks", "Readable traversal depth"];
  const musicDirection = audioDoc.length > 0 ? ["Core loop tension", "Menu calm-to-momentum shift", "Combat escalation"] : ["Loop tension", "Combat escalation"];
  const sfxTaxonomy = ["UI", "Traversal", "Combat", "Enemy feedback", "Accessibility"];
  const priorityScenes = ["Splash", "MainMenu", "Gameplay", ...levelNames].slice(0, 6);
  const worldRules = loreDoc.length > 0 ? ["No lore contradiction across docs", "Player fantasy stays primary"] : ["Player fantasy stays primary"];
  const factions = ["Player", "Enemy factions", "Support/mentor", "Boss entities"];
  const characterAnchors = ["Player identity", "Companion hooks", "Enemy role identities", "Boss identities"];
  const namingConventions = ["Snake case data ids", "Pascal case Unity classes", "Readable scene names"];
  const runtimeSystems = techDoc.length > 0 ? ["Gameplay loop", "Encounter director", "Settings persistence", "Scene bootstrap", "Save/load"] : ["Gameplay loop", "Scene bootstrap"];
  const projectStructure = ["Assets/Scripts/GameCreator/Shell", "Assets/NexusGenerated", "Assets/Scenes", "ProjectSettings"];
  const buildPipeline = ["Gate 4 handoff", "Unity batch authoring", "Scene import validation", "Regression smoke test"];
  const performanceTargets = ["Stable startup", "Low menu overhead", "Playable combat baseline"];
  const milestones = productionDoc.length > 0 ? ["Preproduction lock", "Vertical slice", "Content expansion", "Polish", "RC"] : ["Vertical slice", "Polish"];
  const backlog = ["UI polish", "Enemy tuning", "Audio pass", "Level pass", "Save/load pass"];
  const risks = ["Scope drift", "Content inconsistency", "Performance regressions"];
  const owners = ["Design", "Engineering", "Art", "Audio", "Production"];
  const spawnRules = difficultyDoc.length > 0 ? ["Role balance scales per level", "Spawn density increases with level index", "Bosses reserve encounter budget"] : ["Spawn density increases with level index"];
  const compositionTemplates = ["Intro encounter", "Mid-level pressure wave", "Boss setup wave"];
  const bossHooks = ["Boss encounter reserved", "Boss arena readable at distance"];

  const splashNotes = uiDoc.length > 0
    ? "Derived from the UI/UX screen map and startup pacing implied by the canon docs."
    : "Added as the startup handoff surface because the canon docs require a first-run flow.";
  const settingsNotes = controlsDoc.length > 0
    ? "Derived from the controls/camera doc to expose remapping and accessibility options."
    : "Added from the controls requirement so the shell always exposes remapping and comfort settings.";
  const menuNotes = gameBibleDoc.length > 0
    ? "Derived from the core loop and player fantasy in the game bible." 
    : "Derived from the core loop expectations.";
  const gameplayNotes = techDoc.length > 0 || productionDoc.length > 0
    ? "Derived from the technical design and production plan so the first playable loop is explicit."
    : "Derived from the initial playable loop requirements.";
  const hudWidgets = ["ObjectiveText", "HealthBar", "AmmoOrAbilityTracker", "EncounterStatus", "InteractionHint"];
  const menuPanels = ["PrimaryActions", "OptionsSummary", "BuildInfo"];
  const footerItems = ["VersionBadge", "AccessibilityHint", "ControllerHint"];

  const screens = [
    {
      id: "splash",
      title: "Splash Screen",
      sourceDocs: ["UI_UX_SPEC.md", "PRODUCTION_PLAN.md"].filter((fileName) => docsByName.has(fileName)),
      notes: splashNotes,
    },
    {
      id: "main-menu",
      title: "Main Menu",
      sourceDocs: ["UI_UX_SPEC.md", "GAME_BIBLE.md"].filter((fileName) => docsByName.has(fileName)),
      notes: menuNotes,
    },
    {
      id: "settings",
      title: "Settings Screen",
      sourceDocs: ["UI_UX_SPEC.md", "CONTROLS_CAMERA_SPEC.md"].filter((fileName) => docsByName.has(fileName)),
      notes: settingsNotes,
    },
    {
      id: "pause-overlay",
      title: "Pause Menu Overlay",
      sourceDocs: ["UI_UX_SPEC.md", "CONTROLS_CAMERA_SPEC.md"].filter((fileName) => docsByName.has(fileName)),
      notes: "Derived from the pause/settings requirement in the UI/UX spec and controls accessibility coverage.",
    },
    {
      id: "gameplay-hud",
      title: "Gameplay HUD",
      sourceDocs: ["UI_UX_SPEC.md", "TECHNICAL_DESIGN.md"].filter((fileName) => docsByName.has(fileName)),
      notes: gameplayNotes,
    },
  ];

  const scenes: GameCreatorUnityShellScene[] = [
    {
      name: "Splash",
      kind: "splash",
      rootObjects: ["SplashCanvas", "EventSystem", "SplashBootstrap"],
      sourceDocs: ["UI_UX_SPEC.md", "PRODUCTION_PLAN.md"].filter((fileName) => docsByName.has(fileName)),
      notes: splashNotes,
    },
    {
      name: "MainMenu",
      kind: "menu",
      rootObjects: ["MainMenuCanvas", "EventSystem", "PersistentBootstrap"],
      sourceDocs: ["UI_UX_SPEC.md", "GAME_BIBLE.md"].filter((fileName) => docsByName.has(fileName)),
      notes: menuNotes,
    },
    {
      name: "Settings",
      kind: "settings",
      rootObjects: ["SettingsCanvas", "EventSystem", "SettingsController"],
      sourceDocs: ["UI_UX_SPEC.md", "CONTROLS_CAMERA_SPEC.md"].filter((fileName) => docsByName.has(fileName)),
      notes: settingsNotes,
    },
    {
      name: "Gameplay",
      kind: "gameplay",
      rootObjects: ["Player", "GameplaySystems", "EncounterRoot", "HudCanvas", "PauseMenuCanvas", "EnvironmentRoot"],
      sourceDocs: ["TECHNICAL_DESIGN.md", "UI_UX_SPEC.md", "CONTROLS_CAMERA_SPEC.md"].filter((fileName) => docsByName.has(fileName)),
      notes: gameplayNotes,
    },
    ...levelNames.map((levelName, index) => ({
      name: levelName,
      kind: "level" as const,
      rootObjects: ["LevelRoot", "SpawnPoints", "EncounterRoot", "EnvironmentRoot"],
      sourceDocs: ["ENEMY_ROSTER.md", "DIFFICULTY_CURVE.md", "PRODUCTION_PLAN.md"].filter((fileName) => docsByName.has(fileName)),
      notes: `Derived from the biome and progression targets for level ${index + 1}.`,
    })),
  ];

  const evidence: string[] = [];
  if (uiDoc.includes("Main menu")) {
    evidence.push("UI_UX_SPEC.md defines the main menu surface.");
  }
  if (/pause|settings/i.test(uiDoc) || /remapp|accessibility/i.test(controlsDoc)) {
    evidence.push("UI_UX_SPEC.md and CONTROLS_CAMERA_SPEC.md require settings/pause coverage.");
  }
  if (/hud/i.test(uiDoc)) {
    evidence.push("UI_UX_SPEC.md calls for an in-game HUD.");
  }
  if (techDoc.length > 0) {
    evidence.push("TECHNICAL_DESIGN.md describes the runtime systems to attach to the gameplay shell.");
  }
  if (productionDoc.length > 0) {
    evidence.push("PRODUCTION_PLAN.md keeps the shell aligned to milestone-based delivery.");
  }

  return {
    generatedAt: new Date().toISOString(),
    docsUsed,
    artDirection: {
      visualPillars,
      palette,
      uiStyle,
      silhouetteRules,
      environmentStyle,
    },
    audioPlan: {
      musicDirection,
      sfxTaxonomy,
      priorityScenes,
      loudnessStandard: "-16 LUFS integrated with clear UI peaks",
    },
    loreProfile: {
      worldRules,
      factions,
      characterAnchors,
      namingConventions,
    },
    technicalProfile: {
      runtimeSystems,
      projectStructure,
      buildPipeline,
      performanceTargets,
    },
    productionPlan: {
      milestones,
      backlog,
      risks,
      owners,
    },
    settingsProfile: {
      defaultFullscreen: true,
      defaultMasterVolume: 0.85,
      defaultInputProfile: input.spec.controls,
      accessibilityOptions: ["remapping", "sensitivity", "camera-comfort", "subtitle-visibility"],
      qualityPreset: input.spec.scopeTier === "mini-vertical-slice" ? "Low" : input.spec.scopeTier === "small-prototype" ? "Medium" : "High",
    },
    menuLayout: {
      primaryButtons: ["Play", "Settings", "Quit"],
      secondaryPanels: menuPanels,
      footerItems,
    },
    hudLayout: {
      anchors: ["TopLeft", "TopRight", "BottomLeft", "BottomRight", "CenterBottom"],
      widgets: hudWidgets,
    },
    enemyLayout: {
      roles: enemyRoles,
      families: enemyFamilies,
      sourceDocs: enemyRosterDoc.length > 0 ? ["ENEMY_ROSTER.md", "DIFFICULTY_CURVE.md", "ART_BIBLE.md"] : ["DIFFICULTY_CURVE.md"],
    },
    encounterWire: {
      spawnRules,
      compositionTemplates,
      bossHooks,
      sourceDocs: ["ENEMY_ROSTER.md", "DIFFICULTY_CURVE.md", "PRODUCTION_PLAN.md"].filter((fileName) => docsByName.has(fileName)),
    },
    screens,
    levelManifest: levelNames.map((levelName, index) => ({
      levelId: `level_${String(index + 1).padStart(2, "0")}`,
      sceneName: levelName,
      displayName: `Biome ${index + 1}`,
      biomeIndex: index + 1,
      sourceDocs: ["ENEMY_ROSTER.md", "DIFFICULTY_CURVE.md", "PRODUCTION_PLAN.md"].filter((fileName) => docsByName.has(fileName)),
    })),
    scenes,
    levelNames,
    flow: {
      splashToMenu: true,
      menuToSettings: true,
      menuToGameplay: true,
      gameplayToLevels: levelNames.length > 1,
      gameplayHasPauseOverlay: true,
    },
    evidence,
  };
}

function buildGameCreatorShellRuntimeScripts(shellPlan: GameCreatorUnityShellPlan): Array<{ relativePath: string; content: string }> {
  const levelHints = shellPlan.levelNames.length > 0 ? shellPlan.levelNames.join(", ") : "Level01, Level02";
  return [
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/ArtStyleGuide.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class ArtStyleGuide : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] visualPillars = new[] { " + shellPlan.artDirection.visualPillars.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] palette = new[] { " + shellPlan.artDirection.palette.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] uiStyle = new[] { " + shellPlan.artDirection.uiStyle.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] silhouetteRules = new[] { " + shellPlan.artDirection.silhouetteRules.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] environmentStyle = new[] { " + shellPlan.artDirection.environmentStyle.map((value) => `\"${value}\"`).join(", ") + " };",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/AudioCueCatalog.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class AudioCueCatalog : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] musicDirection = new[] { " + shellPlan.audioPlan.musicDirection.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] sfxTaxonomy = new[] { " + shellPlan.audioPlan.sfxTaxonomy.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] priorityScenes = new[] { " + shellPlan.audioPlan.priorityScenes.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string loudnessStandard = \"" + shellPlan.audioPlan.loudnessStandard.replace(/"/g, '\\"') + "\";",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/LoreCatalog.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class LoreCatalog : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] worldRules = new[] { " + shellPlan.loreProfile.worldRules.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] factions = new[] { " + shellPlan.loreProfile.factions.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] characterAnchors = new[] { " + shellPlan.loreProfile.characterAnchors.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] namingConventions = new[] { " + shellPlan.loreProfile.namingConventions.map((value) => `\"${value}\"`).join(", ") + " };",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/TechnicalRuntimeProfile.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class TechnicalRuntimeProfile : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] runtimeSystems = new[] { " + shellPlan.technicalProfile.runtimeSystems.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] projectStructure = new[] { " + shellPlan.technicalProfile.projectStructure.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] buildPipeline = new[] { " + shellPlan.technicalProfile.buildPipeline.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] performanceTargets = new[] { " + shellPlan.technicalProfile.performanceTargets.map((value) => `\"${value}\"`).join(", ") + " };",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/ProductionMilestones.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class ProductionMilestones : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] milestones = new[] { " + shellPlan.productionPlan.milestones.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] backlog = new[] { " + shellPlan.productionPlan.backlog.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] risks = new[] { " + shellPlan.productionPlan.risks.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] owners = new[] { " + shellPlan.productionPlan.owners.map((value) => `\"${value}\"`).join(", ") + " };",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/EncounterWiringProfile.cs",
      content: [
        "using System;",
        "using System.Collections.Generic;",
        "using UnityEngine;",
        "",
        "[Serializable]",
        "public class EncounterTemplateDefinition",
        "{",
        "    public string templateId;",
        "    public string role;",
        "    public int baseEnemyCount;",
        "}",
        "",
        "public class EncounterWiringProfile : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] spawnRules = new[] { " + shellPlan.encounterWire.spawnRules.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] compositionTemplates = new[] { " + shellPlan.encounterWire.compositionTemplates.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string[] bossHooks = new[] { " + shellPlan.encounterWire.bossHooks.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private EncounterTemplateDefinition[] runtimeTemplates = new[] {",
        shellPlan.encounterWire.compositionTemplates.map((template, index) => `        new EncounterTemplateDefinition { templateId = "${template}", role = "${shellPlan.enemyLayout.roles[index % Math.max(1, shellPlan.enemyLayout.roles.length)] ?? "ranged"}", baseEnemyCount = ${2 + index} },`).join("\n"),
        "    };",
        "",
        "    public IReadOnlyList<EncounterTemplateDefinition> BuildTemplatesForLevel(int levelIndex)",
        "    {",
        "        if (runtimeTemplates == null || runtimeTemplates.Length == 0)",
        "        {",
        "            return Array.Empty<EncounterTemplateDefinition>();",
        "        }",
        "",
        "        var count = Mathf.Clamp(1 + levelIndex, 1, runtimeTemplates.Length);",
        "        var selected = new List<EncounterTemplateDefinition>(count);",
        "        for (var i = 0; i < count; i++)",
        "        {",
        "            selected.Add(runtimeTemplates[i]);",
        "        }",
        "",
        "        return selected;",
        "    }",
        "",
        "    public string ResolveSpawnRule(int levelIndex)",
        "    {",
        "        if (spawnRules == null || spawnRules.Length == 0)",
        "        {",
        "            return \"Default spawn pacing\";",
        "        }",
        "",
        "        return spawnRules[Mathf.Abs(levelIndex) % spawnRules.Length];",
        "    }",
        "",
        "    public string ResolveBossHook(int levelIndex)",
        "    {",
        "        if (bossHooks == null || bossHooks.Length == 0)",
        "        {",
        "            return \"No explicit boss hook\";",
        "        }",
        "",
        "        return bossHooks[Mathf.Abs(levelIndex) % bossHooks.Length];",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/EncounterRuntimeDirector.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class EncounterRuntimeDirector : MonoBehaviour",
        "{",
        "    [SerializeField] public Transform[] spawnPoints;",
        "    [SerializeField] public GameObject[] enemyPrefabs;",
        "    [SerializeField] public EncounterWiringProfile profile;",
        "    [SerializeField] public EnemyBehaviorCatalog behaviorCatalog;",
        "    [SerializeField] public int levelIndex;",
        "",
        "    private bool hasSpawnedInitialWave;",
        "",
        "    private void Start()",
        "    {",
        "        if (profile == null)",
        "        {",
        "            profile = GetComponent<EncounterWiringProfile>();",
        "        }",
        "        if (behaviorCatalog == null)",
        "        {",
        "            behaviorCatalog = GetComponent<EnemyBehaviorCatalog>();",
        "        }",
        "",
        "        SpawnInitialWaveFromPlan();",
        "    }",
        "",
        "    public void SpawnInitialWaveFromPlan()",
        "    {",
        "        if (hasSpawnedInitialWave)",
        "        {",
        "            return;",
        "        }",
        "        if (profile == null || spawnPoints == null || spawnPoints.Length == 0 || enemyPrefabs == null || enemyPrefabs.Length == 0)",
        "        {",
        "            Debug.Log(\"[NexusGenerated] EncounterRuntimeDirector missing references; skipping spawn.\");",
        "            return;",
        "        }",
        "",
        "        var templates = profile.BuildTemplatesForLevel(levelIndex);",
        "        var spawnRule = profile.ResolveSpawnRule(levelIndex);",
        "        var bossHook = profile.ResolveBossHook(levelIndex);",
        "",
        "        var spawnBudget = 0;",
        "        for (var t = 0; t < templates.Count; t++)",
        "        {",
        "            spawnBudget += Mathf.Max(1, templates[t].baseEnemyCount);",
        "        }",
        "",
        "        spawnBudget = Mathf.Max(1, Mathf.Min(spawnBudget, spawnPoints.Length * 2));",
        "        for (var i = 0; i < spawnBudget; i++)",
        "        {",
        "            var spawnPoint = spawnPoints[i % spawnPoints.Length];",
        "            var prefab = enemyPrefabs[i % enemyPrefabs.Length];",
        "            if (spawnPoint != null && prefab != null)",
        "            {",
        "                Instantiate(prefab, spawnPoint.position, spawnPoint.rotation);",
        "            }",
        "        }",
        "",
        "        hasSpawnedInitialWave = true;",
        "        Debug.Log($\"[NexusGenerated] Encounter spawned using rule '{spawnRule}' with hook '{bossHook}'.\");",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/SceneAudioBootstrap.cs",
      content: [
        "using System;",
        "using UnityEngine;",
        "using UnityEngine.SceneManagement;",
        "",
        "[Serializable]",
        "public class SceneCueBinding",
        "{",
        "    public string sceneName;",
        "    public string musicCue;",
        "    public string ambienceCue;",
        "    public string uiCue;",
        "}",
        "",
        "public class SceneAudioBootstrap : MonoBehaviour",
        "{",
        "    [SerializeField] private string loudnessStandard = \"" + shellPlan.audioPlan.loudnessStandard.replace(/"/g, '\\"') + "\";",
        "    [SerializeField] private string[] sfxTaxonomy = new[] { " + shellPlan.audioPlan.sfxTaxonomy.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private SceneCueBinding[] sceneCues = new[] {",
        shellPlan.audioPlan.priorityScenes.map((scene, index) => `        new SceneCueBinding { sceneName = "${scene}", musicCue = "music_${index + 1}", ambienceCue = "ambience_${index + 1}", uiCue = "UI" },`).join("\n"),
        "    };",
        "",
        "    private string activeSceneName;",
        "",
        "    private void OnEnable()",
        "    {",
        "        SceneManager.sceneLoaded += HandleSceneLoaded;",
        "        HandleSceneLoaded(SceneManager.GetActiveScene(), LoadSceneMode.Single);",
        "    }",
        "",
        "    private void OnDisable()",
        "    {",
        "        SceneManager.sceneLoaded -= HandleSceneLoaded;",
        "    }",
        "",
        "    public void PlayUiCue(string cueName)",
        "    {",
        "        var cue = ResolveCue(activeSceneName);",
        "        var resolvedCue = string.IsNullOrWhiteSpace(cueName) ? cue.uiCue : cueName;",
        "        Debug.Log($\"[NexusGenerated] UI cue '{resolvedCue}' fired in scene '{activeSceneName}'.\");",
        "    }",
        "",
        "    private void HandleSceneLoaded(Scene scene, LoadSceneMode mode)",
        "    {",
        "        activeSceneName = scene.name;",
        "        var cue = ResolveCue(activeSceneName);",
        "        Debug.Log($\"[NexusGenerated] Audio bootstrap for '{activeSceneName}' -> music:{cue.musicCue}, ambience:{cue.ambienceCue}, LUFS:{loudnessStandard}.\");",
        "    }",
        "",
        "    private SceneCueBinding ResolveCue(string sceneName)",
        "    {",
        "        if (sceneCues != null)",
        "        {",
        "            for (var i = 0; i < sceneCues.Length; i++)",
        "            {",
        "                var candidate = sceneCues[i];",
        "                if (candidate != null && string.Equals(candidate.sceneName, sceneName, StringComparison.OrdinalIgnoreCase))",
        "                {",
        "                    return candidate;",
        "                }",
        "            }",
        "        }",
        "",
        "        return new SceneCueBinding { sceneName = sceneName, musicCue = \"music_default\", ambienceCue = \"ambience_default\", uiCue = \"UI\" };",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/UiAudioTrigger.cs",
      content: [
        "using UnityEngine;",
        "using UnityEngine.UI;",
        "",
        "[RequireComponent(typeof(Button))]",
        "public class UiAudioTrigger : MonoBehaviour",
        "{",
        "    [SerializeField] private string cueName = \"UI\";",
        "",
        "    private void Awake()",
        "    {",
        "        var button = GetComponent<Button>();",
        "        button.onClick.AddListener(TriggerCue);",
        "    }",
        "",
        "    public void SetCue(string cue)",
        "    {",
        "        cueName = string.IsNullOrWhiteSpace(cue) ? \"UI\" : cue;",
        "    }",
        "",
        "    private void TriggerCue()",
        "    {",
        "        var bootstrap = FindFirstObjectByType<SceneAudioBootstrap>();",
        "        if (bootstrap != null)",
        "        {",
        "            bootstrap.PlayUiCue(cueName);",
        "        }",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/EnemyBehaviorCatalog.cs",
      content: [
        "using System;",
        "using UnityEngine;",
        "",
        "[Serializable]",
        "public class EnemyBehaviorRule",
        "{",
        "    public string role;",
        "    public float aggression;",
        "    public float chaseRange;",
        "    public float retreatHealthThreshold;",
        "}",
        "",
        "public class EnemyBehaviorCatalog : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] enemyFamilies = new[] { " + shellPlan.enemyLayout.families.map((family) => `\"${family}\"`).join(", ") + " };",
        "    [SerializeField] private string[] enemyRoles = new[] { " + shellPlan.enemyLayout.roles.map((role) => `\"${role}\"`).join(", ") + " };",
        "    [SerializeField] private EnemyBehaviorRule[] rules = new[] {",
        shellPlan.enemyLayout.roles.map((role, index) => `        new EnemyBehaviorRule { role = \"${role}\", aggression = ${Math.max(0.35, 0.55 + index * 0.08).toFixed(2)}f, chaseRange = ${Math.max(4.0, 6.0 + index * 0.75).toFixed(2)}f, retreatHealthThreshold = ${Math.max(0.2, 0.35 - index * 0.05).toFixed(2)}f },`).join("\n"),
        "    };",
        "",
        "    public EnemyBehaviorRule GetRuleForRole(string role)",
        "    {",
        "        foreach (var rule in rules)",
        "        {",
        "            if (string.Equals(rule.role, role, StringComparison.OrdinalIgnoreCase))",
        "            {",
        "                return rule;",
        "            }",
        "        }",
        "",
        "        return rules != null && rules.Length > 0 ? rules[0] : new EnemyBehaviorRule();",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/MenuLayoutController.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class MenuLayoutController : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] primaryButtons = new[] { " + shellPlan.menuLayout.primaryButtons.map((button) => `\"${button}\"`).join(", ") + " };",
        "    [SerializeField] private string[] secondaryPanels = new[] { " + shellPlan.menuLayout.secondaryPanels.map((panel) => `\"${panel}\"`).join(", ") + " };",
        "    [SerializeField] private string[] footerItems = new[] { " + shellPlan.menuLayout.footerItems.map((item) => `\"${item}\"`).join(", ") + " };",
        "",
        "    public string[] PrimaryButtons => primaryButtons;",
        "    public string[] SecondaryPanels => secondaryPanels;",
        "    public string[] FooterItems => footerItems;",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/HudLayoutController.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class HudLayoutController : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] anchors = new[] { " + shellPlan.hudLayout.anchors.map((anchor) => `\"${anchor}\"`).join(", ") + " };",
        "    [SerializeField] private string[] widgets = new[] { " + shellPlan.hudLayout.widgets.map((widget) => `\"${widget}\"`).join(", ") + " };",
        "",
        "    public string[] Anchors => anchors;",
        "    public string[] Widgets => widgets;",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/EnvironmentStyleProfile.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class EnvironmentStyleProfile : MonoBehaviour",
        "{",
        "    [SerializeField] private string[] styleRules = new[] { " + shellPlan.artDirection.environmentStyle.map((value) => `\"${value}\"`).join(", ") + " };",
        "    [SerializeField] private string activeProfile = \"Generated\";",
        "",
        "    public string[] StyleRules => styleRules;",
        "    public string ActiveProfile => activeProfile;",
        "",
        "    public void ApplyStyleText(string styleText, int levelIndex)",
        "    {",
        "        activeProfile = string.IsNullOrWhiteSpace(styleText) ? $\"Generated Level {levelIndex + 1}\" : $\"Level {levelIndex + 1}: {styleText}\";",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/GameSettingsProfile.cs",
      content: [
        "using UnityEngine;",
        "",
        "public static class GameSettingsProfile",
        "{",
        "    private const string FullscreenKey = \"nexus.fullscreen\";",
        "    private const string ResolutionKey = \"nexus.resolution\";",
        "    private const string MasterVolumeKey = \"nexus.masterVolume\";",
        "    private const string MusicVolumeKey = \"nexus.musicVolume\";",
        "    private const string SfxVolumeKey = \"nexus.sfxVolume\";",
        "    private const string InputProfileKey = \"nexus.inputProfile\";",
        "    private const string CameraComfortKey = \"nexus.cameraComfort\";",
        "",
        "    public static void Save(bool fullscreen, string resolutionLabel, float masterVolume, float musicVolume, float sfxVolume, string inputProfile, float cameraComfort)",
        "    {",
        "        PlayerPrefs.SetInt(FullscreenKey, fullscreen ? 1 : 0);",
        "        PlayerPrefs.SetString(ResolutionKey, string.IsNullOrWhiteSpace(resolutionLabel) ? \"1920x1080\" : resolutionLabel);",
        "        PlayerPrefs.SetFloat(MasterVolumeKey, Mathf.Clamp01(masterVolume));",
        "        PlayerPrefs.SetFloat(MusicVolumeKey, Mathf.Clamp01(musicVolume));",
        "        PlayerPrefs.SetFloat(SfxVolumeKey, Mathf.Clamp01(sfxVolume));",
        "        PlayerPrefs.SetString(InputProfileKey, string.IsNullOrWhiteSpace(inputProfile) ? \"keyboard-mouse\" : inputProfile);",
        "        PlayerPrefs.SetFloat(CameraComfortKey, Mathf.Clamp01(cameraComfort));",
        "        PlayerPrefs.Save();",
        "    }",
        "",
        "    public static void Load(out bool fullscreen, out string resolutionLabel, out float masterVolume, out float musicVolume, out float sfxVolume, out string inputProfile, out float cameraComfort)",
        "    {",
        "        fullscreen = PlayerPrefs.GetInt(FullscreenKey, 1) == 1;",
        "        resolutionLabel = PlayerPrefs.GetString(ResolutionKey, \"1920x1080\");",
        "        masterVolume = PlayerPrefs.GetFloat(MasterVolumeKey, 0.85f);",
        "        musicVolume = PlayerPrefs.GetFloat(MusicVolumeKey, 0.8f);",
        "        sfxVolume = PlayerPrefs.GetFloat(SfxVolumeKey, 0.85f);",
        "        inputProfile = PlayerPrefs.GetString(InputProfileKey, \"keyboard-mouse\");",
        "        cameraComfort = PlayerPrefs.GetFloat(CameraComfortKey, 0.5f);",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/GameFlowBootstrap.cs",
      content: [
        "using UnityEngine;",
        "using UnityEngine.SceneManagement;",
        "",
        "public class GameFlowBootstrap : MonoBehaviour",
        "{",
        "    [SerializeField] private string splashSceneName = \"Splash\";",
        "    [SerializeField] private string mainMenuSceneName = \"MainMenu\";",
        "    [SerializeField] private string settingsSceneName = \"Settings\";",
        "    [SerializeField] private string gameplaySceneName = \"Gameplay\";",
        "    [SerializeField] private string[] levelSceneNames = new[] { " + shellPlan.levelNames.map((levelName) => `\"${levelName}\"`).join(", ") + " };",
        "",
        "    private void Awake()",
        "    {",
        "        DontDestroyOnLoad(gameObject);",
        "    }",
        "",
        "    public void GoToSplash() => SceneManager.LoadScene(splashSceneName);",
        "    public void GoToMainMenu() => SceneManager.LoadScene(mainMenuSceneName);",
        "    public void GoToSettings() => SceneManager.LoadScene(settingsSceneName);",
        "    public void GoToGameplay() => SceneManager.LoadScene(gameplaySceneName);",
        "    public void GoToLevel(int index)",
        "    {",
        "        if (levelSceneNames == null || levelSceneNames.Length == 0)",
        "        {",
        "            SceneManager.LoadScene(gameplaySceneName);",
        "            return;",
        "        }",
        "",
        "        var safeIndex = Mathf.Clamp(index, 0, levelSceneNames.Length - 1);",
        "        SceneManager.LoadScene(levelSceneNames[safeIndex]);",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/LevelManifest.cs",
      content: [
        "using System;",
        "using UnityEngine;",
        "",
        "[Serializable]",
        "public class GameCreatorLevelManifest",
        "{",
        "    public LevelEntry[] levels;",
        "}",
        "",
        "[Serializable]",
        "public class LevelEntry",
        "{",
        "    public string levelId;",
        "    public string sceneName;",
        "    public string displayName;",
        "    public int biomeIndex;",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/SplashController.cs",
      content: [
        "using UnityEngine;",
        "using UnityEngine.SceneManagement;",
        "",
        "public class SplashController : MonoBehaviour",
        "{",
        "    [SerializeField] private float delaySeconds = 2f;",
        "    private GameFlowBootstrap bootstrap;",
        "",
        "    private void Start()",
        "    {",
        "        bootstrap = FindFirstObjectByType<GameFlowBootstrap>();",
        "        Invoke(nameof(GoNext), delaySeconds);",
        "    }",
        "",
        "    private void GoNext()",
        "    {",
        "        if (bootstrap != null)",
        "        {",
        "            bootstrap.GoToMainMenu();",
        "            return;",
        "        }",
        "",
        "        SceneManager.LoadScene(\"MainMenu\");",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/SettingsController.cs",
      content: [
        "using UnityEngine;",
        "",
        "public class SettingsController : MonoBehaviour",
        "{",
        "    [SerializeField] private bool fullscreen = true;",
        "    [SerializeField] private string resolutionLabel = \"1920x1080\";",
        "    [SerializeField] private float masterVolume = 0.85f;",
        "    [SerializeField] private float musicVolume = 0.8f;",
        "    [SerializeField] private float sfxVolume = 0.85f;",
        "    [SerializeField] private string inputProfile = \"keyboard-mouse\";",
        "    [SerializeField] private float cameraComfort = 0.5f;",
        "",
        "    private void OnEnable()",
        "    {",
        "        GameSettingsProfile.Load(out fullscreen, out resolutionLabel, out masterVolume, out musicVolume, out sfxVolume, out inputProfile, out cameraComfort);",
        "    }",
        "",
        "    public void Apply()",
        "    {",
        "        GameSettingsProfile.Save(fullscreen, resolutionLabel, masterVolume, musicVolume, sfxVolume, inputProfile, cameraComfort);",
        "        Debug.Log(\"Settings saved\");",
        "    }",
        "",
        "    public void ResetToDefaults()",
        "    {",
        "        fullscreen = true;",
        "        resolutionLabel = \"1920x1080\";",
        "        masterVolume = 0.85f;",
        "        musicVolume = 0.8f;",
        "        sfxVolume = 0.85f;",
        "        inputProfile = \"keyboard-mouse\";",
        "        cameraComfort = 0.5f;",
        "    }",
        "",
        "    public void BackToMenu()",
        "    {",
        "        Apply();",
        "        var bootstrap = FindFirstObjectByType<GameFlowBootstrap>();",
        "        if (bootstrap != null)",
        "        {",
        "            bootstrap.GoToMainMenu();",
        "            return;",
        "        }",
        "",
        "        UnityEngine.SceneManagement.SceneManager.LoadScene(\"MainMenu\");",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/PauseMenuController.cs",
      content: [
        "using UnityEngine;",
        "using UnityEngine.SceneManagement;",
        "",
        "public class PauseMenuController : MonoBehaviour",
        "{",
        "    private GameFlowBootstrap bootstrap;",
        "",
        "    private void Awake()",
        "    {",
        "        bootstrap = FindFirstObjectByType<GameFlowBootstrap>();",
        "    }",
        "",
        "    public void Resume()",
        "    {",
        "        Time.timeScale = 1f;",
        "    }",
        "",
        "    public void Pause()",
        "    {",
        "        Time.timeScale = 0f;",
        "    }",
        "",
        "    public void BackToMenu()",
        "    {",
        "        Time.timeScale = 1f;",
        "        if (bootstrap != null)",
        "        {",
        "            bootstrap.GoToMainMenu();",
        "            return;",
        "        }",
        "",
        "        SceneManager.LoadScene(\"MainMenu\");",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Assets/Scripts/GameCreator/Shell/LevelFlowController.cs",
      content: [
        "using UnityEngine;",
        "using UnityEngine.SceneManagement;",
        "",
        "public class LevelFlowController : MonoBehaviour",
        "{",
        "    [TextArea] public string levelHints = \"" + levelHints.replace(/"/g, '\\"') + "\";",
        "    public string[] levelNames = new[] { " + shellPlan.levelNames.map((levelName) => `\"${levelName}\"`).join(", ") + " };",
        "    private int currentLevelIndex;",
        "",
        "    public void LoadNextLevel()",
        "    {",
        "        if (levelNames == null || levelNames.Length == 0)",
        "        {",
        "            return;",
        "        }",
        "",
        "        currentLevelIndex = Mathf.Clamp(currentLevelIndex + 1, 0, levelNames.Length - 1);",
        "        SceneManager.LoadScene(levelNames[currentLevelIndex]);",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
  ];
}

function buildUnityProjectVersionText(): string {
  return ["m_EditorVersion: 2022.3.0f1", "m_EditorVersionWithRevision: 2022.3.0f1 (placeholder)", ""].join("\n");
}

function buildUnityPackagesManifest(): string {
  return JSON.stringify({
    dependencies: {
      "com.unity.textmeshpro": "3.0.6",
    },
  }, null, 2);
}

function buildGameCreatorAutomationScript(): string {
  return [
    "using System;",
    "using System.Collections.Generic;",
    "using System.IO;",
    "using System.Linq;",
    "using UnityEditor;",
    "using UnityEditor.Animations;",
    "using UnityEditor.SceneManagement;",
    "using UnityEngine;",
    "using UnityEngine.UI;",
    "using UnityEngine.SceneManagement;",
    "",
    "namespace NexusGenerated",
    "{",
    "    [Serializable]",
    "    public class GameCreatorPlan",
    "    {",
    "        public string generatedAt;",
    "        public string workspacePath;",
    "        public string unityProjectPath;",
    "        public string gate4RootRelativePath;",
    "        public string methodName;",
    "        public string logRelativePath;",
    "        public GameCreatorSpec spec;",
    "        public GameCreatorShellPlan shell;",
    "        public Gate4Payload gate4;",
    "    }",
    "",
    "    [Serializable]",
    "    public class GameCreatorSpec",
    "    {",
    "        public string target;",
    "        public string genre;",
    "        public string perspective;",
    "        public string scopeTier;",
    "        public string artStyle;",
    "        public string controls;",
    "        public string coreLoopPriority;",
    "        public string difficultyTarget;",
    "        public int enemyFamilies;",
    "        public int biomes;",
    "        public int bosses;",
    "    }",
    "",
    "    [Serializable]",
    "    public class Gate4Payload",
    "    {",
    "        public object assetManifest;",
    "        public object importPackage;",
    "        public object prefabWiringManifest;",
    "        public object spawnTables;",
    "        public object animationStateMap;",
    "        public object postImportReadiness;",
    "        public EnemyFamilyPayload[] enemyFamilies;",
    "    }",
    "",
    "    [Serializable]",
    "    public class GameCreatorShellPlan",
    "    {",
    "        public string[] docsUsed;",
    "        public ArtDirectionPlan artDirection;",
    "        public MenuLayoutPlan menuLayout;",
    "        public HudLayoutPlan hudLayout;",
    "        public ShellScreen[] screens;",
    "        public ShellScene[] scenes;",
    "        public string[] levelNames;",
    "        public ShellFlow flow;",
    "        public string[] evidence;",
    "    }",
    "",
    "    [Serializable]",
    "    public class ArtDirectionPlan",
    "    {",
    "        public string[] visualPillars;",
    "        public string[] palette;",
    "        public string[] uiStyle;",
    "        public string[] silhouetteRules;",
    "        public string[] environmentStyle;",
    "    }",
    "",
    "    [Serializable]",
    "    public class MenuLayoutPlan",
    "    {",
    "        public string[] primaryButtons;",
    "        public string[] secondaryPanels;",
    "        public string[] footerItems;",
    "    }",
    "",
    "    [Serializable]",
    "    public class HudLayoutPlan",
    "    {",
    "        public string[] anchors;",
    "        public string[] widgets;",
    "    }",
    "",
    "    [Serializable]",
    "    public class ShellScreen",
    "    {",
    "        public string id;",
    "        public string title;",
    "        public string[] sourceDocs;",
    "        public string notes;",
    "    }",
    "",
    "    [Serializable]",
    "    public class ShellScene",
    "    {",
    "        public string name;",
    "        public string kind;",
    "        public string[] rootObjects;",
    "        public string[] sourceDocs;",
    "        public string notes;",
    "    }",
    "",
    "    [Serializable]",
    "    public class ShellFlow",
    "    {",
    "        public bool splashToMenu;",
    "        public bool menuToSettings;",
    "        public bool menuToGameplay;",
    "        public bool gameplayToLevels;",
    "        public bool gameplayHasPauseOverlay;",
    "    }",
    "",
    "    [Serializable]",
    "    public class EnemyFamilyPayload",
    "    {",
    "        public string familyId;",
    "        public string displayName;",
    "        public string role;",
    "        public CombatPayload combat;",
    "        public string prefabPath;",
    "        public string animatorOverridePath;",
    "    }",
    "",
    "    [Serializable]",
    "    public class CombatPayload",
    "    {",
    "        public float moveSpeed;",
    "        public float maxHealth;",
    "        public float attackDamage;",
    "        public float attackRange;",
    "        public float attackCooldown;",
    "    }",
    "",
    "    [Serializable]",
    "    public class EnemyFamilyDefinition : ScriptableObject",
    "    {",
    "        public string familyId;",
    "        public string displayName;",
    "        public string role;",
    "        public float moveSpeed = 3f;",
    "        public float maxHealth = 100f;",
    "        public float attackDamage = 10f;",
    "        public float attackRange = 1.2f;",
    "        public float attackCooldown = 1f;",
    "    }",
    "",
    "    [Serializable]",
    "    public class GeneratedArtKit",
    "    {",
    "        public string playerMaterialPath;",
    "        public string enemyMaterialPath;",
    "        public string environmentMaterialPath;",
    "        public string uiMaterialPath;",
    "    }",
    "",
    "    [Serializable]",
    "    public class ReadinessCheck",
    "    {",
    "        public string id;",
    "        public bool passed;",
    "        public string details;",
    "    }",
    "",
    "    [Serializable]",
    "    public class ReadinessReport",
    "    {",
    "        public string generatedAt;",
    "        public float score;",
    "        public int passedChecks;",
    "        public int failedChecks;",
    "        public ReadinessCheck[] checks;",
    "    }",
    "",
    "    public static class GameCreatorAutomation",
    "    {",
    "        private static string ProjectRoot => Directory.GetParent(Application.dataPath)?.FullName ?? string.Empty;",
    "        private static string SpecPath => Path.Combine(ProjectRoot, \"ProjectSettings\", \"NexusGameSpec.json\");",
    "        private static string PlanPath => Path.Combine(ProjectRoot, \"Assets\", \"NexusGenerated\", \"GameCreatorImportPlan.json\");",
    "        private static string ShellPlanPath => Path.Combine(ProjectRoot, \"Assets\", \"NexusGenerated\", \"GameCreatorShellPlan.json\");",
    "",
    "        [MenuItem(\"Nexus/Generate Game Creator From Gate 4\")]",
    "        public static void GenerateFromGate4()",
    "        {",
    "            EnsureFolders();",
    "            var plan = LoadPlan();",
    "            var artKit = BuildArtStarterAssets(plan);",
    "            BuildScenes(plan, artKit);",
    "            BuildShellScenes(plan, artKit);",
    "            BuildPrefabs(plan, artKit);",
    "            BuildEnemyDataAssets(plan);",
    "            BuildAnimationAssets(plan);",
    "            var readiness = RunReadinessValidation(plan, artKit);",
    "            WriteValidationReport(plan, readiness);",
    "            AssetDatabase.SaveAssets();",
    "            AssetDatabase.Refresh();",
    "            Debug.Log(\"[NexusGenerated] Game Creator Gate 4 authoring complete.\");",
    "        }",
    "",
    "        [MenuItem(\"Nexus/Generate And Run Readiness Smoke\")]",
    "        public static void GenerateAndRunReadinessSmoke()",
    "        {",
    "            GenerateFromGate4();",
    "            var readinessPath = Path.Combine(ProjectRoot, \"Assets\", \"Generated\", \"game-creator-readiness-score.json\");",
    "            if (!File.Exists(readinessPath))",
    "            {",
    "                throw new Exception(\"Readiness score artifact missing after generation.\");",
    "            }",
    "",
    "            var raw = File.ReadAllText(readinessPath);",
    "            var readiness = JsonUtility.FromJson<ReadinessReport>(raw);",
    "            if (readiness == null)",
    "            {",
    "                throw new Exception(\"Readiness score artifact is invalid JSON.\");",
    "            }",
    "",
    "            if (readiness.failedChecks > 0 || readiness.score < 75f)",
    "            {",
    "                throw new Exception($\"Game Creator readiness smoke failed. Score={readiness.score:0.##}, failed={readiness.failedChecks}.\");",
    "            }",
    "",
    "            Debug.Log($\"[NexusGenerated] Readiness smoke passed with score {readiness.score:0.##}.\");",
    "        }",
    "",
    "        private static GameCreatorPlan LoadPlan()",
    "        {",
    "            if (!File.Exists(PlanPath))",
    "            {",
    "                throw new Exception(\"Game Creator import plan is missing.\");",
    "            }",
    "            var json = File.ReadAllText(PlanPath);",
    "            return JsonUtility.FromJson<GameCreatorPlan>(json) ?? throw new Exception(\"Game Creator import plan could not be parsed.\");",
    "        }",
    "",
    "        private static GameCreatorShellPlan LoadShellPlan()",
    "        {",
    "            if (!File.Exists(ShellPlanPath))",
    "            {",
    "                throw new Exception(\"Game Creator shell plan is missing.\");",
    "            }",
    "            var json = File.ReadAllText(ShellPlanPath);",
    "            return JsonUtility.FromJson<GameCreatorShellPlan>(json) ?? throw new Exception(\"Game Creator shell plan could not be parsed.\");",
    "        }",
    "",
    "        private static void BuildScenes(GameCreatorPlan plan, GeneratedArtKit artKit)",
    "        {",
    "            var mainMenuScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);",
    "            var menuRoot = new GameObject(\"MainMenuCanvas\");",
    "            menuRoot.AddComponent<Canvas>();",
    "            menuRoot.AddComponent<UnityEngine.UI.CanvasScaler>();",
    "            menuRoot.AddComponent<UnityEngine.UI.GraphicRaycaster>();",
    "            menuRoot.AddComponent<MainMenuController>();",
    "            menuRoot.AddComponent<MenuLayoutController>();",
    "            menuRoot.AddComponent<ArtStyleGuide>();",
    "            menuRoot.AddComponent<AudioCueCatalog>();",
    "            menuRoot.AddComponent<LoreCatalog>();",
    "            var persistentBootstrap = new GameObject(\"PersistentBootstrap\");",
    "            persistentBootstrap.AddComponent<GameManager>();",
    "            var flowBootstrap = persistentBootstrap.AddComponent<GameFlowBootstrap>();",
    "            persistentBootstrap.AddComponent<SceneAudioBootstrap>();",
    "            BuildMainMenuUi(menuRoot.transform, flowBootstrap, plan);",
    "            EditorSceneManager.SaveScene(mainMenuScene, \"Assets/Scenes/MainMenu.unity\");",
    "",
    "            var splashScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);",
    "            var splashRoot = new GameObject(\"SplashCanvas\");",
    "            splashRoot.AddComponent<Canvas>();",
    "            splashRoot.AddComponent<UnityEngine.UI.CanvasScaler>();",
    "            splashRoot.AddComponent<UnityEngine.UI.GraphicRaycaster>();",
    "            var splashController = splashRoot.AddComponent<SplashController>();",
    "            splashRoot.AddComponent<SceneAudioBootstrap>();",
    "            BuildSplashUi(splashRoot.transform, splashController, plan);",
    "            EditorSceneManager.SaveScene(splashScene, \"Assets/Scenes/Splash.unity\");",
    "",
    "            var gameplayScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);",
    "            var player = new GameObject(\"Player\");",
    "            player.tag = \"Player\";",
    "            player.AddComponent<CharacterController>();",
    "            player.AddComponent<Health>();",
    "            player.AddComponent<CombatSystem>();",
    "            player.AddComponent<PlayerController>();",
    "",
    "            var gameplaySystems = new GameObject(\"GameplaySystems\");",
    "            var encounter = gameplaySystems.AddComponent<EncounterDirector>();",
    "            gameplaySystems.AddComponent<GameplayLoopController>();",
    "            gameplaySystems.AddComponent<LevelFlowController>();",
    "            gameplaySystems.AddComponent<EnemyBehaviorCatalog>();",
    "            gameplaySystems.AddComponent<EncounterWiringProfile>();",
    "            var encounterRuntime = gameplaySystems.AddComponent<EncounterRuntimeDirector>();",
    "            gameplaySystems.AddComponent<SceneAudioBootstrap>();",
    "            gameplaySystems.AddComponent<TechnicalRuntimeProfile>();",
    "            gameplaySystems.AddComponent<ProductionMilestones>();",
    "",
    "            var hudCanvas = new GameObject(\"HudCanvas\");",
    "            hudCanvas.AddComponent<Canvas>();",
    "            hudCanvas.AddComponent<UnityEngine.UI.CanvasScaler>();",
    "            hudCanvas.AddComponent<UnityEngine.UI.GraphicRaycaster>();",
    "            hudCanvas.AddComponent<HudController>();",
    "            hudCanvas.AddComponent<HudLayoutController>();",
    "            hudCanvas.AddComponent<ArtStyleGuide>();",
    "            BuildHudUi(hudCanvas.transform, plan);",
    "",
    "            var pauseMenuCanvas = new GameObject(\"PauseMenuCanvas\");",
    "            pauseMenuCanvas.AddComponent<Canvas>();",
    "            pauseMenuCanvas.AddComponent<UnityEngine.UI.CanvasScaler>();",
    "            pauseMenuCanvas.AddComponent<UnityEngine.UI.GraphicRaycaster>();",
    "            var pauseController = pauseMenuCanvas.AddComponent<PauseMenuController>();",
    "            pauseMenuCanvas.AddComponent<AudioCueCatalog>();",
    "            BuildPauseUi(pauseMenuCanvas.transform, pauseController, plan);",
    "",
    "            var spawnA = new GameObject(\"SpawnPointAlpha\").transform;",
    "            var spawnB = new GameObject(\"SpawnPointBeta\").transform;",
    "            var spawnC = new GameObject(\"SpawnPointGamma\").transform;",
    "            encounter.spawnPoints = new[] { spawnA, spawnB, spawnC };",
    "            encounter.enemyPrefabs = BuildEnemyPrefabArray(plan, artKit);",
    "            encounterRuntime.spawnPoints = encounter.spawnPoints;",
    "            encounterRuntime.enemyPrefabs = encounter.enemyPrefabs;",
    "            encounterRuntime.profile = gameplaySystems.GetComponent<EncounterWiringProfile>();",
    "            encounterRuntime.behaviorCatalog = gameplaySystems.GetComponent<EnemyBehaviorCatalog>();",
    "",
    "            var environmentRoot = new GameObject(\"EnvironmentRoot\");",
    "            environmentRoot.AddComponent<EnvironmentStyleProfile>();",
    "            ApplyEnvironmentLayout(environmentRoot.transform, LoadMaterial(artKit.environmentMaterialPath), plan, 0);",
    "",
    "            EditorSceneManager.SaveScene(gameplayScene, \"Assets/Scenes/Gameplay.unity\");",
    "        }",
    "",
    "        private static void BuildMainMenuUi(Transform parent, GameFlowBootstrap bootstrap, GameCreatorPlan plan)",
    "        {",
    "            BuildMenuChrome(parent, plan);",
    "            CreateMenuButton(parent, \"PlayButton\", \"Play\", 0, () => bootstrap.GoToGameplay());",
    "            CreateMenuButton(parent, \"SettingsButton\", \"Settings\", 1, () => bootstrap.GoToSettings());",
    "            CreateMenuButton(parent, \"QuitButton\", \"Quit\", 2, Application.Quit);",
    "        }",
    "",
    "        private static void BuildSplashUi(Transform parent, SplashController controller, GameCreatorPlan plan)",
    "        {",
    "            CreateLabel(parent, \"SplashTitle\", \"Nexus Game Creator\", 0);",
    "            CreateMenuButton(parent, \"ContinueButton\", \"Continue\", 1, () => controller.SendMessage(\"GoNext\"));",
    "        }",
    "",
    "        private static void BuildSettingsUi(Transform parent, SettingsController controller, GameCreatorPlan plan)",
    "        {",
    "            CreateLabel(parent, \"SettingsTitle\", \"Settings\", 0);",
    "            CreateToggle(parent, \"FullscreenToggle\", \"Fullscreen\", 1, true, controller.Apply);",
    "            CreateDropdown(parent, \"ResolutionDropdown\", new[] { \"1280x720\", \"1600x900\", \"1920x1080\", \"2560x1440\" }, 2, 2, controller.Apply);",
    "            CreateSlider(parent, \"MasterVolumeSlider\", \"Master Volume\", 3, 0.85f, controller.Apply);",
    "            CreateSlider(parent, \"MusicVolumeSlider\", \"Music Volume\", 4, 0.8f, controller.Apply);",
    "            CreateSlider(parent, \"SfxVolumeSlider\", \"SFX Volume\", 5, 0.85f, controller.Apply);",
    "            CreateDropdown(parent, \"InputProfileDropdown\", new[] { \"keyboard-mouse\", \"controller\", \"both\" }, 6, 0, controller.Apply);",
    "            CreateSlider(parent, \"CameraComfortSlider\", \"Camera Comfort\", 7, 0.5f, controller.Apply);",
    "            CreateMenuButton(parent, \"ApplyButton\", \"Apply\", 8, () => controller.Apply());",
    "            CreateMenuButton(parent, \"BackButton\", \"Back\", 9, () => controller.SendMessage(\"BackToMenu\", SendMessageOptions.DontRequireReceiver));",
    "        }",
    "",
    "        private static void BuildPauseUi(Transform parent, PauseMenuController controller, GameCreatorPlan plan)",
    "        {",
    "            CreateMenuButton(parent, \"ResumeButton\", \"Resume\", 0, () => controller.Resume());",
    "            CreateMenuButton(parent, \"MenuButton\", \"Main Menu\", 1, () => controller.BackToMenu());",
    "        }",
    "",
    "        private static void BuildMenuChrome(Transform parent, GameCreatorPlan plan)",
    "        {",
    "            CreateLabel(parent, \"MenuTitle\", \"Nexus\", -1);",
    "            CreateLabel(parent, \"MenuBuildInfo\", string.Join(\" | \", plan.shell.menuLayout.footerItems), 3);",
    "        }",
    "",
    "        private static void BuildHudUi(Transform parent, GameCreatorPlan plan)",
    "        {",
    "            var widgets = plan.shell.hudLayout.widgets ?? Array.Empty<string>();",
    "            for (var index = 0; index < widgets.Length; index++)",
    "            {",
    "                CreateLabel(parent, \"HudWidget_\" + index, widgets[index], index);",
    "            }",
    "            CreateLabel(parent, \"HudAnchors\", string.Join(\", \", plan.shell.hudLayout.anchors), widgets.Length + 1);",
    "        }",
    "",
    "        private static void CreateLabel(Transform parent, string name, string text, int order)",
    "        {",
    "            var labelObject = new GameObject(name);",
    "            labelObject.transform.SetParent(parent, false);",
    "            var textComponent = labelObject.AddComponent<UnityEngine.UI.Text>();",
    "            textComponent.text = text;",
    "            textComponent.font = Resources.GetBuiltinResource<Font>(\"Arial.ttf\");",
    "            textComponent.alignment = TextAnchor.MiddleCenter;",
    "            labelObject.transform.localPosition = new Vector3(0f, 120f - (order * 40f), 0f);",
    "        }",
    "",
    "        private static Button CreateMenuButton(Transform parent, string name, string text, int order, UnityEngine.Events.UnityAction onClick, string cueName = null)",
    "        {",
    "            var buttonObject = new GameObject(name);",
    "            buttonObject.transform.SetParent(parent, false);",
    "            var rect = buttonObject.AddComponent<RectTransform>();",
    "            rect.sizeDelta = new Vector2(260f, 48f);",
    "            rect.anchoredPosition = new Vector2(0f, 40f - (order * 60f));",
    "            var image = buttonObject.AddComponent<UnityEngine.UI.Image>();",
    "            image.color = new Color(0.18f, 0.18f, 0.18f, 0.92f);",
    "            var button = buttonObject.AddComponent<Button>();",
    "            button.onClick.AddListener(onClick);",
    "            var audioTrigger = buttonObject.AddComponent<UiAudioTrigger>();",
    "            audioTrigger.SetCue(string.IsNullOrWhiteSpace(cueName) ? text : cueName);",
    "            var textObject = new GameObject(\"Label\");",
    "            textObject.transform.SetParent(buttonObject.transform, false);",
    "            var textComponent = textObject.AddComponent<UnityEngine.UI.Text>();",
    "            textComponent.text = text;",
    "            textComponent.font = Resources.GetBuiltinResource<Font>(\"Arial.ttf\");",
    "            textComponent.alignment = TextAnchor.MiddleCenter;",
    "            textComponent.color = Color.white;",
    "            var textRect = textObject.GetComponent<RectTransform>();",
    "            textRect.anchorMin = Vector2.zero;",
    "            textRect.anchorMax = Vector2.one;",
    "            textRect.offsetMin = Vector2.zero;",
    "            textRect.offsetMax = Vector2.zero;",
    "            return button;",
    "        }",
    "",
    "        private static Toggle CreateToggle(Transform parent, string name, string label, int order, bool value, UnityEngine.Events.UnityAction onChange)",
    "        {",
    "            var toggleObject = new GameObject(name);",
    "            toggleObject.transform.SetParent(parent, false);",
    "            var toggle = toggleObject.AddComponent<Toggle>();",
    "            toggle.isOn = value;",
    "            toggle.onValueChanged.AddListener(_ => onChange());",
    "            CreateLabel(toggleObject.transform, label + \"Value\", label, order);",
    "            return toggle;",
    "        }",
    "",
    "        private static Slider CreateSlider(Transform parent, string name, string label, int order, float value, UnityEngine.Events.UnityAction onChange)",
    "        {",
    "            var sliderObject = new GameObject(name);",
    "            sliderObject.transform.SetParent(parent, false);",
    "            var slider = sliderObject.AddComponent<Slider>();",
    "            slider.minValue = 0f;",
    "            slider.maxValue = 1f;",
    "            slider.value = value;",
    "            slider.onValueChanged.AddListener(_ => onChange());",
    "            CreateLabel(sliderObject.transform, label + \"Value\", label, order);",
    "            return slider;",
    "        }",
    "",
    "        private static Dropdown CreateDropdown(Transform parent, string name, string[] options, int order, int defaultIndex, UnityEngine.Events.UnityAction onChange)",
    "        {",
    "            var dropdownObject = new GameObject(name);",
    "            dropdownObject.transform.SetParent(parent, false);",
    "            var dropdown = dropdownObject.AddComponent<Dropdown>();",
    "            dropdown.options = options.Select(option => new Dropdown.OptionData(option)).ToList();",
    "            dropdown.value = Mathf.Clamp(defaultIndex, 0, Math.Max(0, dropdown.options.Count - 1));",
    "            dropdown.onValueChanged.AddListener(_ => onChange());",
    "            CreateLabel(dropdownObject.transform, name + \"Label\", name, order);",
    "            return dropdown;",
    "        }",
    "",
    "        private static void BuildShellScenes(GameCreatorPlan plan, GeneratedArtKit artKit)",
    "        {",
    "            if (plan.shell == null || plan.shell.scenes == null)",
    "            {",
    "                return;",
    "            }",
    "",
    "            foreach (var scene in plan.shell.scenes)",
    "            {",
    "                if (scene == null || string.IsNullOrWhiteSpace(scene.name))",
    "                {",
    "                    continue;",
    "                }",
    "",
    "                if (scene.kind == \"splash\" || scene.kind == \"menu\" || scene.kind == \"gameplay\")",
    "                {",
    "                    continue;",
    "                }",
    "",
    "                var unityScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);",
    "                foreach (var rootName in scene.rootObjects ?? Array.Empty<string>())",
    "                {",
    "                    var root = new GameObject(rootName);",
    "                    if (scene.kind == \"splash\" && rootName == \"SplashCanvas\")",
    "                    {",
    "                        root.AddComponent<Canvas>();",
    "                        root.AddComponent<UnityEngine.UI.CanvasScaler>();",
    "                        root.AddComponent<UnityEngine.UI.GraphicRaycaster>();",
    "                        var controller = root.AddComponent<SplashController>();",
    "                        BuildSplashUi(root.transform, controller, plan);",
    "                    }",
    "                    else if (scene.kind == \"settings\" && rootName == \"SettingsCanvas\")",
    "                    {",
    "                        root.AddComponent<Canvas>();",
    "                        root.AddComponent<UnityEngine.UI.CanvasScaler>();",
    "                        root.AddComponent<UnityEngine.UI.GraphicRaycaster>();",
    "                        root.AddComponent<SceneAudioBootstrap>();",
    "                        var controller = root.AddComponent<SettingsController>();",
    "                        BuildSettingsUi(root.transform, controller, plan);",
    "                    }",
    "                    else if (scene.kind == \"level\" && rootName == \"LevelRoot\")",
    "                    {",
    "                        root.AddComponent<LevelFlowController>();",
    "                        root.AddComponent<EncounterWiringProfile>();",
    "                        root.AddComponent<EnemyBehaviorCatalog>();",
    "                        root.AddComponent<EncounterRuntimeDirector>();",
    "                        root.AddComponent<SceneAudioBootstrap>();",
    "                        CreateLabel(root.transform, \"LevelTitle\", scene.name, 0);",
    "                    }",
    "                    else if (scene.kind == \"level\" && rootName == \"EnvironmentRoot\")",
    "                    {",
    "                        root.AddComponent<EnvironmentStyleProfile>();",
    "                        ApplyEnvironmentLayout(root.transform, LoadMaterial(artKit.environmentMaterialPath), plan, Array.IndexOf(plan.shell.levelNames ?? Array.Empty<string>(), scene.name));",
    "                    }",
    "                }",
    "",
    "                EditorSceneManager.SaveScene(unityScene, \"Assets/Scenes/\" + scene.name + \".unity\");",
    "            }",
    "        }",
    "",
    "        private static GeneratedArtKit BuildArtStarterAssets(GameCreatorPlan plan)",
    "        {",
    "            var folder = \"Assets/Art/Generated/Materials\";",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Art\", \"Generated\", \"Materials\"));",
    "            var palette = plan?.shell?.artDirection?.palette ?? Array.Empty<string>();",
    "            var playerColor = ResolvePaletteColor(palette, 0, new Color(0.22f, 0.68f, 0.96f, 1f));",
    "            var enemyColor = ResolvePaletteColor(palette, 1, new Color(0.88f, 0.33f, 0.33f, 1f));",
    "            var environmentColor = ResolvePaletteColor(palette, 2, new Color(0.46f, 0.66f, 0.42f, 1f));",
    "            var uiColor = ResolvePaletteColor(palette, 3, new Color(0.14f, 0.15f, 0.18f, 0.96f));",
    "",
    "            CreateOrUpdateMaterial($\"{folder}/PlayerPrimary.mat\", playerColor);",
    "            CreateOrUpdateMaterial($\"{folder}/EnemyPrimary.mat\", enemyColor);",
    "            CreateOrUpdateMaterial($\"{folder}/EnvironmentPrimary.mat\", environmentColor);",
    "            CreateOrUpdateMaterial($\"{folder}/UiPanel.mat\", uiColor);",
    "",
    "            return new GeneratedArtKit",
    "            {",
    "                playerMaterialPath = $\"{folder}/PlayerPrimary.mat\",",
    "                enemyMaterialPath = $\"{folder}/EnemyPrimary.mat\",",
    "                environmentMaterialPath = $\"{folder}/EnvironmentPrimary.mat\",",
    "                uiMaterialPath = $\"{folder}/UiPanel.mat\",",
    "            };",
    "        }",
    "",
    "        private static Material CreateOrUpdateMaterial(string assetPath, Color color)",
    "        {",
    "            var material = AssetDatabase.LoadAssetAtPath<Material>(assetPath);",
    "            if (material == null)",
    "            {",
    "                var shader = Shader.Find(\"Standard\") ?? Shader.Find(\"Sprites/Default\");",
    "                material = new Material(shader);",
    "                AssetDatabase.CreateAsset(material, assetPath);",
    "            }",
    "",
    "            material.color = color;",
    "            EditorUtility.SetDirty(material);",
    "            return material;",
    "        }",
    "",
    "        private static Material LoadMaterial(string assetPath)",
    "        {",
    "            return string.IsNullOrWhiteSpace(assetPath) ? null : AssetDatabase.LoadAssetAtPath<Material>(assetPath);",
    "        }",
    "",
    "        private static Color ResolvePaletteColor(string[] palette, int slot, Color fallback)",
    "        {",
    "            if (palette == null || palette.Length == 0)",
    "            {",
    "                return fallback;",
    "            }",
    "",
    "            var seed = palette[Mathf.Abs(slot) % palette.Length] ?? string.Empty;",
    "            if (string.IsNullOrWhiteSpace(seed))",
    "            {",
    "                return fallback;",
    "            }",
    "",
    "            unchecked",
    "            {",
    "                var hash = 17;",
    "                for (var i = 0; i < seed.Length; i++)",
    "                {",
    "                    hash = hash * 31 + seed[i];",
    "                }",
    "",
    "                var hue = Mathf.Repeat((Mathf.Abs(hash % 360) / 360f) + (slot * 0.08f), 1f);",
    "                var saturation = 0.48f + ((Mathf.Abs(hash) % 20) / 100f);",
    "                var value = 0.74f + ((Mathf.Abs(hash / 10) % 18) / 100f);",
    "                return Color.HSVToRGB(hue, Mathf.Clamp01(saturation), Mathf.Clamp01(value));",
    "            }",
    "        }",
    "",
    "        private static void ApplyVisualMesh(GameObject root, PrimitiveType primitiveType, Material material, Vector3 localScale, string childName)",
    "        {",
    "            var visual = GameObject.CreatePrimitive(primitiveType);",
    "            visual.name = childName;",
    "            visual.transform.SetParent(root.transform, false);",
    "            visual.transform.localScale = localScale;",
    "            var renderer = visual.GetComponent<Renderer>();",
    "            if (renderer != null && material != null)",
    "            {",
    "                renderer.sharedMaterial = material;",
    "            }",
    "            var collider = visual.GetComponent<Collider>();",
    "            if (collider != null)",
    "            {",
    "                UnityEngine.Object.DestroyImmediate(collider);",
    "            }",
    "        }",
    "",
    "        private static void ApplyEnvironmentLayout(Transform environmentRoot, Material material, GameCreatorPlan plan, int levelIndex)",
    "        {",
    "            if (environmentRoot == null)",
    "            {",
    "                return;",
    "            }",
    "",
    "            var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);",
    "            floor.name = \"EnvironmentFloor\";",
    "            floor.transform.SetParent(environmentRoot, false);",
    "            floor.transform.localScale = new Vector3(3.5f, 1f, 3.5f);",
    "            var floorRenderer = floor.GetComponent<Renderer>();",
    "            if (floorRenderer != null && material != null)",
    "            {",
    "                floorRenderer.sharedMaterial = material;",
    "            }",
    "",
    "            for (var i = 0; i < 4; i++)",
    "            {",
    "                var prop = GameObject.CreatePrimitive(i % 2 == 0 ? PrimitiveType.Cube : PrimitiveType.Cylinder);",
    "                prop.name = $\"EnvironmentProp_{i + 1}\";",
    "                prop.transform.SetParent(environmentRoot, false);",
    "                prop.transform.localPosition = new Vector3(-6f + (i * 4f), 0.75f, 4f - (i * 2f));",
    "                prop.transform.localScale = i % 2 == 0 ? new Vector3(1.5f, 1.5f + (0.2f * i), 1.5f) : new Vector3(1f, 2.25f, 1f);",
    "                var renderer = prop.GetComponent<Renderer>();",
    "                if (renderer != null && material != null)",
    "                {",
    "                    renderer.sharedMaterial = material;",
    "                }",
    "            }",
    "",
    "            var styleRules = plan != null && plan.shell != null && plan.shell.artDirection != null ? plan.shell.artDirection.environmentStyle : null;",
    "            var styleText = styleRules != null && styleRules.Length > 0 ? string.Join(\" | \", styleRules) : \"Generated environment baseline\";",
    "            var profile = environmentRoot.GetComponent<EnvironmentStyleProfile>();",
    "            if (profile != null)",
    "            {",
    "                profile.ApplyStyleText(styleText, Mathf.Max(0, levelIndex));",
    "            }",
    "        }",
    "",
    "        private static GameObject[] BuildEnemyPrefabArray(GameCreatorPlan plan, GeneratedArtKit artKit)",
    "        {",
    "            var prefabs = new List<GameObject>();",
    "            var enemyFolder = \"Assets/Prefabs/Enemies\";",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Prefabs\", \"Enemies\"));",
    "            foreach (var family in plan.gate4.enemyFamilies ?? Array.Empty<EnemyFamilyPayload>())",
    "            {",
    "                var prefab = new GameObject(family.displayName);",
    "                prefab.tag = \"Enemy\";",
    "                prefab.layer = LayerMask.NameToLayer(\"Enemy\");",
    "                prefab.AddComponent<Health>();",
    "                prefab.AddComponent<EnemyController>();",
    "                prefab.AddComponent(Type.GetType(family.familyId.Replace(\"_\", string.Empty).Substring(0, 1).ToUpper() + family.familyId.Replace(\"_\", string.Empty).Substring(1) + \"Controller, Assembly-CSharp\") ?? typeof(EnemyController));",
    "                ApplyVisualMesh(prefab, PrimitiveType.Capsule, LoadMaterial(artKit.enemyMaterialPath), new Vector3(1f, 2f, 1f), \"EnemyVisual\");",
    "                var prefabPath = Path.Combine(enemyFolder, family.familyId + \".prefab\").Replace('\\\\', '/');",
    "                PrefabUtility.SaveAsPrefabAsset(prefab, prefabPath);",
    "                UnityEngine.Object.DestroyImmediate(prefab);",
    "                prefabs.Add(AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath));",
    "            }",
    "            return prefabs.ToArray();",
    "        }",
    "",
    "        private static void BuildPrefabs(GameCreatorPlan plan, GeneratedArtKit artKit)",
    "        {",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Prefabs\"));",
    "            var player = new GameObject(\"Player\");",
    "            player.tag = \"Player\";",
    "            player.AddComponent<CharacterController>();",
    "            player.AddComponent<Health>();",
    "            player.AddComponent<CombatSystem>();",
    "            player.AddComponent<PlayerController>();",
    "            ApplyVisualMesh(player, PrimitiveType.Capsule, LoadMaterial(artKit.playerMaterialPath), new Vector3(1f, 2f, 1f), \"PlayerVisual\");",
    "            PrefabUtility.SaveAsPrefabAsset(player, \"Assets/Prefabs/Player.prefab\");",
    "            UnityEngine.Object.DestroyImmediate(player);",
    "",
    "            var enemyBase = new GameObject(\"EnemyBase\");",
    "            enemyBase.tag = \"Enemy\";",
    "            enemyBase.layer = LayerMask.NameToLayer(\"Enemy\");",
    "            enemyBase.AddComponent<Health>();",
    "            enemyBase.AddComponent<EnemyController>();",
    "            ApplyVisualMesh(enemyBase, PrimitiveType.Capsule, LoadMaterial(artKit.enemyMaterialPath), new Vector3(1f, 2f, 1f), \"EnemyBaseVisual\");",
    "            PrefabUtility.SaveAsPrefabAsset(enemyBase, \"Assets/Prefabs/EnemyBase.prefab\");",
    "            UnityEngine.Object.DestroyImmediate(enemyBase);",
    "",
    "            BuildEnvironmentPrefabs(plan, artKit);",
    "        }",
    "",
    "        private static void BuildEnvironmentPrefabs(GameCreatorPlan plan, GeneratedArtKit artKit)",
    "        {",
    "            var environmentFolder = \"Assets/Prefabs/Environment\";",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Prefabs\", \"Environment\"));",
    "            var environmentMaterial = LoadMaterial(artKit.environmentMaterialPath);",
    "",
    "            CreateEnvironmentPrefab(environmentFolder, \"EnvironmentBlock\", PrimitiveType.Cube, new Vector3(2f, 1f, 2f), environmentMaterial);",
    "            CreateEnvironmentPrefab(environmentFolder, \"EnvironmentPillar\", PrimitiveType.Cylinder, new Vector3(1.25f, 2.6f, 1.25f), environmentMaterial);",
    "            CreateEnvironmentPrefab(environmentFolder, \"EnvironmentPlatform\", PrimitiveType.Cube, new Vector3(3.2f, 0.5f, 3.2f), environmentMaterial);",
    "            CreateEnvironmentPrefab(environmentFolder, \"EnvironmentCover\", PrimitiveType.Cube, new Vector3(1.8f, 1.4f, 0.8f), environmentMaterial);",
    "        }",
    "",
    "        private static void CreateEnvironmentPrefab(string folder, string prefabName, PrimitiveType primitiveType, Vector3 scale, Material material)",
    "        {",
    "            var root = new GameObject(prefabName);",
    "            root.AddComponent<EnvironmentStyleProfile>();",
    "            ApplyVisualMesh(root, primitiveType, material, scale, prefabName + \"Visual\");",
    "            var prefabPath = Path.Combine(folder, prefabName + \".prefab\").Replace('\\\\', '/');",
    "            PrefabUtility.SaveAsPrefabAsset(root, prefabPath);",
    "            UnityEngine.Object.DestroyImmediate(root);",
    "        }",
    "",
    "        private static void BuildEnemyDataAssets(GameCreatorPlan plan)",
    "        {",
    "            var dataFolder = \"Assets/Generated/EnemyFamilies\";",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Generated\", \"EnemyFamilies\"));",
    "            foreach (var family in plan.gate4.enemyFamilies ?? Array.Empty<EnemyFamilyPayload>())",
    "            {",
    "                var asset = ScriptableObject.CreateInstance<EnemyFamilyDefinition>();",
    "                asset.familyId = family.familyId;",
    "                asset.displayName = family.displayName;",
    "                asset.role = family.role;",
    "                asset.moveSpeed = family.combat.moveSpeed;",
    "                asset.maxHealth = family.combat.maxHealth;",
    "                asset.attackDamage = family.combat.attackDamage;",
    "                asset.attackRange = family.combat.attackRange;",
    "                asset.attackCooldown = family.combat.attackCooldown;",
    "                AssetDatabase.CreateAsset(asset, $\"{dataFolder}/{family.familyId}.asset\");",
    "            }",
    "        }",
    "",
    "        private static void BuildAnimationAssets(GameCreatorPlan plan)",
    "        {",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Animation\", \"Controllers\"));",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Animation\", \"Clips\"));",
    "            var playerController = AnimatorController.CreateAnimatorControllerAtPath(\"Assets/Animation/Controllers/Player.controller\");",
    "            var enemyController = AnimatorController.CreateAnimatorControllerAtPath(\"Assets/Animation/Controllers/EnemyBase.controller\");",
    "            BuildClipSet(playerController, new[] { \"player_idle\", \"player_move\", \"player_attack_01\", \"player_hit\", \"player_death\" });",
    "            BuildClipSet(enemyController, new[] { \"enemy_idle\", \"enemy_move\", \"enemy_attack_01\", \"enemy_hit\", \"enemy_death\" });",
    "            foreach (var family in plan.gate4.enemyFamilies ?? Array.Empty<EnemyFamilyPayload>())",
    "            {",
    "                var overrideController = new AnimatorOverrideController(enemyController);",
    "                AssetDatabase.CreateAsset(overrideController, family.animatorOverridePath);",
    "            }",
    "        }",
    "",
    "        private static void BuildClipSet(AnimatorController controller, IEnumerable<string> clipNames)",
    "        {",
    "            var clips = new Dictionary<string, AnimationClip>();",
    "            foreach (var clipName in clipNames)",
    "            {",
    "                var clip = new AnimationClip();",
    "                AssetDatabase.CreateAsset(clip, $\"Assets/Animation/Clips/{clipName}.anim\");",
    "                clips[clipName] = clip;",
    "            }",
    "",
    "            var root = controller.layers[0].stateMachine;",
    "            root.states.ToList().ForEach(state => root.RemoveState(state.state));",
    "            var idle = root.AddState(\"Idle\");",
    "            idle.motion = clips[clipNames.First()];",
    "        }",
    "",
    "        private static ReadinessReport RunReadinessValidation(GameCreatorPlan plan, GeneratedArtKit artKit)",
    "        {",
    "            var checks = new List<ReadinessCheck>();",
    "",
    "            AddReadinessCheck(checks, \"materials.player\", AssetExists(artKit.playerMaterialPath), artKit.playerMaterialPath);",
    "            AddReadinessCheck(checks, \"materials.enemy\", AssetExists(artKit.enemyMaterialPath), artKit.enemyMaterialPath);",
    "            AddReadinessCheck(checks, \"materials.environment\", AssetExists(artKit.environmentMaterialPath), artKit.environmentMaterialPath);",
    "",
    "            AddReadinessCheck(checks, \"prefab.player.visual\", PrefabHasVisualRenderer(\"Assets/Prefabs/Player.prefab\"), \"Player prefab visual renderer\");",
    "            AddReadinessCheck(checks, \"prefab.enemy.visual\", PrefabHasVisualRenderer(\"Assets/Prefabs/EnemyBase.prefab\"), \"Enemy prefab visual renderer\");",
    "            AddReadinessCheck(checks, \"prefab.environment.visual\", PrefabHasVisualRenderer(\"Assets/Prefabs/Environment/EnvironmentBlock.prefab\"), \"Environment prefab visual renderer\");",
    "",
    "            AddReadinessCheck(checks, \"scene.mainmenu.audio\", SceneContainsComponent(\"Assets/Scenes/MainMenu.unity\", typeof(SceneAudioBootstrap)), \"MainMenu has SceneAudioBootstrap\");",
    "            AddReadinessCheck(checks, \"scene.splash.audio\", SceneContainsComponent(\"Assets/Scenes/Splash.unity\", typeof(SceneAudioBootstrap)), \"Splash has SceneAudioBootstrap\");",
    "            AddReadinessCheck(checks, \"scene.gameplay.audio\", SceneContainsComponent(\"Assets/Scenes/Gameplay.unity\", typeof(SceneAudioBootstrap)), \"Gameplay has SceneAudioBootstrap\");",
    "            AddReadinessCheck(checks, \"scene.gameplay.encounter\", SceneContainsComponent(\"Assets/Scenes/Gameplay.unity\", typeof(EncounterRuntimeDirector)), \"Gameplay has EncounterRuntimeDirector\");",
    "            AddReadinessCheck(checks, \"scene.gameplay.environment\", SceneContainsComponent(\"Assets/Scenes/Gameplay.unity\", typeof(EnvironmentStyleProfile)), \"Gameplay has EnvironmentStyleProfile\");",
    "",
    "            foreach (var levelName in plan.shell?.levelNames ?? Array.Empty<string>())",
    "            {",
    "                var scenePath = $\"Assets/Scenes/{levelName}.unity\";",
    "                AddReadinessCheck(checks, $\"scene.{levelName}.audio\", SceneContainsComponent(scenePath, typeof(SceneAudioBootstrap)), $\"{levelName} has SceneAudioBootstrap\");",
    "                AddReadinessCheck(checks, $\"scene.{levelName}.encounter\", SceneContainsComponent(scenePath, typeof(EncounterRuntimeDirector)), $\"{levelName} has EncounterRuntimeDirector\");",
    "                AddReadinessCheck(checks, $\"scene.{levelName}.environment\", SceneContainsComponent(scenePath, typeof(EnvironmentStyleProfile)), $\"{levelName} has EnvironmentStyleProfile\");",
    "            }",
    "",
    "            var passed = checks.Count(check => check.passed);",
    "            var failed = checks.Count - passed;",
    "            var score = checks.Count == 0 ? 0f : (passed * 100f) / checks.Count;",
    "",
    "            return new ReadinessReport",
    "            {",
    "                generatedAt = DateTime.UtcNow.ToString(\"o\"),",
    "                score = (float)Math.Round(score, 2),",
    "                passedChecks = passed,",
    "                failedChecks = failed,",
    "                checks = checks.ToArray(),",
    "            };",
    "        }",
    "",
    "        private static void AddReadinessCheck(List<ReadinessCheck> checks, string id, bool passed, string details)",
    "        {",
    "            checks.Add(new ReadinessCheck",
    "            {",
    "                id = id,",
    "                passed = passed,",
    "                details = details,",
    "            });",
    "        }",
    "",
    "        private static bool AssetExists(string assetPath)",
    "        {",
    "            if (string.IsNullOrWhiteSpace(assetPath))",
    "            {",
    "                return false;",
    "            }",
    "            return AssetDatabase.LoadMainAssetAtPath(assetPath) != null;",
    "        }",
    "",
    "        private static bool PrefabHasVisualRenderer(string prefabPath)",
    "        {",
    "            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);",
    "            if (prefab == null)",
    "            {",
    "                return false;",
    "            }",
    "            return prefab.GetComponentsInChildren<Renderer>(true).Length > 0;",
    "        }",
    "",
    "        private static bool SceneContainsComponent(string scenePath, Type componentType)",
    "        {",
    "            if (string.IsNullOrWhiteSpace(scenePath) || componentType == null)",
    "            {",
    "                return false;",
    "            }",
    "",
    "            try",
    "            {",
    "                var scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Additive);",
    "                try",
    "                {",
    "                    foreach (var root in scene.GetRootGameObjects())",
    "                    {",
    "                        if (root.GetComponentInChildren(componentType, true) != null)",
    "                        {",
    "                            return true;",
    "                        }",
    "                    }",
    "                    return false;",
    "                }",
    "                finally",
    "                {",
    "                    EditorSceneManager.CloseScene(scene, true);",
    "                }",
    "            }",
    "            catch",
    "            {",
    "                return false;",
    "            }",
    "        }",
    "",
    "        private static void WriteValidationReport(GameCreatorPlan plan, ReadinessReport readiness)",
    "        {",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Generated\"));",
    "            File.WriteAllText(\"Assets/Generated/game-creator-import-report.json\", JsonUtility.ToJson(plan, true));",
    "            File.WriteAllText(\"Assets/Generated/game-creator-readiness-score.json\", JsonUtility.ToJson(readiness, true));",
    "        }",
    "",
    "        private static void EnsureFolders()",
    "        {",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Scenes\"));",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Prefabs\"));",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Animation\"));",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Assets\", \"Generated\"));",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"ProjectSettings\"));",
    "            Directory.CreateDirectory(Path.Combine(ProjectRoot, \"Packages\"));",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
}

export async function buildGameCreatorUnityAuthoringProject(input: { workspacePath: string; spec: GameCreatorUnityAuthoringSpec; canonDocs: GameCreatorCanonDocSource[] }): Promise<BuildGameCreatorUnityAuthoringProjectResult> {
  const gate4RootRelativePath = path.join("GameBuild", "gates", "gate4");
  const gate4Root = path.join(input.workspacePath, gate4RootRelativePath);
  const gate4HandoffRoot = path.join(gate4Root, "unity-handoff");
  const unityProjectPath = path.join(input.workspacePath, "GameBuild", "unity");
  const editorScriptPath = path.join(unityProjectPath, "Assets", "Editor", "NexusGenerated", "GameCreatorAutomation.cs");
  const projectSettingsPath = path.join(unityProjectPath, "ProjectSettings");
  const packagesPath = path.join(unityProjectPath, "Packages");
  const generatedAssetsPath = path.join(unityProjectPath, "Assets", "NexusGenerated");

  const requiredGate4Paths = [
    path.join(gate4Root, "asset-manifest.json"),
    path.join(gate4Root, "import-package.json"),
    path.join(gate4HandoffRoot, "Prefabs", "prefab-wiring-manifest.json"),
    path.join(gate4HandoffRoot, "Data", "SpawnTables", "biome-spawn-tables.json"),
    path.join(gate4HandoffRoot, "Animation", "animation-state-map.json"),
    path.join(gate4HandoffRoot, "Validation", "post-import-readiness.json"),
    path.join(gate4HandoffRoot, "Scripts", "Enemies", "enemy-archetypes.json"),
  ];

  for (const filePath of requiredGate4Paths) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error(`Missing Gate 4 authoring dependency: ${path.relative(input.workspacePath, filePath).split(path.sep).join("/")}`);
    }
  }

  const assetManifest = await readJsonFile(path.join(gate4Root, "asset-manifest.json"));
  const importPackage = await readJsonFile(path.join(gate4Root, "import-package.json"));
  const prefabWiringManifest = await readJsonFile(path.join(gate4HandoffRoot, "Prefabs", "prefab-wiring-manifest.json"));
  const spawnTables = await readJsonFile(path.join(gate4HandoffRoot, "Data", "SpawnTables", "biome-spawn-tables.json"));
  const animationStateMap = await readJsonFile(path.join(gate4HandoffRoot, "Animation", "animation-state-map.json"));
  const postImportReadiness = await readJsonFile(path.join(gate4HandoffRoot, "Validation", "post-import-readiness.json"));
  const enemyFamilyFiles = await fs.readdir(path.join(gate4HandoffRoot, "Data", "EnemyFamilies")).catch(() => [] as string[]);
  const enemyFamilies = await Promise.all(enemyFamilyFiles.filter((entry) => entry.toLowerCase().endsWith(".json")).sort().map(async (entry) => readJsonFile<EnemyFamilySource>(path.join(gate4HandoffRoot, "Data", "EnemyFamilies", entry))));
  const runtimeScriptsTarget = path.join(unityProjectPath, "Assets", "Scripts", "GameCreator", "Generated");
  const runtimeScriptsSource = path.join(gate4HandoffRoot, "Scripts");
  const shellScriptsTarget = path.join(unityProjectPath, "Assets", "Scripts", "GameCreator", "Shell");
  const shellPlan = buildGameCreatorUnityShellPlan({ spec: input.spec, canonDocs: input.canonDocs });
  const levelManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorLevelManifest.json");
  const uiManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorUiLayoutManifest.json");
  const enemyBehaviorManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorEnemyBehaviorManifest.json");
  const prefabStyleManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorPrefabStyleManifest.json");
  const artDirectionManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorArtDirectionManifest.json");
  const audioPlanManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorAudioPlanManifest.json");
  const loreProfileManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorLoreProfileManifest.json");
  const technicalProfileManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorTechnicalProfileManifest.json");
  const productionPlanManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorProductionPlanManifest.json");
  const encounterWireManifestPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorEncounterWireManifest.json");
  const readinessReportPath = path.join(unityProjectPath, "Assets", "Generated", "game-creator-readiness-score.json");

  await fs.mkdir(projectSettingsPath, { recursive: true });
  await fs.mkdir(packagesPath, { recursive: true });
  await fs.mkdir(generatedAssetsPath, { recursive: true });
  await fs.mkdir(path.join(unityProjectPath, "Assets", "Editor", "NexusGenerated"), { recursive: true });
  await fs.mkdir(path.join(unityProjectPath, "Assets", "Scenes"), { recursive: true });
  await fs.mkdir(path.join(unityProjectPath, "Assets", "Prefabs"), { recursive: true });
  await fs.mkdir(path.join(unityProjectPath, "Assets", "Animation", "Controllers"), { recursive: true });
  await fs.mkdir(path.join(unityProjectPath, "Assets", "Animation", "Clips"), { recursive: true });
  await fs.mkdir(path.join(unityProjectPath, "Assets", "Generated", "EnemyFamilies"), { recursive: true });
  await fs.mkdir(runtimeScriptsTarget, { recursive: true });
  await fs.mkdir(shellScriptsTarget, { recursive: true });

  const copiedRuntimeScripts = await copyDirectoryFiles(runtimeScriptsSource, runtimeScriptsTarget);
  const shellRuntimeScripts = buildGameCreatorShellRuntimeScripts(shellPlan);
  for (const script of shellRuntimeScripts) {
    const targetPath = path.join(unityProjectPath, script.relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, script.content, "utf-8");
  }
  await fs.writeFile(levelManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    levels: shellPlan.levelManifest,
    flow: shellPlan.flow,
    docsUsed: shellPlan.docsUsed,
  }, null, 2), "utf-8");
  await fs.writeFile(uiManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    settingsProfile: shellPlan.settingsProfile,
    menuLayout: shellPlan.menuLayout,
    hudLayout: shellPlan.hudLayout,
    screens: shellPlan.screens,
    docsUsed: shellPlan.docsUsed,
  }, null, 2), "utf-8");
  await fs.writeFile(enemyBehaviorManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    enemyLayout: shellPlan.enemyLayout,
    levelManifest: shellPlan.levelManifest,
    evidence: shellPlan.evidence,
  }, null, 2), "utf-8");
  await fs.writeFile(prefabStyleManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    sourceDocs: shellPlan.docsUsed,
    artDirection: shellPlan.artDirection,
    prefabStylePlan: {
      player: {
        meshHint: "capsule",
        materialRole: "player-primary",
        silhouetteRule: shellPlan.artDirection.silhouetteRules[0] ?? "Distinct player silhouette",
      },
      enemyBase: {
        meshHint: "capsule",
        materialRole: "enemy-primary",
        silhouetteRule: shellPlan.artDirection.silhouetteRules[1] ?? "Distinct enemy role silhouettes",
      },
      environmentRoot: {
        meshHint: "cube",
        materialRole: "environment-primary",
        styleRule: shellPlan.artDirection.environmentStyle[0] ?? "Biome contrast by color and shape",
      },
      ui: {
        materialRole: "ui-panel",
        styleRule: shellPlan.artDirection.uiStyle[0] ?? "High readability",
      },
    },
  }, null, 2), "utf-8");
  await fs.writeFile(artDirectionManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    artDirection: shellPlan.artDirection,
    docsUsed: shellPlan.docsUsed,
  }, null, 2), "utf-8");
  await fs.writeFile(audioPlanManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    audioPlan: shellPlan.audioPlan,
    docsUsed: shellPlan.docsUsed,
  }, null, 2), "utf-8");
  await fs.writeFile(loreProfileManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    loreProfile: shellPlan.loreProfile,
    docsUsed: shellPlan.docsUsed,
  }, null, 2), "utf-8");
  await fs.writeFile(technicalProfileManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    technicalProfile: shellPlan.technicalProfile,
    docsUsed: shellPlan.docsUsed,
  }, null, 2), "utf-8");
  await fs.writeFile(productionPlanManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    productionPlan: shellPlan.productionPlan,
    docsUsed: shellPlan.docsUsed,
  }, null, 2), "utf-8");
  await fs.writeFile(encounterWireManifestPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    encounterWire: shellPlan.encounterWire,
    enemyLayout: shellPlan.enemyLayout,
    levelManifest: shellPlan.levelManifest,
  }, null, 2), "utf-8");
  await fs.writeFile(readinessReportPath, JSON.stringify({
    generatedAt: shellPlan.generatedAt,
    status: "pending-unity-run",
    score: 0,
    passedChecks: 0,
    failedChecks: 0,
    checks: [],
  }, null, 2), "utf-8");

  const plan: GameCreatorUnityAuthoringPlan = {
    generatedAt: new Date().toISOString(),
    workspacePath: input.workspacePath,
    unityProjectPath,
    gate4RootRelativePath,
    methodName: "NexusGenerated.GameCreatorAutomation.GenerateFromGate4",
    logRelativePath: "GameBuild/unity/Logs/generate.log",
    shellPlanRelativePath: "Assets/NexusGenerated/GameCreatorShellPlan.json",
    levelManifestRelativePath: "Assets/NexusGenerated/GameCreatorLevelManifest.json",
    uiLayoutManifestRelativePath: "Assets/NexusGenerated/GameCreatorUiLayoutManifest.json",
    enemyBehaviorManifestRelativePath: "Assets/NexusGenerated/GameCreatorEnemyBehaviorManifest.json",
    prefabStyleManifestRelativePath: "Assets/NexusGenerated/GameCreatorPrefabStyleManifest.json",
    artDirectionManifestRelativePath: "Assets/NexusGenerated/GameCreatorArtDirectionManifest.json",
    audioPlanManifestRelativePath: "Assets/NexusGenerated/GameCreatorAudioPlanManifest.json",
    loreProfileManifestRelativePath: "Assets/NexusGenerated/GameCreatorLoreProfileManifest.json",
    technicalProfileManifestRelativePath: "Assets/NexusGenerated/GameCreatorTechnicalProfileManifest.json",
    productionPlanManifestRelativePath: "Assets/NexusGenerated/GameCreatorProductionPlanManifest.json",
    encounterWireManifestRelativePath: "Assets/NexusGenerated/GameCreatorEncounterWireManifest.json",
    readinessReportRelativePath: "Assets/Generated/game-creator-readiness-score.json",
    stageRelativePaths: [
      "ProjectSettings/NexusGameSpec.json",
      "ProjectSettings/ProjectVersion.txt",
      "Packages/manifest.json",
      "Assets/NexusGenerated/GameCreatorImportPlan.json",
      "Assets/NexusGenerated/GameCreatorShellPlan.json",
      "Assets/NexusGenerated/GameCreatorLevelManifest.json",
      "Assets/NexusGenerated/GameCreatorUiLayoutManifest.json",
      "Assets/NexusGenerated/GameCreatorEnemyBehaviorManifest.json",
      "Assets/NexusGenerated/GameCreatorPrefabStyleManifest.json",
      "Assets/NexusGenerated/GameCreatorArtDirectionManifest.json",
      "Assets/NexusGenerated/GameCreatorAudioPlanManifest.json",
      "Assets/NexusGenerated/GameCreatorLoreProfileManifest.json",
      "Assets/NexusGenerated/GameCreatorTechnicalProfileManifest.json",
      "Assets/NexusGenerated/GameCreatorProductionPlanManifest.json",
      "Assets/NexusGenerated/GameCreatorEncounterWireManifest.json",
      "Assets/Generated/game-creator-readiness-score.json",
      "Assets/Editor/NexusGenerated/GameCreatorAutomation.cs",
      "Assets/Scripts/GameCreator/Shell/SplashController.cs",
      "Assets/Scripts/GameCreator/Shell/SettingsController.cs",
      "Assets/Scripts/GameCreator/Shell/PauseMenuController.cs",
      "Assets/Scripts/GameCreator/Shell/LevelFlowController.cs",
    ],
    spec: input.spec,
    shell: shellPlan,
    gate4: {
      assetManifest,
      importPackage,
      prefabWiringManifest,
      spawnTables,
      animationStateMap,
      postImportReadiness,
      enemyFamilies: enemyFamilies.map((entry) => ({
        familyId: String(entry.familyId ?? "").trim(),
        displayName: String(entry.displayName ?? "").trim(),
        role: String(entry.role ?? "").trim(),
        combat: {
          moveSpeed: Number(entry.combat?.moveSpeed ?? 0),
          maxHealth: Number(entry.combat?.maxHealth ?? 0),
          attackDamage: Number(entry.combat?.attackDamage ?? 0),
          attackRange: Number(entry.combat?.attackRange ?? 0),
          attackCooldown: Number(entry.combat?.attackCooldown ?? 0),
        },
      })),
    },
  };

  const importPlanPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorImportPlan.json");
  const shellPlanPath = path.join(unityProjectPath, "Assets", "NexusGenerated", "GameCreatorShellPlan.json");
  const specPath = path.join(projectSettingsPath, "NexusGameSpec.json");
  const projectVersionPath = path.join(projectSettingsPath, "ProjectVersion.txt");
  const packagesManifestPath = path.join(packagesPath, "manifest.json");

  await fs.writeFile(specPath, JSON.stringify(input.spec, null, 2), "utf-8");
  await fs.writeFile(projectVersionPath, buildUnityProjectVersionText(), "utf-8");
  await fs.writeFile(packagesManifestPath, buildUnityPackagesManifest(), "utf-8");
  await fs.writeFile(importPlanPath, JSON.stringify(plan, null, 2), "utf-8");
  await fs.writeFile(shellPlanPath, JSON.stringify(shellPlan, null, 2), "utf-8");
  await fs.writeFile(editorScriptPath, buildGameCreatorAutomationScript(), "utf-8");

  return {
    unityProjectPath,
    logRelativePath: plan.logRelativePath,
    methodName: plan.methodName,
    stagedFiles: [
      path.relative(input.workspacePath, specPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, projectVersionPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, packagesManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, importPlanPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, shellPlanPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, levelManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, uiManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, enemyBehaviorManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, prefabStyleManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, artDirectionManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, audioPlanManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, loreProfileManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, technicalProfileManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, productionPlanManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, encounterWireManifestPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, readinessReportPath).split(path.sep).join("/"),
      path.relative(input.workspacePath, editorScriptPath).split(path.sep).join("/"),
      ...shellRuntimeScripts.map((script) => path.relative(input.workspacePath, path.join(unityProjectPath, script.relativePath)).split(path.sep).join("/")),
      ...copiedRuntimeScripts.map((filePath) => path.relative(input.workspacePath, filePath).split(path.sep).join("/")),
    ],
    planRelativePath: path.relative(input.workspacePath, importPlanPath).split(path.sep).join("/"),
    shellPlanRelativePath: path.relative(input.workspacePath, shellPlanPath).split(path.sep).join("/"),
    levelManifestRelativePath: path.relative(input.workspacePath, levelManifestPath).split(path.sep).join("/"),
    uiLayoutManifestRelativePath: path.relative(input.workspacePath, uiManifestPath).split(path.sep).join("/"),
    enemyBehaviorManifestRelativePath: path.relative(input.workspacePath, enemyBehaviorManifestPath).split(path.sep).join("/"),
    prefabStyleManifestRelativePath: path.relative(input.workspacePath, prefabStyleManifestPath).split(path.sep).join("/"),
    artDirectionManifestRelativePath: path.relative(input.workspacePath, artDirectionManifestPath).split(path.sep).join("/"),
    audioPlanManifestRelativePath: path.relative(input.workspacePath, audioPlanManifestPath).split(path.sep).join("/"),
    loreProfileManifestRelativePath: path.relative(input.workspacePath, loreProfileManifestPath).split(path.sep).join("/"),
    technicalProfileManifestRelativePath: path.relative(input.workspacePath, technicalProfileManifestPath).split(path.sep).join("/"),
    productionPlanManifestRelativePath: path.relative(input.workspacePath, productionPlanManifestPath).split(path.sep).join("/"),
    encounterWireManifestRelativePath: path.relative(input.workspacePath, encounterWireManifestPath).split(path.sep).join("/"),
    readinessReportRelativePath: path.relative(input.workspacePath, readinessReportPath).split(path.sep).join("/"),
    plan,
  };
}
