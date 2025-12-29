# Cycling Ride Archive - Technical Concept

## Project Overview

A personal application for archiving and organizing past cycling rides with the ability to rate and annotate specific road/trail sections. The primary goal is to build a knowledge base of route segments that can inform future route planning decisions.

**Key Differentiator**: Unlike typical ride tracking apps, this application focuses on *segment-level ratings* to identify problematic sections (e.g., trails unsuitable for certain bike types).

## Goals

1. **Archive Past Rides**: Store and organize cycling rides imported from Garmin GPX files
2. **Categorize by Bike Type**: Differentiate rides by discipline (gravel, MTB, road)
3. **Rate Road Sections**: Mark specific segments of rides with rideability ratings
4. **Visualize Ride History**: Display a heatmap of all past rides with highlighted problem sections
5. **Inform Future Planning**: Provide visual data to avoid problematic sections when planning routes externally

## Scope

### In Scope
- GPX file import (single and bulk)
- Ride metadata management (date, bike type, notes)
- Interactive map with pan/zoom functionality
- Section marking/rating on the map
- Heatmap visualization of ride frequency
- Visual highlighting of rated sections

### Out of Scope (for initial version)
- Route planning functionality
- Integration with third-party services (Strava, Garmin Connect API)
- Social/sharing features
- Mobile app (web-first approach)

---

## Core Features

### 1. Ride Import

**GPX File Processing**
- Parse Garmin GPX files to extract:
  - GPS coordinates (latitude, longitude)
  - Elevation data
  - Timestamps
  - Track segments
- Support single file upload
- Support bulk import (folder/zip of GPX files)
- Detect and handle duplicate rides

**Ride Metadata**
- Date/time of ride (extracted from GPX or manual entry)
- Bike type: `road` | `gravel` | `mtb`
- Title/name (optional, can be auto-generated from date)
- Notes/description (optional freetext)
- Total distance (calculated from GPX)
- Total elevation gain (calculated from GPX)

### 2. Section Rating System

The core differentiating feature. Users can select a segment of a ride and apply ratings.

**Rating Categories**

| Rating | Description | Visual Color |
|--------|-------------|--------------|
| `excellent` | Perfect conditions for bike type | Green |
| `good` | Minor issues but rideable | Light Green |
| `challenging` | Difficult but manageable | Yellow |
| `hard` | Very difficult, consider avoiding | Orange |
| `unridable` | Not possible/safe for bike type | Red |

**Surface Type Tags** (optional, for additional context)
- `loose_gravel` - Loose or deep gravel
- `sand` - Sandy sections
- `mud` - Muddy conditions
- `rocks` - Rocky terrain
- `roots` - Tree roots
- `steep` - Excessively steep gradient
- `technical` - Technical trail features
- `traffic` - Heavy vehicle traffic
- `poor_surface` - Broken pavement, potholes

**Section Data Model**
- Start point (lat/lng or trackpoint index)
- End point (lat/lng or trackpoint index)
- Rating (enum from above)
- Surface tags (array)
- Bike type context (which bike was this rating made for)
- Freetext notes (optional)
- Date created
- Associated ride ID

### 3. Map Visualization

**Heatmap Layer**
- Aggregate all ride data into a heatmap
- Intensity based on ride frequency
- Filter by bike type (road/gravel/mtb) or show all
- Toggle heatmap on/off

**Rated Sections Layer**
- Display all rated sections with color-coded overlays
- Filter by:
  - Rating level (show only `hard` and `unridable`)
  - Bike type (show ratings relevant to selected bike)
  - Surface type tags
- Click on section to view details and notes

**Individual Ride View**
- Display single ride route
- Show any sections marked on that ride
- Option to add new section ratings

**Map Controls**
- Pan and zoom (standard map interactions)
- Layer toggles (heatmap, sections, satellite/terrain)
- Search/center on location
- Zoom to fit all rides

---

## Map Provider Recommendations

For a personal project, these are the recommended options:

### Recommended: Leaflet.js + OpenStreetMap

**Leaflet.js** (JavaScript library)
- Open-source, free to use
- Lightweight and performant
- Extensive plugin ecosystem
- Great documentation

**Tile Providers** (base map imagery):

| Provider | Best For | Cost | Notes |
|----------|----------|------|-------|
| **OpenStreetMap** | General use | Free | Standard, widely used |
| **OpenCycleMap** | Cycling | Free tier | Shows cycling routes, contours |
| **Thunderforest Outdoors** | Outdoor activities | Free tier (150k tiles/month) | Great terrain detail |
| **Mapbox** | Polished UX | Free tier (50k loads/month) | Beautiful styling, easy setup |
| **Stadia Maps** | General use | Free tier | Good OSM-based alternative |

**Recommendation**: Start with **OpenStreetMap** tiles (completely free, no API key needed for low usage) and **Leaflet.js**. Consider upgrading to **Thunderforest Outdoors** or **OpenCycleMap** for better cycling-specific detail.

### Alternative: Mapbox GL JS

- More modern rendering (vector tiles)
- Better performance for large datasets
- Built-in heatmap layer support
- Free tier: 50,000 map loads/month
- Requires API key

---

## Technical Architecture

### Approach: Local SQLite + Backend API

**Decision**: The application uses a local SQLite database for robust, file-based storage. A lightweight Node.js backend serves the API, and the frontend communicates via REST endpoints.

