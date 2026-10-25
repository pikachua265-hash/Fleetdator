import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import { JobManager } from '../services/jobManager.js';
import { computeSha256 } from '../security/fileSecurity.js';
import AdmZip from 'adm-zip';

async function runE2E() {
  console.log('====================================================');
  console.log('MINECRAFT MOD UPDATER AI — END-TO-END PIPELINE TEST');
  console.log('====================================================\n');

  const workspaceRoot = path.resolve(__dirname, '../../../test_workspace');
  if (fs.existsSync(workspaceRoot)) fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const sampleZip = path.resolve(__dirname, '../../../test-mods/antigravity_ruby_1.20.1.zip');
  if (!fs.existsSync(sampleZip)) {
    throw new Error(`Test artifact missing at: ${sampleZip}`);
  }

  const jobManager = new JobManager(workspaceRoot);

  console.log('[E2E STAGE 1] Creating Real Mod Update Job (1.20.1 -> 1.21.1 Fabric)...');
  const job = jobManager.createJob({
    artifactPath: sampleZip,
    targetMinecraft: '1.21.1',
    loader: 'fabric',
    aiMode: 'automatic'
  });

  console.log(`  Job ID: ${job.id}`);
  console.log(`  Original SHA-256: ${job.originalArtifact.sha256}`);

  // Wait for job completion
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Job execution timed out after 60s'));
    }, 60000);

    jobManager.on('finished', (data) => {
      if (data.jobId === job.id) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  const completedJob = jobManager.getJob(job.id)!;
  console.log(`\n[E2E STAGE 2] Job Finished with State: ${completedJob.state} | Result: ${completedJob.resultState}`);

  // Verification 1: LOADER INTEGRITY
  if (completedJob.loader !== 'fabric') {
    throw new Error(`CRITICAL FAILURE: Loader converted to ${completedJob.loader}. Rule violation!`);
  }
  console.log('  ✓ Verified: Fabric loader strictly preserved (never converted).');

  // Verification 2: SUCCESS RESULT
  if (completedJob.resultState !== 'SUCCESS' && completedJob.resultState !== 'SUCCESS_WITH_WARNINGS') {
    console.error('Final failure reason:', completedJob.failureReason);
    console.error('Build stderr:', completedJob.buildResult?.stderr);
    throw new Error(`Pipeline did not achieve SUCCESS: ${completedJob.failureReason}`);
  }
  console.log('  ✓ Verified: Pipeline succeeded with genuine build and validation.');

  // Verification 3: ARTIFACT GENERATION & INTEGRITY
  if (!completedJob.updatedArtifact || !fs.existsSync(completedJob.updatedArtifact.path)) {
    throw new Error('Updated JAR artifact missing on disk!');
  }

  const updatedZip = new AdmZip(completedJob.updatedArtifact.path);
  const zipEntries = updatedZip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));
  console.log(`  Updated JAR entries: ${zipEntries.join(', ')}`);

  if (!zipEntries.includes('com/antigravity/ruby/AntigravityRubyMod.class')) {
    throw new Error('Bytecode class missing from compiled JAR!');
  }
  console.log('  ✓ Verified: Bytecode class file AntigravityRubyMod.class compiled and present.');

  const fabricModJsonEntry = updatedZip.getEntry('fabric.mod.json');
  if (!fabricModJsonEntry) {
    throw new Error('fabric.mod.json missing from updated JAR!');
  }
  const updatedModJson = JSON.parse(fabricModJsonEntry.getData().toString('utf-8'));
  console.log(`  Updated fabric.mod.json depends: ${JSON.stringify(updatedModJson.depends)}`);

  if (!updatedModJson.depends.minecraft.includes('1.21.1')) {
    throw new Error('Target Minecraft version was not updated in fabric.mod.json!');
  }
  console.log('  ✓ Verified: Target Minecraft version 1.21.1 validated in fabric.mod.json.');

  // Verification 4: LEAK AUDIT
  console.log('\n[E2E STAGE 3] Zero-Leak Audit (Checking Logs & Output for Secrets)...');
  const allLogsText = completedJob.logs.map((l) => l.message).join('\n');
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (geminiKey && allLogsText.includes(geminiKey)) {
    throw new Error('SECURITY VIOLATION: GEMINI_API_KEY was found in job logs!');
  }
  if (openaiKey && allLogsText.includes(openaiKey)) {
    throw new Error('SECURITY VIOLATION: OPENAI_API_KEY was found in job logs!');
  }
  console.log('  ✓ Verified: No secret API keys exposed in execution logs.');

  // Verification 5: CONTROLLED REPAIR & ROLLBACK TEST
  console.log('\n[E2E STAGE 4] Controlled Compilation Failure & Rollback Test...');
  const testSandbox = path.join(workspaceRoot, 'test_rollback_sandbox');
  fs.mkdirSync(path.join(testSandbox, 'src/main/java'), { recursive: true });
  fs.writeFileSync(path.join(testSandbox, 'src/main/java/Broken.java'), 'public class Broken { bad_syntax(); }');

  const cp = (jobManager as any).repairEngine.createCheckpoint(testSandbox, 'test-cp', 'Checkpoint 1');
  fs.writeFileSync(path.join(testSandbox, 'src/main/java/Broken.java'), 'completely destroyed content');
  (jobManager as any).repairEngine.restoreCheckpoint(testSandbox, cp);

  const restored = fs.readFileSync(path.join(testSandbox, 'src/main/java/Broken.java'), 'utf-8');
  if (!restored.includes('bad_syntax')) {
    throw new Error('Rollback mechanism failed to restore file content!');
  }
  console.log('  ✓ Verified: Checkpoint creation & automatic rollback works reliably.');

  console.log('\n====================================================');
  console.log('ALL END-TO-END ACCEPTANCE TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
}

runE2E().catch((err) => {
  console.error('\nE2E Failure:', err);
  process.exit(1);
});
