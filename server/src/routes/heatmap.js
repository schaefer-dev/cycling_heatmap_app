const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/heatmap - Get track points for heatmap
// Uses full track_points for high resolution, with optional sampling for performance
router.get('/', (req, res) => {
  try {
    const { bike_type } = req.query;

    // Use full track_points for better resolution
    // Sample every Nth point to balance resolution vs performance
    const sampleRate = 3; // Take every 3rd point (adjust if needed)

    let query = `
      SELECT tp.lat, tp.lng
      FROM track_points tp
      WHERE tp.point_index % ? = 0
    `;
    const params = [sampleRate];

    if (bike_type && ['road', 'gravel', 'mtb'].includes(bike_type)) {
      query = `
        SELECT tp.lat, tp.lng
        FROM track_points tp
        INNER JOIN rides r ON tp.ride_id = r.id
        WHERE tp.point_index % ? = 0 AND r.bike_type = ?
      `;
      params.push(bike_type);
    }

    const points = db.prepare(query).all(...params);

    // Return as array of [lat, lng] pairs for efficiency
    res.json(points.map(p => [p.lat, p.lng]));

  } catch (error) {
    console.error('Error fetching heatmap data:', error);
    res.status(500).json({ error: 'Failed to fetch heatmap data' });
  }
});

// GET /api/heatmap/bounds - Get bounding box of all rides
router.get('/bounds', (req, res) => {
  try {
    const { bike_type } = req.query;

    let query = `
      SELECT
        MIN(lat) as min_lat,
        MAX(lat) as max_lat,
        MIN(lng) as min_lng,
        MAX(lng) as max_lng
      FROM track_points_simplified tps
    `;
    const params = [];

    if (bike_type && ['road', 'gravel', 'mtb'].includes(bike_type)) {
      query += `
        INNER JOIN rides r ON tps.ride_id = r.id
        WHERE r.bike_type = ?
      `;
      params.push(bike_type);
    }

    const bounds = db.prepare(query).get(...params);

    if (!bounds.min_lat) {
      return res.json(null);
    }

    res.json({
      southwest: [bounds.min_lat, bounds.min_lng],
      northeast: [bounds.max_lat, bounds.max_lng],
      center: [
        (bounds.min_lat + bounds.max_lat) / 2,
        (bounds.min_lng + bounds.max_lng) / 2
      ]
    });

  } catch (error) {
    console.error('Error fetching bounds:', error);
    res.status(500).json({ error: 'Failed to fetch bounds' });
  }
});

// GET /api/heatmap/tracks - Get all simplified tracks grouped by ride
router.get('/tracks', (req, res) => {
  try {
    const { bike_type } = req.query;

    let ridesQuery = `SELECT id, title, bike_type, date, distance_km FROM rides`;
    const params = [];

    if (bike_type && ['road', 'gravel', 'mtb'].includes(bike_type)) {
      ridesQuery += ' WHERE bike_type = ?';
      params.push(bike_type);
    }

    ridesQuery += ' ORDER BY date DESC';

    const rides = db.prepare(ridesQuery).all(...params);

    // Get simplified points for each ride
    const getPoints = db.prepare(`
      SELECT lat, lng FROM track_points_simplified
      WHERE ride_id = ?
      ORDER BY id
    `);

    const tracks = rides.map(ride => ({
      id: ride.id,
      title: ride.title,
      bike_type: ride.bike_type,
      date: ride.date,
      distance_km: ride.distance_km,
      track: getPoints.all(ride.id).map(p => [p.lat, p.lng])
    }));

    res.json(tracks);

  } catch (error) {
    console.error('Error fetching tracks:', error);
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

// GET /api/heatmap/stats - Get statistics
router.get('/stats', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_rides,
        SUM(distance_km) as total_distance,
        SUM(elevation_gain_m) as total_elevation,
        COUNT(CASE WHEN bike_type = 'road' THEN 1 END) as road_rides,
        COUNT(CASE WHEN bike_type = 'gravel' THEN 1 END) as gravel_rides,
        COUNT(CASE WHEN bike_type = 'mtb' THEN 1 END) as mtb_rides
      FROM rides
    `).get();

    const sectionStats = db.prepare(`
      SELECT
        COUNT(*) as total_sections,
        COUNT(CASE WHEN rating = 'excellent' THEN 1 END) as excellent,
        COUNT(CASE WHEN rating = 'good' THEN 1 END) as good,
        COUNT(CASE WHEN rating = 'challenging' THEN 1 END) as challenging,
        COUNT(CASE WHEN rating = 'hard' THEN 1 END) as hard,
        COUNT(CASE WHEN rating = 'unridable' THEN 1 END) as unridable
      FROM sections
    `).get();

    res.json({
      rides: {
        total: stats.total_rides,
        total_distance_km: Math.round(stats.total_distance || 0),
        total_elevation_m: Math.round(stats.total_elevation || 0),
        by_type: {
          road: stats.road_rides,
          gravel: stats.gravel_rides,
          mtb: stats.mtb_rides
        }
      },
      sections: {
        total: sectionStats.total_sections,
        by_rating: {
          excellent: sectionStats.excellent,
          good: sectionStats.good,
          challenging: sectionStats.challenging,
          hard: sectionStats.hard,
          unridable: sectionStats.unridable
        }
      }
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
