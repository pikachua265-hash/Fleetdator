import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import {
  Cpu,
  Settings,
  History as HistoryIcon,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Play,
  RotateCcw,
  CheckCircle2,
  Box,
  Layers
} from 'lucide-react';
import { UploadZone } from '../components/UploadZone';
import { InspectionCard } from '../components/InspectionCard';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { LogConsole } from '../components/LogConsole';
import { ResultsCard } from '../components/ResultsCard';
import { SettingsModal } from '../components/SettingsModal';
import { HistoryModal } from '../components/HistoryModal';

export default function Home() {
  const [uploadedFile, setUploadedFile] = useState<any>(null);
  const [inspection, setInspection] = useState<any>(null);
  const [targetMcVersion, setTargetMcVersion] = useState('1.21.1');
  const [availableVersions, setAvailableVersions] = useState<any[]>([]);
  const [aiMode, setAiMode] = useState<'automatic' | 'gemini' | 'openai' | 'disabled'>('automatic');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<string>('QUEUED');
  const [jobResult, setJobResult] = useState<any>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiConfig, setAiConfig] = useState<any>(null);

  useEffect(() => {
    // Fetch available game versions
    fetch('/api/versions')
      .then((res) => res.json())
      .then((data) => {
        if (data.versions) setAvailableVersions(data.versions);
      })
      .catch(() => {});

    // Fetch AI config status
    fetch('/api/ai/config')
      .then((res) => res.json())
      .then((data) => setAiConfig(data))
      .catch(() => {});
  }, []);

  const handleUploaded = (fileData: any, insp: any) => {
    setUploadedFile(fileData);
    setInspection(insp);
    setJobResult(null);
    setActiveJobId(null);

    // Default target suggestion
    if (insp.currentMinecraft === '1.20.1') {
      setTargetMcVersion('1.21.1');
    } else if (insp.currentMinecraft.startsWith('1.21')) {
      setTargetMcVersion('26.2');
    } else {
      setTargetMcVersion('1.21.1');
    }
  };

  const startUpdate = async () => {
    if (!uploadedFile || !inspection) return;

    setIsUpdating(true);
    setJobResult(null);
    setJobState('QUEUED');

    try {
      const res = await fetch('/api/update-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: uploadedFile.path,
          targetMinecraft: targetMcVersion,
          loader: inspection.loader,
          aiMode
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start job');

      setActiveJobId(data.jobId);
    } catch (err: any) {
      alert(`Error starting update job: ${err.message}`);
      setIsUpdating(false);
    }
  };

  const handleStateUpdate = (state: string, resultState?: string) => {
    setJobState(state);
    if (state === 'COMPLETED' || state === 'FAILED' || state === 'MANUAL_REVIEW') {
      setIsUpdating(false);
      // Fetch full result
      if (activeJobId) {
        fetch(`/api/update-jobs/${activeJobId}/result`)
          .then((res) => res.json())
          .then((resData) => setJobResult(resData))
          .catch(() => {});
      }
    }
  };

  const resetProject = () => {
    setUploadedFile(null);
    setInspection(null);
    setActiveJobId(null);
    setJobResult(null);
    setIsUpdating(false);
    setJobState('QUEUED');
  };

  return (
    <div className="min-h-screen bg-[#080d1a] text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      <Head>
        <title>Minecraft Mod Updater AI — Real Toolchain Migration</title>
        <meta name="description" content="Real Minecraft Mod update engine with deterministic tooling and AI repair." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/20 text-white">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">Minecraft Mod Updater AI</h1>
                <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  v2.0 Real Toolchain
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Deterministic Migration &bull; AST Parsing &bull; Isolated Sandbox &bull; AI Repair</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* AI Status Badge */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-800/60 border border-slate-700/60 rounded-xl text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300">
                {aiConfig?.geminiConfigured ? 'Gemini 3.5 Ready' : 'AI Configured'}
              </span>
            </div>

            <button
              onClick={() => setHistoryOpen(true)}
              className="p-2 bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl border border-slate-700/60 transition-colors flex items-center gap-1.5 text-xs font-medium"
              title="Job History"
            >
              <HistoryIcon className="w-4 h-4" />
              <span className="hidden md:inline">History</span>
            </button>

            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl border border-slate-700/60 transition-colors flex items-center gap-1.5 text-xs font-medium"
              title="AI Settings"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden md:inline">Settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        {/* Upload & Inspection Stage */}
        {!uploadedFile ? (
          <div className="space-y-6">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Update Any Minecraft Mod Reliably
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Deterministic compiler & toolchain updates first. AI is engaged <span className="text-slate-200 font-semibold">strictly as an error repair fallback</span> when APIs break.
              </p>
            </div>

            <UploadZone onUploaded={handleUploaded} />

            {/* Feature Highlights */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
              <div className="p-4 bg-slate-900/30 border border-slate-800/60 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-blue-400 font-semibold text-xs">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Strict Loader Lock</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Fabric stays Fabric. Forge stays Forge. NeoForge stays NeoForge. Loaders are never silently converted.
                </p>
              </div>

              <div className="p-4 bg-slate-900/30 border border-slate-800/60 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Zero-Fake Guarantee</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Every mod undergoes real JDK 21 / Gradle compilation and bytecode verification before download is unlocked.
                </p>
              </div>

              <div className="p-4 bg-slate-900/30 border border-slate-800/60 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-purple-400 font-semibold text-xs">
                  <Sparkles className="w-4 h-4" />
                  <span>Cost-Optimized AI</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  No wasted LLM tokens. Compatible mods are updated 100% deterministically. AI only repairs compiler failures.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Top Control Bar with Uploaded Mod */}
            <div className="flex items-center justify-between bg-slate-900/40 border border-slate-800 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="text-xs text-slate-300 font-medium">
                  Active Mod: <span className="font-bold text-white">{inspection?.modName}</span> ({uploadedFile?.originalName})
                </span>
              </div>
              <button
                onClick={resetProject}
                disabled={isUpdating}
                className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-40"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Upload Another Mod</span>
              </button>
            </div>

            {/* Inspection Card */}
            <InspectionCard inspection={inspection} />

            {/* Update Configuration Form */}
            {!activeJobId && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                      Configure Migration Targets
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Select target Minecraft release and automated repair policy
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Current Version (Locked) */}
                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1.5">Current Minecraft</label>
                    <div className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 font-mono font-bold">
                      {inspection.currentMinecraft}
                    </div>
                  </div>

                  {/* Target Version Selector */}
                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1.5">Target Minecraft Version</label>
                    <select
                      value={targetMcVersion}
                      onChange={(e) => setTargetMcVersion(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 font-mono font-bold focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      {availableVersions.length > 0 ? (
                        availableVersions.slice(0, 30).map((v) => (
                          <option key={v.version} value={v.version}>
                            Minecraft {v.version} {v.stable ? '(Release)' : '(Snapshot)'}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="26.2">Minecraft 26.2</option>
                          <option value="1.21.1">Minecraft 1.21.1</option>
                          <option value="1.21">Minecraft 1.21</option>
                          <option value="1.20.4">Minecraft 1.20.4</option>
                          <option value="1.20.1">Minecraft 1.20.1</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Loader (Locked with explicit rule display) */}
                  <div>
                    <label className="text-xs font-semibold text-slate-400 block mb-1.5">Mod Loader (Locked)</label>
                    <div className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 font-mono font-bold capitalize flex items-center justify-between">
                      <span>{inspection.loader}</span>
                      <span className="text-[10px] text-emerald-400 font-sans font-semibold">1:1 Preserved</span>
                    </div>
                  </div>
                </div>

                {/* AI Mode Selector */}
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1.5">AI Repair Policy</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      { id: 'automatic', label: 'Automatic (Recommended)', desc: 'Uses best available configured provider' },
                      { id: 'gemini', label: 'Google Gemini', desc: 'Direct Gemini 3.5 reasoning' },
                      { id: 'openai', label: 'OpenAI', desc: 'GPT-4o engine' },
                      { id: 'disabled', label: 'Disabled (Toolchain Only)', desc: 'Zero AI calls, pure deterministic' }
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAiMode(opt.id as any)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          aiMode === opt.id
                            ? 'bg-blue-600/15 border-blue-500/60 ring-1 ring-blue-500/40 text-blue-200'
                            : 'bg-slate-800/30 border-slate-800 hover:border-slate-700 text-slate-400'
                        }`}
                      >
                        <div className="text-xs font-bold text-slate-200">{opt.label}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Action Button */}
                <div className="pt-2">
                  <button
                    onClick={startUpdate}
                    disabled={isUpdating}
                    className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm rounded-xl shadow-xl shadow-blue-600/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>START REAL MOD MIGRATION &bull; {inspection.currentMinecraft} &rarr; {targetMcVersion}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Live Pipeline Execution Stage */}
            {activeJobId && (
              <div className="space-y-6">
                <WorkflowStepper currentState={jobState} resultState={jobResult?.resultState} />

                <LogConsole jobId={activeJobId} onStateUpdate={handleStateUpdate} />

                {jobResult && <ResultsCard result={jobResult} />}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectJob={(id) => {
          setActiveJobId(id);
          setIsUpdating(false);
          fetch(`/api/update-jobs/${id}/result`)
            .then((r) => r.json())
            .then((data) => setJobResult(data));
        }}
      />
    </div>
  );
}
