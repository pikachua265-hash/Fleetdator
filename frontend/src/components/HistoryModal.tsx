import React, { useState, useEffect } from 'react';
import { X, History, Download, Clock, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectJob?: (jobId: string) => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose, onSelectJob }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetch('/api/history')
        .then((res) => res.json())
        .then((data) => {
          setHistory(data.history || []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 text-blue-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Migration Job History</h2>
              <p className="text-xs text-slate-400">Past updates, artifacts, and validation reports</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div className="p-6 overflow-y-auto space-y-3">
          {loading ? (
            <div className="py-12 text-center text-slate-500 text-xs italic">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs italic">No past migration jobs recorded yet.</div>
          ) : (
            history.map((job) => (
              <div
                key={job.id}
                className="p-4 bg-slate-800/40 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-700 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-slate-200 text-sm">{job.modName}</span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-md bg-slate-800 border border-slate-700 text-cyan-400">
                      {job.loader}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                        job.resultState === 'SUCCESS' || job.resultState === 'SUCCESS_WITH_WARNINGS'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}
                    >
                      {job.resultState || job.state}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 font-mono">
                    <span>{job.currentMinecraft || '?'} → {job.targetMinecraft}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {new Date(job.createdAt).toLocaleString()}
                    </span>
                    {job.repairAttempts > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-fuchsia-400">{job.repairAttempts} AI repair(s)</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      onSelectJob?.(job.id);
                      onClose();
                    }}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
                  >
                    View Logs
                  </button>
                  {job.updatedSha256 && (
                    <a
                      href={`/api/update-jobs/${job.id}/download`}
                      download
                      className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
