# CLAUDE.md - Cycling Archive Project Guide

## Project Overview

Personal cycling ride archive application for storing GPX rides, visualizing them on a heatmap, and rating road/trail sections for future route planning.

## Quick Start

```bash
./start.sh          # Start server + frontend, opens browser
# Or manually:
npm run dev         # Runs both server and client concurrently
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- Database: `data/cycling_archive.db` (SQLite)

## Tech Stack

- **Frontend**: React + Vite, Tailwind CSS, Leaflet (react-leaflet), TanStack React Query
- **Backend**: Express.js, better-sqlite3
- **Maps**: OpenStreetMap tiles, leaflet.heat for heatmap

## Project Structure

```
cycling_map/
├── client/                 # React frontend
│   └── src/
│       ├── App.jsx         # Main app, state management
│       ├── api.js          # API client functions
│       └── components/
│           ├── Map.jsx           # Main map with all layers
│           ├── Sidebar.jsx       # Controls, ride list, filters
│           ├── HeatmapLayer.jsx  # Leaflet.heat integration
│           ├── ImportModal.jsx   # GPX file import
│           ├── SectionRatingPanel.jsx   # Rate a section
│           └── SectionDetailsPanel.jsx  # View/edit section
├── server/
│   └── src/
│       ├── index.js        # Express server entry
│       ├── db.js           # SQLite setup + migrations
│       ├── gpxParser.js    # GPX parsing + Douglas-Peucker simplification
│       └── routes/
│           ├── rides.js    # CRUD for rides
│           ├── sections.js # CRUD for sections
│           └── heatmap.js  # Heatmap data, stats, tracks
└── data/                   # SQLite database (gitignored)
```

## Database Schema

```sql
-- Main tables
rides (id, title, date, bike_type, distance_km, elevation_gain_m, notes)
track_points (ride_id, lat, lng, elevation, timestamp, point_index)
track_points_simplified (ride_id, lat, lng)  -- For heatmap performance
sections (id, ride_id, bike_type, rating, surface_tags, notes,
          start_lat, start_lng, start_index, end_lat, end_lng, end_index,
          track_segment)  -- track_segment stores actual path as JSON
```

## Key API Endpoints

```
GET/POST   /api/rides              # List/import rides
POST       /api/rides/preview      # Preview GPX files (detect activity types)
GET/DELETE /api/rides/:id          # Get/delete ride with track
GET/POST   /api/sections           # List/create sections
PUT/DELETE /api/sections/:id       # Update/delete section
GET        /api/heatmap            # Simplified points for heatmap
GET        /api/heatmap/tracks     # All tracks with metadata (for "show all tracks")
GET        /api/heatmap/stats      # Ride/section statistics
GET        /api/heatmap/bounds     # Map bounding box
```

## Important Patterns

### Map Layers (Z-Index Order)
Custom Leaflet panes control layer stacking:
- `tracksPane` (z-index 401): "Show all tracks" polylines
- `sectionsPane` (z-index 410): Rated section overlays
- Heatmap canvas has `pointer-events: none` to allow clicks through

### State Management
All UI state lives in `App.jsx` and flows down via props:
- `selectedRide`, `bikeTypeFilter`, `showHeatmap`, `showSections`, `showAllTracks`
- `trackOpacity`, `mapSaturation`, `heatmapIntensity`

### Data Fetching
TanStack React Query handles all API calls with automatic caching:
```javascript
const { data } = useQuery({
  queryKey: ['rides', bikeTypeFilter],
  queryFn: () => getRides(bikeTypeFilter)
});
```

### Duplicate Detection (Import)
On GPX import, duplicates are detected by:
1. Same date + distance within 0.5km
2. Same start/end points within ~50m + similar distance

## Common Tasks

### Adding a new map layer
1. Add state in `App.jsx`
2. Pass to `Sidebar.jsx` for toggle UI
3. Pass to `Map.jsx` for rendering
4. Consider z-index via custom panes if layering matters

### Adding a new API endpoint
1. Add route in `server/src/routes/`
2. Add client function in `client/src/api.js`
3. Use with `useQuery` or `useMutation` in components

### Modifying database schema
1. Add migration in `server/src/db.js` (use try/catch for ALTER TABLE)
2. Restart server to apply

## Bike Types & Ratings

**Bike Types**: `road`, `gravel`, `mtb`

**Section Ratings**: `excellent`, `good`, `challenging`, `hard`, `unridable`

**Rating Colors** (defined in `Map.jsx`):
```javascript
const RATING_COLORS = {
  excellent: '#22c55e',  // green
  good: '#84cc16',       // lime
  challenging: '#eab308', // yellow
  hard: '#f97316',       // orange
  unridable: '#ef4444'   // red
};
```

## Activity Type Detection

The import system automatically detects activity types from GPX metadata:

**Detection sources (in order of priority):**
1. `<trk><type>` element
2. Garmin extensions (`gpxx:ActivityType`)
3. GPX metadata keywords
4. Filename patterns

**Detected cycling types:**
- `road_biking`, `road cycling` → `road`
- `mountain_biking`, `mtb` → `mtb`
- `gravel_cycling`, `cyclocross` → `gravel`
- Generic `cycling`, `biking`, `ride` → cycling (no specific bike type)

**Import options:**
- `skip_non_cycling`: Skip running, walking, hiking, etc.
- `use_detected_bike_type`: Auto-assign road/gravel/mtb from metadata

**Files:** `server/src/gpxParser.js` (detection logic), `ImportModal.jsx` (UI)

## Gotchas

- GPX files without timestamps will have `null` dates
- Section `track_segment` is stored as JSON array of `[lat, lng]` pairs
- Heatmap uses simplified track points (~10m tolerance) for performance
- The heatmap canvas must have `pointer-events: none` or it blocks clicks
- When adding new query invalidations, remember to include `allTracks` for "show all tracks" feature
- Activity type detection depends on GPX metadata; files without type info show as "unknown"
