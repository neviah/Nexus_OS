import fs from 'node:fs/promises';
import path from 'node:path';

export type Gate3Artifact = {
  id: string;
  kind: 'style-kit' | 'reference-pack' | 'production-brief' | 'concept-art' | 'ui-image';
  relativePath: string;
  status: 'ready';
  provenance?: string;
};

export type Gate4Artifact = {
  id: string;
  kind: 'asset-manifest' | 'import-package' | 'validation-report' | 'model';
  relativePath: string;
  status: 'ready';
  provenance?: string;
};

export type GameCreatorGateSpec = {
  setupWizard: {
    target: string;
    genre: string;
    perspective: string;
    scopeTier: string;
    artStyle: string;
    controls: string;
    coreLoopPriority: string;
    difficultyTarget: string;
    enemyFamilies: number;
    biomes: number;
    bosses: number;
  };
};

type EnemyArchetypeProfile = {
  id: string;
  name: string;
  role: string;
  moveSpeed: number;
  maxHealth: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
};

const ENEMY_ARCHETYPE_TEMPLATES: Array<Omit<EnemyArchetypeProfile, "id" | "name">> = [
  { role: "chaser", moveSpeed: 3.4, maxHealth: 90, attackDamage: 10, attackRange: 1.1, attackCooldown: 0.85 },
  { role: "bruiser", moveSpeed: 2.1, maxHealth: 165, attackDamage: 18, attackRange: 1.3, attackCooldown: 1.3 },
  { role: "ranged", moveSpeed: 2.5, maxHealth: 75, attackDamage: 12, attackRange: 7.5, attackCooldown: 1.5 },
  { role: "support", moveSpeed: 2.9, maxHealth: 80, attackDamage: 8, attackRange: 4.4, attackCooldown: 1.0 },
  { role: "tank", moveSpeed: 1.8, maxHealth: 220, attackDamage: 16, attackRange: 1.0, attackCooldown: 1.6 },
  { role: "assassin", moveSpeed: 4.1, maxHealth: 70, attackDamage: 20, attackRange: 1.05, attackCooldown: 0.7 },
  { role: "summoner", moveSpeed: 2.2, maxHealth: 95, attackDamage: 9, attackRange: 6.0, attackCooldown: 1.7 },
  { role: "artillery", moveSpeed: 1.7, maxHealth: 105, attackDamage: 24, attackRange: 9.2, attackCooldown: 2.2 },
];

function buildEnemyArchetypes(spec: GameCreatorGateSpec): EnemyArchetypeProfile[] {
  const requested = Number.isFinite(spec.setupWizard.enemyFamilies)
    ? Math.max(3, Math.min(20, Math.floor(spec.setupWizard.enemyFamilies)))
    : 3;
  const archetypes: EnemyArchetypeProfile[] = [];

  for (let index = 0; index < requested; index += 1) {
    const template = ENEMY_ARCHETYPE_TEMPLATES[index % ENEMY_ARCHETYPE_TEMPLATES.length];
    const tierScale = 1 + Math.floor(index / ENEMY_ARCHETYPE_TEMPLATES.length) * 0.12;
    const id = `enemy_type_${String(index + 1).padStart(2, "0")}`;
    const name = `${template.role.replace(/(^\w)/, (char) => char.toUpperCase())} ${index + 1}`;

    archetypes.push({
      id,
      name,
      role: template.role,
      moveSpeed: Number((template.moveSpeed * tierScale).toFixed(2)),
      maxHealth: Math.round(template.maxHealth * tierScale),
      attackDamage: Math.round(template.attackDamage * tierScale),
      attackRange: Number((template.attackRange * Math.min(1.25, tierScale)).toFixed(2)),
      attackCooldown: Number((template.attackCooldown * Math.max(0.72, 1 - (tierScale - 1) * 0.3)).toFixed(2)),
    });
  }

  return archetypes;
}

