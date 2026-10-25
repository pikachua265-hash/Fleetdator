import { AIProvider, RepairPromptContext } from './AIProvider.js';
import { AIPatch, PatchFileChange } from '../types/index.js';

export class GeminiProvider extends AIProvider {
  name: 'gemini' = 'gemini';
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    super();
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.model = model || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    if (!this.isConfigured()) {
      return { success: false, message: 'Gemini API key is not configured.' };
    }

    try {
      // Test generation with short prompt
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with "OK".' }] }],
          generationConfig: { maxOutputTokens: 20 }
        })
      });

      if (!response.ok) {
        // Try fallback to gemini-flash-lite-latest or gemini-3.8-flash
        const fallbacks = ['gemini-flash-lite-latest', 'gemini-3.8-flash'];
        for (const fb of fallbacks) {
          const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fb}:generateContent?key=${this.apiKey}`;
          const fallbackRes = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Respond with "OK".' }] }],
              generationConfig: { maxOutputTokens: 20 }
            })
          });

          if (fallbackRes.ok) {
            this.model = fb;
            return { success: true, message: `Connected successfully using ${fb}`, model: fb };
          }
        }

        const errText = await response.text();
        return { success: false, message: `Gemini API returned ${response.status}: ${errText}` };
      }

      return { success: true, message: `Connected to Gemini successfully (${this.model})`, model: this.model };
    } catch (e: any) {
      return { success: false, message: `Connection test failed: ${e.message}` };
    }
  }

  async generateRepairPatch(context: RepairPromptContext): Promise<AIPatch> {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key is not configured.');
    }

    const prompt = this.buildRepairPrompt(context);
    const candidateModels = [this.model, 'gemini-flash-lite-latest', 'gemini-3.8-flash'];

    let lastError = '';
    for (const mod of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent?key=${this.apiKey}`;
        const requestBody = {
          systemInstruction: {
            parts: [{ text: this.getSystemPrompt() }]
          },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          lastError = await response.text();
          continue; // Try next model on 503 or other spike
        }

        const data: any = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          return this.parsePatchResponse(rawText, context.attemptNumber, mod);
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }

    throw new Error(`Gemini API error across all candidate models: ${lastError}`);
  }

  private buildRepairPrompt(context: RepairPromptContext): string {
    return `TASK: Repair Minecraft mod compiler errors encountered during migration from ${context.sourceMinecraft} to ${context.targetMinecraft}.
Mod ID: ${context.modId}
Mod Loader: ${context.loader} (MUST REMAIN ${context.loader.toUpperCase()})
Attempt: ${context.attemptNumber}

EXACT COMPILER ERRORS:
${context.compilerDiagnostics.map((d) => `[${d.severity.toUpperCase()}] ${d.file}:${d.line || '?'} - ${d.message}\n${d.codeSnippet || ''}`).join('\n')}

RAW BUILD OUTPUT SNIPPET:
${context.rawBuildOutput.slice(-2000)}

AFFECTED SOURCE FILES:
${Object.entries(context.affectedFiles)
  .map(([fPath, content]) => `--- FILE: ${fPath} ---\n${content}\n--- END FILE ---`)
  .join('\n\n')}

REQUIREMENTS:
1. Provide the exact file modification to resolve the compiler error.
2. Maintain standard Java / Minecraft conventions.
3. Output STRICTLY as JSON with this schema:
{
  "rationale": "Brief technical explanation of API change and fix",
  "changes": [
    {
      "path": "src/main/java/...",
      "operation": "modify",
      "originalSnippet": "exact verbatim string to find in file",
      "replacementSnippet": "exact verbatim replacement string",
      "explanation": "Why this change is needed"
    }
  ]
}`;
  }

  private parsePatchResponse(rawText: string, attempt: number, model: string): AIPatch {
    // Clean potential markdown blocks
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/```\s*$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned);
    const changes: PatchFileChange[] = Array.isArray(parsed.changes)
      ? parsed.changes.map((c: any) => ({
          path: c.path,
          operation: c.operation || 'modify',
          originalSnippet: c.originalSnippet,
          replacementSnippet: c.replacementSnippet,
          content: c.content,
          explanation: c.explanation || ''
        }))
      : [];

    return {
      attempt,
      provider: 'gemini',
      model,
      rationale: parsed.rationale || 'AI-generated migration patch',
      changes,
      rawResponse: rawText,
      timestamp: new Date().toISOString()
    };
  }
}
