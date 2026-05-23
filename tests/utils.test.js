import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { haversineKm, extractJSON, normalizeSong, generateCodeVerifier } = require('../lib/utils.cjs');

// ── haversineKm ───────────────────────────────────────────
describe('haversineKm', () => {
  test('returns 0 for identical coordinates', () => {
    assert.strictEqual(haversineKm(0, 0, 0, 0), 0);
    assert.strictEqual(haversineKm(48.8566, 2.3522, 48.8566, 2.3522), 0);
  });

  test('returns ~111 km for 1 degree of latitude', () => {
    const dist = haversineKm(0, 0, 1, 0);
    assert.ok(dist > 110 && dist < 112, `Expected ~111 km, got ${dist}`);
  });

  test('returns ~111 km for 1 degree of longitude at equator', () => {
    const dist = haversineKm(0, 0, 0, 1);
    assert.ok(dist > 110 && dist < 112, `Expected ~111 km at equator, got ${dist}`);
  });

  test('NYC to London is roughly 5500–5600 km', () => {
    // New York City ~(40.71, -74.01), London ~(51.51, -0.13)
    const dist = haversineKm(40.71, -74.01, 51.51, -0.13);
    assert.ok(dist > 5500 && dist < 5600, `Expected ~5570 km, got ${dist}`);
  });

  test('is symmetric', () => {
    const d1 = haversineKm(10, 20, 30, 40);
    const d2 = haversineKm(30, 40, 10, 20);
    assert.ok(Math.abs(d1 - d2) < 0.0001, `Expected symmetric result, got ${d1} vs ${d2}`);
  });
});

// ── extractJSON ───────────────────────────────────────────
describe('extractJSON', () => {
  test('parses a bare valid JSON array', () => {
    const input = '[{"title":"Song A","artist":"Artist A"}]';
    const result = extractJSON(input);
    assert.deepEqual(result, [{ title: 'Song A', artist: 'Artist A' }]);
  });

  test('parses a JSON array wrapped in markdown code fences', () => {
    const input = '```json\n[{"title":"Song B"}]\n```';
    const result = extractJSON(input);
    assert.deepEqual(result, [{ title: 'Song B' }]);
  });

  test('parses a JSON array with surrounding prose', () => {
    const input = 'Here are some songs:\n[{"title":"Song C","artist":"Artist C"}]\nEnjoy!';
    const result = extractJSON(input);
    assert.deepEqual(result, [{ title: 'Song C', artist: 'Artist C' }]);
  });

  test('parses a single JSON object wrapped in prose (tier 2)', () => {
    const input = 'The location is {"location":"Paris, France","explanation":"The song is set in Paris."}';
    const result = extractJSON(input);
    assert.deepEqual(result, { location: 'Paris, France', explanation: 'The song is set in Paris.' });
  });

  test('falls back to brace-match when array brackets are missing (tier 3)', () => {
    const input = 'Song 1: {"title":"Alpha","artist":"Beta"} and Song 2: {"title":"Gamma","artist":"Delta"}';
    const result = extractJSON(input);
    assert.ok(Array.isArray(result), 'Should return an array from brace-match');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].title, 'Alpha');
    assert.strictEqual(result[1].title, 'Gamma');
  });

  test('returns null for completely invalid input', () => {
    assert.strictEqual(extractJSON('no json here at all'), null);
    assert.strictEqual(extractJSON(''), null);
    assert.strictEqual(extractJSON('just some text'), null);
  });

  test('strips markdown fences before parsing', () => {
    const input = '```\n[{"title":"Fenced"}]\n```';
    const result = extractJSON(input);
    assert.deepEqual(result, [{ title: 'Fenced' }]);
  });

  test('handles LLM-style newlines inside values', () => {
    // Real LLMs sometimes put literal newlines inside string values
    const input = '[{"title":"Song\nWith\nNewlines","artist":"A"}]';
    const result = extractJSON(input);
    assert.ok(Array.isArray(result));
    assert.strictEqual(result[0].artist, 'A');
  });
});

