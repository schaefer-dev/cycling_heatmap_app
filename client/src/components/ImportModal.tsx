import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, importRides, previewRides } from '../api';
import { BIKE, BIKE_TYPES, type BikeType } from '../domain';
import { invalidateRideData } from '../queryKeys';
import { summarizePreview } from './importSummary';
import { useToast } from './Toast';

const ACCEPTED = ['.gpx', '.fit'];
const isAccepted = (f: File) => ACCEPTED.some((ext) => f.name.toLowerCase().endsWith(ext));
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export default function ImportModal({ onClose }: { onClose(): void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [fallbackBike, setFallbackBike] = useState<BikeType | ''>('');
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewRides>> | null>(null);
  const [skipNonCycling, setSkipNonCycling] = useState(true);
  const [useDetected, setUseDetected] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list).filter(isAccepted);
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      return [...prev, ...incoming.filter((f) => !seen.has(fileKey(f)))];
    });
    setPreview(null);
  };

  const analyze = useMutation({
    mutationFn: () => previewRides(files),
    onSuccess: setPreview,
    onError: (e) => toast.show(`Analysis failed: ${errorMessage(e)}`, 'error'),
  });

  const doImport = useMutation({
    mutationFn: () =>
      importRides(
        files,
        fallbackBike,
        { skipNonCycling, useDetectedBikeType: useDetected },
        (done, total) => setProgress({ done, total })
      ),
    onSuccess: (data) => {
      const lines = [`Imported ${data.summary.success} ride(s).`];
      if (data.summary.skipped)
        lines.push(`Skipped ${data.summary.skipped} (duplicates or non-cycling).`);
      if (data.summary.failed)
        lines.push(
          `Failed ${data.summary.failed}: ${data.errors
            .slice(0, 3)
            .map((e) => e.file)
            .join(', ')}`
        );
      toast.show(lines.join('\n'), data.summary.failed ? 'error' : 'success');
      onClose();
      return invalidateRideData(queryClient);
    },
    onError: (e) => toast.show(`Import failed: ${errorMessage(e)}`, 'error'),
    onSettled: () => setProgress(null),
  });

  const summary = useMemo(() => (preview ? summarizePreview(preview.previews) : null), [preview]);
  const toImport = useMemo(() => {
    if (!preview) return 0;
    return preview.previews.filter(
      (p) => !p.isDuplicate && (!skipNonCycling || p.isCycling || p.activityType === 'unknown')
    ).length;
  }, [preview, skipNonCycling]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1500]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Import files"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Import GPX / FIT files</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <p className="text-xs text-gray-500">
            Rides on Garmin Connect and Hammerhead arrive automatically via the sync. Use this for
            other sources or old exports.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer ${dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
          >
            <p className="font-medium text-gray-600">Drag & drop .gpx or .fit files here</p>
            <p className="text-sm text-gray-500">or click to browse</p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              multiple
              onChange={(e) => e.target.files && addFiles(e.target.files)}
              className="hidden"
            />
          </div>

          {files.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1 text-sm">
                <span className="font-medium text-gray-700">Selected files ({files.length})</span>
                <button
                  onClick={() => {
                    setFiles([]);
                    setPreview(null);
                  }}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Clear all
                </button>
              </div>
              <ul className="max-h-32 overflow-y-auto space-y-1 text-sm">
                {files.slice(0, 20).map((f) => (
                  <li
                    key={fileKey(f)}
                    className="flex items-center justify-between bg-gray-50 rounded px-2 py-1"
                  >
                    <span className="truncate text-gray-600">{f.name}</span>
                    <button
                      onClick={() => {
                        setFiles((prev) => prev.filter((p) => p !== f));
                        setPreview(null);
                      }}
                      className="text-red-500 hover:text-red-700 ml-2"
                      aria-label={`Remove ${f.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
                {files.length > 20 && (
                  <li className="text-gray-500 text-xs px-2">… and {files.length - 20} more</li>
                )}
              </ul>
            </div>
          )}

          {preview && summary && (
            <div className="border rounded-lg p-3 bg-gray-50 space-y-2 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Cycling" value={summary.cycling} className="text-green-600" />
                <Metric
                  label="Non-cycling"
                  value={summary.nonCycling}
                  className="text-orange-600"
                />
                <Metric label="Unknown type" value={summary.unknown} className="text-gray-600" />
                <Metric
                  label="Already imported"
                  value={summary.duplicates}
                  className="text-red-600"
                />
                <Metric label="Unreadable" value={preview.errors.length} className="text-red-600" />
              </div>
              {summary.nonCyclingTypes.length > 0 && (
                <div className="text-orange-700 text-xs">
                  Non-cycling types: {summary.nonCyclingTypes.join(', ')}
                </div>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={skipNonCycling}
                  onChange={(e) => setSkipNonCycling(e.target.checked)}
                />
                Skip non-cycling activities
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useDetected}
                  onChange={(e) => setUseDetected(e.target.checked)}
                />
                Use the bike type detected in the file when available
              </label>
              <label className="flex items-center gap-2">
                {useDetected ? 'Otherwise' : 'Bike type'}:
                <select
                  value={fallbackBike}
                  onChange={(e) => setFallbackBike(e.target.value as BikeType | '')}
                  className="border rounded px-2 py-1"
                >
                  <option value="">Leave unassigned</option>
                  {BIKE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {BIKE[t].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          {progress && (
            <span className="mr-auto text-sm text-gray-500">
              Uploading {progress.done}/{progress.total}…
            </span>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          {!preview ? (
            <button
              onClick={() => analyze.mutate()}
              disabled={files.length === 0 || analyze.isPending}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg"
            >
              {analyze.isPending ? 'Analyzing…' : `Analyze ${files.length} file(s)`}
            </button>
          ) : (
            <button
              onClick={() => doImport.mutate()}
              disabled={toImport === 0 || doImport.isPending}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg"
            >
              {doImport.isPending ? 'Importing…' : `Import ${toImport} ride(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="bg-white rounded p-2">
      <div className="text-gray-500 text-xs">{label}</div>
      <div className={`font-semibold ${className}`}>{value}</div>
    </div>
  );
}
