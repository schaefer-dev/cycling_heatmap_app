import { RATINGS, SURFACE_TAGS, type Rating } from '../domain';

export function RatingPicker({
  value,
  onChange,
}: {
  value: Rating | null;
  onChange(r: Rating): void;
}) {
  return (
    <fieldset className="mb-3">
      <legend className="block text-sm font-medium text-gray-700 mb-1">Rating</legend>
      <div className="grid grid-cols-5 gap-1">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onChange(r.value)}
            aria-pressed={value === r.value}
            title={r.description}
            className={`p-1.5 rounded text-xs text-white transition-all ${r.bg} ${
              value === r.value
                ? 'ring-2 ring-offset-1 ring-gray-800'
                : 'opacity-60 hover:opacity-100'
            }`}
          >
            {r.label}
          </button>
        ))}
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
    <fieldset className="mb-3">
      <legend className="block text-sm font-medium text-gray-700 mb-1">
        Surface issues (optional)
      </legend>
      <div className="flex flex-wrap gap-1">
        {SURFACE_TAGS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => toggle(t.value)}
            aria-pressed={value.includes(t.value)}
            className={`px-2 py-1 rounded-full text-xs transition-colors ${
              value.includes(t.value)
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
