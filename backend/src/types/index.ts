export type ModLoader = 'fabric' | 'forge' | 'neoforge';

export type JobState =
  | 'QUEUED'
  | 'INSPECTING'
  | 'PREPARING'
  | 'MIGRATING'
  | 'BUILDING'
  | 'TESTING'
  | 'DIAGNOSING'
  | 'AI_REPAIRING'
  | 'REBUILDING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'MANUAL_REVIEW';

export type ResultState =
  | 'SUCCESS'
  | 'SUCCESS_WITH_WARNINGS'
  | 'NEEDS_MANUAL_REVIEW'
  | 'BLOCKED'
  | 'FAILED';

export type LogSeverity = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
export type LogStage =
  | 'INSPECT'
  | 'PREPARE'
  | 'MIGRATE'
  | 'BUILD'
  | 'TEST'
  | 'DIAGNOSE'
  | 'AI'
  | 'PATCH'
  | 'ROLLBACK'
  | 'VALIDATE'
  | 'SYSTEM';

export interface LogEntry {
  timestamp: string;
  stage: LogStage;
  severity: LogSeverity;
  message: string;
  details?: any;
}

export interface ModDependency {
  id: string;
  versionRange: string;
  required: boolean;
  targetCompatibleVersion?: string;
  compatible?: boolean;
}

export interface MixinInfo {
  configFile: string;
  package?: string;
  mixins: string[];
  clientMixins?: string[];
  serverMixins?: string[];
}

export interface InspectionReport {
  modId: string;
  modName: string;
  modVersion: string;
  loader: ModLoader;
  currentMinecraft: string;
  targetMinecraft?: string;
  javaVersion: number;
  environment: 'client' | 'server' | 'both';
  dependencies: ModDependency[];
  optionalDependencies: ModDependency[];
  gradleVersion?: string;
  toolchainVersion?: string;
  mappings?: string;
  mixins: MixinInfo[];
  accessWideners: string[];
  accessTransformers: string[];
  entrypoints: Record<string, string[]>;
  sourceLanguage: 'java' | 'kotlin' | 'both' | 'unknown';
  sourceFilesCount: number;
  resourcesCount: number;
  isBinaryOnly: boolean;
  canMigrateFromBinary: boolean;
  migrationNotes: string[];
  sha256: string;
  fileName: string;
  fileSizeBytes: number;
}

export interface CompilerDiagnostic {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
  message: string;
  codeSnippet?: string;
}

export interface BuildResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  compilerDiagnostics: CompilerDiagnostic[];
  artifactPath?: string;
  sha256?: string;
  durationMs: number;
}

export interface ValidationReport {
  passed: boolean;
  metadataValid: boolean;
  buildValid: boolean;
  isolatedTestPassed: boolean;
  clientTestPassed?: boolean;
  serverTestPassed?: boolean;
  warnings: string[];
  errors: string[];
  details: Record<string, any>;
}

export interface PatchFileChange {
  path: string;
  operation: 'modify' | 'create' | 'delete';
  content?: string;
  originalSnippet?: string;
  replacementSnippet?: string;
  explanation: string;
}

export interface AIPatch {
  attempt: number;
  provider: 'gemini' | 'openai';
  model: string;
  rationale: string;
  changes: PatchFileChange[];
  rawResponse?: string;
  timestamp: string;
}

export interface Checkpoint {
  id: string;
  name: string;
  timestamp: string;
  files: Record<string, string>;
  buildError?: string;
}

export interface UpdateJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  state: JobState;
  resultState?: ResultState;
  loader: ModLoader;
  currentMinecraft: string;
  targetMinecraft: string;
  aiMode: 'automatic' | 'gemini' | 'openai' | 'disabled';
  maxRepairAttempts: number;
  currentRepairAttempt: number;
  inspection?: InspectionReport;
  buildResult?: BuildResult;
  validation?: ValidationReport;
  logs: LogEntry[];
  patches: AIPatch[];
  checkpoints: Checkpoint[];
  originalArtifact: {
    fileName: string;
    sha256: string;
    path: string;
    sizeBytes: number;
  };
  updatedArtifact?: {
    fileName: string;
    sha256: string;
    path: string;
    sizeBytes: number;
  };
  failureReason?: string;
}

export interface AIProviderConfig {
  geminiApiKey?: string;
  geminiModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  preferredProvider: 'automatic' | 'gemini' | 'openai';
  maxRepairAttempts: number;
}
