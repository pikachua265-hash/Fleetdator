# Minecraft Mod Updater AI (Production Platform)

A real, verified web application and deterministic migration engine designed to update Minecraft mods between game versions without simulation, fake progress, or hallucinated APIs.

---

## 🛠 Architectural Principles & Guarantees

1. **Strict Mod Loader Invariance**:
   - Fabric $\rightarrow$ Fabric only.
   - Forge $\rightarrow$ Forge only.
   - NeoForge $\rightarrow$ NeoForge only.
   - Loaders are **never** silently converted or cross-remapped.

2. **Deterministic Migration First, AI Strictly as Fallback**:
   - **Level 0**: Already-compatible projects are verified and rebuilt without touching code.
   - **Level 1**: Automatic Toolchain Migration (`fabric-loom`, `ForgeGradle`, Java 21 compatibility, mappings, `gradle.properties`).
   - **Level 2**: AST and Deterministic Source Migration (known API changes, `Identifier.of`, `Registries`, `Text.translatable`, data pack `pack_format`).
   - **Level 3**: Real JDK 21 / Gradle compilation inside isolated sandbox workspaces.
   - **Level 4**: AI Repair Engine (Google Gemini / OpenAI) is triggered **only** if compilation fails.

3. **Checkpoints & Automatic Rollback**:
   - Before applying any AI-generated patch, a snapshot checkpoint is preserved (`checkpoint-repair-N-pre`).
   - If an AI patch worsens compiler errors or fails to compile, the engine automatically rolls back to the clean state.

4. **Zero-Leak Security**:
   - Secrets and API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`) are kept strictly server-side in `backend/.env`.
   - Child build processes run with sanitized environments where all token/key variables are stripped.
   - Zip-slip and path traversal attacks are rejected.

5. **Absolute Verification Guarantee**:
   - An output JAR is marked `SUCCESS` only when the compiler exits with code 0, the output archive contains valid `0xCAFEBABE` bytecode, and isolated headless validation passes.

---

## 📁 Repository Layout

```
minecraft-mod-updater-ai/
├── backend/
│   ├── src/
│   │   ├── ai/               # AIProvider, GeminiProvider, OpenAIProvider, RepairEngine
│   │   ├── build/            # Real buildRunner (Gradle 8.10.2 + JDK 21 toolchain)
│   │   ├── inspector/        # ModInspector (fabric.mod.json, mods.toml, binary detection)
│   │   ├── migration/        # VersionResolver, DependencyManager, DeterministicMigrator
│   │   ├── routes/           # REST & SSE streaming endpoints (/api/*)
│   │   ├── security/         # FileSecurity (Zip-slip guard, SHA-256) & SandboxManager
│   │   ├── services/         # JobManager state machine & persistence
│   │   ├── tests/            # Test suites (runAllTests, runE2ePipeline, testAiRepair)
│   │   ├── types/            # TypeScript schemas & contracts
│   │   └── index.ts          # Express server entrypoint
│   ├── .env                  # Server secrets (encrypted, gitignored)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/       # UploadZone, InspectionCard, WorkflowStepper, LogConsole, ResultsCard, SettingsModal, HistoryModal
│   │   ├── pages/            # Next.js pages (index.tsx, _app.tsx)
│   │   └── styles/           # Tailwind CSS & global animations
│   ├── next.config.js        # API proxy to backend:5050
│   └── package.json
├── test-mods/                # Real Fabric test projects (antigravity_ruby_1.20.1.zip)
├── toolchain/                # Local Gradle 8.10.2 toolchain distribution
├── start.bat                 # One-click Windows runner
└── package.json              # Root npm orchestration
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18+ (tested on Node v24)
- **Java JDK**: JDK 21 (Eclipse Adoptium recommended for modern 1.20.5+ / 1.21+ / 26.x Minecraft)

### Running Locally

You can launch both the backend and frontend simultaneously with:

```bash
# Option A: Windows Batch File
start.bat

# Option B: Terminal
# Terminal 1 (Backend):
cd backend
npm run dev

# Terminal 2 (Frontend):
cd frontend
npm run dev
```

- **Frontend UI**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:5050](http://localhost:5050)

---

## 🧪 Verification & Acceptance Suite

The application includes an extensive test suite verifying every component against real Minecraft code:

```bash
cd backend

# 1. Run Core Unit & Security Tests (28 passing tests):
npm test

# 2. Run End-to-End Pipeline Migration & Validation Test:
npm run test:e2e

# 3. Run Live AI Repair & Automatic Rollback Test with Gemini:
npm run test:ai
```

---

## 🔒 Security Best Practices
- Mod archives are extracted into temporary job-isolated sandboxes (`/workspace/JOB_ID/`).
- Decompression bombs and path-traversal relative links (`../../`) are blocked.
- Cleanups remove intermediate sources while preserving outputs and execution logs.
