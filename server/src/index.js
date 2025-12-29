const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialize database (creates tables if needed)
require('./db');

const ridesRouter = require('./routes/rides');
const sectionsRouter = require('./routes/sections');
const heatmapRouter = require('./routes/heatmap');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/rides', ridesRouter);
app.use('/api/sections', sectionsRouter);
app.use('/api/heatmap', heatmapRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err.message === 'Only .gpx files are allowed') {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
  }

  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('API endpoints:');
  console.log('  GET    /api/rides          - List all rides');
  console.log('  GET    /api/rides/:id      - Get single ride with track');
  console.log('  POST   /api/rides          - Import GPX file(s)');
  console.log('  PUT    /api/rides/:id      - Update ride metadata');
  console.log('  DELETE /api/rides/:id      - Delete a ride');
  console.log('  GET    /api/sections       - List all sections');
  console.log('  POST   /api/sections       - Create section rating');
  console.log('  PUT    /api/sections/:id   - Update section');
  console.log('  DELETE /api/sections/:id   - Delete section');
  console.log('  GET    /api/heatmap        - Get heatmap data');
  console.log('  GET    /api/heatmap/bounds - Get map bounds');
  console.log('  GET    /api/heatmap/stats  - Get statistics');
});
