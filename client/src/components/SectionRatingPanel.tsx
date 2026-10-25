import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { createSection, errorMessage, type LatLngTuple } from '../api';
import { BIKE, BIKE_TYPES, type BikeType, type Rating } from '../domain';
import { invalidateSectionData } from '../queryKeys';
import { NotesField, RatingPicker, SurfaceTagPicker } from './SectionFields';
import { useToast } from './Toast';
import { Button, IconButton } from './ui/Button';
import { Select } from './ui/fields';

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
    <div
      role="dialog"
      aria-label="Rate this section"
      className="animate-pop-in absolute bottom-6 left-1/2 z-[1000] w-[26rem] -translate-x-1/2 rounded-lg border border-line bg-panel p-4 shadow-float"
    >
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex-1 text-base font-semibold">
          Rate this section <span className="text-xs font-normal text-faint">Step 3 of 3</span>
        </h3>
        <IconButton label="Close" onClick={onCancel} className="-mr-1.5">
          <X className="size-4" />
        </IconButton>
      </div>
      <RatingPicker value={rating} onChange={setRating} />
      <SurfaceTagPicker value={tags} onChange={setTags} />
      {!bikeType && (
        <label className="mb-4 flex items-center gap-3 text-xs font-medium text-muted">
          Bike type
          <Select value={bike} onChange={(e) => setBike(e.target.value as BikeType)}>
            {BIKE_TYPES.map((t) => (
              <option key={t} value={t}>
                {BIKE[t].label}
              </option>
            ))}
          </Select>
        </label>
      )}
      <NotesField
        label="Notes (optional)"
        value={notes}
        onChange={setNotes}
        placeholder="Any additional details…"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
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
        >
          {create.isPending ? 'Saving…' : 'Save rating'}
        </Button>
      </div>
    </div>
  );
}
