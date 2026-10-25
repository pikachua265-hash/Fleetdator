import React from 'react';
import { Layers, Box, Cpu, FileCode, CheckCircle, AlertTriangle, ShieldAlert } from 'lucide-react';

interface InspectionCardProps {
  inspection: any;
}

export const InspectionCard: React.FC<InspectionCardProps> = ({ inspection }) => {
  if (!inspection) return null;

  const isFabric = inspection.loader === 'fabric';
  const isForge = inspection.loader === 'forge';
  const isNeoForge = inspection.loader === 'neoforge';

  const loaderBadgeColor = isFabric
    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
    : isForge
    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    : 'bg-purple-500/10 text-purple-400 border-purple-500/30';

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-100">{inspection.modName}</h2>
            <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${loaderBadgeColor}`}>
              {inspection.loader.toUpperCase()} MOD
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-1">
            Mod ID: <span className="text-slate-300 font-bold">{inspection.modId}</span> • Version: {inspection.modVersion}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs">
            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Current MC</span>
            <span className="font-bold text-slate-200">{inspection.currentMinecraft}</span>
          </div>
          <div className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs">
            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Java Target</span>
            <span className="font-bold text-slate-200">Java {inspection.javaVersion}</span>
          </div>
          <div className="px-3 py-1.5 bg-slate-800/80 border border-slate-700/80 rounded-xl text-xs">
            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Environment</span>
            <span className="font-bold text-slate-200 capitalize">{inspection.environment}</span>
          </div>
        </div>
      </div>

      {/* Binary Warning if applicable */}
      {inspection.isBinaryOnly && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 text-xs text-amber-300">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-400 mt-0.5" />
          <div>
            <span className="font-bold text-amber-200">Precompiled Binary JAR Detected:</span>
            <p className="mt-0.5 text-amber-300/90 leading-relaxed">
              {inspection.migrationNotes?.[0] || 'Source project required for reliable migration. Arbitrary binary JAR migration cannot guarantee stable bytecode remapping.'}
            </p>
          </div>
        </div>
      )}

      {/* Grid Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800/40 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <FileCode className="w-4 h-4 text-blue-400" />
            <span>Source Files</span>
          </div>
          <div className="text-lg font-bold text-slate-200">
            {inspection.sourceFilesCount} <span className="text-xs text-slate-400 font-normal">({inspection.sourceLanguage})</span>
          </div>
        </div>

        <div className="bg-slate-800/40 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <Layers className="w-4 h-4 text-purple-400" />
            <span>Mixins</span>
          </div>
          <div className="text-lg font-bold text-slate-200">
            {inspection.mixins?.length || 0} <span className="text-xs text-slate-400 font-normal">configs</span>
          </div>
        </div>

        <div className="bg-slate-800/40 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <Box className="w-4 h-4 text-emerald-400" />
            <span>Dependencies</span>
          </div>
          <div className="text-lg font-bold text-slate-200">
            {inspection.dependencies?.length || 0}
          </div>
        </div>

        <div className="bg-slate-800/40 border border-slate-800/80 rounded-xl p-3">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span>Toolchain</span>
          </div>
          <div className="text-xs font-semibold text-slate-200 truncate" title={inspection.toolchainVersion || 'Standard'}>
            {inspection.toolchainVersion || 'Standard Loom/FG'}
          </div>
        </div>
      </div>

      {/* Dependencies preview */}
      {inspection.dependencies && inspection.dependencies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Detected Dependencies</h4>
          <div className="flex flex-wrap gap-2">
            {inspection.dependencies.map((dep: any, idx: number) => (
              <span
                key={idx}
                className="px-2.5 py-1 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-300 font-mono"
              >
                {dep.id}: <span className="text-blue-400">{dep.versionRange}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
