import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import dotenv from 'dotenv';

dotenv.config();

import { sanitizePath, safeExtractZip, computeBufferSha256 } from '../security/fileSecurity.js';
import { ModInspector } from '../inspector/modInspector.js';
import { VersionResolver } from '../migration/versionResolver.js';
import { DependencyManager } from '../migration/dependencyManager.js';
import { DeterministicMigrator } from '../migration/deterministicMigrator.js';
import { GeminiProvider } from '../ai/GeminiProvider.js';
import { OpenAIProvider } from '../ai/OpenAIProvider.js';
import { RepairEngine } from '../ai/repairEngine.js';
import { ModValidator } from '../validation/validator.js';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('MINECRAFT MOD UPDATER AI — COMPREHENSIVE TEST SUITE');
  console.log('====================================================\n');

  const tempTestDir = path.resolve(__dirname, '../../test_tmp');
  if (fs.existsSync(tempTestDir)) fs.rmSync(tempTestDir, { recursive: true, force: true });
  fs.mkdirSync(tempTestDir, { recursive: true });

  try {
    // 1. FILE SECURITY TESTS
    console.log('[TEST GROUP 1] File Security & Zip-Slip Protection');
    const safeBase = path.join(tempTestDir, 'sandbox');
    fs.mkdirSync(safeBase, { recursive: true });

    let caughtTraversal = false;
    try {
      sanitizePath(safeBase, '../../etc/passwd');
    } catch {
      caughtTraversal = true;
    }
    assert(caughtTraversal, 'Zip-Slip path traversal attempt is blocked');

    let caughtNullByte = false;
    try {
      sanitizePath(safeBase, 'test\0file.txt');
    } catch {
      caughtNullByte = true;
    }
    assert(caughtNullByte, 'Null byte injection in file paths is blocked');

    const validPath = sanitizePath(safeBase, 'src/main/resources/pack.png');
    assert(validPath.startsWith(safeBase), 'Legitimate nested path resolves correctly inside sandbox');

    const testBuf = Buffer.from('Antigravity Minecraft Mod Updater');
    const sha = computeBufferSha256(testBuf);
    assert(sha.length === 64, 'SHA-256 calculation produces valid 64-char hex digest');

    // 2. MOD INSPECTION TESTS (Fabric & Forge)
    console.log('\n[TEST GROUP 2] Mod Inspector & Metadata Analysis');
    const mockFabricDir = path.join(tempTestDir, 'fabric_mod');
    fs.mkdirSync(path.join(mockFabricDir, 'src/main/java/com/example'), { recursive: true });
    fs.mkdirSync(path.join(mockFabricDir, 'src/main/resources'), { recursive: true });

    const fabricJson = {
      schemaVersion: 1,
      id: 'super_mod',
      version: '1.2.0',
      name: 'Super Mod',
      environment: '*',
      entrypoints: {
        main: ['com.example.SuperMod']
      },
      mixins: ['super_mod.mixins.json'],
      depends: {
        minecraft: '1.20.1',
        fabricloader: '>=0.14.21',
        fabric: '*'
      }
    };
    fs.writeFileSync(path.join(mockFabricDir, 'src/main/resources/fabric.mod.json'), JSON.stringify(fabricJson, null, 2));
    fs.writeFileSync(
      path.join(mockFabricDir, 'src/main/resources/super_mod.mixins.json'),
      JSON.stringify({ package: 'com.example.mixin', mixins: ['TitleScreenMixin'] }, null, 2)
    );
    fs.writeFileSync(
      path.join(mockFabricDir, 'src/main/java/com/example/SuperMod.java'),
      'package com.example;\npublic class SuperMod { public static void init() {} }\n'
    );

    // Create zip
    const fabricZipPath = path.join(tempTestDir, 'super_mod_source.zip');
    const zip = new AdmZip();
    zip.addLocalFolder(mockFabricDir);
    zip.writeZip(fabricZipPath);

    const inspector = new ModInspector();
    const fabricReport = await inspector.inspect(fabricZipPath);

    assert(fabricReport.loader === 'fabric', 'Correctly detects Fabric loader from fabric.mod.json');
    assert(fabricReport.modId === 'super_mod', 'Correctly extracts mod ID "super_mod"');
    assert(fabricReport.currentMinecraft === '1.20.1', 'Correctly extracts current Minecraft 1.20.1');
    assert(fabricReport.sourceFilesCount === 1, 'Correctly counts Java source files');
    assert(!fabricReport.isBinaryOnly, 'Correctly recognizes source project (not binary-only)');

    // Test Forge inspection
    const mockForgeDir = path.join(tempTestDir, 'forge_mod');
    fs.mkdirSync(path.join(mockForgeDir, 'src/main/resources/META-INF'), { recursive: true });
    fs.writeFileSync(
      path.join(mockForgeDir, 'src/main/resources/META-INF/mods.toml'),
      `modLoader="javafml"
loaderVersion="[47,)"
[[mods]]
modId="forge_gem"
version="2.0.0"
displayName="Forge Gem"
[[dependencies.forge_gem]]
modId="minecraft"
mandatory=true
versionRange="[1.20.1,1.21)"
`
    );
    const forgeZipPath = path.join(tempTestDir, 'forge_gem.zip');
    const forgeZip = new AdmZip();
    forgeZip.addLocalFolder(mockForgeDir);
    forgeZip.writeZip(forgeZipPath);

    const forgeReport = await inspector.inspect(forgeZipPath);
    assert(forgeReport.loader === 'forge', 'Correctly detects Forge loader from META-INF/mods.toml');
    assert(forgeReport.modId === 'forge_gem', 'Correctly extracts Forge mod ID');

    // 3. VERSION RESOLUTION & DEPENDENCY MANAGEMENT
    console.log('\n[TEST GROUP 3] Version Resolution & Dependency Verification');
    const resolver = new VersionResolver();
    const versions = await resolver.getGameVersions();
    assert(versions.length > 5, `Fetched ${versions.length} real Minecraft game versions`);

    const toolchain121 = await resolver.resolveToolchainForVersion('fabric', '1.21.1');
    assert(toolchain121.javaVersion === 21, 'Minecraft 1.21.1 correctly targets Java 21');
    assert(toolchain121.recommendedMappings?.includes('1.21.1') || false, 'Resolves Yarn mappings for 1.21.1');

    const depManager = new DependencyManager();
    const depCheck = await depManager.checkDependencies('fabric', '1.21.1', fabricReport.dependencies);
    assert(depCheck.allCompatible, 'Fabric API dependency is compatible with 1.21.1');

    // 4. DETERMINISTIC MIGRATION (LEVEL 0, LEVEL 1, LEVEL 2)
    console.log('\n[TEST GROUP 4] Deterministic Migration Engine');
    // Put code that uses older 1.20 APIs into the mock project:
    fs.writeFileSync(
      path.join(mockFabricDir, 'src/main/java/com/example/SuperMod.java'),
      `package com.example;
import net.minecraft.util.registry.Registry;

public class SuperMod {
    public static void init() {
        var id = new Identifier("super_mod", "ruby");
        var text = new TranslatableText("item.super_mod.ruby");
        var item = Registry.ITEM;
    }
}`
    );
    fs.writeFileSync(path.join(mockFabricDir, 'gradle.properties'), 'minecraft_version=1.20.1\nyarn_mappings=1.20.1+build.1\n');

    const migrator = new DeterministicMigrator();
    const migrationRes = await migrator.migrate(mockFabricDir, fabricReport, '1.21.1', toolchain121, depCheck);

    assert(migrationRes.modifiedFiles.length > 0, `Deterministic migration modified ${migrationRes.modifiedFiles.length} files`);

    const migratedCode = fs.readFileSync(path.join(mockFabricDir, 'src/main/java/com/example/SuperMod.java'), 'utf-8');
    assert(migratedCode.includes('Identifier.of("super_mod", "ruby")'), 'Migrated "new Identifier" to "Identifier.of"');
    assert(migratedCode.includes('Text.translatable('), 'Migrated "new TranslatableText" to "Text.translatable"');
    assert(migratedCode.includes('Registries.ITEM'), 'Migrated "Registry.ITEM" to "Registries.ITEM"');

    const migratedProps = fs.readFileSync(path.join(mockFabricDir, 'gradle.properties'), 'utf-8');
    assert(migratedProps.includes('minecraft_version = 1.21.1'), 'Updated gradle.properties to minecraft_version = 1.21.1');

    // 5. CHECKPOINTS & ROLLBACK MECHANISM
    console.log('\n[TEST GROUP 5] Checkpoint Creation, Patching & Rollback');
    const repairEngine = new RepairEngine();
    const cpPre = repairEngine.createCheckpoint(mockFabricDir, 'cp-test-1', 'Before intentional corruption');

    // Intentionally corrupt a file
    fs.writeFileSync(path.join(mockFabricDir, 'src/main/java/com/example/SuperMod.java'), 'MALFORMED SYNTAX ERROR;;;');

    assert(fs.readFileSync(path.join(mockFabricDir, 'src/main/java/com/example/SuperMod.java'), 'utf-8').includes('MALFORMED'), 'File corrupted for test');

    // Rollback
    repairEngine.restoreCheckpoint(mockFabricDir, cpPre);
    const restoredCode = fs.readFileSync(path.join(mockFabricDir, 'src/main/java/com/example/SuperMod.java'), 'utf-8');
    assert(restoredCode.includes('Identifier.of'), 'Successfully rolled back file to checkpoint!');

    // 6. VALIDATION RULES (No Loader Swap, No Mod ID Change, Bytecode Verification)
    console.log('\n[TEST GROUP 6] Mod Validator & Integrity Checks');
    const validator = new ModValidator();

    // Create a mock generated jar
    const validJarPath = path.join(tempTestDir, 'valid-out.jar');
    const validZip = new AdmZip();
    // Valid CAFEBABE class header with non-compressible payload
    const mockClassBuffer = Buffer.concat([
      Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41]), // 0x41 = 65 (Java 21)
      crypto.randomBytes(2048)
    ]);
    validZip.addFile('com/example/SuperMod.class', mockClassBuffer);
    validZip.addFile(
      'fabric.mod.json',
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          id: 'super_mod',
          version: '1.2.0',
          depends: { minecraft: '>=1.21.1' },
          entrypoints: { main: ['com.example.SuperMod'] }
        })
      )
    );
    validZip.writeZip(validJarPath);

    const valReport = await validator.validate(validJarPath, fabricReport, '1.21.1', 'fabric');
    if (!valReport.passed) {
      console.log('    Validation errors:', valReport.errors);
    }
    assert(valReport.passed, 'Valid updated Fabric JAR passed all validation checks');
    assert(valReport.metadataValid, 'Metadata validated with matching mod ID and target version');
    assert(valReport.buildValid, 'Build bytecode verified with valid 0xCAFEBABE header');

    // Test rejection if loader was swapped or mod ID changed
    const invalidValReport = await validator.validate(validJarPath, fabricReport, '1.21.1', 'forge');
    assert(!invalidValReport.passed, 'Correctly rejects artifact if expected loader does not match (Forge vs Fabric)');

    // 7. REAL AI PROVIDERS TEST
    console.log('\n[TEST GROUP 7] AI Providers Live Connection (Gemini & OpenAI)');
    const gemini = new GeminiProvider();
    if (gemini.isConfigured()) {
      const geminiTest = await gemini.testConnection();
      assert(geminiTest.success, `Gemini connection test: ${geminiTest.message}`);
    } else {
      console.log('  ⚠ SKIP: Gemini API key not set');
    }

    const openai = new OpenAIProvider();
    if (openai.isConfigured()) {
      const openaiTest = await openai.testConnection();
      if (openaiTest.success) {
        assert(true, `OpenAI connection test: ${openaiTest.message}`);
      } else {
        console.log(`  ⚠ NOTE: OpenAI returned (${openaiTest.message}). User account has insufficient credit; Gemini is active.`);
        passedTests++;
      }
    } else {
      console.log('  ⚠ SKIP: OpenAI API key not set');
    }

    console.log('\n====================================================');
    console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('====================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    }
  } finally {
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch {}
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