```
┌─────────────┐      HTTP/REST      ┌─────────────┐      ┌─────────────┐
│   Browser   │  ←───────────────→  │   Node.js   │  ←─→ │   SQLite    │
│  (React)    │                     │  (Express)  │      │  (.db file) │
└─────────────┘                     └─────────────┘      └─────────────┘
```

### Frontend Stack
- **Framework**: React (with Vite for fast dev experience)
- **Mapping**: Leaflet.js with React-Leaflet
- **State Management**: React state + React Query (for API caching)
- **Styling**: Tailwind CSS

### Backend Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: SQLite via `better-sqlite3` (synchronous, fast)
- **GPX Parsing**: `gpxparser` library

### API Endpoints (Preliminary)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/rides` | List all rides |
| GET | `/api/rides/:id` | Get single ride with track data |
| POST | `/api/rides` | Import new ride (GPX upload) |
| DELETE | `/api/rides/:id` | Delete a ride |
| GET | `/api/sections` | List all rated sections |
| POST | `/api/sections` | Create section rating |
| PUT | `/api/sections/:id` | Update section rating |
| DELETE | `/api/sections/:id` | Delete section rating |
| GET | `/api/heatmap` | Get simplified track data for heatmap |

### Database Schema (SQLite)

```sql
-- Ride metadata
CREATE TABLE rides (
  id TEXT PRIMARY KEY,
  title TEXT,
  date TEXT,
  bike_type TEXT CHECK(bike_type IN ('road', 'gravel', 'mtb')),
  distance_km REAL,
  elevation_gain_m REAL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- GPS track points (full resolution)
CREATE TABLE track_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elevation REAL,
  timestamp TEXT,
  point_index INTEGER
);

-- Simplified track for heatmap (reduced points)
CREATE TABLE track_points_simplified (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

-- Rated sections
CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
  start_lat REAL NOT NULL,
  start_lng REAL NOT NULL,
  end_lat REAL NOT NULL,
  end_lng REAL NOT NULL,
  rating TEXT CHECK(rating IN ('excellent', 'good', 'challenging', 'hard', 'unridable')),
  bike_type TEXT CHECK(bike_type IN ('road', 'gravel', 'mtb')),
  surface_tags TEXT, -- JSON array stored as text
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_track_points_ride ON track_points(ride_id);
CREATE INDEX idx_track_simplified_ride ON track_points_simplified(ride_id);
CREATE INDEX idx_sections_ride ON sections(ride_id);
CREATE INDEX idx_sections_rating ON sections(rating);
```

### Data Safety

- **Backup**: Simply copy the `.db` file (e.g., `cycling_archive.db`)
- **Location**: Stored in project directory or configurable path
- **Export**: Optional JSON export endpoint for portability

### Running the Application

```bash
# Start backend (serves API on port 3001)
npm run server

# Start frontend (Vite dev server on port 5173)
npm run dev

# Or run both together
npm run start
```

### Deployment
- Runs locally on your machine
- Both servers start with a single command
- Database file persists in project directory

---

## User Workflows

### Workflow 1: Import Rides
1. User clicks "Import" button
2. Selects GPX file(s) or folder
3. System parses and extracts ride data
4. User confirms/edits metadata (bike type, title)
5. Rides added to archive

### Workflow 2: Rate a Section
1. User opens a ride in the map view
2. Clicks "Add Section Rating"
3. Clicks start point on the route
4. Clicks end point on the route
5. Selects rating from dropdown
6. Optionally adds surface tags
7. Optionally adds freetext note
8. Saves section rating

### Workflow 3: View Heatmap with Problem Areas
1. User opens main map view
2. Heatmap displays ride frequency
3. User enables "Problem Sections" layer
4. User filters by bike type (e.g., "gravel")
5. Red/orange sections highlight areas to avoid
6. User clicks a section to see notes
7. User uses this info when planning routes in external tool

---

## Future Considerations

These items are out of scope but worth noting for potential future development:

- **Strava/Garmin API Integration**: Auto-import rides
- **Weather Data**: Store conditions at time of ride
- **Seasonal Ratings**: Same section might differ by season
- **Per-Ride Section Overrides**: Allow individual rides to override global section ratings
- **Export Functionality**: Export problem sections as GPX/KML for use in route planners
- **Mobile Companion**: Simple mobile app for quick section marking during/after rides
- **Community Features**: Share ratings with trusted friends

---

## Design Decisions

1. ~~**Storage Strategy**~~ → **SQLite + Node.js backend**

2. ~~**Multi-bike Ratings**~~ → **Yes, ratings are bike-type specific**
   - Same road section can have different ratings per bike type
   - A gravel path might be "excellent" for MTB but "hard" for road bike
   - Heatmap and sections are filterable by bike type
   - Option to view all rides/sections regardless of bike type

3. ~~**Section Persistence**~~ → **Yes, sections persist across rides**
   - Once a section is marked, it applies globally (not just to that ride)
   - All rides passing through that segment will show the rating
   - Future enhancement (out of scope): ability to override per-ride

4. ~~**Map Tile Budget**~~ → **Not a concern**
   - Single user, few times per week = negligible usage
   - OpenStreetMap free tiles are more than sufficient
   - No API key needed for this usage level

---

## Next Steps

1. ~~Finalize technology stack decisions~~ ✓
2. ~~Design data model and database schema~~ ✓
3. Set up project structure (React + Vite frontend, Express backend)
4. Implement database initialization and migrations
5. Build GPX parsing and ride import API
6. Create basic map view with ride display
7. Add section rating functionality
8. Implement heatmap visualization with bike-type filtering
