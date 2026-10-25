import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Copy, ArrowDown, Check, Trash2 } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  stage: string;
  severity: string;
  message: string;
}

interface LogConsoleProps {
  jobId: string | null;
  onStateUpdate?: (state: string, resultState?: string) => void;
}

export const LogConsole: React.FC<LogConsoleProps> = ({ jobId, onStateUpdate }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) {
      setLogs([]);
      return;
    }

    // Connect to Server-Sent Events (SSE) stream
    const eventSource = new EventSource(`/api/update-jobs/${jobId}/logs`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          setLogs((prev) => [...prev, data.log]);
        } else if (data.type === 'state') {
          onStateUpdate?.(data.state, data.resultState);
        } else if (data.type === 'finished') {
          onStateUpdate?.(data.state, data.resultState);
          eventSource.close();
        }
      } catch (err) {
        // ignore parse error
      }
    };

    eventSource.onerror = () => {
      // If SSE disconnects or finishes
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [jobId, onStateUpdate]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const copyAll = () => {
    const text = logs
      .map((l) => `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.stage}] [${l.severity}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStageBadgeColor = (stage: string) => {
    switch (stage) {
      case 'INSPECT':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
      case 'PREPARE':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'MIGRATE':
        return 'text-violet-400 bg-violet-500/10 border-violet-500/20';
      case 'BUILD':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'AI':
        return 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20';
      case 'PATCH':
        return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
      case 'ROLLBACK':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'VALIDATE':
        return 'text-teal-400 bg-teal-500/10 border-teal-500/20';
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'ERROR':
        return 'text-rose-400 font-semibold';
      case 'WARN':
        return 'text-amber-300';
      case 'DEBUG':
        return 'text-slate-500';
      default:
        return 'text-slate-300';
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col font-mono text-xs">
      {/* Console Header */}
      <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-300">
          <Terminal className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-xs tracking-wider">LIVE EXECUTION TERMINAL</span>
          {jobId && (
            <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-slate-400 rounded-md border border-slate-700">
              {jobId}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors flex items-center gap-1.5 ${
              autoScroll
                ? 'bg-blue-500/20 border-blue-500/30 text-blue-400'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ArrowDown className="w-3 h-3" />
            <span>Auto-scroll</span>
          </button>
          <button
            onClick={copyAll}
            disabled={logs.length === 0}
            className="px-2.5 py-1 text-[11px] bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-300 rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Console Output */}
      <div className="p-4 h-96 overflow-y-auto space-y-1.5 selection:bg-blue-600 selection:text-white">
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600 text-xs italic">
            Waiting for build / migration pipeline to initiate...
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="flex items-start gap-2 leading-relaxed">
              <span className="text-slate-600 select-none text-[10px] w-14 flex-shrink-0 pt-0.5">
                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold border flex-shrink-0 ${getStageBadgeColor(
                  log.stage
                )}`}
              >
                {log.stage}
              </span>
              <span className={`break-all ${getSeverityColor(log.severity)}`}>
                {log.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
