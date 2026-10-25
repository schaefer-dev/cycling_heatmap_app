/**
 * Stacking order (z-index): tiles < heatmap (overlay 400) < all tracks (401) < route (402)
 * < selected ride (405) < deviations (406) < sections (410) < popups.
 */
export const PANES = {
  tracks: { name: 'tracksPane', zIndex: 401 },
  route: { name: 'routePane', zIndex: 402 },
  ride: { name: 'ridePane', zIndex: 405 },
  deviation: { name: 'deviationPane', zIndex: 406 },
  sections: { name: 'sectionsPane', zIndex: 410 },
} as const;
