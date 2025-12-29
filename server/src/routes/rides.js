const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { parseGPX, simplifyTrack } = require('../gpxParser');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.gpx')) {
      cb(null, true);
    } else {
      cb(new Error('Only .gpx files are allowed'));
    }
  }
});

// GET /api/rides - List all rides
router.get('/', (req, res) => {
  try {
    const { bike_type } = req.query;

    let query = `
      SELECT id, title, date, bike_type, distance_km, elevation_gain_m, notes, created_at,
             (SELECT COUNT(*) FROM track_points WHERE ride_id = rides.id) as point_count
      FROM rides
    `;
    const params = [];

    if (bike_type && ['road', 'gravel', 'mtb'].includes(bike_type)) {
      query += ' WHERE bike_type = ?';
      params.push(bike_type);
    }

    query += ' ORDER BY date DESC, created_at DESC';

    const rides = db.prepare(query).all(...params);
    res.json(rides);
  } catch (error) {
    console.error('Error fetching rides:', error);
    res.status(500).json({ error: 'Failed to fetch rides' });
  }
});

// GET /api/rides/near-point - Find all rides that pass near a given point
// IMPORTANT: This must be defined BEFORE /:id route to avoid "near-point" being matched as an ID
router.get('/near-point', (req, res) => {
  try {
    const { lat, lng, threshold = 0.0003, bike_type } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const thresholdNum = parseFloat(threshold); // ~30m default

    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({ error: 'Invalid lat/lng values' });
    }

    // Find all rides that have at least one track point near the clicked location
    let query = `
      SELECT DISTINCT r.id, r.title, r.date, r.bike_type, r.distance_km, r.elevation_gain_m
      FROM rides r
      INNER JOIN track_points tp ON tp.ride_id = r.id
      WHERE tp.lat BETWEEN ? AND ?
        AND tp.lng BETWEEN ? AND ?
    `;
    const params = [
      latNum - thresholdNum,
      latNum + thresholdNum,
      lngNum - thresholdNum,
      lngNum + thresholdNum
    ];

    if (bike_type && ['road', 'gravel', 'mtb'].includes(bike_type)) {
      query += ' AND r.bike_type = ?';
      params.push(bike_type);
    }

    query += ' ORDER BY r.date DESC';

    const rides = db.prepare(query).all(...params);

    res.json(rides);

  } catch (error) {
    console.error('Error finding rides near point:', error);
    res.status(500).json({ error: 'Failed to find rides near point' });
  }
});

// GET /api/rides/:id - Get single ride with track data
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const ride = db.prepare(`
      SELECT id, title, date, bike_type, distance_km, elevation_gain_m, notes, created_at
      FROM rides WHERE id = ?
    `).get(id);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Get full track points
    const trackPoints = db.prepare(`
      SELECT lat, lng, elevation, timestamp, point_index
      FROM track_points
      WHERE ride_id = ?
      ORDER BY point_index
    `).all(id);

    // Get sections for this ride
    const sections = db.prepare(`
      SELECT id, start_lat, start_lng, start_index, end_lat, end_lng, end_index,
             rating, bike_type, surface_tags, notes, created_at
      FROM sections
      WHERE ride_id = ?
    `).all(id);

    res.json({
      ...ride,
      trackPoints,
      sections: sections.map(s => ({
        ...s,
        surface_tags: s.surface_tags ? JSON.parse(s.surface_tags) : []
      }))
    });
  } catch (error) {
    console.error('Error fetching ride:', error);
    res.status(500).json({ error: 'Failed to fetch ride' });
  }
});

