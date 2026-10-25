import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { errorMessage, importRides, previewRides } from '../api';
import { BIKE, BIKE_TYPES, type BikeType } from '../domain';
import { invalidateRideData } from '../queryKeys';
import { summarizePreview } from './importSummary';
import { useToast } from './Toast';
import { Button, IconButton } from './ui/Button';
import { cx } from './ui/cx';
import { Dialog } from './ui/Dialog';
import { Select, Switch } from './ui/fields';

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

  const step = !preview ? 1 : doImport.isPending ? 3 : 2;
  return (
    <Dialog
      title="Import GPX and FIT files"
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <>
          {progress && (
            <span className="tnum mr-auto text-sm text-muted">
              Uploading {progress.done}/{progress.total}…
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!preview ? (
            <Button
              variant="primary"
              onClick={() => analyze.mutate()}
              disabled={files.length === 0 || analyze.isPending}
            >
              {analyze.isPending ? 'Analyzing…' : `Analyze ${files.length} file(s)`}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => doImport.mutate()}
              disabled={toImport === 0 || doImport.isPending}
            >
              {doImport.isPending ? 'Importing…' : `Import ${toImport} ride(s)`}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <ol className="flex items-center gap-2 text-xs" aria-label="Import steps">
          {['Choose files', 'Review', 'Import'].map((label, i) => (
            <li
              key={label}
              aria-current={step === i + 1 ? 'step' : undefined}
              className={cx(
                'flex items-center gap-2',
                step === i + 1 ? 'text-fg' : step > i + 1 ? 'text-muted' : 'text-faint'
              )}
            >
              {i > 0 && <span aria-hidden className="h-px w-6 bg-line" />}
              <span
                className={cx(
                  'tnum flex size-5 items-center justify-center rounded-full border text-2xs font-semibold',
                  step === i + 1 ? 'border-signal text-signal' : 'border-line'
                )}
              >
                {i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        <p className="text-xs text-muted">
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Choose .gpx or .fit files"
          className={cx(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
            dragging ? 'border-signal bg-signal/10' : 'border-line hover:border-line-strong'
          )}
        >
          <FileUp aria-hidden className="size-6 text-faint" />
          <p className="font-medium text-fg">Drag and drop .gpx or .fit files here</p>
          <p className="text-sm text-muted">or click to browse</p>
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
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-fg">
                Selected files <span className="tnum text-faint">{files.length}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFiles([]);
                  setPreview(null);
                }}
              >
                Clear all
              </Button>
            </div>
            <ul className="max-h-32 space-y-px overflow-y-auto rounded-md border border-line p-1 text-sm">
              {files.slice(0, 20).map((f) => (
                <li
                  key={fileKey(f)}
                  className="flex items-center justify-between rounded-sm py-0.5 pr-0.5 pl-2 hover:bg-raised"
                >
                  <span className="truncate text-muted">{f.name}</span>
                  <IconButton
                    label={`Remove ${f.name}`}
                    onClick={() => {
                      setFiles((prev) => prev.filter((p) => p !== f));
                      setPreview(null);
                    }}
                    className="size-6"
                  >
                    <X className="size-3.5" />
                  </IconButton>
                </li>
              ))}
              {files.length > 20 && (
                <li className="px-2 py-0.5 text-xs text-faint">… and {files.length - 20} more</li>
              )}
            </ul>
          </div>
        )}

        {preview && summary && (
          <div className="space-y-3 rounded-lg border border-line p-3 text-sm">
            <div className="grid grid-cols-5 gap-2">
              <Metric label="Cycling" value={summary.cycling} className="text-ok" />
              <Metric label="Non-cycling" value={summary.nonCycling} className="text-warn" />
              <Metric label="Unknown type" value={summary.unknown} className="text-muted" />
              <Metric label="Already imported" value={summary.duplicates} className="text-muted" />
              <Metric label="Unreadable" value={preview.errors.length} className="text-danger" />
            </div>
            {summary.nonCyclingTypes.length > 0 && (
              <div className="text-xs text-warn">
                Non-cycling types: {summary.nonCyclingTypes.join(', ')}
              </div>
            )}
            <Switch
              label="Skip non-cycling activities"
              checked={skipNonCycling}
              onChange={setSkipNonCycling}
            />
            <Switch
              label="Use the bike type detected in the file when available"
              checked={useDetected}
              onChange={setUseDetected}
            />
            <label className="flex items-center gap-3">
              <span className="text-muted">{useDetected ? 'Otherwise' : 'Bike type'}</span>
              <Select
                value={fallbackBike}
                onChange={(e) => setFallbackBike(e.target.value as BikeType | '')}
              >
                <option value="">Leave unassigned</option>
                {BIKE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BIKE[t].label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Metric({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-md bg-raised px-2.5 py-2">
      <div className="text-2xs text-faint">{label}</div>
      <div className={cx('tnum text-lg font-semibold', value === 0 ? 'text-faint' : className)}>
        {value}
      </div>
    </div>
  );
}
