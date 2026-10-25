import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { InspectionReport, ModDependency, MixinInfo, ModLoader } from '../types/index.js';
import { computeSha256 } from '../security/fileSecurity.js';

export interface FileAccessor {
  allFiles: string[];
  readText(filePath: string): string | null;
}

export class ModInspector {
  /**
   * Inspects a mod artifact (.jar, .zip, or unzipped directory) with zero unnecessary disk I/O.
   * Archive files are analyzed directly in-memory via central directory parsing in < 25ms.
   */
  async inspect(artifactPath: string): Promise<InspectionReport> {
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Artifact does not exist at: ${artifactPath}`);
    }

    const stats = fs.statSync(artifactPath);
    const sha256 = computeSha256(artifactPath);
    const fileName = path.basename(artifactPath);
    const fileSizeBytes = stats.size;

    if (stats.isFile() && (artifactPath.endsWith('.jar') || artifactPath.endsWith('.zip'))) {
      const zip = new AdmZip(artifactPath);
      const zipEntries = zip.getEntries();
      const allFiles = zipEntries.map((e) => e.entryName.replace(/\\/g, '/'));

      const accessor: FileAccessor = {
        allFiles,
        readText: (fp: string) => {
          const normalized = fp.replace(/\\/g, '/').toLowerCase();
          const entry = zipEntries.find((e) => {
            const entryNorm = e.entryName.replace(/\\/g, '/').toLowerCase();
            return entryNorm === normalized || entryNorm.endsWith('/' + normalized);
          });
          if (!entry || entry.isDirectory) return null;
          try {
            return entry.getData().toString('utf-8');
          } catch {
            return null;
          }
        }
      };

      return this.analyzeWithAccessor(accessor, sha256, fileName, fileSizeBytes, artifactPath.endsWith('.jar'));
    } else if (stats.isDirectory()) {
      const allFiles = this.getAllRelativeFiles(artifactPath);
      const accessor: FileAccessor = {
        allFiles,
        readText: (fp: string) => {
          try {
            const normalized = fp.replace(/\\/g, '/').toLowerCase();
            const matched = allFiles.find((f) => {
              const normF = f.replace(/\\/g, '/').toLowerCase();
              return normF === normalized || normF.endsWith('/' + normalized);
            });
            if (!matched) return null;
            return fs.readFileSync(path.join(artifactPath, matched), 'utf-8');
          } catch {
            return null;
          }
        }
      };
      return this.analyzeWithAccessor(accessor, sha256, fileName, fileSizeBytes, false);
    } else {
      throw new Error(`Unsupported artifact format: ${artifactPath}. Expected .jar, .zip or directory.`);
    }
  }

  analyzeWithAccessor(
    accessor: FileAccessor,
    sha256: string,
    fileName: string,
    fileSizeBytes: number,
    isJarArtifact: boolean
  ): InspectionReport {
    const allFiles = accessor.allFiles;

    const hasFabricJson = allFiles.some((f) => f.toLowerCase() === 'fabric.mod.json' || f.toLowerCase().endsWith('/fabric.mod.json'));
    const hasNeoForgeModsToml = allFiles.some((f) => f.toLowerCase().endsWith('meta-inf/neoforge.mods.toml'));
    const hasForgeModsToml = allFiles.some((f) => f.toLowerCase().endsWith('meta-inf/mods.toml'));
    const hasBuildGradle = allFiles.some((f) => f.toLowerCase() === 'build.gradle' || f.toLowerCase() === 'build.gradle.kts');
    const hasGradleProperties = allFiles.some((f) => f.toLowerCase() === 'gradle.properties');

    const javaFiles = allFiles.filter((f) => f.endsWith('.java'));
    const kotlinFiles = allFiles.filter((f) => f.endsWith('.kt'));
    const classFiles = allFiles.filter((f) => f.endsWith('.class'));
    const resourceFiles = allFiles.filter((f) => !f.endsWith('.java') && !f.endsWith('.kt') && !f.endsWith('.class') && !f.startsWith('.git'));

    const sourceFilesCount = javaFiles.length + kotlinFiles.length;
    const isBinaryOnly = isJarArtifact && sourceFilesCount === 0 && classFiles.length > 0;

    let loader: ModLoader = 'fabric';
    if (hasNeoForgeModsToml) {
      loader = 'neoforge';
    } else if (hasForgeModsToml) {
      loader = 'forge';
    } else if (hasFabricJson) {
      loader = 'fabric';
    } else if (hasBuildGradle) {
      const buildGradleContent = accessor.readText('build.gradle') || accessor.readText('build.gradle.kts') || '';
      if (buildGradleContent.includes('fabric-loom') || buildGradleContent.includes('net.fabricmc')) {
        loader = 'fabric';
      } else if (buildGradleContent.includes('net.neoforged') || buildGradleContent.includes('neoforge')) {
        loader = 'neoforge';
      } else if (buildGradleContent.includes('net.minecraftforge') || buildGradleContent.includes('forgegradle')) {
        loader = 'forge';
      }
    }

    let modId = 'unknown';
    let modName = fileName.replace(/\.(jar|zip)$/i, '');
    let modVersion = '1.0.0';
    let currentMinecraft = '1.21.1';
    let javaVersion = 21;
    let environment: 'client' | 'server' | 'both' = 'both';
    const dependencies: ModDependency[] = [];
    const optionalDependencies: ModDependency[] = [];
    const mixins: MixinInfo[] = [];
    const accessWideners: string[] = [];
    const accessTransformers: string[] = [];
    const entrypoints: Record<string, string[]> = {};
    const migrationNotes: string[] = [];

    // Parse Gradle properties if present
    const gradlePropsContent = accessor.readText('gradle.properties');
    let gradleProps: Record<string, string> = {};
    if (gradlePropsContent) {
      gradleProps = this.parseProperties(gradlePropsContent);
      if (gradleProps['minecraft_version']) currentMinecraft = gradleProps['minecraft_version'];
      if (gradleProps['mod_version']) modVersion = gradleProps['mod_version'];
      if (gradleProps['mod_id']) modId = gradleProps['mod_id'];
      if (gradleProps['mod_name']) modName = gradleProps['mod_name'];
    }

    // Inspect Fabric metadata
    if (loader === 'fabric') {
      const fabricJsonContent = accessor.readText('fabric.mod.json');
      if (fabricJsonContent) {
        try {
          const content = JSON.parse(fabricJsonContent.replace(/^\ufeff/, ''));
          if (content.id) modId = content.id;
          if (content.name) modName = content.name;
          if (content.version) modVersion = content.version;
          if (content.environment) {
            environment = content.environment === '*' ? 'both' : content.environment;
          }

          if (content.depends) {
            for (const [depId, versionRange] of Object.entries(content.depends)) {
              if (depId === 'minecraft') {
                currentMinecraft = String(versionRange).replace(/^[~^>=< ]+/, '');
              } else if (depId === 'java') {
                const jv = parseInt(String(versionRange).replace(/[^0-9]/g, ''), 10);
                if (!isNaN(jv)) javaVersion = jv;
              } else {
                dependencies.push({
                  id: depId,
                  versionRange: String(versionRange),
                  required: true
                });
              }
            }
          }

          if (content.suggests || content.recommends) {
            const opt = { ...content.suggests, ...content.recommends };
            for (const [depId, versionRange] of Object.entries(opt)) {
              optionalDependencies.push({
                id: depId,
                versionRange: String(versionRange),
                required: false
              });
            }
          }

          if (content.entrypoints) {
            for (const [epName, epValue] of Object.entries(content.entrypoints)) {
              if (Array.isArray(epValue)) {
                entrypoints[epName] = epValue.map((v) => (typeof v === 'string' ? v : v.value || JSON.stringify(v)));
              } else if (typeof epValue === 'string') {
                entrypoints[epName] = [epValue];
              }
            }
          }

          if (content.mixins) {
            for (const m of content.mixins) {
              const mixinConfigName = typeof m === 'string' ? m : m.config;
              if (mixinConfigName) {
                const parsedMixin = this.parseMixinConfig(accessor, mixinConfigName);
                mixins.push(parsedMixin);
              }
            }
          }

          if (content.accessWidener) {
            accessWideners.push(content.accessWidener);
          }
        } catch (e: any) {
          migrationNotes.push(`Warning parsing fabric.mod.json: ${e.message}`);
        }
      }
    }

    // Inspect Forge metadata
    if (loader === 'forge' || loader === 'neoforge') {
      const tomlContent = accessor.readText('meta-inf/neoforge.mods.toml') || accessor.readText('meta-inf/mods.toml');
      if (tomlContent) {
        const parsedToml = this.parseSimpleToml(tomlContent.replace(/^\ufeff/, ''));
        if (parsedToml.modId) modId = parsedToml.modId;
        if (parsedToml.displayName) modName = parsedToml.displayName;
        if (parsedToml.version) modVersion = parsedToml.version;

        if (parsedToml.dependencies) {
          for (const dep of parsedToml.dependencies) {
            if (dep.modId === 'minecraft') {
              currentMinecraft = dep.versionRange.replace(/^[~^>=<[\]() ]+/, '').split(',')[0].trim();
            } else if (dep.mandatory) {
              dependencies.push({
                id: dep.modId,
                versionRange: dep.versionRange,
                required: true
              });
            } else {
              optionalDependencies.push({
                id: dep.modId,
                versionRange: dep.versionRange,
                required: false
              });
            }
          }
        }
      }

      const atFile = allFiles.find((f) => f.toLowerCase().endsWith('meta-inf/accesstransformer.cfg'));
      if (atFile) {
        accessTransformers.push(atFile);
      }
    }

    // Gradle toolchain & mappings inspection
    let gradleVersion: string | undefined;
    let toolchainVersion: string | undefined;
    let mappings: string | undefined;

    const wrapperPropContent = accessor.readText('gradle/wrapper/gradle-wrapper.properties');
    if (wrapperPropContent) {
      const match = wrapperPropContent.match(/gradle-([0-9.]+)-/);
      if (match) gradleVersion = match[1];
    }

    const buildGradleContent = accessor.readText('build.gradle') || accessor.readText('build.gradle.kts');
    if (buildGradleContent) {
      const yarnMatch = buildGradleContent.match(/mappings\s+['"]net\.fabricmc:yarn:([^'"]+)['"]/);
      if (yarnMatch) {
        mappings = `Yarn ${yarnMatch[1]}`;
      } else if (buildGradleContent.includes('official()') || buildGradleContent.includes('parchment')) {
        mappings = 'Mojang / Parchment';
      }

      const loomMatch = buildGradleContent.match(/fabric-loom['"]\s+version\s+['"]([^'"]+)['"]/);
      if (loomMatch) {
        toolchainVersion = `Loom ${loomMatch[1]}`;
      }
      const fgMatch = buildGradleContent.match(/net\.minecraftforge\.gradle['"]\s+version\s+['"]([^'"]+)['"]/);
      if (fgMatch) {
        toolchainVersion = `ForgeGradle ${fgMatch[1]}`;
      }
    }

    // Source language determination
    let sourceLanguage: 'java' | 'kotlin' | 'both' | 'unknown' = 'unknown';
    if (javaFiles.length > 0 && kotlinFiles.length > 0) sourceLanguage = 'both';
    else if (javaFiles.length > 0) sourceLanguage = 'java';
    else if (kotlinFiles.length > 0) sourceLanguage = 'kotlin';

    // Binary-only analysis
    let canMigrateFromBinary = true;
    if (isBinaryOnly) {
      canMigrateFromBinary = false;
      migrationNotes.push(
        'Source project required for reliable migration. This uploaded file is a precompiled binary JAR containing compiled bytecode (.class files) without Java source code. Deterministic AST migration and clean recompilation require the original source project.'
      );
    }

    return {
      modId: modId.replace(/\$\{.*\}/g, 'mod'),
      modName: modName.replace(/\$\{.*\}/g, 'Mod'),
      modVersion: modVersion.replace(/\$\{.*\}/g, '1.0.0'),
      loader,
      currentMinecraft,
      javaVersion,
      environment,
      dependencies,
      optionalDependencies,
      gradleVersion,
      toolchainVersion,
      mappings,
      mixins,
      accessWideners,
      accessTransformers,
      entrypoints,
      sourceLanguage,
      sourceFilesCount,
      resourcesCount: resourceFiles.length,
      isBinaryOnly,
      canMigrateFromBinary,
      migrationNotes,
      sha256,
      fileName,
      fileSizeBytes
    };
  }

  private parseProperties(content: string): Record<string, string> {
    const props: Record<string, string> = {};
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        props[key] = val;
      }
    }
    return props;
  }

  private parseMixinConfig(accessor: FileAccessor, configPath: string): MixinInfo {
    const rawContent = accessor.readText(configPath);
    if (!rawContent) {
      return { configFile: configPath, mixins: [] };
    }

    try {
      const content = JSON.parse(rawContent.replace(/^\ufeff/, ''));
      return {
        configFile: configPath,
        package: content.package,
        mixins: Array.isArray(content.mixins) ? content.mixins : [],
        clientMixins: Array.isArray(content.client) ? content.client : [],
        serverMixins: Array.isArray(content.server) ? content.server : []
      };
    } catch {
      return { configFile: configPath, mixins: [] };
    }
  }

  private parseSimpleToml(content: string): {
    modId?: string;
    displayName?: string;
    version?: string;
    dependencies?: Array<{ modId: string; versionRange: string; mandatory: boolean }>;
  } {
    const result: any = { dependencies: [] };
    const lines = content.split(/\r?\n/);
    let currentDep: any = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('[[dependencies.') || trimmed.startsWith('[[neoforge.dependencies.')) {
        if (currentDep) result.dependencies.push(currentDep);
        currentDep = { mandatory: true, versionRange: '*' };
        continue;
      }

      const matchModId = trimmed.match(/^modId\s*=\s*["']([^"']+)["']/);
      if (matchModId) {
        if (currentDep) currentDep.modId = matchModId[1];
        else if (!result.modId) result.modId = matchModId[1];
        continue;
      }

      const matchName = trimmed.match(/^displayName\s*=\s*["']([^"']+)["']/);
      if (matchName && !result.displayName) {
        result.displayName = matchName[1];
        continue;
      }

      const matchVer = trimmed.match(/^version\s*=\s*["']([^"']+)["']/);
      if (matchVer && !result.version) {
        result.version = matchVer[1];
        continue;
      }

      const matchMandatory = trimmed.match(/^mandatory\s*=\s*(true|false)/i);
      if (matchMandatory && currentDep) {
        currentDep.mandatory = matchMandatory[1].toLowerCase() === 'true';
        continue;
      }

      const matchRange = trimmed.match(/^versionRange\s*=\s*["']([^"']+)["']/);
      if (matchRange && currentDep) {
        currentDep.versionRange = matchRange[1];
        continue;
      }
    }

    if (currentDep) result.dependencies.push(currentDep);
    return result;
  }

  private getAllRelativeFiles(dir: string, base: string = dir): string[] {
    let files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(this.getAllRelativeFiles(fullPath, base));
      } else {
        files.push(path.relative(base, fullPath).replace(/\\/g, '/'));
      }
    }

    return files;
  }
}