// ── normalizeSong ─────────────────────────────────────────
describe('normalizeSong', () => {
  test('passes through canonical field names unchanged', () => {
    const raw = { title: 'T', artist: 'A', year: 1990, location: 'NYC', connection: 'reason' };
    assert.deepEqual(normalizeSong(raw), raw);
  });

  test('maps song_title -> title', () => {
    assert.strictEqual(normalizeSong({ song_title: 'My Song' }).title, 'My Song');
  });

  test('maps song -> title', () => {
    assert.strictEqual(normalizeSong({ song: 'My Song' }).title, 'My Song');
  });

  test('maps name -> title', () => {
    assert.strictEqual(normalizeSong({ name: 'My Song' }).title, 'My Song');
  });

  test('maps artist_name -> artist', () => {
    assert.strictEqual(normalizeSong({ title: 'T', artist_name: 'Bob' }).artist, 'Bob');
  });

  test('maps by -> artist', () => {
    assert.strictEqual(normalizeSong({ title: 'T', by: 'Carol' }).artist, 'Carol');
  });

  test('maps performer -> artist', () => {
    assert.strictEqual(normalizeSong({ title: 'T', performer: 'Dave' }).artist, 'Dave');
  });

  test('maps release_year -> year', () => {
    assert.strictEqual(normalizeSong({ title: 'T', release_year: 2001 }).year, 2001);
  });

  test('maps released -> year', () => {
    assert.strictEqual(normalizeSong({ title: 'T', released: 1999 }).year, 1999);
  });

  test('maps place -> location', () => {
    assert.strictEqual(normalizeSong({ title: 'T', place: 'London' }).location, 'London');
  });

  test('maps city -> location', () => {
    assert.strictEqual(normalizeSong({ title: 'T', city: 'Tokyo' }).location, 'Tokyo');
  });

  test('maps region -> location', () => {
    assert.strictEqual(normalizeSong({ title: 'T', region: 'Midwest' }).location, 'Midwest');
  });

  test('maps explanation -> connection', () => {
    assert.strictEqual(normalizeSong({ title: 'T', explanation: 'because' }).connection, 'because');
  });

  test('maps reason -> connection', () => {
    assert.strictEqual(normalizeSong({ title: 'T', reason: 'because' }).connection, 'because');
  });

  test('maps description -> connection', () => {
    assert.strictEqual(normalizeSong({ title: 'T', description: 'info' }).connection, 'info');
  });

  test('falls back to em-dash for missing title', () => {
    assert.strictEqual(normalizeSong({}).title, '—');
  });

  test('falls back to empty string for missing artist', () => {
    assert.strictEqual(normalizeSong({}).artist, '');
  });

  test('falls back to null for missing year, location, connection', () => {
    const result = normalizeSong({});
    assert.strictEqual(result.year, null);
    assert.strictEqual(result.location, null);
    assert.strictEqual(result.connection, null);
  });

  test('extra fields are not included in the output', () => {
    const result = normalizeSong({ title: 'T', extra_field: 'ignored' });
    assert.ok(!('extra_field' in result));
  });

  test('canonical field wins over variant when both present', () => {
    // title should win over song_title
    assert.strictEqual(normalizeSong({ title: 'Primary', song_title: 'Fallback' }).title, 'Primary');
    // artist wins over by
    assert.strictEqual(normalizeSong({ artist: 'Primary', by: 'Fallback' }).artist, 'Primary');
  });
});

// ── generateCodeVerifier ──────────────────────────────────
describe('generateCodeVerifier', () => {
  // Uint32Array(28): each element is 1–8 hex chars, so total length is 28–224.
  test('returns a string between 28 and 224 characters', () => {
    const v = generateCodeVerifier();
    assert.strictEqual(typeof v, 'string');
    assert.ok(v.length >= 28 && v.length <= 224, `Expected length 28–224, got ${v.length}`);
  });

  test('contains only lowercase hex characters [0-9a-f]', () => {
    const v = generateCodeVerifier();
    assert.match(v, /^[0-9a-f]+$/, `Got non-hex chars in: ${v}`);
  });

  test('returns a different value on each call (random)', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    // Astronomically unlikely to collide — treat equality as a test failure
    assert.notStrictEqual(a, b);
  });
});