// Check if a ride already exists (duplicate detection)
function checkDuplicate(parsed) {
  // Check by date and distance (within 0.5km tolerance)
  if (parsed.date) {
    const existing = db.prepare(`
      SELECT id, title, distance_km FROM rides
      WHERE date = ? AND ABS(distance_km - ?) < 0.5
    `).get(parsed.date, parsed.totalDistance);

    if (existing) {
      return existing;
    }
  }

  // Also check by first and last track points (within ~50m)
  if (parsed.points.length > 0) {
    const first = parsed.points[0];
    const last = parsed.points[parsed.points.length - 1];
    const threshold = 0.0005; // ~50m

    const matchingRides = db.prepare(`
      SELECT DISTINCT r.id, r.title, r.date, r.distance_km
      FROM rides r
      JOIN track_points tp_first ON tp_first.ride_id = r.id AND tp_first.point_index = 0
      JOIN track_points tp_last ON tp_last.ride_id = r.id AND tp_last.point_index = (
        SELECT MAX(point_index) FROM track_points WHERE ride_id = r.id
      )
      WHERE ABS(tp_first.lat - ?) < ? AND ABS(tp_first.lng - ?) < ?
        AND ABS(tp_last.lat - ?) < ? AND ABS(tp_last.lng - ?) < ?
        AND ABS(r.distance_km - ?) < 0.5
    `).get(
      first.lat, threshold, first.lng, threshold,
      last.lat, threshold, last.lng, threshold,
      parsed.totalDistance
    );

    if (matchingRides) {
      return matchingRides;
    }
  }

  return null;
}

// POST /api/rides/preview - Preview GPX files before importing (analyze activity types)
router.post('/preview', upload.array('gpx', 100), async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No GPX files provided' });
    }

    const previews = [];
    const errors = [];

    for (const file of files) {
      try {
        const gpxContent = file.buffer.toString('utf-8');
        const parsed = parseGPX(gpxContent, file.originalname);

        // Check for duplicates
        const duplicate = checkDuplicate(parsed);

        previews.push({
          filename: file.originalname,
          title: parsed.name,
          date: parsed.date,
          distance_km: parsed.totalDistance,
          elevation_gain_m: parsed.totalElevationGain,
          activityType: parsed.activityType,
          isCycling: parsed.isCycling,
          detectedBikeType: parsed.detectedBikeType,
          isDuplicate: !!duplicate,
          duplicateOf: duplicate ? duplicate.title : null,
          pointCount: parsed.points.length
        });
      } catch (parseError) {
        errors.push({
          filename: file.originalname,
          error: parseError.message
        });
      }
    }

    // Sort by date (newest first)
    previews.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });

    // Summary stats
    const cyclingCount = previews.filter(p => p.isCycling).length;
    const nonCyclingCount = previews.filter(p => !p.isCycling && p.activityType !== 'unknown').length;
    const unknownCount = previews.filter(p => p.activityType === 'unknown').length;
    const duplicateCount = previews.filter(p => p.isDuplicate).length;

    res.json({
      previews,
      errors,
      summary: {
        total: files.length,
        cycling: cyclingCount,
        nonCycling: nonCyclingCount,
        unknown: unknownCount,
        duplicates: duplicateCount,
        parseErrors: errors.length,
        byBikeType: {
          road: previews.filter(p => p.detectedBikeType === 'road').length,
          gravel: previews.filter(p => p.detectedBikeType === 'gravel').length,
          mtb: previews.filter(p => p.detectedBikeType === 'mtb').length,
          undetected: previews.filter(p => p.isCycling && !p.detectedBikeType).length
        }
      }
    });

  } catch (error) {
    console.error('Error previewing rides:', error);
    res.status(500).json({ error: 'Failed to preview rides' });
  }
});

