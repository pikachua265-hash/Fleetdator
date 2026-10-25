import React from 'react';
import { Download, CheckCircle, AlertTriangle, XCircle, ShieldCheck, Clock, Hash, Cpu } from 'lucide-react';

interface ResultsCardProps {
  result: any;
}

export const ResultsCard: React.FC<ResultsCardProps> = ({ result }) => {
  if (!result || !result.resultState) return null;

  const isSuccess = result.resultState === 'SUCCESS';
  const isWarning = result.resultState === 'SUCCESS_WITH_WARNINGS';
  const isBlocked = result.resultState === 'BLOCKED';
  const isManual = result.resultState === 'NEEDS_MANUAL_REVIEW';
  const isFailed = result.resultState === 'FAILED';

  let bannerStyle = 'bg-slate-900 border-slate-800 text-slate-200';
  let badgeText = result.resultState;
  let icon = <CheckCircle className="w-6 h-6 text-emerald-400" />;

  if (isSuccess) {
    bannerStyle = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200';
    badgeText = 'MIGRATION SUCCESSFUL & VALIDATED';
    icon = <CheckCircle className="w-6 h-6 text-emerald-400" />;
  } else if (isWarning) {
    bannerStyle = 'bg-amber-500/10 border-amber-500/30 text-amber-200';
    badgeText = 'SUCCESS WITH WARNINGS';
    icon = <AlertTriangle className="w-6 h-6 text-amber-400" />;
  } else if (isBlocked) {
    bannerStyle = 'bg-rose-500/10 border-rose-500/30 text-rose-200';
    badgeText = 'BLOCKED BY DEPENDENCY';
    icon = <XCircle className="w-6 h-6 text-rose-400" />;
  } else if (isManual) {
    bannerStyle = 'bg-orange-500/10 border-orange-500/30 text-orange-200';
    badgeText = 'NEEDS MANUAL REVIEW';
    icon = <AlertTriangle className="w-6 h-6 text-orange-400" />;
  } else if (isFailed) {
    bannerStyle = 'bg-rose-500/10 border-rose-500/30 text-rose-200';
    badgeText = 'MIGRATION FAILED';
    icon = <XCircle className="w-6 h-6 text-rose-400" />;
  }

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
      {/* Banner */}
      <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${bannerStyle}`}>
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <h3 className="text-base font-bold tracking-wide">{badgeText}</h3>
            <p className="text-xs opacity-90 mt-0.5">
              {result.failureReason || `Mod successfully compiled and validated for Minecraft ${result.targetMinecraft} (${result.loader.toUpperCase()})`}
            </p>
          </div>
        </div>

        {/* Download Button if Updated Artifact is ready */}
        {result.updatedArtifact && (
          <a
            href={result.downloadUrl}
            download
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/30 transition-all flex-shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>DOWNLOAD UPDATED MOD</span>
          </a>
        )}
      </div>

      {/* Artifact Details Table */}
      {result.updatedArtifact && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                Updated Artifact
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {(result.updatedArtifact.sizeBytes / 1024).toFixed(1)} KB
              </span>
            </div>
            <div className="text-sm font-semibold text-slate-200 font-mono break-all">
              {result.updatedArtifact.fileName}
            </div>
            <div className="space-y-1 text-xs">
              <div className="text-slate-400 flex items-center gap-1.5 font-mono">
                <Hash className="w-3.5 h-3.5 text-slate-500" />
                <span className="truncate">SHA-256: {result.updatedArtifact.sha256}</span>
              </div>
              <div className="text-slate-400 flex items-center gap-1.5 font-mono">
                <Cpu className="w-3.5 h-3.5 text-slate-500" />
                <span>Target: Minecraft {result.targetMinecraft} ({result.loader.toUpperCase()})</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Original Input Artifact
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {(result.originalArtifact.sizeBytes / 1024).toFixed(1)} KB
              </span>
            </div>
            <div className="text-sm font-semibold text-slate-300 font-mono break-all">
              {result.originalArtifact.fileName}
            </div>
            <div className="space-y-1 text-xs">
              <div className="text-slate-400 flex items-center gap-1.5 font-mono">
                <Hash className="w-3.5 h-3.5 text-slate-500" />
                <span className="truncate">SHA-256: {result.originalArtifact.sha256}</span>
              </div>
              <div className="text-slate-400 flex items-center gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>Original Minecraft: {result.currentMinecraft || 'Auto-detected'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Validation Breakdown */}
      {result.validation && (
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Validation Proof & Security Attestation
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-slate-800/40 border border-slate-800 rounded-xl flex items-center gap-2.5">
              <ShieldCheck className={`w-4 h-4 ${result.validation.metadataValid ? 'text-emerald-400' : 'text-rose-400'}`} />
              <div className="text-xs">
                <span className="font-semibold block text-slate-200">Metadata Verification</span>
                <span className="text-slate-400 text-[11px]">Mod ID & Loader locked</span>
              </div>
            </div>

            <div className="p-3 bg-slate-800/40 border border-slate-800 rounded-xl flex items-center gap-2.5">
              <ShieldCheck className={`w-4 h-4 ${result.validation.buildValid ? 'text-emerald-400' : 'text-rose-400'}`} />
              <div className="text-xs">
                <span className="font-semibold block text-slate-200">Bytecode Integrity</span>
                <span className="text-slate-400 text-[11px]">Valid 0xCAFEBABE header</span>
              </div>
            </div>

            <div className="p-3 bg-slate-800/40 border border-slate-800 rounded-xl flex items-center gap-2.5">
              <ShieldCheck className={`w-4 h-4 ${result.validation.isolatedTestPassed ? 'text-emerald-400' : 'text-rose-400'}`} />
              <div className="text-xs">
                <span className="font-semibold block text-slate-200">Isolated Loader Test</span>
                <span className="text-slate-400 text-[11px]">Headless startup simulated</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
