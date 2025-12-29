import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateSection, deleteSection } from '../api';

const RATINGS = [
  { value: 'excellent', label: 'Excellent', color: 'bg-green-500' },
  { value: 'good', label: 'Good', color: 'bg-lime-500' },
  { value: 'challenging', label: 'Challenging', color: 'bg-yellow-500' },
  { value: 'hard', label: 'Hard', color: 'bg-orange-500' },
  { value: 'unridable', label: 'Unridable', color: 'bg-red-500' }
];

const SURFACE_TAGS = [
  { value: 'loose_gravel', label: 'Loose Gravel' },
  { value: 'sand', label: 'Sand' },
  { value: 'mud', label: 'Mud' },
  { value: 'rocks', label: 'Rocks' },
  { value: 'roots', label: 'Roots' },
  { value: 'steep', label: 'Steep' },
  { value: 'technical', label: 'Technical' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'poor_surface', label: 'Poor Surface' }
];

const RATING_COLORS = {
  excellent: 'text-green-600',
  good: 'text-lime-600',
  challenging: 'text-yellow-600',
  hard: 'text-orange-600',
  unridable: 'text-red-600'
};

export default function SectionDetailsPanel({ section, onClose }) {
  const [isEditing, setIsEditing] = useState(false);
  const [rating, setRating] = useState(section.rating);
  const [selectedTags, setSelectedTags] = useState(section.surface_tags || []);
  const [notes, setNotes] = useState(section.notes || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (updates) => updateSection(section.id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sections'] });
      setIsEditing(false);
    },
    onError: (error) => {
      alert(`Failed to update: ${error.response?.data?.error || error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSection(section.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sections'] });
      onClose();
    },
    onError: (error) => {
      alert(`Failed to delete: ${error.response?.data?.error || error.message}`);
    }
  });

  const toggleTag = (tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSave = () => {
    updateMutation.mutate({
      rating,
      surface_tags: selectedTags,
      notes: notes.trim() || null
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown date';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="absolute top-4 right-4 z-[1000] bg-white rounded-xl shadow-xl w-80">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="font-semibold text-gray-800">Section Details</h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <div className="p-4">
        {!isEditing ? (
          /* View Mode */
          <>
            {/* Ride info */}
            <div className="mb-3 pb-3 border-b">
              <div className="text-sm text-gray-500">From ride</div>
              <div className="font-medium text-gray-800">
                {section.ride_title || 'Unknown ride'}
              </div>
              <div className="text-sm text-gray-500">
                {formatDate(section.ride_date)}
              </div>
            </div>

            {/* Rating */}
            <div className="mb-3">
              <div className="text-sm text-gray-500">Rating</div>
              <div className={`font-semibold capitalize ${RATING_COLORS[section.rating]}`}>
                {section.rating}
              </div>
            </div>

            {/* Surface tags */}
            {section.surface_tags && section.surface_tags.length > 0 && (
              <div className="mb-3">
                <div className="text-sm text-gray-500 mb-1">Surface issues</div>
                <div className="flex flex-wrap gap-1">
                  {section.surface_tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs"
                    >
                      {SURFACE_TAGS.find((t) => t.value === tag)?.label || tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {section.notes && (
              <div className="mb-3">
                <div className="text-sm text-gray-500 mb-1">Notes</div>
                <div className="text-sm text-gray-800 bg-gray-50 rounded p-2">
                  {section.notes}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-4 pt-3 border-t">
              <button
                onClick={() => setIsEditing(true)}
                className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium"
              >
                Edit
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium"
              >
                Delete
              </button>
            </div>

            {/* Delete confirmation */}
            {showDeleteConfirm && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="text-sm text-red-800 mb-2">
                  Delete this section rating?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Edit Mode */
          <>
            {/* Rating selection */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rating
              </label>
              <div className="grid grid-cols-5 gap-1">
                {RATINGS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRating(r.value)}
                    className={`p-1.5 rounded text-xs text-white transition-all ${r.color} ${
                      rating === r.value
                        ? 'ring-2 ring-offset-1 ring-gray-800'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Surface tags */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Surface issues
              </label>
              <div className="flex flex-wrap gap-1">
                {SURFACE_TAGS.map((tag) => (
                  <button
                    key={tag.value}
                    onClick={() => toggleTag(tag.value)}
                    className={`px-2 py-1 rounded-full text-xs transition-colors ${
                      selectedTags.includes(tag.value)
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional details..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-20 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setRating(section.rating);
                  setSelectedTags(section.surface_tags || []);
                  setNotes(section.notes || '');
                }}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
