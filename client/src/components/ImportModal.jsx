import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importRides } from '../api';

export default function ImportModal({ onClose }) {
  const [files, setFiles] = useState([]);
  const [bikeType, setBikeType] = useState('gravel');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: ({ files, bikeType }) => importRides(files, bikeType),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['rides'] });
      queryClient.invalidateQueries({ queryKey: ['heatmap'] });
      queryClient.invalidateQueries({ queryKey: ['bounds'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['allTracks'] });

      const messages = [];
      messages.push(`Imported ${data.summary.success} ride(s).`);

      if (data.summary.skipped > 0) {
        messages.push(`\n\nSkipped ${data.summary.skipped} duplicate(s):`);
        messages.push(data.skipped.map((s) => `• ${s.file}: ${s.reason}`).join('\n'));
      }

      if (data.summary.failed > 0) {
        messages.push(`\n\nFailed ${data.summary.failed}:`);
        messages.push(data.errors.map((e) => `• ${e.file}: ${e.error}`).join('\n'));
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
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...selectedFiles]);
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleImport = () => {
    if (files.length === 0) return;
    importMutation.mutate({ files, bikeType });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Import GPX Files</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Bike type selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bike type for imported rides
            </label>
            <select
              value={bikeType}
              onChange={(e) => setBikeType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="road">Road</option>
              <option value="gravel">Gravel</option>
              <option value="mtb">MTB</option>
            </select>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <div className="text-gray-600">
              <div className="text-2xl mb-2">📁</div>
              <p>Drag & drop GPX files here</p>
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
              <div className="text-sm font-medium text-gray-700 mb-2">
                Selected files ({files.length})
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-sm"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      onClick={() => removeFile(index)}
                      className="text-red-500 hover:text-red-700 ml-2"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={files.length === 0 || importMutation.isPending}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg transition-colors"
          >
            {importMutation.isPending ? 'Importing...' : `Import ${files.length} file(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