// POST /api/rides - Import new ride from GPX
router.post('/', upload.array('gpx', 100), async (req, res) => {
  try {
    const files = req.files;
    const {
      bike_type = 'gravel',
      skip_non_cycling = 'false',
      use_detected_bike_type = 'false'
    } = req.body;

    const skipNonCycling = skip_non_cycling === 'true';
    const useDetectedBikeType = use_detected_bike_type === 'true';

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No GPX files provided' });
    }

    if (!['road', 'gravel', 'mtb'].includes(bike_type)) {
      return res.status(400).json({ error: 'Invalid bike_type. Must be road, gravel, or mtb' });
    }

    const importedRides = [];
    const errors = [];
    const skipped = [];

    for (const file of files) {
      try {
        const gpxContent = file.buffer.toString('utf-8');
        const parsed = parseGPX(gpxContent, file.originalname);

        // Skip non-cycling activities if requested
        if (skipNonCycling && !parsed.isCycling && parsed.activityType !== 'unknown') {
          skipped.push({
            file: file.originalname,
            reason: `Non-cycling activity (${parsed.activityType})`
          });
          continue;
        }

        // Check for duplicates
        const duplicate = checkDuplicate(parsed);
        if (duplicate) {
          skipped.push({
            file: file.originalname,
            reason: `Already imported as "${duplicate.title}" (${duplicate.distance_km?.toFixed(1)} km)`
          });
          continue;
        }

        // Determine bike type to use
        let finalBikeType = bike_type;
        if (useDetectedBikeType && parsed.detectedBikeType) {
          finalBikeType = parsed.detectedBikeType;
        }

        const rideId = uuidv4();

        // Insert ride
        db.prepare(`
          INSERT INTO rides (id, title, date, bike_type, distance_km, elevation_gain_m)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          rideId,
          parsed.name,
          parsed.date,
          finalBikeType,
          parsed.totalDistance,
          parsed.totalElevationGain
        );

        // Insert full track points
        const insertPoint = db.prepare(`
          INSERT INTO track_points (ride_id, lat, lng, elevation, timestamp, point_index)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((points) => {
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            insertPoint.run(rideId, p.lat, p.lng, p.elevation, p.timestamp, i);
          }
        });

        insertMany(parsed.points);

        // Simplify track and insert simplified points
        const simplified = simplifyTrack(parsed.points, 0.0001); // ~10m tolerance

        const insertSimplified = db.prepare(`
          INSERT INTO track_points_simplified (ride_id, lat, lng)
          VALUES (?, ?, ?)
        `);

        const insertSimplifiedMany = db.transaction((points) => {
          for (const p of points) {
            insertSimplified.run(rideId, p.lat, p.lng);
          }
        });

        insertSimplifiedMany(simplified);

        importedRides.push({
          id: rideId,
          title: parsed.name,
          date: parsed.date,
          bike_type: finalBikeType,
          detected_bike_type: parsed.detectedBikeType,
          activity_type: parsed.activityType,
          distance_km: parsed.totalDistance,
          elevation_gain_m: parsed.totalElevationGain,
          point_count: parsed.points.length,
          simplified_count: simplified.length
        });

      } catch (parseError) {
        errors.push({
          file: file.originalname,
          error: parseError.message
        });
      }
    }

    res.json({
      imported: importedRides,
      errors,
      skipped,
      summary: {
        total: files.length,
        success: importedRides.length,
        skipped: skipped.length,
        failed: errors.length
      }
    });

  } catch (error) {
    console.error('Error importing rides:', error);
    res.status(500).json({ error: 'Failed to import rides' });
  }
});

// PUT /api/rides/:id - Update ride metadata
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, bike_type, notes } = req.body;

    const ride = db.prepare('SELECT id FROM rides WHERE id = ?').get(id);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    if (bike_type && !['road', 'gravel', 'mtb'].includes(bike_type)) {
      return res.status(400).json({ error: 'Invalid bike_type' });
    }

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (bike_type !== undefined) {
      updates.push('bike_type = ?');
      params.push(bike_type);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    db.prepare(`UPDATE rides SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM rides WHERE id = ?').get(id);
    res.json(updated);

  } catch (error) {
    console.error('Error updating ride:', error);
    res.status(500).json({ error: 'Failed to update ride' });
  }
});

// DELETE /api/rides/:id - Delete a ride
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const ride = db.prepare('SELECT id FROM rides WHERE id = ?').get(id);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Foreign keys with ON DELETE CASCADE will handle track_points and sections
    db.prepare('DELETE FROM rides WHERE id = ?').run(id);

    res.json({ success: true, message: 'Ride deleted' });

  } catch (error) {
    console.error('Error deleting ride:', error);
    res.status(500).json({ error: 'Failed to delete ride' });
  }
});

module.exports = router;
