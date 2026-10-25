import React, { useState, useRef } from 'react';
import { Upload, FileArchive, CheckCircle, AlertTriangle } from 'lucide-react';

interface UploadZoneProps {
  onUploaded: (fileData: any, inspection: any) => void;
  disabled?: boolean;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ onUploaded, disabled }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'jar' && ext !== 'zip') {
      setError('Please upload a valid .jar mod or .zip source project.');
      return;
    }

    setUploading(true);
    setProgress(20);

    const formData = new FormData();
    formData.append('file', file);

    try {
      setProgress(50);
      const res = await fetch('/api/mods/upload', {
        method: 'POST',
        body: formData
      });

      setProgress(85);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to inspect uploaded file.');
      }

      setProgress(100);
      setTimeout(() => {
        setUploading(false);
        onUploaded(data.file, data.inspection);
      }, 400);
    } catch (err: any) {
      setUploading(false);
      setError(err.message || 'Failed to upload and analyze mod.');
    }
  };

  return (
    <div className="w-full">
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !uploading && !disabled && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
          isDragging
            ? 'border-blue-500 bg-blue-500/10 scale-[1.01]'
            : 'border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/60'
        } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jar,.zip"
          onChange={handleChange}
          className="hidden"
        />

        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20 text-blue-400">
            {uploading ? (
              <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <FileArchive className="w-8 h-8" />
            )}
          </div>

          <div>
            <h3 className="text-base font-semibold text-slate-200">
              {uploading ? 'Analyzing Mod Structure...' : 'Drop your Minecraft Mod or Project Archive'}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Supports Fabric, Forge, and NeoForge source ZIPs or compiled JARs
            </p>
          </div>

          {!uploading && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-300">
              <Upload className="w-3.5 h-3.5" />
              <span>Browse Files (.jar, .zip)</span>
            </div>
          )}

          {uploading && (
            <div className="w-64 bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2 text-xs text-rose-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