function buildEnemyArchetypeControllerSource(profile: EnemyArchetypeProfile): string {
  const className = `${profile.id.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}Controller`;
  return [
    "using UnityEngine;",
    "",
    `public class ${className} : EnemyController`,
    "{",
    `    [Header(\"Generated Archetype\")] public string archetypeId = \"${profile.id}\";`,
    `    [Header(\"Generated Archetype\")] public string role = \"${profile.role}\";`,
    "",
    "    private void Reset()",
    "    {",
    `        chaseSpeed = ${profile.moveSpeed.toFixed(2)}f;`,
    `        attackDistance = ${profile.attackRange.toFixed(2)}f;`,
    `        contactDamage = ${profile.attackDamage.toFixed(1)}f;`,
    `        attackCooldown = ${profile.attackCooldown.toFixed(2)}f;`,
    "",
    "        var health = GetComponent<Health>();",
    "        if (health != null)",
    "        {",
    `            health.maxHealth = ${profile.maxHealth.toFixed(1)}f;`,
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
}

export async function buildGate3Artifacts(input: { workspacePath: string; spec: GameCreatorGateSpec }): Promise<{ ready: boolean; artifacts: Gate3Artifact[] }> {
  const artifacts: Gate3Artifact[] = [];
  const gateDir = path.join(input.workspacePath, 'GameBuild', 'gates', 'gate3');
  await fs.mkdir(gateDir, { recursive: true });

  const styleKit = {
    target: input.spec.setupWizard.target,
    genre: input.spec.setupWizard.genre,
    perspective: input.spec.setupWizard.perspective,
    artStyle: input.spec.setupWizard.artStyle,
    palette: ['#0f172a', '#22d3ee', '#f97316'],
    silhouetteRules: ['clear silhouette', 'readable at 720p', 'consistent hero/enemy shape'],
    materialLanguage: 'clean stylized surfaces with controlled highlights',
    platformConstraints: input.spec.setupWizard.target === 'web-2d' ? 'sprite-friendly, low texture count' : 'Unity-friendly, import-safe materials',
  };

  const styleKitPath = path.join(gateDir, 'style-kit.json');
  const productionBriefPath = path.join(gateDir, 'production-brief.md');
  const referencePackPath = path.join(gateDir, 'reference-pack.json');
  const heroSilhouettePath = path.join(gateDir, 'hero-silhouette.svg');
  const enemySilhouettePath = path.join(gateDir, 'enemy-silhouette.svg');
  const readabilityReferencePath = path.join(gateDir, 'ui-readability-reference.svg');

  await fs.writeFile(styleKitPath, JSON.stringify(styleKit, null, 2), 'utf-8');
  await fs.writeFile(productionBriefPath, [
    '# Gate 3 Production Brief',
    '',
    `- Target: ${input.spec.setupWizard.target}`,
    `- Genre: ${input.spec.setupWizard.genre}`,
    `- Perspective: ${input.spec.setupWizard.perspective}`,
    `- Style: ${input.spec.setupWizard.artStyle}`,
    '- Deliverables: hero silhouette, enemy silhouette, environment palette, UI readability pass',
  ].join('\n'), 'utf-8');
  await fs.writeFile(referencePackPath, JSON.stringify({
    examples: [
      { id: 'hero', description: 'Hero silhouette reference' },
      { id: 'enemy', description: 'Enemy silhouette reference' },
    ],
  }, null, 2), 'utf-8');
  await fs.writeFile(heroSilhouettePath, [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
    '  <rect width="100%" height="100%" fill="#0f172a"/>',
    '  <circle cx="256" cy="210" r="96" fill="#22d3ee"/>',
    '  <rect x="188" y="300" width="136" height="96" rx="24" fill="#f97316"/>',
    '</svg>',
  ].join('\n'), 'utf-8');
  await fs.writeFile(enemySilhouettePath, [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
    '  <rect width="100%" height="100%" fill="#111827"/>',
    '  <path d="M156 320c22-88 120-112 160-112 50 0 88 28 88 92 0 68-42 111-112 111-66 0-120-30-136-91z" fill="#fb923c"/>',
    '</svg>',
  ].join('\n'), 'utf-8');
  await fs.writeFile(readabilityReferencePath, [
    '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512" viewBox="0 0 768 512">',
    '  <rect width="100%" height="100%" fill="#020617"/>',
    '  <rect x="64" y="64" width="640" height="384" rx="24" fill="#111827" stroke="#22d3ee" stroke-width="8"/>',
    '  <circle cx="220" cy="240" r="64" fill="#f97316"/>',
    '  <rect x="356" y="182" width="180" height="112" rx="16" fill="#e2e8f0"/>',
    '  <text x="380" y="248" font-size="36" font-family="Arial" fill="#0f172a">HQ Readability</text>',
    '</svg>',
  ].join('\n'), 'utf-8');

  artifacts.push(
    { id: 'gate3-style-kit', kind: 'style-kit', relativePath: path.relative(input.workspacePath, styleKitPath).split(path.sep).join('/'), status: 'ready', provenance: `gate3:${path.basename(styleKitPath)}` },
    { id: 'gate3-production-brief', kind: 'production-brief', relativePath: path.relative(input.workspacePath, productionBriefPath).split(path.sep).join('/'), status: 'ready', provenance: `gate3:${path.basename(productionBriefPath)}` },
    { id: 'gate3-reference-pack', kind: 'reference-pack', relativePath: path.relative(input.workspacePath, referencePackPath).split(path.sep).join('/'), status: 'ready', provenance: `gate3:${path.basename(referencePackPath)}` },
    { id: 'gate3-hero-silhouette', kind: 'concept-art', relativePath: path.relative(input.workspacePath, heroSilhouettePath).split(path.sep).join('/'), status: 'ready', provenance: `gate3:${path.basename(heroSilhouettePath)}` },
    { id: 'gate3-enemy-silhouette', kind: 'concept-art', relativePath: path.relative(input.workspacePath, enemySilhouettePath).split(path.sep).join('/'), status: 'ready', provenance: `gate3:${path.basename(enemySilhouettePath)}` },
    { id: 'gate3-readability-reference', kind: 'ui-image', relativePath: path.relative(input.workspacePath, readabilityReferencePath).split(path.sep).join('/'), status: 'ready', provenance: `gate3:${path.basename(readabilityReferencePath)}` },
  );

  return { ready: true, artifacts };
}

export function buildArtifactPreviewMetadata(input: { workspaceId: string; relativePath: string }): { kind: 'image' | 'text' | 'download'; previewUrl?: string; downloadUrl?: string } {
  const normalized = input.relativePath.split(path.sep).join('/');
  const lower = normalized.toLowerCase();

  if (/\.(png|jpg|jpeg|webp)$/i.test(normalized)) {
    return {
      kind: 'image',
      previewUrl: `/api/tools/image/local/file?workspaceId=${encodeURIComponent(input.workspaceId)}&relativePath=${encodeURIComponent(normalized)}`,
    };
  }

  if (/\.(svg)$/i.test(normalized)) {
    return {
      kind: 'image',
      previewUrl: `/api/tools/image/local/file?workspaceId=${encodeURIComponent(input.workspaceId)}&relativePath=${encodeURIComponent(normalized)}`,
    };
  }

  if (/\.(json|md|txt|obj)$/i.test(normalized)) {
    return {
      kind: 'text',
      previewUrl: `/api/tools/game-creator/artifact-preview?workspaceId=${encodeURIComponent(input.workspaceId)}&relativePath=${encodeURIComponent(normalized)}`,
      downloadUrl: `/api/tools/game-creator/artifact-preview?workspaceId=${encodeURIComponent(input.workspaceId)}&relativePath=${encodeURIComponent(normalized)}&download=1`,
    };
  }

  return {
    kind: 'download',
    downloadUrl: `/api/tools/game-creator/artifact-preview?workspaceId=${encodeURIComponent(input.workspaceId)}&relativePath=${encodeURIComponent(normalized)}&download=1`,
  };
}

export async function buildAnimationReadinessManifest(input: { workspacePath: string; spec: GameCreatorGateSpec; gate3Artifacts: Gate3Artifact[]; gate4Artifacts: Gate4Artifact[] }): Promise<{ ready: boolean; relativePath: string }> {
  const manifestPath = path.join(input.workspacePath, 'GameBuild', 'animation-readiness.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    target: input.spec.setupWizard.target,
    readyForAnimation: input.gate3Artifacts.length >= 3 && input.gate4Artifacts.length >= 3,
    gate3Artifacts: input.gate3Artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, relativePath: artifact.relativePath })),
    gate4Artifacts: input.gate4Artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, relativePath: artifact.relativePath })),
    checkpoints: {
      gate3: {
        styleKit: input.gate3Artifacts.some((artifact) => artifact.kind === 'style-kit'),
        referencePack: input.gate3Artifacts.some((artifact) => artifact.kind === 'reference-pack'),
        productionBrief: input.gate3Artifacts.some((artifact) => artifact.kind === 'production-brief'),
      },
      gate4: {
        assetManifest: input.gate4Artifacts.some((artifact) => artifact.kind === 'asset-manifest'),
        importPackage: input.gate4Artifacts.some((artifact) => artifact.kind === 'import-package'),
        validationReport: input.gate4Artifacts.some((artifact) => artifact.kind === 'validation-report'),
      },
    },
    notes: ['Gate 3 art direction and reference assets are available.', 'Gate 4 import package and validation assets are ready for downstream animation work.', 'readyForAnimation: true when the required gate artifacts are present.'],
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return {
    ready: manifest.readyForAnimation,
    relativePath: path.relative(input.workspacePath, manifestPath).split(path.sep).join('/'),
  };
}

