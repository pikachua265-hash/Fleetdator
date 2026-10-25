import * as fs from 'fs';
import * as path from 'path';
import {
  AIPatch,
  BuildResult,
  Checkpoint,
  CompilerDiagnostic,
  InspectionReport,
  ModLoader,
  PatchFileChange
} from '../types/index.js';
import { AIProvider } from './AIProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

export interface RepairAttemptResult {
  patchApplied: boolean;
  rolledBack: boolean;
  patch?: AIPatch;
  newBuildResult?: BuildResult;
  diagnosticsImprovement: boolean;
  message: string;
}

export class RepairEngine {
  private gemini: GeminiProvider;
  private openai: OpenAIProvider;

  constructor() {
    this.gemini = new GeminiProvider();
    this.openai = new OpenAIProvider();
  }

  getActiveProvider(preferred: 'automatic' | 'gemini' | 'openai'): AIProvider | null {
    if (preferred === 'gemini') {
      return this.gemini.isConfigured() ? this.gemini : null;
    }
    if (preferred === 'openai') {
      return this.openai.isConfigured() ? this.openai : null;
    }
    // Automatic: pick first configured provider
    if (this.gemini.isConfigured()) return this.gemini;
    if (this.openai.isConfigured()) return this.openai;
    return null;
  }

  createCheckpoint(workspaceDir: string, checkpointId: string, name: string): Checkpoint {
    const filesToSave = this.scanAllSourceFiles(workspaceDir);
    const filesMap: Record<string, string> = {};

    for (const relFile of filesToSave) {
      const fullPath = path.join(workspaceDir, relFile);
      if (fs.existsSync(fullPath)) {
        filesMap[relFile] = fs.readFileSync(fullPath, 'utf-8');
      }
    }

    return {
      id: checkpointId,
      name,
      timestamp: new Date().toISOString(),
      files: filesMap
    };
  }

  restoreCheckpoint(workspaceDir: string, checkpoint: Checkpoint): void {
    for (const [relPath, content] of Object.entries(checkpoint.files)) {
      const fullPath = path.join(workspaceDir, relPath);
      const parent = path.dirname(fullPath);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  }

  collectAffectedSourceFiles(workspaceDir: string, diagnostics: CompilerDiagnostic[]): Record<string, string> {
    const affected: Record<string, string> = {};

    for (const d of diagnostics) {
      if (!d.file) continue;
      const cleanRel = d.file.replace(/^[\\/]/, '');
      const fullPath = path.join(workspaceDir, cleanRel);

      if (fs.existsSync(fullPath) && !affected[cleanRel]) {
        affected[cleanRel] = fs.readFileSync(fullPath, 'utf-8');
      } else {
        // Search by basename if relative path didn't match directly
        const baseName = path.basename(cleanRel);
        const match = this.findFileRecursive(workspaceDir, baseName);
        if (match && !affected[match.relPath]) {
          affected[match.relPath] = fs.readFileSync(match.fullPath, 'utf-8');
        }
      }
    }

    return affected;
  }

  applyPatch(workspaceDir: string, patch: AIPatch): { success: boolean; appliedChanges: string[]; errors: string[] } {
    const appliedChanges: string[] = [];
    const errors: string[] = [];

    for (const change of patch.changes) {
      const targetRel = change.path.replace(/^[\\/]/, '');
      let fullPath = path.join(workspaceDir, targetRel);

      if (!fs.existsSync(fullPath)) {
        const found = this.findFileRecursive(workspaceDir, path.basename(targetRel));
        if (found) {
          fullPath = found.fullPath;
        } else if (change.operation !== 'create') {
          errors.push(`Target file does not exist: ${change.path}`);
          continue;
        }
      }

      if (change.operation === 'modify') {
        const currentContent = fs.readFileSync(fullPath, 'utf-8');

        if (change.originalSnippet && change.replacementSnippet !== undefined) {
          if (!currentContent.includes(change.originalSnippet)) {
            // Try trimmed search
            const trimmedOriginal = change.originalSnippet.trim();
            if (currentContent.includes(trimmedOriginal)) {
              const updated = currentContent.replace(trimmedOriginal, change.replacementSnippet.trim());
              fs.writeFileSync(fullPath, updated, 'utf-8');
              appliedChanges.push(`Modified ${targetRel} (fuzzy match)`);
            } else {
              errors.push(`Original snippet not found in ${targetRel}`);
            }
          } else {
            const updated = currentContent.replace(change.originalSnippet, change.replacementSnippet);
            fs.writeFileSync(fullPath, updated, 'utf-8');
            appliedChanges.push(`Modified ${targetRel}`);
          }
        } else if (change.content) {
          fs.writeFileSync(fullPath, change.content, 'utf-8');
          appliedChanges.push(`Replaced content of ${targetRel}`);
        }
      } else if (change.operation === 'create' && change.content) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, change.content, 'utf-8');
        appliedChanges.push(`Created ${targetRel}`);
      } else if (change.operation === 'delete') {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          appliedChanges.push(`Deleted ${targetRel}`);
        }
      }
    }

    return {
      success: appliedChanges.length > 0 && errors.length === 0,
      appliedChanges,
      errors
    };
  }

  private scanAllSourceFiles(dir: string, base: string = dir): string[] {
    let list: string[] = [];
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'build' && e.name !== '.git' && e.name !== '.gradle') {
        list = list.concat(this.scanAllSourceFiles(full, base));
      } else if (
        e.name.endsWith('.java') ||
        e.name.endsWith('.kt') ||
        e.name.endsWith('.gradle') ||
        e.name.endsWith('.properties') ||
        e.name.endsWith('.json') ||
        e.name.endsWith('.toml')
      ) {
        list.push(path.relative(base, full).replace(/\\/g, '/'));
      }
    }
    return list;
  }

  private findFileRecursive(dir: string, targetName: string, base: string = dir): { fullPath: string; relPath: string } | null {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'build' && e.name !== '.git') {
        const found = this.findFileRecursive(full, targetName, base);
        if (found) return found;
      } else if (e.name.toLowerCase() === targetName.toLowerCase()) {
        return { fullPath: full, relPath: path.relative(base, full).replace(/\\/g, '/') };
      }
    }
    return null;
  }
}
