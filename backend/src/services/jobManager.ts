import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
  AIPatch,
  BuildResult,
  Checkpoint,
  InspectionReport,
  JobState,
  LogEntry,
  LogSeverity,
  LogStage,
  ModLoader,
  ResultState,
  UpdateJob,
  ValidationReport
} from '../types/index.js';
import { SandboxManager, WorkspaceDirs } from '../security/sandbox.js';
import { computeSha256, safeExtractZip } from '../security/fileSecurity.js';
import { ModInspector } from '../inspector/modInspector.js';
import { VersionResolver } from '../migration/versionResolver.js';
import { DependencyManager } from '../migration/dependencyManager.js';
import { DeterministicMigrator } from '../migration/deterministicMigrator.js';
import { BuildRunner } from '../build/buildRunner.js';
import { ModValidator } from '../validation/validator.js';
import { RepairEngine } from '../ai/repairEngine.js';

export class JobManager extends EventEmitter {
  private jobs: Map<string, UpdateJob> = new Map();
  private storePath: string;
  private sandbox: SandboxManager;
  private inspector: ModInspector;
  private versionResolver: VersionResolver;
  private dependencyManager: DependencyManager;
  private migrator: DeterministicMigrator;
  private buildRunner: BuildRunner;
  private validator: ModValidator;
  private repairEngine: RepairEngine;

  constructor(workspaceRoot: string) {
    super();
    this.sandbox = new SandboxManager(workspaceRoot);
    this.storePath = path.join(workspaceRoot, 'jobs_store.json');
    this.inspector = new ModInspector();
    this.versionResolver = new VersionResolver();
    this.dependencyManager = new DependencyManager();
    this.migrator = new DeterministicMigrator();
    this.buildRunner = new BuildRunner(this.sandbox);
    this.validator = new ModValidator();
    this.repairEngine = new RepairEngine();

    this.loadPersistedJobs();
  }

  getJob(id: string): UpdateJob | undefined {
    return this.jobs.get(id);
  }

  getAllJobs(): UpdateJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  createJob(params: {
    artifactPath: string;
    targetMinecraft: string;
    loader?: ModLoader;
    aiMode?: 'automatic' | 'gemini' | 'openai' | 'disabled';
    maxRepairAttempts?: number;
  }): UpdateJob {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stats = fs.statSync(params.artifactPath);
    const sha256 = computeSha256(params.artifactPath);
    const fileName = path.basename(params.artifactPath);

    const job: UpdateJob = {
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'QUEUED',
      loader: params.loader || 'fabric',
      currentMinecraft: '',
      targetMinecraft: params.targetMinecraft,
      aiMode: params.aiMode || 'automatic',
      maxRepairAttempts: params.maxRepairAttempts || 8,
      currentRepairAttempt: 0,
      logs: [],
      patches: [],
      checkpoints: [],
      originalArtifact: {
        fileName,
        sha256,
        path: params.artifactPath,
        sizeBytes: stats.size
      }
    };

    this.jobs.set(id, job);
    this.persistJobs();
    this.log(job, 'SYSTEM', 'INFO', `Job ${id} created for ${fileName}`);

    // Start background processing
    setImmediate(() => this.processJob(job));

    return job;
  }

