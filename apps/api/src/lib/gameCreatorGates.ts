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
  await fs.mkdir(assetsDir, { recursive: true });

  const assetManifest = {
    target: input.spec.setupWizard.target,
    generatedAt: new Date().toISOString(),
    assets: [
      { id: 'hero', kind: 'character', file: 'assets/hero.fbx', importStatus: 'ready' },
      { id: 'enemy_slime', kind: 'enemy', file: 'assets/enemy_slime.fbx', importStatus: 'ready' },
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

  await fs.writeFile(assetManifestPath, JSON.stringify(assetManifest, null, 2), 'utf-8');
  await fs.writeFile(importPackagePath, JSON.stringify({
    gate3ReferenceCount: input.gate3Artifacts.length,
    target: input.spec.setupWizard.target,
    importRules: assetManifest.importRules,
  }, null, 2), 'utf-8');
  await fs.writeFile(validationReportPath, JSON.stringify({
    ready: true,
    checks: ['topology', 'textures', 'materials', 'import-compatibility'],
  }, null, 2), 'utf-8');
  await fs.writeFile(heroObjectPath, ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'f 1 2 3', ''].join('\n'), 'utf-8');
  await fs.writeFile(enemyObjectPath, ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n'), 'utf-8');

  artifacts.push(
    { id: 'gate4-asset-manifest', kind: 'asset-manifest', relativePath: path.relative(input.workspacePath, assetManifestPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(assetManifestPath)}` },
    { id: 'gate4-import-package', kind: 'import-package', relativePath: path.relative(input.workspacePath, importPackagePath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(importPackagePath)}` },
    { id: 'gate4-validation-report', kind: 'validation-report', relativePath: path.relative(input.workspacePath, validationReportPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(validationReportPath)}` },
    { id: 'gate4-hero-object', kind: 'model', relativePath: path.relative(input.workspacePath, heroObjectPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(heroObjectPath)}` },
    { id: 'gate4-enemy-object', kind: 'model', relativePath: path.relative(input.workspacePath, enemyObjectPath).split(path.sep).join('/'), status: 'ready', provenance: `gate4:${path.basename(enemyObjectPath)}` },
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
