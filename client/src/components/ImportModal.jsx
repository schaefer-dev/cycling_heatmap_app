import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importRides, previewRides } from '../api';

const BIKE_TYPE_COLORS = {
  road: 'bg-blue-500',
  gravel: 'bg-amber-600',
  mtb: 'bg-green-600'
};

const BIKE_TYPE_LABELS = {
  road: 'Road',
  gravel: 'Gravel',
  mtb: 'MTB'
};

export default function ImportModal({ onClose }) {
  const [files, setFiles] = useState([]);
  const [bikeType, setBikeType] = useState('gravel');
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [skipNonCycling, setSkipNonCycling] = useState(true);
  const [useDetectedBikeType, setUseDetectedBikeType] = useState(true);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  const previewMutation = useMutation({
    mutationFn: previewRides,
    onSuccess: (data) => {
      setPreview(data);
    },
    onError: (error) => {
      alert(`Preview failed: ${error.response?.data?.error || error.message}`);
    }
  });

  const importMutation = useMutation({
    mutationFn: ({ files, bikeType, options }) => importRides(files, bikeType, options),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['rides'] });
      queryClient.invalidateQueries({ queryKey: ['heatmap'] });
      queryClient.invalidateQueries({ queryKey: ['bounds'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['allTracks'] });

      const messages = [];
      messages.push(`Imported ${data.summary.success} ride(s).`);

      if (data.summary.skipped > 0) {
        messages.push(`\nSkipped ${data.summary.skipped}:`);
        messages.push(data.skipped.slice(0, 10).map((s) => `  - ${s.file}: ${s.reason}`).join('\n'));
        if (data.skipped.length > 10) {
          messages.push(`  ... and ${data.skipped.length - 10} more`);
        }
      }

      if (data.summary.failed > 0) {
        messages.push(`\nFailed ${data.summary.failed}:`);
        messages.push(data.errors.slice(0, 5).map((e) => `  - ${e.file}: ${e.error}`).join('\n'));
      }

      if (data.summary.skipped > 0 || data.summary.failed > 0) {
        alert(messages.join('\n'));
      }

      onClose();
    },
    onError: (error) => {
      alert(`Import failed: ${error.response?.data?.error || error.message}`);
    }
  });

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith('.gpx')
    );
    setFiles((prev) => [...prev, ...droppedFiles]);
    setPreview(null); // Reset preview when files change
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...selectedFiles]);
    setPreview(null); // Reset preview when files change
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreview(null);
  };

  const clearFiles = () => {
    setFiles([]);
    setPreview(null);
  };

  const handlePreview = () => {
    if (files.length === 0) return;
    previewMutation.mutate(files);
  };

  const handleImport = () => {
    if (files.length === 0) return;
    importMutation.mutate({
      files,
      bikeType,
      options: { skipNonCycling, useDetectedBikeType }
    });
  };

  // Calculate what will be imported based on preview and settings
  const getImportEstimate = () => {
    if (!preview) return null;

    let toImport = preview.previews.filter(p => !p.isDuplicate);

    if (skipNonCycling) {
      toImport = toImport.filter(p => p.isCycling || p.activityType === 'unknown');
    }

    return {
      count: toImport.length,
      byType: {
        road: toImport.filter(p => useDetectedBikeType && p.detectedBikeType === 'road').length,
        gravel: toImport.filter(p => useDetectedBikeType && p.detectedBikeType === 'gravel').length,
        mtb: toImport.filter(p => useDetectedBikeType && p.detectedBikeType === 'mtb').length,
        fallback: toImport.filter(p => !useDetectedBikeType || !p.detectedBikeType).length
      }
    };
  };

  const importEstimate = getImportEstimate();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <h2 className="text-lg font-semibold">Import GPX Files</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <div className="text-gray-600">
              <p className="font-medium">Drag & drop GPX files here</p>
              <p className="text-sm text-gray-500">or click to browse</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gpx"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Selected files */}
          {files.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">
                  Selected files ({files.length})
                </span>
                <button
                  onClick={clearFiles}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Clear all
                </button>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1 text-sm">
                {files.slice(0, 20).map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-gray-50 rounded px-2 py-1"
                  >
                    <span className="truncate text-gray-600">{file.name}</span>
                    <button
                      onClick={() => removeFile(index)}
                      className="text-red-500 hover:text-red-700 ml-2"
                    >
                      &times;
                    </button>
                  </div>
                ))}
                {files.length > 20 && (
                  <div className="text-gray-500 text-xs px-2">
                    ... and {files.length - 20} more files
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preview results */}
          {preview && (
            <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
              <h3 className="font-medium text-gray-800">Analysis Results</h3>

              {/* Summary */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white rounded p-2">
                  <div className="text-gray-500">Total files</div>
                  <div className="font-semibold">{preview.summary.total}</div>
                </div>
                <div className="bg-white rounded p-2">
                  <div className="text-gray-500">Cycling activities</div>
                  <div className="font-semibold text-green-600">{preview.summary.cycling}</div>
                </div>
                <div className="bg-white rounded p-2">
                  <div className="text-gray-500">Non-cycling</div>
                  <div className="font-semibold text-orange-600">{preview.summary.nonCycling}</div>
                </div>
                <div className="bg-white rounded p-2">
                  <div className="text-gray-500">Unknown type</div>
                  <div className="font-semibold text-gray-600">{preview.summary.unknown}</div>
                </div>
                <div className="bg-white rounded p-2">
                  <div className="text-gray-500">Duplicates</div>
                  <div className="font-semibold text-red-600">{preview.summary.duplicates}</div>
                </div>
                <div className="bg-white rounded p-2">
                  <div className="text-gray-500">Parse errors</div>
                  <div className="font-semibold text-red-600">{preview.summary.parseErrors}</div>
                </div>
              </div>

              {/* Detected bike types */}
              {preview.summary.cycling > 0 && (
                <div className="bg-white rounded p-2">
                  <div className="text-gray-500 text-sm mb-1">Detected bike types:</div>
                  <div className="flex gap-2 flex-wrap">
                    {preview.summary.byBikeType.road > 0 && (
                      <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-sm">
                        Road: {preview.summary.byBikeType.road}
                      </span>
                    )}
                    {preview.summary.byBikeType.gravel > 0 && (
                      <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-sm">
                        Gravel: {preview.summary.byBikeType.gravel}
                      </span>
                    )}
                    {preview.summary.byBikeType.mtb > 0 && (
                      <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-sm">
                        MTB: {preview.summary.byBikeType.mtb}
                      </span>
                    )}
                    {preview.summary.byBikeType.undetected > 0 && (
                      <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-sm">
                        Undetected: {preview.summary.byBikeType.undetected}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Non-cycling activity types found */}
              {preview.summary.nonCycling > 0 && (
                <div className="bg-orange-50 rounded p-2 text-sm">
                  <div className="text-orange-700 font-medium">Non-cycling activities found:</div>
                  <div className="text-orange-600">
                    {[...new Set(preview.previews
                      .filter(p => !p.isCycling && p.activityType !== 'unknown')
                      .map(p => p.activityType)
                    )].join(', ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Import options */}
          {preview && (
            <div className="space-y-3">
              <h3 className="font-medium text-gray-800">Import Options</h3>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={skipNonCycling}
                  onChange={(e) => setSkipNonCycling(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">
                  Skip non-cycling activities
                  {preview.summary.nonCycling > 0 && (
                    <span className="text-orange-600 ml-1">
                      ({preview.summary.nonCycling} will be skipped)
                    </span>
                  )}
                </span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useDetectedBikeType}
                  onChange={(e) => setUseDetectedBikeType(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">
                  Use detected bike type when available
                </span>
              </label>

              <div>
                <label className="block text-sm text-gray-700 mb-1">
                  {useDetectedBikeType
                    ? 'Fallback bike type (when not detected):'
                    : 'Bike type for all imports:'}
                </label>
                <select
                  value={bikeType}
                  onChange={(e) => setBikeType(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="road">Road</option>
                  <option value="gravel">Gravel</option>
                  <option value="mtb">MTB</option>
                </select>
              </div>

              {/* Import estimate */}
              {importEstimate && (
                <div className="bg-blue-50 rounded p-3 text-sm">
                  <div className="font-medium text-blue-800">
                    Will import {importEstimate.count} ride(s):
                  </div>
                  {useDetectedBikeType && (
                    <div className="text-blue-700 mt-1">
                      {importEstimate.byType.road > 0 && `${importEstimate.byType.road} Road, `}
                      {importEstimate.byType.gravel > 0 && `${importEstimate.byType.gravel} Gravel, `}
                      {importEstimate.byType.mtb > 0 && `${importEstimate.byType.mtb} MTB, `}
                      {importEstimate.byType.fallback > 0 && `${importEstimate.byType.fallback} as ${BIKE_TYPE_LABELS[bikeType]}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>

          {!preview ? (
            <button
              onClick={handlePreview}
              disabled={files.length === 0 || previewMutation.isPending}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg transition-colors"
            >
              {previewMutation.isPending ? 'Analyzing...' : `Analyze ${files.length} file(s)`}
            </button>
          ) : (
            <button
              onClick={handleImport}
              disabled={importEstimate?.count === 0 || importMutation.isPending}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg transition-colors"
            >
              {importMutation.isPending
                ? 'Importing...'
                : `Import ${importEstimate?.count || 0} ride(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