  async cancelJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.state === 'COMPLETED' || job.state === 'FAILED') return false;

    job.state = 'FAILED';
    job.resultState = 'FAILED';
    job.failureReason = 'Job cancelled by user';
    job.updatedAt = new Date().toISOString();
    this.log(job, 'SYSTEM', 'WARN', 'Job execution cancelled by user');
    this.persistJobs();
    return true;
  }

  private async processJob(job: UpdateJob): Promise<void> {
    const workspaceDirs = this.sandbox.createJobWorkspace(job.id);

    try {
      // 1. INSPECTING
      this.setJobState(job, 'INSPECTING');
      this.log(job, 'INSPECT', 'INFO', `Inspecting uploaded mod artifact: ${job.originalArtifact.fileName}`);

      const inspection = await this.inspector.inspect(job.originalArtifact.path);
      job.inspection = inspection;
      job.loader = inspection.loader; // LOADER LOCK: Never silently convert loaders!
      job.currentMinecraft = inspection.currentMinecraft;
      this.log(
        job,
        'INSPECT',
        'INFO',
        `Detected loader: ${inspection.loader.toUpperCase()} | Minecraft: ${inspection.currentMinecraft} | Mod: ${inspection.modName} (${inspection.modId})`
      );

      // Binary-only validation check (Section 2 & 26)
      if (inspection.isBinaryOnly && !inspection.canMigrateFromBinary) {
        this.log(
          job,
          'INSPECT',
          'WARN',
          'Source project required for reliable migration. Arbitrary binary JAR migration cannot guarantee stable bytecode remapping.'
        );
        this.finishJob(
          job,
          'MANUAL_REVIEW',
          'NEEDS_MANUAL_REVIEW',
          'Source project required for reliable migration. This uploaded file is a precompiled binary JAR containing compiled bytecode (.class files) without Java source code.'
        );
        return;
      }

      // 2. PREPARING WORKSPACE
      this.setJobState(job, 'PREPARING');
      this.log(job, 'PREPARE', 'INFO', `Preparing isolated sandbox workspace for job ${job.id}`);

      // Extract original project into workspace/source
      safeExtractZip(job.originalArtifact.path, workspaceDirs.source);

      // Create Checkpoint 0
      const cp0 = this.repairEngine.createCheckpoint(
        workspaceDirs.source,
        'checkpoint-0-original',
        'Original uploaded project'
      );
      job.checkpoints.push(cp0);

      // Resolve target toolchains & versions
      const toolchainInfo = await this.versionResolver.resolveToolchainForVersion(
        job.loader,
        job.targetMinecraft
      );
      this.log(
        job,
        'PREPARE',
        'INFO',
        `Resolved target toolchain for ${job.targetMinecraft}: Loader ${toolchainInfo.recommendedLoaderVersion}, Toolchain ${toolchainInfo.recommendedToolchainVersion}, Java ${toolchainInfo.javaVersion}`
      );

      // Check dependency compatibility
      const depCheck = await this.dependencyManager.checkDependencies(
        job.loader,
        job.targetMinecraft,
        inspection.dependencies
      );

      for (const note of depCheck.notes) {
        this.log(job, 'PREPARE', note.includes('BLOCKED') ? 'ERROR' : 'INFO', note);
      }

      if (!depCheck.allCompatible) {
        const blockedNames = depCheck.blockedDependencies.map((d) => d.id).join(', ');
        this.finishJob(
          job,
          'FAILED',
          'BLOCKED',
          `BLOCKED BY DEPENDENCY: Incompatible dependencies for target Minecraft ${job.targetMinecraft}: ${blockedNames}`
        );
        return;
      }

      // 3. MIGRATING (Deterministic Level 0, 1, 2)
      this.setJobState(job, 'MIGRATING');
      this.log(job, 'MIGRATE', 'INFO', `Running deterministic migration from ${job.currentMinecraft} to ${job.targetMinecraft}...`);

      const migrationResult = await this.migrator.migrate(
        workspaceDirs.source,
        inspection,
        job.targetMinecraft,
        toolchainInfo,
        depCheck
      );

      for (const step of migrationResult.steps) {
        this.log(job, 'MIGRATE', 'INFO', `[${step.stage}] ${step.description}`);
        if (step.filesModified.length > 0) {
          this.log(job, 'MIGRATE', 'DEBUG', `Files updated: ${step.filesModified.join(', ')}`);
        }
      }

      // Create Checkpoint 1 (Deterministic Migration)
      const cp1 = this.repairEngine.createCheckpoint(
        workspaceDirs.source,
        'checkpoint-1-deterministic',
        'After deterministic migration'
      );
      job.checkpoints.push(cp1);

      // 4. BUILDING
      this.setJobState(job, 'BUILDING');
      this.log(job, 'BUILD', 'INFO', `Executing real build with target toolchain (JDK ${toolchainInfo.javaVersion})...`);

      let buildResult = await this.buildRunner.build(workspaceDirs.source, (chunk, isErr) => {
        // Stream build output to SSE logs
        const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines.slice(0, 10)) {
          this.log(job, 'BUILD', isErr ? 'WARN' : 'INFO', line);
        }
      });

      job.buildResult = buildResult;

      // 5. EVALUATE BUILD RESULT & ENTER AI REPAIR LOOP IF FAILED
      if (!buildResult.success) {
        this.log(job, 'BUILD', 'ERROR', `Initial build failed with exit code ${buildResult.exitCode}. Error count: ${buildResult.compilerDiagnostics.length}`);

        // AI Repair Loop (Section 7)
        let repairSuccess = false;
        if (job.aiMode !== 'disabled') {
          const aiProvider = this.repairEngine.getActiveProvider(job.aiMode);

          if (!aiProvider) {
            this.log(job, 'AI', 'WARN', 'No configured AI provider available for automated repair. Marking for manual review.');
          } else {
            this.log(job, 'AI', 'INFO', `Active AI provider: ${aiProvider.name.toUpperCase()} (mode: ${job.aiMode}). Commencing diagnostic repair loop.`);

            let previousErrorHash = '';
            let repeatCount = 0;

            while (job.currentRepairAttempt < job.maxRepairAttempts && !repairSuccess) {
              job.currentRepairAttempt++;
              this.setJobState(job, 'AI_REPAIRING');

              const errorSummary = buildResult.compilerDiagnostics.map((d) => `${d.file}:${d.line}:${d.message}`).join('|');
              if (errorSummary === previousErrorHash) {
                repeatCount++;
                if (repeatCount >= 2) {
                  this.log(job, 'AI', 'WARN', 'Repeated identical compilation error encountered across multiple repair cycles. Halting repair loop.');
                  break;
                }
              } else {
                previousErrorHash = errorSummary;
                repeatCount = 0;
              }

              this.log(
                job,
                'AI',
                'INFO',
                `AI Repair Attempt ${job.currentRepairAttempt}/${job.maxRepairAttempts} analyzing ${buildResult.compilerDiagnostics.length} compiler error(s)...`
              );

              // Collect affected source files
              const affectedSources = this.repairEngine.collectAffectedSourceFiles(
                workspaceDirs.source,
                buildResult.compilerDiagnostics
              );

              try {
                // Checkpoint before AI patch
                const prePatchCheckpoint = this.repairEngine.createCheckpoint(
                  workspaceDirs.source,
                  `checkpoint-repair-${job.currentRepairAttempt}-pre`,
                  `Before AI repair attempt ${job.currentRepairAttempt}`
                );

                const patch = await aiProvider.generateRepairPatch({
                  modId: inspection.modId,
                  loader: job.loader,
                  sourceMinecraft: job.currentMinecraft,
                  targetMinecraft: job.targetMinecraft,
                  compilerDiagnostics: buildResult.compilerDiagnostics,
                  rawBuildOutput: buildResult.stdout + '\n' + buildResult.stderr,
                  affectedFiles: affectedSources,
                  previousPatches: job.patches,
                  attemptNumber: job.currentRepairAttempt
                });

                job.patches.push(patch);
                this.log(job, 'PATCH', 'INFO', `Generated patch: ${patch.rationale}`);

                const applyResult = this.repairEngine.applyPatch(workspaceDirs.source, patch);
                if (!applyResult.success) {
                  this.log(job, 'PATCH', 'WARN', `Failed to cleanly apply AI patch: ${applyResult.errors.join(', ')}. Restoring pre-patch state.`);
                  this.repairEngine.restoreCheckpoint(workspaceDirs.source, prePatchCheckpoint);
                  continue;
                }

                this.log(job, 'PATCH', 'INFO', `Applied changes: ${applyResult.appliedChanges.join('; ')}`);

                // REBUILD
                this.setJobState(job, 'REBUILDING');
                this.log(job, 'BUILD', 'INFO', `Rebuilding project after AI patch ${job.currentRepairAttempt}...`);

                const newBuild = await this.buildRunner.build(workspaceDirs.source);
                job.buildResult = newBuild;

                if (newBuild.success) {
                  this.log(job, 'BUILD', 'INFO', `Rebuild successful after AI repair attempt ${job.currentRepairAttempt}!`);
                  buildResult = newBuild;
                  repairSuccess = true;
                  break;
                } else {
                  // Check if build got worse
                  const oldErrors = buildResult.compilerDiagnostics.length;
                  const newErrors = newBuild.compilerDiagnostics.length;

                  if (newErrors > oldErrors + 2) {
                    this.log(job, 'ROLLBACK', 'WARN', `Patch worsened build error count (${oldErrors} -> ${newErrors}). Automatically rolling back.`);
                    this.repairEngine.restoreCheckpoint(workspaceDirs.source, prePatchCheckpoint);
                  } else {
                    buildResult = newBuild;
                  }
                }
              } catch (aiErr: any) {
                this.log(job, 'AI', 'ERROR', `AI repair execution error: ${aiErr.message}`);
                break;
              }
            }
          }
        }

        if (!buildResult.success) {
          this.finishJob(
            job,
            'MANUAL_REVIEW',
            'NEEDS_MANUAL_REVIEW',
            `Build failed with ${buildResult.compilerDiagnostics.length} compilation errors after ${job.currentRepairAttempt} automated repair attempt(s).`
          );
          return;
        }
      }

      // 6. VALIDATING (Section 9)
      this.setJobState(job, 'VALIDATING');
      this.log(job, 'VALIDATE', 'INFO', 'Validating generated artifact against metadata, bytecode, and isolated test rules...');

      if (!buildResult.artifactPath || !fs.existsSync(buildResult.artifactPath)) {
        this.finishJob(
          job,
          'FAILED',
          'FAILED',
          'Build completed but output JAR artifact could not be located in build/libs.'
        );
        return;
      }

      const validation = await this.validator.validate(
        buildResult.artifactPath,
        inspection,
        job.targetMinecraft,
        job.loader
      );

      job.validation = validation;

      for (const w of validation.warnings) {
        this.log(job, 'VALIDATE', 'WARN', `Validation warning: ${w}`);
      }
      for (const e of validation.errors) {
        this.log(job, 'VALIDATE', 'ERROR', `Validation error: ${e}`);
      }

      if (!validation.passed) {
        this.finishJob(
          job,
          'FAILED',
          'FAILED',
          `Validation failed: ${validation.errors.join('; ')}`
        );
        return;
      }

      // 7. COPY FINAL ARTIFACT & COMPLETE
      const outputJarName = `${inspection.modId}-${inspection.modVersion}-mc${job.targetMinecraft}-${job.loader}.jar`;
      const finalJarPath = path.join(workspaceDirs.output, outputJarName);
      fs.copyFileSync(buildResult.artifactPath, finalJarPath);

      const finalSha256 = computeSha256(finalJarPath);
      const finalStats = fs.statSync(finalJarPath);

      job.updatedArtifact = {
        fileName: outputJarName,
        sha256: finalSha256,
        path: finalJarPath,
        sizeBytes: finalStats.size
      };

      const finalResultState: ResultState = validation.warnings.length > 0 ? 'SUCCESS_WITH_WARNINGS' : 'SUCCESS';
      this.finishJob(
        job,
        'COMPLETED',
        finalResultState,
        `Migration completed successfully! Artifact ready: ${outputJarName} (${(finalStats.size / 1024).toFixed(1)} KB)`
      );
    } catch (err: any) {
      this.log(job, 'SYSTEM', 'ERROR', `Fatal unexpected exception during mod update: ${err.message}`);
      this.finishJob(job, 'FAILED', 'FAILED', err.message);
    }
  }

  private setJobState(job: UpdateJob, state: JobState): void {
    job.state = state;
    job.updatedAt = new Date().toISOString();
    this.persistJobs();
    this.emit('state', { jobId: job.id, state });
  }

  private finishJob(job: UpdateJob, state: JobState, resultState: ResultState, message: string): void {
    job.state = state;
    job.resultState = resultState;
    job.updatedAt = new Date().toISOString();
    if (resultState === 'FAILED' || resultState === 'NEEDS_MANUAL_REVIEW' || resultState === 'BLOCKED') {
      job.failureReason = message;
    }
    this.log(job, 'SYSTEM', resultState === 'SUCCESS' ? 'INFO' : 'WARN', message);
    this.persistJobs();
    this.emit('finished', { jobId: job.id, state, resultState });
  }

  private log(job: UpdateJob, stage: LogStage, severity: LogSeverity, message: string, details?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      stage,
      severity,
      message,
      details
    };
    job.logs.push(entry);
    this.emit('log', { jobId: job.id, entry });
  }

  private persistJobs(): void {
    try {
      const serialized = Array.from(this.jobs.values()).map((j) => ({
        ...j,
        // Exclude huge log arrays from deep persistence if desired, or keep last 500 logs
        logs: j.logs.slice(-500)
      }));
      fs.writeFileSync(this.storePath, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch {
      // Ignore persistence errors
    }
  }

  private loadPersistedJobs(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        const list: UpdateJob[] = JSON.parse(raw);
        for (const job of list) {
          this.jobs.set(job.id, job);
        }
      }
    } catch {
      // Ignore
    }
  }
}
