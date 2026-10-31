import type { BaseMap } from '../App';

/** Map settings on the phone; stored apart from the desktop ones. */
export interface MobileView {
  baseMap: BaseMap;
  showHeatmap: boolean;
  showAllTracks: boolean;
}

export const DEFAULT_MOBILE_VIEW: MobileView = {
  baseMap: 'dark',
  showHeatmap: true,
  showAllTracks: false,
};
