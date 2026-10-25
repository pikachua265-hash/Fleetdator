import { AIProvider, RepairPromptContext } from './AIProvider.js';
import { AIPatch, PatchFileChange } from '../types/index.js';

export class OpenAIProvider extends AIProvider {
  name: 'openai' = 'openai';
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    super();
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    this.model = model || process.env.OPENAI_MODEL || 'gpt-4o';
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    if (!this.isConfigured()) {
      return { success: false, message: 'OpenAI API key is not configured.' };
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 10
        })
      });

      if (!response.ok) {
        // Fallback to gpt-4o-mini
        const fallbackRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Say OK' }],
            max_tokens: 10
          })
        });

        if (fallbackRes.ok) {
          this.model = 'gpt-4o-mini';
          return { success: true, message: 'Connected successfully using gpt-4o-mini', model: 'gpt-4o-mini' };
        }

        const errText = await response.text();
        return { success: false, message: `OpenAI API returned ${response.status}: ${errText}` };
      }

      return { success: true, message: `Connected to OpenAI successfully (${this.model})`, model: this.model };
    } catch (e: any) {
      return { success: false, message: `Connection test failed: ${e.message}` };
    }
  }

  async generateRepairPatch(context: RepairPromptContext): Promise<AIPatch> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key is not configured.');
    }

    const prompt = this.buildRepairPrompt(context);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: this.getSystemPrompt() },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    const data: any = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error('OpenAI returned an empty response.');
    }

    return this.parsePatchResponse(rawContent, context.attemptNumber, this.model);
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
      provider: 'openai',
      model,
      rationale: parsed.rationale || 'AI-generated migration patch',
      changes,
      rawResponse: rawText,
      timestamp: new Date().toISOString()
    };
  }
}
