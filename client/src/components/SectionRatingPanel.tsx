import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createSection, errorMessage, type LatLngTuple } from '../api';
import { BIKE, BIKE_TYPES, type BikeType, type Rating } from '../domain';
import { invalidateSectionData } from '../queryKeys';
import { RatingPicker, SurfaceTagPicker } from './SectionFields';
import { useToast } from './Toast';

interface Point {
  index: number;
  lat: number;
  lng: number;
}

interface Props {
  rideId: string;
  bikeType: BikeType | null;
  startPoint: Point;
  endPoint: Point;
  trackSegment: LatLngTuple[];
  onCancel(): void;
  onSave(): void;
}

export default function SectionRatingPanel({
  rideId,
  bikeType,
  startPoint,
  endPoint,
  trackSegment,
  onCancel,
  onSave,
}: Props) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  // A section needs a bike type; rides without one let the user pick it here.
  const [bike, setBike] = useState<BikeType>(bikeType ?? 'gravel');
  const queryClient = useQueryClient();
  const toast = useToast();

  const create = useMutation({
    mutationFn: createSection,
    onSuccess: () => {
      toast.show('Section saved', 'success');
      onSave();
      return invalidateSectionData(queryClient);
    },
    onError: (e) => toast.show(`Failed to save section: ${errorMessage(e)}`, 'error'),
  });

  const [first, last] =
    startPoint.index <= endPoint.index ? [startPoint, endPoint] : [endPoint, startPoint];

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-white rounded-xl shadow-xl p-4 w-96">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-gray-800">Rate this section</h3>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-700" aria-label="Close">
          ×
        </button>
      </div>
      <RatingPicker value={rating} onChange={setRating} />
      <SurfaceTagPicker value={tags} onChange={setTags} />
      {!bikeType && (
        <label className="block mb-3 text-sm text-gray-700">
          Bike type
          <select
            value={bike}
            onChange={(e) => setBike(e.target.value as BikeType)}
            className="ml-2 border rounded px-2 py-1"
          >
            {BIKE_TYPES.map((t) => (
              <option key={t} value={t}>
                {BIKE[t].label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block mb-4 text-sm font-medium text-gray-700">
        Notes (optional)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional details…"
          className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-16 resize-none font-normal"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm"
        >
          Cancel
        </button>
        <button
          onClick={() =>
            rating &&
            create.mutate({
              ride_id: rideId,
              start_lat: first.lat,
              start_lng: first.lng,
              start_index: first.index,
              end_lat: last.lat,
              end_lng: last.lng,
              end_index: last.index,
              track_segment: trackSegment,
              rating,
              bike_type: bike,
              surface_tags: tags,
              notes: notes.trim() || null,
            })
          }
          disabled={!rating || create.isPending}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg text-sm"
        >
          {create.isPending ? 'Saving…' : 'Save rating'}
        </button>
      </div>
    </div>
  );
}
