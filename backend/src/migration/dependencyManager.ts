import { ModDependency, ModLoader } from '../types/index.js';

export interface DependencyCheckResult {
  allCompatible: boolean;
  blockedDependencies: ModDependency[];
  updatedDependencies: ModDependency[];
  notes: string[];
}

export class DependencyManager {
  // Known ecosystem dependency compatibility tables
  private fabricApiVersions: Record<string, string> = {
    '26.2': '0.116.0+26.2',
    '26.1': '0.115.0+26.1',
    '1.21.11': '0.114.0+1.21.11',
    '1.21.4': '0.114.0+1.21.4',
    '1.21.3': '0.106.0+1.21.3',
    '1.21.1': '0.104.0+1.21.1',
    '1.21': '0.100.0+1.21',
    '1.20.6': '0.99.0+1.20.6',
    '1.20.4': '0.97.0+1.20.4',
    '1.20.2': '0.91.0+1.20.2',
    '1.20.1': '0.92.2+1.20.1',
    '1.19.4': '0.87.2+1.19.4',
    '1.19.2': '0.77.0+1.19.2',
    '1.18.2': '0.76.0+1.18.2'
  };

  private clothConfigVersions: Record<string, string> = {
    '1.21.1': '15.0.127',
    '1.21': '15.0.127',
    '1.20.4': '13.0.121',
    '1.20.1': '11.1.118',
    '1.19.2': '8.2.88'
  };

  private modMenuVersions: Record<string, string> = {
    '1.21.1': '11.0.1',
    '1.21': '11.0.0',
    '1.20.4': '9.0.0',
    '1.20.1': '7.2.2',
    '1.19.2': '4.2.0-beta.2'
  };

  async checkDependencies(
    loader: ModLoader,
    targetMcVersion: string,
    dependencies: ModDependency[]
  ): Promise<DependencyCheckResult> {
    const blocked: ModDependency[] = [];
    const updated: ModDependency[] = [];
    const notes: string[] = [];

    for (const dep of dependencies) {
      if (dep.id === 'minecraft' || dep.id === 'java') {
        continue;
      }

      if (loader === 'fabric') {
        if (dep.id === 'fabric' || dep.id === 'fabric-api' || dep.id === 'fabricloader') {
          if (dep.id === 'fabricloader') {
            updated.push({
              ...dep,
              targetCompatibleVersion: '>=0.16.0',
              compatible: true
            });
          } else {
            const fApiVer = this.findCompatibleFabricApi(targetMcVersion);
            if (fApiVer) {
              updated.push({
                ...dep,
                targetCompatibleVersion: fApiVer,
                compatible: true
              });
              notes.push(`Updated Fabric API to compatible release ${fApiVer} for Minecraft ${targetMcVersion}`);
            } else if (dep.required) {
              blocked.push({
                ...dep,
                compatible: false
              });
              notes.push(`BLOCKED BY DEPENDENCY: Fabric API has no verified compatible release for Minecraft ${targetMcVersion}`);
            }
          }
          continue;
        }

        if (dep.id === 'cloth-config' || dep.id === 'cloth-config2') {
          const cVer = this.clothConfigVersions[targetMcVersion];
          if (cVer) {
            updated.push({
              ...dep,
              targetCompatibleVersion: cVer,
              compatible: true
            });
          } else if (dep.required && !targetMcVersion.startsWith('1.21')) {
            notes.push(`Warning: Cloth Config may need manual verification on Minecraft ${targetMcVersion}`);
            updated.push({ ...dep, compatible: true });
          } else {
            updated.push({ ...dep, compatible: true });
          }
          continue;
        }

        if (dep.id === 'modmenu') {
          const mVer = this.modMenuVersions[targetMcVersion];
          if (mVer) {
            updated.push({
              ...dep,
              targetCompatibleVersion: mVer,
              compatible: true
            });
          } else {
            // ModMenu is typically optional
            updated.push({ ...dep, compatible: true });
          }
          continue;
        }
      }

      // Default: retain dependency with open check
      updated.push({
        ...dep,
        compatible: true
      });
    }

    return {
      allCompatible: blocked.length === 0,
      blockedDependencies: blocked,
      updatedDependencies: updated,
      notes
    };
  }

  private findCompatibleFabricApi(mcVersion: string): string | undefined {
    if (this.fabricApiVersions[mcVersion]) {
      return this.fabricApiVersions[mcVersion];
    }
    // Check partial prefix
    for (const [v, fApi] of Object.entries(this.fabricApiVersions)) {
      if (mcVersion.startsWith(v)) return fApi;
    }
    if (mcVersion.startsWith('26.')) {
      return '0.116.0+26.2';
    }
    if (mcVersion.startsWith('1.21')) {
      return '0.104.0+1.21.1';
    }
    return undefined;
  }
}
