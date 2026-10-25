import React from 'react';
import { Check, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface WorkflowStepperProps {
  currentState: string;
  resultState?: string;
}

const STAGES = [
  { id: 'INSPECTING', label: '1. Inspecting Mod' },
  { id: 'LOADER', label: '2. Detecting Loader' },
  { id: 'PREPARING', label: '3. Preparing Environment' },
  { id: 'DEPENDENCIES', label: '4. Updating Dependencies' },
  { id: 'MIGRATING', label: '5. Migrating Project' },
  { id: 'BUILDING', label: '6. Building Mod' },
  { id: 'TESTING', label: '7. Running Validation' },
  { id: 'DIAGNOSING', label: '8. Diagnosing Errors' },
  { id: 'AI_REPAIRING', label: '9. AI Repair' },
  { id: 'REBUILDING', label: '10. Rebuilding' },
  { id: 'VALIDATING', label: '11. Final Validation' },
  { id: 'COMPLETED', label: '12. Ready' }
];

export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({ currentState, resultState }) => {
  // Map raw job state to stage index
  const getStageIndex = (state: string): number => {
    switch (state) {
      case 'QUEUED':
        return 0;
      case 'INSPECTING':
        return 1;
      case 'PREPARING':
        return 2;
      case 'MIGRATING':
        return 4;
      case 'BUILDING':
        return 5;
      case 'TESTING':
        return 6;
      case 'DIAGNOSING':
        return 7;
      case 'AI_REPAIRING':
        return 8;
      case 'REBUILDING':
        return 9;
      case 'VALIDATING':
        return 10;
      case 'COMPLETED':
        return 11;
      case 'FAILED':
      case 'MANUAL_REVIEW':
        return 7;
      default:
        return 0;
    }
  };

  const currentIndex = getStageIndex(currentState);
  const isFailed = resultState === 'FAILED' || currentState === 'FAILED' || resultState === 'BLOCKED';
  const isCompleted = currentState === 'COMPLETED' || resultState === 'SUCCESS' || resultState === 'SUCCESS_WITH_WARNINGS';

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Live Migration Pipeline
        </h3>
        <span className="text-xs font-mono font-medium px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
          Stage: <span className="text-blue-400 font-bold">{currentState}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {STAGES.map((stage, idx) => {
          const isDone = isCompleted || idx < currentIndex;
          const isCurrent = idx === currentIndex && !isCompleted && !isFailed;
          const isStageFailed = isFailed && idx === currentIndex;

          let statusClass = 'border-slate-800/80 bg-slate-900/30 text-slate-500';
          let icon = <span className="w-2 h-2 rounded-full bg-slate-700" />;

          if (isDone) {
            statusClass = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
            icon = <Check className="w-3.5 h-3.5 text-emerald-400" />;
          } else if (isCurrent) {
            statusClass = 'border-blue-500/50 bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30';
            icon = <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
          } else if (isStageFailed) {
            statusClass = 'border-rose-500/50 bg-rose-500/15 text-rose-300';
            icon = <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
          }

          return (
            <div
              key={stage.id}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${statusClass}`}
            >
              <div className="flex-shrink-0">{icon}</div>
              <span className="truncate">{stage.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
