// Pure utility functions shared between app.js (browser globals) and the test suite.

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractJSON(text) {
  text = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  text = text.replace(/[\r\n\t]+/g, ' ');

  const aStart = text.indexOf('[');
  const aEnd   = text.lastIndexOf(']');
  if (aStart !== -1 && aEnd > aStart) {
    try { return JSON.parse(text.slice(aStart, aEnd + 1)); }
    catch (e) { /* fall through */ }
  }

  const oStart = text.indexOf('{');
  const oEnd   = text.lastIndexOf('}');
  if (oStart !== -1 && oEnd > oStart) {
    try { return JSON.parse(text.slice(oStart, oEnd + 1)); } catch {}
  }

  const objects = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth++ === 0) start = i; }
    else if (text[i] === '}') {
      if (--depth === 0 && start !== -1) {
        try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch {}
        start = -1;
      }
    }
  }
  if (objects.length > 0) return objects;

  return null;
}

function normalizeSong(s) {
  return {
    title:      s.title      || s.song_title || s.song   || s.name        || '—',
    artist:     s.artist     || s.artist_name || s.by    || s.performer   || '',
    year:       s.year       || s.release_year || s.released              || null,
    location:   s.location   || s.place || s.city || s.region             || null,
    connection: s.connection || s.explanation || s.reason || s.description || null,
  };
}

function generateCodeVerifier() {
  const arr = new Uint32Array(28);
  crypto.getRandomValues(arr);
  return Array.from(arr, n => n.toString(16).padStart(2, '0')).join('');
}

module.exports = { haversineKm, extractJSON, normalizeSong, generateCodeVerifier };
