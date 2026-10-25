import type { FilePreview } from '../api';

/** Counts shown after analysing files, before importing. */
export function summarizePreview(previews: FilePreview[]) {
  return {
    cycling: previews.filter((p) => p.isCycling).length,
    nonCycling: previews.filter((p) => !p.isCycling && p.activityType !== 'unknown').length,
    unknown: previews.filter((p) => p.activityType === 'unknown').length,
    duplicates: previews.filter((p) => p.isDuplicate).length,
    nonCyclingTypes: [
      ...new Set(
        previews
          .filter((p) => !p.isCycling && p.activityType !== 'unknown')
          .map((p) => p.activityType)
      ),
    ],
  };
}
