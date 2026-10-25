/** Shared vocabulary and colours. Values must match server/src/domain.ts. */

export const BIKE_TYPES = ['road', 'gravel', 'mtb'] as const;
export type BikeType = (typeof BIKE_TYPES)[number];

export const BIKE: Record<BikeType, { label: string; color: string; badge: string }> = {
  road: { label: 'Road', color: '#3b82f6', badge: 'bg-blue-500' },
  gravel: { label: 'Gravel', color: '#d97706', badge: 'bg-amber-600' },
  mtb: { label: 'MTB', color: '#16a34a', badge: 'bg-green-600' },
};
export const UNASSIGNED_COLOR = '#6b7280';

export const RATINGS = [
  {
    value: 'excellent',
    label: 'Excellent',
    color: '#22c55e',
    bg: 'bg-green-500',
    text: 'text-green-600',
    description: 'Perfect conditions',
  },
  {
    value: 'good',
    label: 'Good',
    color: '#84cc16',
    bg: 'bg-lime-500',
    text: 'text-lime-600',
    description: 'Minor issues but rideable',
  },
  {
    value: 'challenging',
    label: 'Challenging',
    color: '#eab308',
    bg: 'bg-yellow-500',
    text: 'text-yellow-600',
    description: 'Difficult but manageable',
  },
  {
    value: 'hard',
    label: 'Hard',
    color: '#f97316',
    bg: 'bg-orange-500',
    text: 'text-orange-600',
    description: 'Very difficult, consider avoiding',
  },
  {
    value: 'unridable',
    label: 'Unridable',
    color: '#ef4444',
    bg: 'bg-red-500',
    text: 'text-red-600',
    description: 'Not possible/safe',
  },
] as const;
export type Rating = (typeof RATINGS)[number]['value'];
export const RATING_BY_VALUE = Object.fromEntries(RATINGS.map((r) => [r.value, r])) as Record<
  Rating,
  (typeof RATINGS)[number]
>;

export const SURFACE_TAGS = [
  { value: 'loose_gravel', label: 'Loose Gravel' },
  { value: 'sand', label: 'Sand' },
  { value: 'mud', label: 'Mud' },
  { value: 'rocks', label: 'Rocks' },
  { value: 'roots', label: 'Roots' },
  { value: 'steep', label: 'Steep' },
  { value: 'technical', label: 'Technical' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'poor_surface', label: 'Poor Surface' },
] as const;

export function bikeColor(bikeType: string | null | undefined): string {
  return bikeType && bikeType in BIKE ? BIKE[bikeType as BikeType].color : UNASSIGNED_COLOR;
}
