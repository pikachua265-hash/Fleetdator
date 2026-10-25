export interface VersionInfo {
  version: string;
  stable: boolean;
  releaseTime?: string;
}

export interface LoaderVersionInfo {
  loader: 'fabric' | 'forge' | 'neoforge';
  minecraftVersion: string;
  recommendedLoaderVersion: string;
  recommendedToolchainVersion: string;
  recommendedMappings?: string;
  javaVersion: number;
}

export class VersionResolver {
  private cachedGameVersions: VersionInfo[] = [];
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

  // High-reliability offline fallback versions
  private readonly fallbackGameVersions: VersionInfo[] = [
    { version: '26.4-snapshot-5', stable: false },
    { version: '26.3', stable: true },
    { version: '26.2', stable: true },
    { version: '26.1.2', stable: true },
    { version: '26.1', stable: true },
    { version: '1.21.11', stable: true },
    { version: '1.21.10', stable: true },
    { version: '1.21.4', stable: true },
    { version: '1.21.3', stable: true },
    { version: '1.21.1', stable: true },
    { version: '1.21', stable: true },
    { version: '1.20.6', stable: true },
    { version: '1.20.4', stable: true },
    { version: '1.20.2', stable: true },
    { version: '1.20.1', stable: true },
    { version: '1.19.4', stable: true },
    { version: '1.19.2', stable: true },
    { version: '1.18.2', stable: true },
    { version: '1.17.1', stable: true },
    { version: '1.16.5', stable: true }
  ];

  constructor() {
    this.cachedGameVersions = this.fallbackGameVersions;
    // Refresh in background without blocking
    this.refreshVersionsInBackground();
  }

  private async refreshVersionsInBackground(): Promise<void> {
    try {
      const response = await fetch('https://meta.fabricmc.net/v2/versions/game');
      if (response.ok) {
        const data = (await response.json()) as any[];
        this.cachedGameVersions = data.map((v) => ({
          version: v.version,
          stable: v.stable
        }));
        this.lastFetchTime = Date.now();
      }
    } catch {}
  }

  async getGameVersions(): Promise<VersionInfo[]> {
    if (this.cachedGameVersions.length > 0) {
      if (Date.now() - this.lastFetchTime > this.CACHE_TTL_MS) {
        this.refreshVersionsInBackground();
      }
      return this.cachedGameVersions;
    }
    return this.fallbackGameVersions;
  }

  async resolveToolchainForVersion(loader: 'fabric' | 'forge' | 'neoforge', targetMcVersion: string): Promise<LoaderVersionInfo> {
    const javaVersion = this.getJavaVersionForMinecraft(targetMcVersion);

    if (loader === 'fabric') {
      let loaderVersion = '0.16.9';
      let loomVersion = '1.9-SNAPSHOT';
      let yarnMappings = `${targetMcVersion}+build.1`;

      return {
        loader: 'fabric',
        minecraftVersion: targetMcVersion,
        recommendedLoaderVersion: loaderVersion,
        recommendedToolchainVersion: loomVersion,
        recommendedMappings: yarnMappings,
        javaVersion
      };
    } else if (loader === 'forge') {
      let forgeVersion = '51.0.8';
      if (targetMcVersion.startsWith('1.21')) forgeVersion = '51.0.33';
      else if (targetMcVersion.startsWith('1.20.1')) forgeVersion = '47.3.0';
      else if (targetMcVersion.startsWith('1.19.2')) forgeVersion = '43.3.0';
      else if (targetMcVersion.startsWith('1.18.2')) forgeVersion = '40.2.0';

      return {
        loader: 'forge',
        minecraftVersion: targetMcVersion,
        recommendedLoaderVersion: forgeVersion,
        recommendedToolchainVersion: '6.0.+',
        recommendedMappings: 'official',
        javaVersion
      };
    } else {
      let neoForgeVersion = '21.1.65';
      if (targetMcVersion.startsWith('1.21.1') || targetMcVersion.startsWith('21.1')) neoForgeVersion = '21.1.65';
      else if (targetMcVersion.startsWith('1.20.4')) neoForgeVersion = '20.4.237';

      return {
        loader: 'neoforge',
        minecraftVersion: targetMcVersion,
        recommendedLoaderVersion: neoForgeVersion,
        recommendedToolchainVersion: '7.0.+',
        recommendedMappings: 'official',
        javaVersion
      };
    }
  }

  getJavaVersionForMinecraft(mcVersion: string): number {
    // Minecraft 1.20.5+ and 1.21+ and 26.x use Java 21
    if (mcVersion.startsWith('26.') || mcVersion.startsWith('25.') || mcVersion.startsWith('24.')) return 21;
    if (mcVersion.startsWith('1.21') || mcVersion.startsWith('1.20.5') || mcVersion.startsWith('1.20.6')) return 21;
    if (mcVersion.startsWith('1.18') || mcVersion.startsWith('1.19') || mcVersion.startsWith('1.20')) return 17;
    if (mcVersion.startsWith('1.17')) return 16;
    return 8;
  }
}
