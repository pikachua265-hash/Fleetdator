import { AIPatch, CompilerDiagnostic, ModLoader } from '../types/index.js';

export interface RepairPromptContext {
  modId: string;
  loader: ModLoader;
  sourceMinecraft: string;
  targetMinecraft: string;
  compilerDiagnostics: CompilerDiagnostic[];
  rawBuildOutput: string;
  affectedFiles: Record<string, string>; // relativePath -> content
  previousPatches?: AIPatch[];
  attemptNumber: number;
}

export abstract class AIProvider {
  abstract name: 'gemini' | 'openai';
  abstract isConfigured(): boolean;
  abstract testConnection(): Promise<{ success: boolean; message: string; model?: string }>;
  abstract generateRepairPatch(context: RepairPromptContext): Promise<AIPatch>;

  protected getSystemPrompt(): string {
    return `You are a Senior Minecraft Mod Migration Engineer specializing in Fabric, Forge, and NeoForge mod ecosystems.

CRITICAL RULES:
1. Preserve original functionality, mod ID, loader, assets, networking, and configuration.
2. Fabric MUST remain Fabric. Forge MUST remain Forge. NeoForge MUST remain NeoForge. NEVER convert loaders.
3. Make minimal, technically justified changes to resolve the exact compiler errors or API breaks.
4. NEVER invent APIs. Use only official Mojang, Fabric, and Forge APIs corresponding to the target Minecraft version.
5. NEVER remove mod features or delete broken mixins merely to make compilation pass. Fix the method signature, injection point, or type.
6. Provide output strictly as a valid JSON object matching the requested schema. No conversational filler or markdown fences outside the JSON.`;
  }
}
