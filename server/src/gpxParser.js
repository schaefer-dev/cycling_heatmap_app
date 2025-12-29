const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_'
});

/**
 * Parse a GPX file and extract track data
 * @param {string} gpxContent - Raw GPX XML content
 * @returns {Object} Parsed ride data
 */
function parseGPX(gpxContent) {
  const parsed = parser.parse(gpxContent);
  const gpx = parsed.gpx;

  if (!gpx || !gpx.trk) {
    throw new Error('Invalid GPX file: no track found');
  }

  const track = gpx.trk;
  const name = track.name || 'Unnamed Ride';

  // Get all track segments
  let segments = track.trkseg;
  if (!Array.isArray(segments)) {
    segments = [segments];
  }

  // Flatten all trackpoints
  const points = [];
  let totalElevationGain = 0;
  let previousElevation = null;

  for (const segment of segments) {
    if (!segment || !segment.trkpt) continue;

    let trackpoints = segment.trkpt;
    if (!Array.isArray(trackpoints)) {
      trackpoints = [trackpoints];
    }

    for (const trkpt of trackpoints) {
      const lat = parseFloat(trkpt['@_lat']);
      const lng = parseFloat(trkpt['@_lon']);
      const elevation = trkpt.ele ? parseFloat(trkpt.ele) : null;
      const timestamp = trkpt.time || null;

      if (isNaN(lat) || isNaN(lng)) continue;

      points.push({
        lat,
        lng,
        elevation,
        timestamp
      });

      // Calculate elevation gain
      if (elevation !== null && previousElevation !== null) {
        const diff = elevation - previousElevation;
        if (diff > 0) {
          totalElevationGain += diff;
        }
      }
      previousElevation = elevation;
    }
  }

  if (points.length === 0) {
    throw new Error('Invalid GPX file: no valid trackpoints found');
  }

  // Extract date from first trackpoint timestamp or metadata
  let date = null;
  if (points[0].timestamp) {
    date = points[0].timestamp.split('T')[0];
  } else if (gpx.metadata?.time) {
    date = gpx.metadata.time.split('T')[0];
  }

  // Calculate total distance using Haversine formula
  const totalDistance = calculateTotalDistance(points);

  return {
    name,
    date,
    points,
    totalDistance,
    totalElevationGain: Math.round(totalElevationGain)
  };
}

/**
 * Calculate distance between two points using Haversine formula
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Calculate total distance of a track
 */
function calculateTotalDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }
  return Math.round(total * 100) / 100; // Round to 2 decimal places
}

/**
 * Simplify track using Douglas-Peucker algorithm
 * @param {Array} points - Array of {lat, lng} points
 * @param {number} tolerance - Tolerance in degrees (roughly 0.0001 = 10m)
 * @returns {Array} Simplified points
 */
function simplifyTrack(points, tolerance = 0.0001) {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from the line between first and last
  let maxDistance = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDistance > tolerance) {
    const left = simplifyTrack(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyTrack(points.slice(maxIndex), tolerance);

    // Remove duplicate point at the join
    return left.slice(0, -1).concat(right);
  }

  // Otherwise, return just the endpoints
  return [first, last];
}

/**
 * Calculate perpendicular distance from a point to a line
 */
function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;

  if (dx === 0 && dy === 0) {
    // Line is a point
    return Math.sqrt(
      Math.pow(point.lat - lineStart.lat, 2) +
      Math.pow(point.lng - lineStart.lng, 2)
    );
  }

  const t = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (dx * dx + dy * dy);

  let nearestLng, nearestLat;
  if (t < 0) {
    nearestLng = lineStart.lng;
    nearestLat = lineStart.lat;
  } else if (t > 1) {
    nearestLng = lineEnd.lng;
    nearestLat = lineEnd.lat;
  } else {
    nearestLng = lineStart.lng + t * dx;
    nearestLat = lineStart.lat + t * dy;
  }

  return Math.sqrt(
    Math.pow(point.lat - nearestLat, 2) +
    Math.pow(point.lng - nearestLng, 2)
  );
}

module.exports = {
  parseGPX,
  simplifyTrack,
  haversineDistance,
  calculateTotalDistance
};
