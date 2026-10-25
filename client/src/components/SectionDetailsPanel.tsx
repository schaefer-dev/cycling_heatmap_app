import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { deleteSection, errorMessage, updateSection, type Section } from '../api';
import { BIKE, RATING_BY_VALUE, SURFACE_TAGS, type Rating } from '../domain';
import { formatDate } from '../format';
import { invalidateSectionData } from '../queryKeys';
import { NotesField, RatingPicker, SurfaceTagPicker } from './SectionFields';
import { useToast } from './Toast';
import { Button, IconButton } from './ui/Button';
import { useConfirm } from './ui/Confirm';

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
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

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
      toast.show('Section deleted', 'success');
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

  const askDelete = async () => {
    const ok = await confirm({
      title: 'Delete this section rating?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) remove.mutate();
  };

  const info = RATING_BY_VALUE[section.rating];
  return (
    <aside
      aria-label="Section details"
      className="animate-pop-in absolute top-15 right-3 z-[1000] w-80 rounded-lg border border-line bg-panel shadow-float"
    >
      <div className="flex items-center gap-2 border-b border-line py-2.5 pr-2 pl-4">
        <h3 className="flex-1 text-base font-semibold">Section details</h3>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="p-4">
        {editing ? (
          <>
            <RatingPicker value={rating} onChange={setRating} />
            <SurfaceTagPicker value={tags} onChange={setTags} />
            <NotesField label="Notes" value={notes} onChange={setNotes} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => update.mutate()} disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: info?.color }}
              />
              <div>
                <div className="font-semibold">{info?.label ?? section.rating}</div>
                {info && <div className="text-xs text-muted">{info.description}</div>}
              </div>
            </div>
            <div className="text-xs">
              <div className="text-faint">From ride</div>
              <div className="text-sm font-medium text-fg">
                {section.ride_title ?? 'Unknown ride'}
              </div>
              <div className="tnum text-muted">
                {formatDate(section.ride_date)},{' '}
                {BIKE[section.bike_type]?.label ?? section.bike_type}
              </div>
            </div>
            {section.surface_tags.length > 0 && (
              <div>
                <div className="mb-1 text-xs text-faint">Surface issues</div>
                <div className="flex flex-wrap gap-1">
                  {section.surface_tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-sm border border-line px-2 py-0.5 text-xs text-muted"
                    >
                      {SURFACE_TAGS.find((t) => t.value === tag)?.label ?? tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {section.notes && (
              <div>
                <div className="mb-1 text-xs text-faint">Notes</div>
                <div className="rounded-md bg-raised p-2.5 text-sm whitespace-pre-line text-fg">
                  {section.notes}
                </div>
              </div>
            )}
            <div className="flex gap-2 border-t border-line pt-3">
              <Button
                size="sm"
                icon={<Pencil aria-hidden className="size-3.5" />}
                onClick={startEditing}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 aria-hidden className="size-3.5" />}
                onClick={() => void askDelete()}
                disabled={remove.isPending}
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
