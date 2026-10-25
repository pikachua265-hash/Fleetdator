import * as fs from 'fs';
import * as path from 'path';
import { InspectionReport, ModLoader } from '../types/index.js';
import { LoaderVersionInfo } from './versionResolver.js';
import { DependencyCheckResult } from './dependencyManager.js';

export interface MigrationStepLog {
  stage: 'LEVEL_0' | 'LEVEL_1' | 'LEVEL_2';
  description: string;
  filesModified: string[];
}

export interface DeterministicMigrationResult {
  alreadyCompatible: boolean;
  steps: MigrationStepLog[];
  modifiedFiles: string[];
  summary: string;
}

export class DeterministicMigrator {
  /**
   * Performs deterministic migration on the project directory.
   */
  async migrate(
    projectDir: string,
    inspection: InspectionReport,
    targetMcVersion: string,
    toolchainInfo: LoaderVersionInfo,
    depResult: DependencyCheckResult
  ): Promise<DeterministicMigrationResult> {
    const steps: MigrationStepLog[] = [];
    const allModifiedFiles: Set<string> = new Set();

    // LEVEL 0: Check if already compatible
    const isAlreadyCompatible = this.checkAlreadyCompatible(inspection, targetMcVersion);
    if (isAlreadyCompatible) {
      steps.push({
        stage: 'LEVEL_0',
        description: `Project is already compatible with target Minecraft ${targetMcVersion}. No code transformation needed.`,
        filesModified: []
      });
      return {
        alreadyCompatible: true,
        steps,
        modifiedFiles: [],
        summary: `Already compatible with Minecraft ${targetMcVersion}`
      };
    }

    // LEVEL 1: Automatic Toolchain Migration
    const toolchainMods = await this.migrateToolchain(
      projectDir,
      inspection.loader,
      targetMcVersion,
      toolchainInfo,
      depResult
    );
    if (toolchainMods.length > 0) {
      steps.push({
        stage: 'LEVEL_1',
        description: `Updated build toolchain, Loom/ForgeGradle configurations, Java target, and dependencies for ${targetMcVersion}`,
        filesModified: toolchainMods
      });
      toolchainMods.forEach((f) => allModifiedFiles.add(f));
    }

    // LEVEL 2: Source & Metadata Migration
    const sourceMods = await this.migrateSourceAndMetadata(
      projectDir,
      inspection.loader,
      targetMcVersion,
      toolchainInfo
    );
    if (sourceMods.length > 0) {
      steps.push({
        stage: 'LEVEL_2',
        description: `Performed deterministic source replacements, registry updates, Identifier syntax, Text components, and resource pack metadata`,
        filesModified: sourceMods
      });
      sourceMods.forEach((f) => allModifiedFiles.add(f));
    }

    return {
      alreadyCompatible: false,
      steps,
      modifiedFiles: Array.from(allModifiedFiles),
      summary: `Deterministic migration applied across ${allModifiedFiles.size} files.`
    };
  }

  private checkAlreadyCompatible(inspection: InspectionReport, targetMcVersion: string): boolean {
    if (inspection.currentMinecraft === targetMcVersion) return true;

    // Check version range in fabric dependencies
    for (const dep of inspection.dependencies) {
      if (dep.id === 'minecraft') {
        const range = dep.versionRange;
        if (range.includes('*') || range.includes('>=') || range.includes('||')) {
          if (this.versionMatchesRange(targetMcVersion, range)) return true;
        }
      }
    }
    return false;
  }

  private versionMatchesRange(target: string, range: string): boolean {
    if (range === '*' || range === '>=1.20' || range.includes(target)) return true;
    return false;
  }