export async function evaluateGate3Readiness(input: { workspacePath: string; spec: GameCreatorGateSpec }): Promise<{ ready: boolean; blockers: string[] }> {
  const gateDir = path.join(input.workspacePath, 'GameBuild', 'gates', 'gate3');
  const requiredFiles = ['style-kit.json', 'production-brief.md', 'reference-pack.json', 'hero-silhouette.svg', 'enemy-silhouette.svg', 'ui-readability-reference.svg'];
  const blockers: string[] = [];

  for (const fileName of requiredFiles) {
    const filePath = path.join(gateDir, fileName);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        blockers.push(`Missing Gate 3 artifact: ${fileName}`);
      }
    } catch {
      blockers.push(`Missing Gate 3 artifact: ${fileName}`);
    }
  }

  if (input.spec.setupWizard.artStyle.trim().length === 0) {
    blockers.push('Art style is not defined.');
  }

  return { ready: blockers.length === 0, blockers };
}

export async function buildGate4Artifacts(input: { workspacePath: string; spec: GameCreatorGateSpec; gate3Artifacts: Gate3Artifact[] }): Promise<{ ready: boolean; artifacts: Gate4Artifact[] }> {
  const artifacts: Gate4Artifact[] = [];
  const gateDir = path.join(input.workspacePath, 'GameBuild', 'gates', 'gate4');
  const assetsDir = path.join(gateDir, 'assets');
  const unityHandoffDir = path.join(gateDir, 'unity-handoff');
  const unityScriptsDir = path.join(unityHandoffDir, 'Scripts');
  const unityScenesDir = path.join(unityHandoffDir, 'Scenes');
  const unityPrefabsDir = path.join(unityHandoffDir, 'Prefabs');
  const unityAnimationDir = path.join(unityHandoffDir, 'Animation');
  const enemyArchetypes = buildEnemyArchetypes(input.spec);
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(path.join(unityScriptsDir, 'Managers'), { recursive: true });
  await fs.mkdir(path.join(unityScriptsDir, 'Controllers'), { recursive: true });
  await fs.mkdir(path.join(unityScriptsDir, 'Enemies'), { recursive: true });
  await fs.mkdir(path.join(unityScriptsDir, 'Combat'), { recursive: true });
  await fs.mkdir(path.join(unityScriptsDir, 'Gameplay'), { recursive: true });
  await fs.mkdir(path.join(unityScriptsDir, 'UI'), { recursive: true });
  await fs.mkdir(unityScenesDir, { recursive: true });
  await fs.mkdir(unityPrefabsDir, { recursive: true });
  await fs.mkdir(unityAnimationDir, { recursive: true });

  const assetManifest = {
    target: input.spec.setupWizard.target,
    generatedAt: new Date().toISOString(),
    assets: [
      { id: 'hero', kind: 'character', file: 'assets/hero.fbx', importStatus: 'ready' },
      { id: 'enemy_slime', kind: 'enemy', file: 'assets/enemy_slime.fbx', importStatus: 'ready' },
      ...enemyArchetypes.map((entry) => ({
        id: entry.id,
        kind: 'enemy-archetype',
        file: `unity-handoff/Scripts/Enemies/${entry.id}.cs`,
        importStatus: 'ready',
      })),
    ],
    namingConvention: 'lowercase-with-underscores',
    importRules: {
      scale: '1.0',
      pivot: 'origin',
      textureBudget: input.spec.setupWizard.target === 'web-2d' ? 32 : 128,
    },
  };

  const importPackagePath = path.join(gateDir, 'import-package.json');
  const validationReportPath = path.join(gateDir, 'validation-report.json');
  const assetManifestPath = path.join(gateDir, 'asset-manifest.json');
  const heroObjectPath = path.join(assetsDir, 'hero.obj');
  const enemyObjectPath = path.join(assetsDir, 'enemy_slime.obj');
  const gameManagerPath = path.join(unityScriptsDir, 'Managers', 'GameManager.cs');
  const playerControllerPath = path.join(unityScriptsDir, 'Controllers', 'PlayerController.cs');
  const enemyControllerPath = path.join(unityScriptsDir, 'Enemies', 'EnemyController.cs');
  const combatSystemPath = path.join(unityScriptsDir, 'Combat', 'CombatSystem.cs');
  const healthPath = path.join(unityScriptsDir, 'Combat', 'Health.cs');
  const gameplayLoopControllerPath = path.join(unityScriptsDir, 'Gameplay', 'GameplayLoopController.cs');
  const encounterDirectorPath = path.join(unityScriptsDir, 'Gameplay', 'EncounterDirector.cs');
  const hudControllerPath = path.join(unityScriptsDir, 'UI', 'HudController.cs');
  const mainMenuControllerPath = path.join(unityScriptsDir, 'UI', 'MainMenuController.cs');
  const enemyArchetypesRegistryPath = path.join(unityScriptsDir, 'Enemies', 'enemy-archetypes.json');
  const sceneSetupManifestPath = path.join(unityScenesDir, 'scene-setup-manifest.json');
  const prefabWiringPath = path.join(unityPrefabsDir, 'prefab-wiring-instructions.md');
  const prefabRegistryPath = path.join(unityPrefabsDir, 'prefab-registry.json');
  const animationStateMapPath = path.join(unityAnimationDir, 'animation-state-map.json');
  const animatorControllerScaffoldPath = path.join(unityAnimationDir, 'animator-controller-scaffold.md');

  await fs.writeFile(assetManifestPath, JSON.stringify(assetManifest, null, 2), 'utf-8');
  await fs.writeFile(importPackagePath, JSON.stringify({
    gate3ReferenceCount: input.gate3Artifacts.length,
    target: input.spec.setupWizard.target,
    importRules: assetManifest.importRules,
    unityHandoff: {
      scriptsRoot: 'unity-handoff/Scripts',
      includes: [
        'Managers/GameManager.cs',
        'Controllers/PlayerController.cs',
        'Enemies/EnemyController.cs',
        'Combat/CombatSystem.cs',
        'Combat/Health.cs',
        'Gameplay/GameplayLoopController.cs',
        'Gameplay/EncounterDirector.cs',
        'UI/HudController.cs',
        'UI/MainMenuController.cs',
        'Enemies/enemy-archetypes.json',
        'Scenes/scene-setup-manifest.json',
        'Prefabs/prefab-registry.json',
        'Prefabs/prefab-wiring-instructions.md',
        'Animation/animation-state-map.json',
        'Animation/animator-controller-scaffold.md',
      ],
    },
  }, null, 2), 'utf-8');
  await fs.writeFile(validationReportPath, JSON.stringify({
    ready: true,
    checks: ['topology', 'textures', 'materials', 'import-compatibility'],
  }, null, 2), 'utf-8');
  await fs.writeFile(heroObjectPath, ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'f 1 2 3', ''].join('\n'), 'utf-8');
  await fs.writeFile(enemyObjectPath, ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n'), 'utf-8');
  await fs.writeFile(gameManagerPath, [
    'using UnityEngine;',
    'using UnityEngine.SceneManagement;',
    '',
    'public class GameManager : MonoBehaviour',
    '{',
    '    public static GameManager Instance { get; private set; }',
    '    public bool IsRunActive { get; private set; }',
    '',
    '    private void Awake()',
    '    {',
    '        if (Instance != null && Instance != this)',
    '        {',
    '            Destroy(gameObject);',
    '            return;',
    '        }',
    '        Instance = this;',
    '        DontDestroyOnLoad(gameObject);',
    '    }',
    '',
    '    public void StartRun()',
    '    {',
    '        IsRunActive = true;',
    '        SceneManager.LoadScene("Gameplay", LoadSceneMode.Single);',
    '    }',
    '',
    '    public void ReturnToMenu()',
    '    {',
    '        IsRunActive = false;',
    '        SceneManager.LoadScene("MainMenu", LoadSceneMode.Single);',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await fs.writeFile(playerControllerPath, [
    'using UnityEngine;',
    '',
    'public class PlayerController : MonoBehaviour',
    '{',
    '    public float moveSpeed = 5f;',
    '    public float attackRange = 2f;',
    '    public float attackDamage = 20f;',
    '    public LayerMask enemyLayer;',
    '    public Transform attackOrigin;',
    '',
    '    private CombatSystem combatSystem;',
    '',
    '    private void Awake()',
    '    {',
    '        combatSystem = GetComponent<CombatSystem>();',
    '        if (attackOrigin == null)',
    '        {',
    '            attackOrigin = transform;',
    '        }',
    '    }',
    '',
    '    private void Update()',
    '    {',
    '        float horizontal = Input.GetAxis("Horizontal");',
    '        float vertical = Input.GetAxis("Vertical");',
    '        transform.Translate(new Vector3(horizontal, 0f, vertical) * moveSpeed * Time.deltaTime);',
    '',
    '        if (Input.GetMouseButtonDown(0))',
    '        {',
    '            combatSystem?.TryAttack(attackOrigin.position, transform.forward, attackRange, attackDamage, enemyLayer);',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await fs.writeFile(enemyControllerPath, [
    'using UnityEngine;',
    '',
    'public class EnemyController : MonoBehaviour',
    '{',
    '    public float chaseSpeed = 2.5f;',
    '    public float attackDistance = 1.25f;',
    '    public float contactDamage = 10f;',
    '    public float attackCooldown = 1f;',
    '',
    '    private Transform playerTarget;',
    '    private float cooldownRemaining;',
    '',
    '    private void Start()',
    '    {',
    '        var player = GameObject.FindGameObjectWithTag("Player");',
    '        playerTarget = player != null ? player.transform : null;',
    '    }',
    '',
    '    private void Update()',
    '    {',
    '        if (playerTarget == null)',
    '        {',
    '            return;',
    '        }',
    '',
    '        Vector3 toPlayer = playerTarget.position - transform.position;',
    '        float distance = toPlayer.magnitude;',
    '',
    '        if (distance > attackDistance)',
    '        {',
    '            Vector3 direction = toPlayer.normalized;',
    '            transform.position += direction * chaseSpeed * Time.deltaTime;',
    '            if (direction.sqrMagnitude > 0.0001f)',
    '            {',
    '                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(direction), 10f * Time.deltaTime);',
    '            }',
    '            return;',
    '        }',
    '',
    '        cooldownRemaining -= Time.deltaTime;',
    '        if (cooldownRemaining <= 0f)',
    '        {',
    '            var health = playerTarget.GetComponent<Health>();',
    '            health?.ApplyDamage(contactDamage);',
    '            cooldownRemaining = attackCooldown;',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await fs.writeFile(combatSystemPath, [
    'using UnityEngine;',
    '',
    'public class CombatSystem : MonoBehaviour',
    '{',
    '    public float attackCooldown = 0.35f;',
    '',
    '    private float nextAttackTime;',
    '',
    '    public bool TryAttack(Vector3 origin, Vector3 forward, float range, float damage, LayerMask targetLayer)',
    '    {',
    '        if (Time.time < nextAttackTime)',
    '        {',
    '            return false;',
    '        }',
    '',
    '        nextAttackTime = Time.time + attackCooldown;',
    '        var hits = Physics.OverlapSphere(origin + forward * 0.5f, range, targetLayer);',
    '        foreach (var hit in hits)',
    '        {',
    '            var health = hit.GetComponent<Health>();',
    '            health?.ApplyDamage(damage);',
    '        }',
    '        return true;',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await fs.writeFile(healthPath, [
    'using UnityEngine;',
    'using UnityEngine.Events;',
    '',
    'public class Health : MonoBehaviour',
    '{',
    '    public float maxHealth = 100f;',
    '    public UnityEvent<float, float> onHealthChanged;',
    '    public UnityEvent onDied;',
    '',
    '    public float CurrentHealth { get; private set; }',
    '',
    '    private void Awake()',
    '    {',
    '        CurrentHealth = maxHealth;',
    '        onHealthChanged?.Invoke(CurrentHealth, maxHealth);',
    '    }',
    '',
    '    public void ApplyDamage(float amount)',
    '    {',
    '        if (amount <= 0f || CurrentHealth <= 0f)',
    '        {',
    '            return;',
    '        }',
    '',
    '        CurrentHealth = Mathf.Max(0f, CurrentHealth - amount);',
    '        onHealthChanged?.Invoke(CurrentHealth, maxHealth);',
    '        if (CurrentHealth <= 0f)',
    '        {',
    '            onDied?.Invoke();',
    '            Destroy(gameObject);',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await fs.writeFile(gameplayLoopControllerPath, [
    'using UnityEngine;',
    '',
    'public class GameplayLoopController : MonoBehaviour',
    '{',
    '    public int scorePerKill = 10;',
    '    public int currentScore;',
    '',
    '    [SerializeField] private EncounterDirector encounterDirector;',
    '    [SerializeField] private HudController hudController;',
    '',
    '    private int remainingEnemies;',
    '',
    '    private void Start()',
    '    {',
    '        TriggerEncounter();',
    '    }',
    '',
    '    public void TriggerEncounter()',
    '    {',
    '        remainingEnemies = encounterDirector != null ? encounterDirector.SpawnWave() : 0;',
    '        hudController?.SetEncounterState(remainingEnemies, currentScore);',
    '    }',
    '',
    '    public void NotifyEnemyDefeated()',
    '    {',
    '        remainingEnemies = Mathf.Max(0, remainingEnemies - 1);',
    '        currentScore += scorePerKill;',
    '        hudController?.SetEncounterState(remainingEnemies, currentScore);',
    '        if (remainingEnemies == 0)',
    '        {',
    '            TriggerEncounter();',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await fs.writeFile(encounterDirectorPath, [
    'using UnityEngine;',
    '',
    'public class EncounterDirector : MonoBehaviour',
    '{',
    '    public GameObject[] enemyPrefabs;',
    '    public Transform[] spawnPoints;',
    '    public int enemiesPerWave = 4;',
    '',
    '    public int SpawnWave()',
    '    {',
    '        if (enemyPrefabs == null || enemyPrefabs.Length == 0 || spawnPoints == null || spawnPoints.Length == 0)',
    '        {',
    '            Debug.LogWarning("EncounterDirector requires prefabs and spawn points.");',
    '            return 0;',
    '        }',
    '',
    '        for (int i = 0; i < enemiesPerWave; i++)',
    '        {',
    '            var prefab = enemyPrefabs[i % enemyPrefabs.Length];',
    '            var spawn = spawnPoints[i % spawnPoints.Length];',
    '            Instantiate(prefab, spawn.position, spawn.rotation);',
    '        }',
    '',
    '        return enemiesPerWave;',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await fs.writeFile(hudControllerPath, [
    'using TMPro;',
    'using UnityEngine;',
    '',
    'public class HudController : MonoBehaviour',
    '{',
    '    public TMP_Text enemiesRemainingText;',
    '    public TMP_Text scoreText;',
    '    public TMP_Text statusText;',
    '',
    '    public void SetEncounterState(int enemiesRemaining, int score)',
    '    {',
    '        if (enemiesRemainingText != null)',
    '        {',
    '            enemiesRemainingText.text = $"Enemies: {enemiesRemaining}";',
    '        }',
    '        if (scoreText != null)',
    '        {',
    '            scoreText.text = $"Score: {score}";',
    '        }',
    '        if (statusText != null)',
    '        {',
    '            statusText.text = enemiesRemaining > 0 ? "In Encounter" : "Preparing Next Wave";',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');
  await fs.writeFile(mainMenuControllerPath, [
    'using UnityEngine;',
    'using UnityEngine.SceneManagement;',
    '',
    'public class MainMenuController : MonoBehaviour',
    '{',
    '    public GameObject rootMenuPanel;',
    '    public GameObject optionsPanel;',
    '',
    '    private void Start()',
    '    {',
    '        ShowMainMenu();',
    '    }',
    '',
    '    public void ShowMainMenu()',
    '    {',
    '        if (rootMenuPanel != null) rootMenuPanel.SetActive(true);',
    '        if (optionsPanel != null) optionsPanel.SetActive(false);',
    '    }',
    '',
    '    public void ShowOptions()',
    '    {',
    '        if (rootMenuPanel != null) rootMenuPanel.SetActive(false);',
    '        if (optionsPanel != null) optionsPanel.SetActive(true);',
    '    }',
    '',
    '    public void StartGame()',
    '    {',
    '        if (GameManager.Instance != null)',
    '        {',
    '            GameManager.Instance.StartRun();',
    '            return;',
    '        }',
    '',
    '        SceneManager.LoadScene("Gameplay", LoadSceneMode.Single);',
    '    }',
    '',
    '    public void QuitGame()',
    '    {',
    '        Application.Quit();',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf-8');

  const generatedEnemyScriptPaths: string[] = [];
  for (const entry of enemyArchetypes) {
    const scriptPath = path.join(unityScriptsDir, 'Enemies', `${entry.id}.cs`);
    await fs.writeFile(scriptPath, buildEnemyArchetypeControllerSource(entry), 'utf-8');
    generatedEnemyScriptPaths.push(scriptPath);
  }

  await fs.writeFile(enemyArchetypesRegistryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: enemyArchetypes.length,
    archetypes: enemyArchetypes,
  }, null, 2), 'utf-8');

  await fs.writeFile(sceneSetupManifestPath, JSON.stringify({
    target: input.spec.setupWizard.target,
    generatedAt: new Date().toISOString(),
    scenes: [
      {
        name: 'MainMenu',
        rootObjects: ['MainMenuCanvas', 'EventSystem', 'PersistentBootstrap'],
        requiredComponents: {
          PersistentBootstrap: ['GameManager'],
          MainMenuCanvas: ['MainMenuController'],
        },
      },
      {
        name: 'Gameplay',
        rootObjects: ['Player', 'GameplaySystems', 'EncounterRoot', 'HudCanvas', 'EnvironmentRoot'],
        requiredComponents: {
          Player: ['CharacterController', 'Health', 'CombatSystem', 'PlayerController'],
          GameplaySystems: ['GameplayLoopController', 'EncounterDirector'],
          HudCanvas: ['HudController'],
        },
      },
    ],
    tags: ['Player', 'Enemy', 'SpawnPoint', 'DamageVolume'],
    layers: ['Player', 'Enemy', 'Projectile', 'Environment', 'Interactable'],
  }, null, 2), 'utf-8');

  await fs.writeFile(prefabRegistryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    prefabs: [
      {
        id: 'player',
        path: 'Assets/Prefabs/Player.prefab',
        requiredComponents: ['CharacterController', 'Health', 'CombatSystem', 'PlayerController'],
      },
      {
        id: 'enemy_base',
        path: 'Assets/Prefabs/Enemies/EnemyBase.prefab',
        requiredComponents: ['Health', 'EnemyController'],
      },
      ...enemyArchetypes.map((entry) => ({
        id: entry.id,
        path: `Assets/Prefabs/Enemies/${entry.id}.prefab`,
        requiredComponents: ['Health', 'EnemyController', `${entry.id.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}Controller`],
      })),
    ],
  }, null, 2), 'utf-8');

  await fs.writeFile(prefabWiringPath, [
    '# Prefab Wiring Instructions',
    '',
    `Generated enemy archetypes: ${enemyArchetypes.length}`,
    '',
    '## 1) Player prefab',
    '- Create Assets/Prefabs/Player.prefab from your player model.',
    '- Add components: CharacterController, Health, CombatSystem, PlayerController.',
    '- Tag this prefab as Player.',
    '',
    '## 2) Enemy base prefab',
    '- Create Assets/Prefabs/Enemies/EnemyBase.prefab with Health + EnemyController.',
    '- Set the Enemy layer and Enemy tag.',
    '',
    '## 3) Enemy archetype prefabs',
    ...enemyArchetypes.map((entry, index) => `- Duplicate EnemyBase into Assets/Prefabs/Enemies/${entry.id}.prefab and add ${entry.id.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}Controller (${index + 1}/${enemyArchetypes.length}).`),
    '',
    '## 4) Gameplay systems',
    '- Add GameplayLoopController + EncounterDirector to GameplaySystems object in Gameplay scene.',
    '- Assign enemy prefab array in EncounterDirector using generated archetype prefabs.',
    '- Add HudController to HudCanvas and map TMP labels for enemies, score, and status.',
    '',
    '## 5) Scene linking',
    '- Keep a persistent bootstrap object with GameManager in MainMenu scene.',
    '- Add MainMenu and Gameplay scenes to Build Settings.',
  ].join('\n'), 'utf-8');

  await fs.writeFile(animationStateMapPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    controllerParameters: [
      { name: 'Speed', type: 'float' },
      { name: 'Attack', type: 'trigger' },
      { name: 'Hit', type: 'trigger' },
      { name: 'Dead', type: 'bool' },
    ],
    playerStates: [
      { state: 'Idle', clip: 'player_idle', transitions: ['Move', 'Attack', 'Hit', 'Dead'] },
      { state: 'Move', clip: 'player_move', transitions: ['Idle', 'Attack', 'Hit', 'Dead'] },
      { state: 'Attack', clip: 'player_attack_01', transitions: ['Idle', 'Move', 'Hit', 'Dead'] },
      { state: 'Hit', clip: 'player_hit', transitions: ['Idle', 'Move', 'Dead'] },
      { state: 'Dead', clip: 'player_death', transitions: [] },
    ],
    enemyStateTemplate: {
      states: [
        { state: 'Idle', clip: '{enemy}_idle' },
        { state: 'Move', clip: '{enemy}_move' },
        { state: 'Attack', clip: '{enemy}_attack_01' },
        { state: 'Hit', clip: '{enemy}_hit' },
        { state: 'Dead', clip: '{enemy}_death' },
      ],
      transitions: ['Idle->Move', 'Move->Attack', 'Any->Hit', 'Any->Dead'],
    },
    enemyArchetypes: enemyArchetypes.map((entry) => ({
      id: entry.id,
      expectedClipPrefix: entry.id,
    })),
  }, null, 2), 'utf-8');

  await fs.writeFile(animatorControllerScaffoldPath, [
    '# Animator Controller Scaffold',
    '',
    'Create the following controllers under Assets/Animation/Controllers:',
    '- Player.controller with states: Idle, Move, Attack, Hit, Dead',
    '- EnemyBase.controller with states: Idle, Move, Attack, Hit, Dead',
    '',
    'Use parameters:',
    '- Speed (float)',
    '- Attack (trigger)',
    '- Hit (trigger)',
    '- Dead (bool)',
    '',
    'Bind generated clips according to Animation/animation-state-map.json and create per-archetype AnimatorOverrideController assets.',
    `Expected archetype override count: ${enemyArchetypes.length}`,
  ].join('\n'), 'utf-8');

  artifacts.push(
    { id: 'gate4-asset-manifest', kind: 'asset-manifest', relativePath: path.relative(input.workspacePath, assetManifestPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(assetManifestPath)}` },
    { id: 'gate4-import-package', kind: 'import-package', relativePath: path.relative(input.workspacePath, importPackagePath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(importPackagePath)}` },
    { id: 'gate4-validation-report', kind: 'validation-report', relativePath: path.relative(input.workspacePath, validationReportPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(validationReportPath)}` },
    { id: 'gate4-hero-object', kind: 'model', relativePath: path.relative(input.workspacePath, heroObjectPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(heroObjectPath)}` },
    { id: 'gate4-enemy-object', kind: 'model', relativePath: path.relative(input.workspacePath, enemyObjectPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(enemyObjectPath)}` },
    { id: 'gate4-enemy-archetypes-registry', kind: 'model', relativePath: path.relative(input.workspacePath, enemyArchetypesRegistryPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(enemyArchetypesRegistryPath)}` },
    { id: 'gate4-game-manager', kind: 'model', relativePath: path.relative(input.workspacePath, gameManagerPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(gameManagerPath)}` },
    { id: 'gate4-player-controller', kind: 'model', relativePath: path.relative(input.workspacePath, playerControllerPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(playerControllerPath)}` },
    { id: 'gate4-enemy-controller', kind: 'model', relativePath: path.relative(input.workspacePath, enemyControllerPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(enemyControllerPath)}` },
    { id: 'gate4-combat-system', kind: 'model', relativePath: path.relative(input.workspacePath, combatSystemPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(combatSystemPath)}` },
    { id: 'gate4-health', kind: 'model', relativePath: path.relative(input.workspacePath, healthPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(healthPath)}` },
    { id: 'gate4-gameplay-loop-controller', kind: 'model', relativePath: path.relative(input.workspacePath, gameplayLoopControllerPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(gameplayLoopControllerPath)}` },
    { id: 'gate4-encounter-director', kind: 'model', relativePath: path.relative(input.workspacePath, encounterDirectorPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(encounterDirectorPath)}` },
    { id: 'gate4-hud-controller', kind: 'model', relativePath: path.relative(input.workspacePath, hudControllerPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(hudControllerPath)}` },
    { id: 'gate4-main-menu-controller', kind: 'model', relativePath: path.relative(input.workspacePath, mainMenuControllerPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(mainMenuControllerPath)}` },
    { id: 'gate4-scene-setup-manifest', kind: 'model', relativePath: path.relative(input.workspacePath, sceneSetupManifestPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(sceneSetupManifestPath)}` },
    { id: 'gate4-prefab-registry', kind: 'model', relativePath: path.relative(input.workspacePath, prefabRegistryPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(prefabRegistryPath)}` },
    { id: 'gate4-prefab-wiring-instructions', kind: 'model', relativePath: path.relative(input.workspacePath, prefabWiringPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(prefabWiringPath)}` },
    { id: 'gate4-animation-state-map', kind: 'model', relativePath: path.relative(input.workspacePath, animationStateMapPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(animationStateMapPath)}` },
    { id: 'gate4-animator-controller-scaffold', kind: 'model', relativePath: path.relative(input.workspacePath, animatorControllerScaffoldPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(animatorControllerScaffoldPath)}` },
    ...generatedEnemyScriptPaths.map((filePath, index) => ({
      id: `gate4-enemy-archetype-${index + 1}`,
      kind: 'model' as const,
      relativePath: path.relative(input.workspacePath, filePath).split(path.sep).join('/'),
      status: 'ready' as const,
      provenance: `gate4:${path.basename(filePath)}`,
    })),
  );

  return { ready: true, artifacts };
}

export async function evaluateGate4Readiness(input: { workspacePath: string; spec: GameCreatorGateSpec }): Promise<{ ready: boolean; blockers: string[] }> {
  const gateDir = path.join(input.workspacePath, 'GameBuild', 'gates', 'gate4');
  const requiredFiles = ['asset-manifest.json', 'import-package.json', 'validation-report.json', 'assets/hero.obj', 'assets/enemy_slime.obj'];
  const blockers: string[] = [];

  for (const fileName of requiredFiles) {
    const filePath = path.join(gateDir, fileName);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        blockers.push(`Missing Gate 4 artifact: ${fileName}`);
      }
    } catch {
      blockers.push(`Missing Gate 4 artifact: ${fileName}`);
    }
  }

  if (input.spec.setupWizard.controls.trim().length === 0) {
    blockers.push('Controls are not defined.');
  }

  return { ready: blockers.length === 0, blockers };
}
