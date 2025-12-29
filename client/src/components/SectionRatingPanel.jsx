import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSection } from '../api';

const RATINGS = [
  { value: 'excellent', label: 'Excellent', color: 'bg-green-500', description: 'Perfect conditions' },
  { value: 'good', label: 'Good', color: 'bg-lime-500', description: 'Minor issues but rideable' },
  { value: 'challenging', label: 'Challenging', color: 'bg-yellow-500', description: 'Difficult but manageable' },
  { value: 'hard', label: 'Hard', color: 'bg-orange-500', description: 'Very difficult, consider avoiding' },
  { value: 'unridable', label: 'Unridable', color: 'bg-red-500', description: 'Not possible/safe' }
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

export default function SectionRatingPanel({
  rideId,
  biketype,
  startPoint,
  endPoint,
  trackSegment,
  onCancel,
  onSave
}) {
  const [rating, setRating] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: createSection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sections'] });
      onSave();
    },
    onError: (error) => {
      alert(`Failed to save section: ${error.response?.data?.error || error.message}`);
    }
  });

  const toggleTag = (tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSave = () => {
    if (!rating) {
      alert('Please select a rating');
      return;
    }

    createMutation.mutate({
      ride_id: rideId,
      start_lat: startPoint.lat,
      start_lng: startPoint.lng,
      start_index: startPoint.index,
      end_lat: endPoint.lat,
      end_lng: endPoint.lng,
      end_index: endPoint.index,
      track_segment: trackSegment,
      rating,
      bike_type: biketype,
      surface_tags: selectedTags,
      notes: notes.trim() || null
    });
  };

  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-white rounded-xl shadow-xl p-4 w-96">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-gray-800">Rate this section</h3>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700"
        >
          &times;
        </button>
      </div>

      {/* Rating selection */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Rating *
        </label>
        <div className="grid grid-cols-5 gap-1">
          {RATINGS.map((r) => (
            <button
              key={r.value}
              onClick={() => setRating(r.value)}
              className={`p-2 rounded text-xs text-white transition-all ${r.color} ${
                rating === r.value
                  ? 'ring-2 ring-offset-1 ring-gray-800'
                  : 'opacity-60 hover:opacity-100'
              }`}
              title={r.description}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Surface tags */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Surface issues (optional)
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
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional details..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-16 resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!rating || createMutation.isPending}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg text-sm"
        >
          {createMutation.isPending ? 'Saving...' : 'Save Rating'}
        </button>
      </div>
    </div>
  );
}