  private async migrateToolchain(
    dir: string,
    loader: ModLoader,
    targetMcVersion: string,
    toolchainInfo: LoaderVersionInfo,
    depResult: DependencyCheckResult
  ): Promise<string[]> {
    const modified: string[] = [];

    // 1. gradle.properties
    const propsPath = path.join(dir, 'gradle.properties');
    if (fs.existsSync(propsPath)) {
      let content = fs.readFileSync(propsPath, 'utf-8').replace(/^\uFEFF/, '');
      let changed = false;

      // Update minecraft_version
      if (/minecraft_version\s*=/i.test(content)) {
        content = content.replace(/minecraft_version\s*=\s*.+/i, `minecraft_version = ${targetMcVersion}`);
        changed = true;
      }
      // Update yarn_mappings
      if (/yarn_mappings\s*=/i.test(content) && toolchainInfo.recommendedMappings) {
        content = content.replace(/yarn_mappings\s*=\s*.+/i, `yarn_mappings = ${toolchainInfo.recommendedMappings}`);
        changed = true;
      }
      // Update loader_version
      if (/loader_version\s*=/i.test(content)) {
        content = content.replace(/loader_version\s*=\s*.+/i, `loader_version = ${toolchainInfo.recommendedLoaderVersion}`);
        changed = true;
      }
      // Update fabric_version (Fabric API)
      const fApiDep = depResult.updatedDependencies.find((d) => d.id === 'fabric' || d.id === 'fabric-api');
      if (fApiDep?.targetCompatibleVersion && /fabric_version\s*=/i.test(content)) {
        content = content.replace(/fabric_version\s*=\s*.+/i, `fabric_version = ${fApiDep.targetCompatibleVersion}`);
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(propsPath, content, 'utf-8');
        modified.push('gradle.properties');
      }
    }

    // 2. build.gradle / build.gradle.kts
    const buildGradlePath = path.join(dir, 'build.gradle');
    if (fs.existsSync(buildGradlePath)) {
      let content = fs.readFileSync(buildGradlePath, 'utf-8').replace(/^\uFEFF/, '');
      let changed = false;

      // Java compatibility update
      const targetJava = toolchainInfo.javaVersion;
      if (content.includes('JavaVersion.VERSION_17') && targetJava === 21) {
        content = content.replace(/JavaVersion\.VERSION_17/g, 'JavaVersion.VERSION_21');
        changed = true;
      }
      if (content.includes('JavaVersion.VERSION_16') && targetJava === 21) {
        content = content.replace(/JavaVersion\.VERSION_16/g, 'JavaVersion.VERSION_21');
        changed = true;
      }
      if (content.includes('sourceCompatibility = 17') && targetJava === 21) {
        content = content.replace(/sourceCompatibility = 17/g, 'sourceCompatibility = 21');
        content = content.replace(/targetCompatibility = 17/g, 'targetCompatibility = 21');
        changed = true;
      }

      // Update Loom version if using older Loom
      if (loader === 'fabric' && content.includes('fabric-loom')) {
        content = content.replace(/id\s*['"]fabric-loom['"]\s*version\s*['"][0-9a-zA-Z.-]+['"]/, `id 'fabric-loom' version '${toolchainInfo.recommendedToolchainVersion}'`);
        changed = true;
      }

      // Update direct minecraft dependency if hardcoded
      if (content.includes('minecraft "com.mojang:minecraft:')) {
        content = content.replace(/minecraft\s*["']com\.mojang:minecraft:[^"']+["']/, `minecraft "com.mojang:minecraft:${targetMcVersion}"`);
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(buildGradlePath, content, 'utf-8');
        modified.push('build.gradle');
      }
    }

    // 3. gradle-wrapper.properties
    const wrapperPropPath = path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    if (fs.existsSync(wrapperPropPath)) {
      let content = fs.readFileSync(wrapperPropPath, 'utf-8');
      // Java 21 requires at least Gradle 8.5+; use Gradle 8.10.2
      if (toolchainInfo.javaVersion >= 21 && (content.includes('gradle-7.') || content.includes('gradle-8.0') || content.includes('gradle-8.1'))) {
        content = content.replace(/gradle-[0-9.]+-bin\.zip/, 'gradle-8.10.2-bin.zip');
        fs.writeFileSync(wrapperPropPath, content, 'utf-8');
        modified.push(path.join('gradle', 'wrapper', 'gradle-wrapper.properties'));
      }
    }

    return modified;
  }

  private async migrateSourceAndMetadata(
    dir: string,
    loader: ModLoader,
    targetMcVersion: string,
    toolchainInfo: LoaderVersionInfo
  ): Promise<string[]> {
    const modified: string[] = [];

    // 1. Update fabric.mod.json
    if (loader === 'fabric') {
      const fabricFiles = this.findFilesNamed(dir, 'fabric.mod.json');
      for (const fPath of fabricFiles) {
        try {
          const content = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
          let changed = false;

          if (content.depends) {
            if (content.depends.minecraft) {
              content.depends.minecraft = `>=${targetMcVersion}`;
              changed = true;
            }
            if (content.depends.java && toolchainInfo.javaVersion >= 21) {
              content.depends.java = '>=21';
              changed = true;
            }
          }

          if (changed) {
            fs.writeFileSync(fPath, JSON.stringify(content, null, 2), 'utf-8');
            modified.push(path.relative(dir, fPath));
          }
        } catch {
          // ignore json errors
        }
      }
    }

    // 2. Update mods.toml (Forge / NeoForge)
    if (loader === 'forge' || loader === 'neoforge') {
      const tomlFiles = this.findFilesNamed(dir, 'mods.toml').concat(this.findFilesNamed(dir, 'neoforge.mods.toml'));
      for (const tPath of tomlFiles) {
        let content = fs.readFileSync(tPath, 'utf-8');
        // Update versionRange for minecraft
        const replaced = content.replace(/(modId\s*=\s*["']minecraft["'][\s\S]*?versionRange\s*=\s*["'])[^"']+["']/g, `$1[${targetMcVersion},)`);
        if (replaced !== content) {
          fs.writeFileSync(tPath, replaced, 'utf-8');
          modified.push(path.relative(dir, tPath));
        }
      }
    }

    // 3. Update pack.mcmeta format
    const packMetaFiles = this.findFilesNamed(dir, 'pack.mcmeta');
    const targetPackFormat = this.getPackFormatForVersion(targetMcVersion);
    for (const pmPath of packMetaFiles) {
      try {
        const content = JSON.parse(fs.readFileSync(pmPath, 'utf-8'));
        if (content.pack && content.pack.pack_format !== targetPackFormat) {
          content.pack.pack_format = targetPackFormat;
          fs.writeFileSync(pmPath, JSON.stringify(content, null, 2), 'utf-8');
          modified.push(path.relative(dir, pmPath));
        }
      } catch {
        // ignore
      }
    }

    // 4. Source code deterministic AST / Regex migrations for Java files
    const javaFiles = this.findFilesWithExtension(dir, '.java');
    for (const jPath of javaFiles) {
      let code = fs.readFileSync(jPath, 'utf-8');
      const originalCode = code;

      // Rule A: Identifier instantiation changes in 1.21+ / 26.x
      // new Identifier("modid", "path") -> Identifier.of("modid", "path")
      // new Identifier("modid:path") -> Identifier.of("modid:path")
      if (this.isVersionAtLeast(targetMcVersion, '1.21')) {
        code = code.replace(/new\s+Identifier\s*\(\s*(".*?")\s*,\s*(".*?")\s*\)/g, 'Identifier.of($1, $2)');
        code = code.replace(/new\s+Identifier\s*\(\s*(".*?")\s*\)/g, 'Identifier.of($1)');
        code = code.replace(/new\s+Identifier\s*\(\s*([a-zA-Z0-9_$.]+)\s*,\s*([a-zA-Z0-9_$.]+)\s*\)/g, 'Identifier.of($1, $2)');
      }

      // Rule B: Text creation
      // new TranslatableText(...) -> Text.translatable(...)
      // new LiteralText(...) -> Text.literal(...)
      code = code.replace(/new\s+TranslatableText\s*\(/g, 'Text.translatable(');
      code = code.replace(/new\s+LiteralText\s*\(/g, 'Text.literal(');

      // Rule C: Registry changes (net.minecraft.util.registry.Registry -> net.minecraft.registry.Registries)
      if (code.includes('import net.minecraft.util.registry.Registry;')) {
        code = code.replace(
          'import net.minecraft.util.registry.Registry;',
          'import net.minecraft.registry.Registry;\nimport net.minecraft.registry.Registries;'
        );
      }
      code = code.replace(/Registry\.ITEM/g, 'Registries.ITEM');
      code = code.replace(/Registry\.BLOCK/g, 'Registries.BLOCK');
      code = code.replace(/Registry\.ENTITY_TYPE/g, 'Registries.ENTITY_TYPE');
      code = code.replace(/Registry\.SOUND_EVENT/g, 'Registries.SOUND_EVENT');

      // Rule D: Block settings
      code = code.replace(/FabricBlockSettings\.of\(Material\.[A-Z]+\)/g, 'AbstractBlock.Settings.create()');
      code = code.replace(/FabricBlockSettings\.create\(\)/g, 'AbstractBlock.Settings.create()');

      if (code !== originalCode) {
        fs.writeFileSync(jPath, code, 'utf-8');
        modified.push(path.relative(dir, jPath));
      }
    }

    return modified;
  }

  private isVersionAtLeast(version: string, base: string): boolean {
    if (version.startsWith('26.') || version.startsWith('25.')) return true;
    const vParts = version.split('.').map((p) => parseInt(p, 10) || 0);
    const bParts = base.split('.').map((p) => parseInt(p, 10) || 0);
    for (let i = 0; i < Math.max(vParts.length, bParts.length); i++) {
      const v = vParts[i] || 0;
      const b = bParts[i] || 0;
      if (v > b) return true;
      if (v < b) return false;
    }
    return true;
  }

  private getPackFormatForVersion(mcVersion: string): number {
    if (mcVersion.startsWith('26.')) return 65;
    if (mcVersion.startsWith('1.21.4')) return 61;
    if (mcVersion.startsWith('1.21.1') || mcVersion.startsWith('1.21')) return 48;
    if (mcVersion.startsWith('1.20.6') || mcVersion.startsWith('1.20.5')) return 34;
    if (mcVersion.startsWith('1.20.4')) return 22;
    if (mcVersion.startsWith('1.20.1')) return 15;
    if (mcVersion.startsWith('1.19.4')) return 13;
    if (mcVersion.startsWith('1.19.2')) return 9;
    return 8;
  }

  private findFilesNamed(dir: string, fileName: string): string[] {
    const results: string[] = [];
    const walk = (d: string) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory() && !e.name.startsWith('.git')) {
          walk(full);
        } else if (e.name.toLowerCase() === fileName.toLowerCase()) {
          results.push(full);
        }
      }
    };
    walk(dir);
    return results;
  }

  private findFilesWithExtension(dir: string, ext: string): string[] {
    const results: string[] = [];
    const walk = (d: string) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory() && !e.name.startsWith('.git') && e.name !== 'build') {
          walk(full);
        } else if (e.name.endsWith(ext)) {
          results.push(full);
        }
      }
    };
    walk(dir);
    return results;
  }
}
