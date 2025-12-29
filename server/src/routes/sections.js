const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

const VALID_RATINGS = ['excellent', 'good', 'challenging', 'hard', 'unridable'];
const VALID_BIKE_TYPES = ['road', 'gravel', 'mtb'];
const VALID_SURFACE_TAGS = [
  'loose_gravel', 'sand', 'mud', 'rocks', 'roots',
  'steep', 'technical', 'traffic', 'poor_surface'
];

// GET /api/sections - List all sections
router.get('/', (req, res) => {
  try {
    const { bike_type, rating, ride_id } = req.query;

    let query = `
      SELECT s.*, r.title as ride_title, r.date as ride_date
      FROM sections s
      LEFT JOIN rides r ON s.ride_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (bike_type && VALID_BIKE_TYPES.includes(bike_type)) {
      query += ' AND s.bike_type = ?';
      params.push(bike_type);
    }

    if (rating && VALID_RATINGS.includes(rating)) {
      query += ' AND s.rating = ?';
      params.push(rating);
    }

    if (ride_id) {
      query += ' AND s.ride_id = ?';
      params.push(ride_id);
    }

    query += ' ORDER BY s.created_at DESC';

    const sections = db.prepare(query).all(...params);

    res.json(sections.map(s => ({
      ...s,
      surface_tags: s.surface_tags ? JSON.parse(s.surface_tags) : []
    })));

  } catch (error) {
    console.error('Error fetching sections:', error);
    res.status(500).json({ error: 'Failed to fetch sections' });
  }
});

// GET /api/sections/:id - Get single section
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const section = db.prepare(`
      SELECT s.*, r.title as ride_title, r.date as ride_date
      FROM sections s
      LEFT JOIN rides r ON s.ride_id = r.id
      WHERE s.id = ?
    `).get(id);

    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({
      ...section,
      surface_tags: section.surface_tags ? JSON.parse(section.surface_tags) : []
    });

  } catch (error) {
    console.error('Error fetching section:', error);
    res.status(500).json({ error: 'Failed to fetch section' });
  }
});

// POST /api/sections - Create a new section
router.post('/', (req, res) => {
  try {
    const {
      ride_id,
      start_lat,
      start_lng,
      start_index,
      end_lat,
      end_lng,
      end_index,
      rating,
      bike_type,
      surface_tags = [],
      notes
    } = req.body;

    // Validation
    if (!ride_id) {
      return res.status(400).json({ error: 'ride_id is required' });
    }

    const ride = db.prepare('SELECT id FROM rides WHERE id = ?').get(ride_id);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    if (start_lat === undefined || start_lng === undefined ||
        end_lat === undefined || end_lng === undefined) {
      return res.status(400).json({ error: 'Start and end coordinates are required' });
    }

    if (!rating || !VALID_RATINGS.includes(rating)) {
      return res.status(400).json({ error: `Invalid rating. Must be one of: ${VALID_RATINGS.join(', ')}` });
    }

    if (!bike_type || !VALID_BIKE_TYPES.includes(bike_type)) {
      return res.status(400).json({ error: `Invalid bike_type. Must be one of: ${VALID_BIKE_TYPES.join(', ')}` });
    }

    // Validate surface tags
    if (!Array.isArray(surface_tags)) {
      return res.status(400).json({ error: 'surface_tags must be an array' });
    }

    for (const tag of surface_tags) {
      if (!VALID_SURFACE_TAGS.includes(tag)) {
        return res.status(400).json({ error: `Invalid surface tag: ${tag}. Valid tags: ${VALID_SURFACE_TAGS.join(', ')}` });
      }
    }

    const sectionId = uuidv4();

    db.prepare(`
      INSERT INTO sections (
        id, ride_id, start_lat, start_lng, start_index,
        end_lat, end_lng, end_index, rating, bike_type, surface_tags, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sectionId,
      ride_id,
      start_lat,
      start_lng,
      start_index || null,
      end_lat,
      end_lng,
      end_index || null,
      rating,
      bike_type,
      JSON.stringify(surface_tags),
      notes || null
    );

    const created = db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);

    res.status(201).json({
      ...created,
      surface_tags: JSON.parse(created.surface_tags)
    });

  } catch (error) {
    console.error('Error creating section:', error);
    res.status(500).json({ error: 'Failed to create section' });
  }
});

// PUT /api/sections/:id - Update a section
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { rating, bike_type, surface_tags, notes } = req.body;

    const section = db.prepare('SELECT id FROM sections WHERE id = ?').get(id);
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    const updates = [];
    const params = [];

    if (rating !== undefined) {
      if (!VALID_RATINGS.includes(rating)) {
        return res.status(400).json({ error: 'Invalid rating' });
      }
      updates.push('rating = ?');
      params.push(rating);
    }

    if (bike_type !== undefined) {
      if (!VALID_BIKE_TYPES.includes(bike_type)) {
        return res.status(400).json({ error: 'Invalid bike_type' });
      }
      updates.push('bike_type = ?');
      params.push(bike_type);
    }

    if (surface_tags !== undefined) {
      if (!Array.isArray(surface_tags)) {
        return res.status(400).json({ error: 'surface_tags must be an array' });
      }
      for (const tag of surface_tags) {
        if (!VALID_SURFACE_TAGS.includes(tag)) {
          return res.status(400).json({ error: `Invalid surface tag: ${tag}` });
        }
      }
      updates.push('surface_tags = ?');
      params.push(JSON.stringify(surface_tags));
    }

    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    db.prepare(`UPDATE sections SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM sections WHERE id = ?').get(id);

    res.json({
      ...updated,
      surface_tags: updated.surface_tags ? JSON.parse(updated.surface_tags) : []
    });

  } catch (error) {
    console.error('Error updating section:', error);
    res.status(500).json({ error: 'Failed to update section' });
  }
});

// DELETE /api/sections/:id - Delete a section
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const section = db.prepare('SELECT id FROM sections WHERE id = ?').get(id);
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    db.prepare('DELETE FROM sections WHERE id = ?').run(id);

    res.json({ success: true, message: 'Section deleted' });

  } catch (error) {
    console.error('Error deleting section:', error);
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

module.exports = router;
