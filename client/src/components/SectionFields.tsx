import { RATINGS, SURFACE_TAGS, type Rating } from '../domain';
import { cx } from './ui/cx';
import { inputClass } from './ui/fields';

const legend = 'mb-1.5 block text-xs font-medium text-muted';

export function RatingPicker({
  value,
  onChange,
}: {
  value: Rating | null;
  onChange(r: Rating): void;
}) {
  return (
    <fieldset className="mb-4">
      <legend className={legend}>Rating</legend>
      <div className="grid grid-cols-5 gap-1">
        {RATINGS.map((r) => {
          const selected = value === r.value;
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => onChange(r.value)}
              aria-pressed={selected}
              title={r.description}
              className={cx(
                'flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-2xs font-medium transition-colors',
                selected
                  ? 'text-fg'
                  : 'border-line text-muted hover:border-line-strong hover:text-fg'
              )}
              style={
                selected ? { borderColor: r.color, backgroundColor: `${r.color}26` } : undefined
              }
            >
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ backgroundColor: r.color }}
              />
              {r.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SurfaceTagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange(tags: string[]): void;
}) {
  const toggle = (tag: string) =>
    onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
  return (
    <fieldset className="mb-4">
      <legend className={legend}>Surface issues (optional)</legend>
      <div className="flex flex-wrap gap-1">
        {SURFACE_TAGS.map((t) => {
          const selected = value.includes(t.value);
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => toggle(t.value)}
              aria-pressed={selected}
              className={cx(
                'rounded-sm border px-2 py-1 text-xs transition-colors',
                selected
                  ? 'border-signal/60 bg-signal/15 text-fg'
                  : 'border-line text-muted hover:border-line-strong hover:text-fg'
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function NotesField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
}) {
  return (
    <label className="mb-4 block">
      <span className={legend}>{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cx(inputClass, 'h-18 w-full resize-none py-2')}
      />
    </label>
  );
}
