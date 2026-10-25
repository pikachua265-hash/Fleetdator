import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import { GeminiProvider } from '../ai/GeminiProvider.js';
import { RepairEngine } from '../ai/repairEngine.js';
import { SandboxManager } from '../security/sandbox.js';
import { BuildRunner } from '../build/buildRunner.js';

async function testAiRepair() {
  console.log('====================================================');
  console.log('TESTING LIVE AI REPAIR & ROLLBACK WITH GEMINI 3.5');
  console.log('====================================================\n');

  const testDir = path.resolve(__dirname, '../../../test_ai_repair_workspace');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(testDir, 'src/main/java/com/example'), { recursive: true });

  const brokenSource = `package com.example;

public class BrokenMod {
    public static void initialize() {
        // Obsolete Minecraft 1.20 call that fails to compile on modern Java
        int invalidToken = "wrong_type_string";
    }
}
`;
  const javaFile = path.join(testDir, 'src/main/java/com/example/BrokenMod.java');
  fs.writeFileSync(javaFile, brokenSource, 'utf-8');

  const sandbox = new SandboxManager(testDir);
  const runner = new BuildRunner(sandbox);
  const repairEngine = new RepairEngine();

  console.log('[STEP 1] Running initial compiler build to collect real error diagnostics...');
  const initialBuild = await runner.build(testDir);

  if (initialBuild.success) {
    throw new Error('Initial build should have failed with type error!');
  }

  console.log(`  ✓ Collected ${initialBuild.compilerDiagnostics.length} compiler error(s):`);
  initialBuild.compilerDiagnostics.forEach((d) => {
    console.log(`    - Line ${d.line}: ${d.message}`);
  });

  console.log('\n[STEP 2] Querying Google Gemini Provider for structured repair patch...');
  const gemini = new GeminiProvider();
  const affectedFiles = repairEngine.collectAffectedSourceFiles(testDir, initialBuild.compilerDiagnostics);

  const checkpoint = repairEngine.createCheckpoint(testDir, 'cp-before-ai', 'Before AI patch');

  const patch = await gemini.generateRepairPatch({
    modId: 'broken_mod',
    loader: 'fabric',
    sourceMinecraft: '1.20.1',
    targetMinecraft: '1.21.1',
    compilerDiagnostics: initialBuild.compilerDiagnostics,
    rawBuildOutput: initialBuild.stdout + '\n' + initialBuild.stderr,
    affectedFiles,
    attemptNumber: 1
  });

  console.log(`  ✓ AI Patch Generated:`);
  console.log(`    Provider: ${patch.provider} (${patch.model})`);
  console.log(`    Rationale: ${patch.rationale}`);
  console.log(`    Changes count: ${patch.changes.length}`);

  console.log('\n[STEP 3] Applying patch and verifying rebuild...');
  const applyRes = repairEngine.applyPatch(testDir, patch);
  console.log(`  Patch apply result: ${applyRes.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`  Modifications: ${applyRes.appliedChanges.join(', ')}`);

  const patchedCode = fs.readFileSync(javaFile, 'utf-8');
  console.log(`  Patched code:\n${patchedCode.trim()}`);

  const secondBuild = await runner.build(testDir);
  if (secondBuild.success) {
    console.log('  ✓ Rebuild after AI patch SUCCEEDED!');
  } else {
    console.log(`  Rebuild errors after AI patch: ${secondBuild.compilerDiagnostics.length}`);
  }

  console.log('\n[STEP 4] Verifying Rollback on Corrupted Patch...');
  fs.writeFileSync(javaFile, 'MALFORMED SYNTAX;;;');
  repairEngine.restoreCheckpoint(testDir, checkpoint);
  const restoredCode = fs.readFileSync(javaFile, 'utf-8');
  if (restoredCode.includes('wrong_type_string')) {
    console.log('  ✓ Verified: Rollback successfully restored original pre-patch state!');
  } else {
    throw new Error('Rollback failed to restore original file content.');
  }

  console.log('\n====================================================');
  console.log('LIVE AI REPAIR & ROLLBACK TEST COMPLETED SUCCESSFULLY');
  console.log('====================================================\n');
}

testAiRepair().catch((err) => {
  console.error('\nAI Repair Test Error:', err);
  process.exit(1);
});
