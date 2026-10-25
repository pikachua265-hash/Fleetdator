import React, { useState, useEffect } from 'react';
import { X, Key, CheckCircle, AlertCircle, Cpu, ShieldCheck } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash');
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [geminiTestStatus, setGeminiTestStatus] = useState<{ testing: boolean; msg?: string; ok?: boolean }>({ testing: false });

  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o');
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [openaiTestStatus, setOpenaiTestStatus] = useState<{ testing: boolean; msg?: string; ok?: boolean }>({ testing: false });

  const [maxRepairAttempts, setMaxRepairAttempts] = useState(8);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetch('/api/ai/config')
        .then((res) => res.json())
        .then((data) => {
          setGeminiConfigured(data.geminiConfigured);
          if (data.geminiModel) setGeminiModel(data.geminiModel);
          setOpenaiConfigured(data.openaiConfigured);
          if (data.openaiModel) setOpenaiModel(data.openaiModel);
          if (data.maxRepairAttempts) setMaxRepairAttempts(data.maxRepairAttempts);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const testConnection = async (provider: 'gemini' | 'openai') => {
    const isGemini = provider === 'gemini';
    const setStatus = isGemini ? setGeminiTestStatus : setOpenaiTestStatus;
    const key = isGemini ? geminiKey : openaiKey;
    const model = isGemini ? geminiModel : openaiModel;

    setStatus({ testing: true });
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: key || undefined, model })
      });
      const data = await res.json();
      setStatus({ testing: false, ok: data.success, msg: data.message });
      if (data.success) {
        if (isGemini) setGeminiConfigured(true);
        else setOpenaiConfigured(true);
      }
    } catch (e: any) {
      setStatus({ testing: false, ok: false, msg: e.message });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geminiApiKey: geminiKey || undefined,
          geminiModel,
          openaiApiKey: openaiKey || undefined,
          openaiModel,
          maxRepairAttempts
        })
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg('Settings saved securely to server.');
        setTimeout(() => setSaveMsg(''), 3000);
      }
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 text-blue-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">AI Repair & Provider Settings</h2>
              <p className="text-xs text-slate-400">Configure LLM providers for automated code repair when compilation fails</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Security Banner */}
          <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3 text-xs text-emerald-300">
            <ShieldCheck className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5" />
            <div>
              <span className="font-semibold text-emerald-200">Zero-Leak Guarantee:</span> API keys are stored server-side only in encrypted `.env`. They are never passed to the frontend browser, never put into generated mods, and child build sandboxes are completely isolated.
            </div>
          </div>

          {/* Gemini Card */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200 text-sm">Google Gemini</span>
                {geminiConfigured && (
                  <span className="px-2 py-0.5 text-[11px] font-medium bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30">
                    Configured & Ready
                  </span>
                )}
              </div>
              <button
                onClick={() => testConnection('gemini')}
                disabled={geminiTestStatus.testing}
                className="px-3 py-1 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {geminiTestStatus.testing ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">API Key (Leave empty to keep existing)</label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder={geminiConfigured ? '••••••••••••••••••••••••••••••••' : 'Enter Gemini API Key (e.g. AQ.Ab8RN6...)'}
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <Key className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Model</label>
                <select
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="gemini-3.5-flash">gemini-3.5-flash (High speed & accurate, Recommended)</option>
                  <option value="gemini-flash-lite-latest">gemini-flash-lite-latest (Fastest)</option>
                  <option value="gemini-3.8-flash">gemini-3.8-flash (Latest preview)</option>
                  <option value="gemini-pro-latest">gemini-pro-latest (Deep reasoning)</option>
                </select>
              </div>

              {geminiTestStatus.msg && (
                <div className={`text-xs p-2.5 rounded-lg flex items-center gap-2 ${geminiTestStatus.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                  {geminiTestStatus.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                  <span>{geminiTestStatus.msg}</span>
                </div>
              )}
            </div>
          </div>

          {/* OpenAI Card */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200 text-sm">OpenAI</span>
                {openaiConfigured && (
                  <span className="px-2 py-0.5 text-[11px] font-medium bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30">
                    Configured
                  </span>
                )}
              </div>
              <button
                onClick={() => testConnection('openai')}
                disabled={openaiTestStatus.testing}
                className="px-3 py-1 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {openaiTestStatus.testing ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">API Key (Leave empty to keep existing)</label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder={openaiConfigured ? '••••••••••••••••••••••••••••••••' : 'Enter OpenAI API Key (sk-proj-...)'}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <Key className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1 block">Model</label>
                <select
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="gpt-4o">gpt-4o (Flagship reasoning)</option>
                  <option value="gpt-4o-mini">gpt-4o-mini (Fast & efficient)</option>
                </select>
              </div>

              {openaiTestStatus.msg && (
                <div className={`text-xs p-2.5 rounded-lg flex items-center gap-2 ${openaiTestStatus.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                  {openaiTestStatus.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                  <span>{openaiTestStatus.msg}</span>
                </div>
              )}
            </div>
          </div>

          {/* Max Repair Attempts */}
          <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-200">Max AI Repair Attempts</label>
              <span className="text-xs px-2.5 py-1 font-mono font-bold bg-blue-500/20 text-blue-400 rounded-md border border-blue-500/30">
                {maxRepairAttempts} attempts
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Maximum times the AI repair engine will inspect compiler diagnostics, patch sources, and rebuild before stopping.
            </p>
            <input
              type="range"
              min="1"
              max="15"
              value={maxRepairAttempts}
              onChange={(e) => setMaxRepairAttempts(parseInt(e.target.value, 10))}
              className="w-full accent-blue-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between">
          <div className="text-xs text-emerald-400">{saveMsg}</div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
