import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { deleteSection, errorMessage, updateSection, type Section } from '../api';
import { RATING_BY_VALUE, SURFACE_TAGS, type Rating } from '../domain';
import { formatDate } from '../format';
import { invalidateSectionData } from '../queryKeys';
import { RatingPicker, SurfaceTagPicker } from './SectionFields';
import { useToast } from './Toast';

/**
 * Shows/edits one rated section. `section` comes straight from the sections query, so it reflects
 * saved changes; mount with key={section.id} so switching sections resets the form.
 */
export default function SectionDetailsPanel({
  section,
  onClose,
}: {
  section: Section;
  onClose(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState<Rating>(section.rating);
  const [tags, setTags] = useState<string[]>(section.surface_tags);
  const [notes, setNotes] = useState(section.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const update = useMutation({
    mutationFn: () =>
      updateSection(section.id, { rating, surface_tags: tags, notes: notes.trim() || null }),
    onSuccess: () => {
      setEditing(false);
      return invalidateSectionData(queryClient);
    },
    onError: (e) => toast.show(`Failed to update: ${errorMessage(e)}`, 'error'),
  });
  const remove = useMutation({
    mutationFn: () => deleteSection(section.id),
    onSuccess: () => {
      onClose();
      return invalidateSectionData(queryClient);
    },
    onError: (e) => toast.show(`Failed to delete: ${errorMessage(e)}`, 'error'),
  });

  const startEditing = () => {
    setRating(section.rating);
    setTags(section.surface_tags);
    setNotes(section.notes ?? '');
    setEditing(true);
  };

  return (
    <div className="absolute top-4 right-4 z-[1000] bg-white rounded-xl shadow-xl w-80">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="font-semibold text-gray-800">Section details</h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="p-4">
        {editing ? (
          <>
            <RatingPicker value={rating} onChange={setRating} />
            <SurfaceTagPicker value={tags} onChange={setTags} />
            <label className="block mb-4 text-sm font-medium text-gray-700">
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-20 resize-none font-normal"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => update.mutate()}
                disabled={update.isPending}
                className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium"
              >
                {update.isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 pb-3 border-b">
              <div className="text-sm text-gray-500">From ride</div>
              <div className="font-medium text-gray-800">
                {section.ride_title ?? 'Unknown ride'}
              </div>
              <div className="text-sm text-gray-500">{formatDate(section.ride_date)}</div>
            </div>
            <div className="mb-3">
              <div className="text-sm text-gray-500">Rating</div>
              <div className={`font-semibold ${RATING_BY_VALUE[section.rating]?.text ?? ''}`}>
                {RATING_BY_VALUE[section.rating]?.label ?? section.rating}
              </div>
            </div>
            {section.surface_tags.length > 0 && (
              <div className="mb-3">
                <div className="text-sm text-gray-500 mb-1">Surface issues</div>
                <div className="flex flex-wrap gap-1">
                  {section.surface_tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs"
                    >
                      {SURFACE_TAGS.find((t) => t.value === tag)?.label ?? tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {section.notes && (
              <div className="mb-3">
                <div className="text-sm text-gray-500 mb-1">Notes</div>
                <div className="text-sm text-gray-800 bg-gray-50 rounded p-2 whitespace-pre-line">
                  {section.notes}
                </div>
              </div>
            )}
            <div className="flex gap-2 mt-4 pt-3 border-t">
              <button
                onClick={startEditing}
                className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium"
              >
                Edit
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium"
              >
                Delete
              </button>
            </div>
            {confirmDelete && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="text-sm text-red-800 mb-2">Delete this section rating?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                    className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
                  >
                    {remove.isPending ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
