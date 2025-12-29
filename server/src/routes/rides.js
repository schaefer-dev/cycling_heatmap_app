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

// POST /api/rides - Import new ride from GPX
router.post('/', upload.array('gpx', 50), async (req, res) => {
  try {
    const files = req.files;
    const { bike_type = 'gravel' } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No GPX files provided' });
    }

    if (!['road', 'gravel', 'mtb'].includes(bike_type)) {
      return res.status(400).json({ error: 'Invalid bike_type. Must be road, gravel, or mtb' });
    }

    const importedRides = [];
    const errors = [];

    for (const file of files) {
      try {
        const gpxContent = file.buffer.toString('utf-8');
        const parsed = parseGPX(gpxContent);

        const rideId = uuidv4();

        // Insert ride
        db.prepare(`
          INSERT INTO rides (id, title, date, bike_type, distance_km, elevation_gain_m)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          rideId,
          parsed.name,
          parsed.date,
          bike_type,
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
          bike_type,
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
      summary: {
        total: files.length,
        success: importedRides.length,
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
