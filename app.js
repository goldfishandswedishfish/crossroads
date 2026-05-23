// ── State ─────────────────────────────────────────────────
const state = {
  mode: 'place',
  pins: [],
  pinCounter: 0,
  assocPlace: 'title',
  assocSong: 'title',
  distance: 500,
  ollamaUrl: 'http://localhost:11434',
  model: 'llama3.2',
  spotifyClientId: '',
  youtubeApiKey: '',
  songMarkers: [],
  lastResults: [],
  seedCoords: null,
  radiusCircle: null,
  queryId: 0,
  _opSecrets: new Set(),
};

// Export cache — avoids embedding JSON in onclick attributes
const _exp = {};
let _expId = 0;
function exportBtns(songs, playlistName) {
  const id = ++_expId;
  _exp[id] = { songs, playlistName };
  return `<div class="export-btns">
    <button class="youtube-export-btn" onclick="_exportYouTube(${id})">▶ YouTube</button>
    <br><span class="export-hint">videos inspired by these songs</span>
  </div>`;
}
function _exportSpotify(id) { const e = _exp[id]; exportToSpotify(e.songs, e.playlistName); }
function _exportYouTube(id) { const e = _exp[id]; exportToYouTube(e.songs, e.playlistName); }

// ── Map ───────────────────────────────────────────────────
let map;

function initMap() {
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  map.on('click', async (e) => {
    if (state.mode !== 'place') return;
    const { lat, lng } = e.latlng;
    const name = await reverseGeocode(lat, lng);
    addPin(lat, lng, name);
  });
}

// haversineKm — defined in lib/utils.js

// ── Geocoding ─────────────────────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await res.json();
    return d.address?.city || d.address?.town || d.address?.village ||
           d.address?.county || d.address?.state || d.address?.country ||
           d.display_name?.split(',')[0] || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  } catch {
    return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  }
}

async function geocode(name) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

// ── Pins ──────────────────────────────────────────────────
function makePin(className, label) {
  return L.divIcon({
    className: '',
    html: `<div class="map-pin ${className}">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

function addPin(lat, lng, name) {
  const id = ++state.pinCounter;
  const num = state.pins.length + 1;
  const marker = L.marker([lat, lng], { icon: makePin('map-pin-place', num), draggable: true })
    .addTo(map)
    .bindPopup(`<div class="popup-inner"><b>${name}</b><button class="popup-remove" onclick="removePin(${id})">Remove</button></div>`, { closeButton: false });

  marker.on('dragend', async () => {
    const { lat, lng } = marker.getLatLng();
    const pin = state.pins.find(p => p.id === id);
    if (!pin) return;
    pin.lat = lat;
    pin.lng = lng;
    pin.name = await reverseGeocode(lat, lng);
    marker.setPopupContent(`<div class="popup-inner"><b>${pin.name}</b><button class="popup-remove" onclick="removePin(${id})">Remove</button></div>`);
    renderPinsList();
    if (document.getElementById('results-place').children.length > 0) {
      findSongsForPlaces();
    }
  });

  state.pins.push({ id, lat, lng, name, marker });
  renderPinsList();
  document.getElementById('btn-find-songs').disabled = false;
}

function removePin(id) {
  const idx = state.pins.findIndex(p => p.id === id);
  if (idx === -1) return;
  state.pins[idx].marker.remove();
  state.pins.splice(idx, 1);
  state.pins.forEach((p, i) => p.marker.setIcon(makePin('map-pin-place', i + 1)));
  renderPinsList();
  const hasPins = state.pins.length > 0;
  document.getElementById('btn-find-songs').disabled = !hasPins;
  if (!hasPins) {
    state.queryId++;
    const resultsEl = document.getElementById('results-place');
    const wasRunning = resultsEl.querySelector('.loading');
    resultsEl.innerHTML = wasRunning
      ? '<p class="empty-state" style="padding:4px 0">Query stopped — no locations selected.</p>'
      : '';
  }
}

function renderPinsList() {
  const el = document.getElementById('pins-list');
  if (state.pins.length === 0) {
    el.innerHTML = '<p class="empty-state">No locations pinned yet.</p>';
    return;
  }
  el.innerHTML = state.pins.map(p => `
    <div class="pin-item">
      <span>📍</span>
      <span class="pin-name">${p.name}</span>
      <button class="pin-remove" onclick="removePin(${p.id})" title="Remove">×</button>
    </div>
  `).join('');
}

// ── Ollama ────────────────────────────────────────────────
async function ollamaGenerate(prompt) {
  const res = await fetch(`${state.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: state.model, prompt, stream: false }),
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Model "${state.model}" not found — run: ollama pull ${state.model}`);
    throw new Error(`Ollama error ${res.status}. Is it running? Try: ollama serve`);
  }
  const data = await res.json();
  return data.response;
}

// extractJSON — defined in lib/utils.js

function assocPhrase(assoc) {
  return assoc === 'lyrics' ? 'lyrics' : 'song title';
}

// ── Mode A: Place → Songs ─────────────────────────────────
async function findSongsForPlaces() {
  const myQueryId = ++state.queryId;
  const resultsEl = document.getElementById('results-place');
  resultsEl.innerHTML = loading('Asking Ollama…');
  state.lastResults = [];

  const phrase = assocPhrase(state.assocPlace);

  const allResults = await Promise.all(state.pins.map(async pin => {
    try {
      const prompt =
        `You are a knowledgeable music expert. List exactly 5 real, well-known songs that reference "${pin.name}" through their ${phrase}.\n` +
        `Return ONLY a valid JSON array — no markdown, no explanation.\n` +
        `Each element: {"title":"string","artist":"string","year":number,"connection":"one sentence"}\n` +
        `Example: [{"title":"New York, New York","artist":"Frank Sinatra","year":1980,"connection":"The title and lyrics celebrate New York City."}]`;

      const raw = await ollamaGenerate(prompt);
      console.log(`[Crossroads] place raw (${pin.name}):`, raw);
      const songs = extractJSON(raw);
      console.log(`[Crossroads] place parsed (${pin.name}):`, songs);
      const songList = Array.isArray(songs) ? songs : [];
      state.lastResults.push(...songList);
      return { pin, songs: songList, error: Array.isArray(songs) ? null : 'Could not parse response — try again.' };
    } catch (err) {
      return { pin, songs: [], error: err.message };
    }
  }));

  if (state.queryId !== myQueryId) return;
  if (state.pins.length === 0) { resultsEl.innerHTML = ''; return; }
  renderPlaceResults(allResults);
}

function renderPlaceResults(groups) {
  const el = document.getElementById('results-place');
  const playlistName = `Crossroads: ${groups.map(g => g.pin.name).join(', ')}`;
  const multiPin = groups.length > 1;

  const groupsHTML = groups.map(({ pin, songs, error }) => `
    <div class="location-group">
      <div class="results-header">
        <div class="location-label">📍 ${pin.name}</div>
        ${songs.length > 0 && !multiPin ? exportBtns(songs, `Crossroads: ${pin.name}`) : ''}
      </div>
      ${error ? `<div class="error-msg">${error}</div>` : ''}
      ${songs.map(s => songCard(s, false)).join('')}
      ${!error && songs.length === 0 ? '<p class="empty-state">No songs found.</p>' : ''}
    </div>
  `).join('');

  const exportAllHTML = multiPin && state.lastResults.length > 0 ? `
    <div class="results-footer">
      ${exportBtns(state.lastResults, playlistName)}
    </div>
  ` : '';

  el.innerHTML = groupsHTML + exportAllHTML;
}

// ── Mode B: Song → Places ─────────────────────────────────
async function findNearbySongs() {
  const title = document.getElementById('input-song-title').value.trim();
  if (!title) {
    document.getElementById('results-song').innerHTML = `<div class="error-msg">Please enter a song title.</div>`;
    return;
  }

  const artist = document.getElementById('input-song-artist').value.trim();
  const songLabel = artist ? `"${title}" by ${artist}` : `"${title}"`;
  const resultsEl = document.getElementById('results-song');

  resultsEl.innerHTML = loading('Identifying location in song…');
  clearSongMarkers();
  state.lastResults = [];

  try {
    const locPrompt =
      `What real-world location does the song ${songLabel} reference or is set in?\n` +
      `Give the most specific and well-known answer (e.g. "Vermont, USA" not a nearby town).\n` +
      `Respond with ONLY this JSON, no other text:\n` +
      `{"location":"Place, Country","explanation":"one sentence about the connection"}\n` +
      `If truly no location exists, respond with: {"location":null,"explanation":"no location"}`;

    const locRaw = await ollamaGenerate(locPrompt);
    const locData = extractJSON(locRaw);

    if (!locData?.location) {
      resultsEl.innerHTML = `<div class="error-msg">Couldn't find a location in ${songLabel}. Try a different song.</div>`;
      return;
    }

    // Show editable confirmation before running the expensive nearby search
    resultsEl.innerHTML = `
      <div class="location-confirm">
        <div class="location-confirm-label">📍 Location identified</div>
        <input type="text" id="confirm-location-input" value="${locData.location.replace(/"/g,'&quot;')}" />
        <p class="location-confirm-hint">${locData.explanation}<br><br>Edit if incorrect, then confirm.</p>
        <button class="confirm-btn" id="btn-confirm-location">Search within this area →</button>
      </div>
    `;

    document.getElementById('btn-confirm-location').addEventListener('click', () => {
      const confirmedLoc = document.getElementById('confirm-location-input').value.trim();
      if (confirmedLoc) runNearbySearch(title, songLabel, confirmedLoc);
    });

  } catch (err) {
    resultsEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

async function runNearbySearch(title, songLabel, seedLoc) {
  const phrase = assocPhrase(state.assocSong);
  const km = state.distance;
  const resultsEl = document.getElementById('results-song');

  resultsEl.innerHTML = loading(`Searching within ${km} km of ${seedLoc}…`);
  clearSongMarkers();

  try {
    const seedCoords = await geocode(seedLoc);
    if (seedCoords) {
      state.seedCoords = seedCoords;
      const m = L.marker([seedCoords.lat, seedCoords.lng], { icon: makePin('map-pin-seed', '♪') })
        .addTo(map)
        .bindPopup(`<b>${title}</b><br><i>${seedLoc}</i>`, { closeButton: false });
      state.songMarkers.push(m);
      map.flyTo([seedCoords.lat, seedCoords.lng], 5, { duration: 1.2 });
      drawRadiusCircle();
    }

    const nearbyPrompt =
      `The song ${songLabel} references ${seedLoc}.\n` +
      `List 6 real songs whose titles reference specific places in the same region as ${seedLoc} — cities, states, or landmarks that are geographically close (within about ${km} km). ` +
      `Do NOT suggest songs about places on different continents or in distant countries. Stay in the same country or neighboring countries.\n` +
      `Find songs through their ${phrase}.\n` +
      `Spread results across different nearby cities — do not cluster them all in one city.\n` +
      `Return ONLY a valid JSON array — no markdown, no explanation.\n` +
      `Each object must have exactly these keys: "title", "artist", "year", "location" (City, State or Country), "connection" (one sentence).\n` +
      `Example for ${seedLoc}: [{"title":"Example Song","artist":"Example Artist","year":1975,"location":"Nearby City, State","connection":"Song is set in Nearby City."}]`;

    const nearbyRaw = await ollamaGenerate(nearbyPrompt);
    console.log('[Crossroads] nearby raw response:', nearbyRaw);
    const nearbySongs = extractJSON(nearbyRaw);
    console.log('[Crossroads] nearby parsed songs:', nearbySongs);

    if (!Array.isArray(nearbySongs) || nearbySongs.length === 0) {
      resultsEl.innerHTML = `<div class="error-msg">Couldn't parse songs from the model. Try again.</div>`;
      return;
    }

    // Normalize field names before filtering so variants like "place" or "city" work
    const normalized = nearbySongs.map(normalizeSong);

    // Geocode all songs in parallel, then filter by real distance
    const withCoords = await Promise.all(
      normalized.filter(s => s.location).map(async song => {
        const coords = await geocode(song.location);
        if (!coords) return null;
        const dist = state.seedCoords
          ? Math.round(haversineKm(state.seedCoords.lat, state.seedCoords.lng, coords.lat, coords.lng))
          : null;
        return { ...song, _coords: coords, _dist: dist };
      })
    );
    const verified = withCoords.filter(s => s && (s._dist === null || s._dist <= km));

    if (verified.length === 0) {
      resultsEl.innerHTML = `<div class="error-msg">No songs found within ${km} km. Try increasing the radius.</div>`;
      return;
    }

    state.lastResults = verified;

    for (const song of verified) {
      const m = L.marker([song._coords.lat, song._coords.lng], { icon: makePin('map-pin-nearby', '♫') })
        .addTo(map)
        .bindPopup(`<b>${song.title}</b> — ${song.artist}<br><i>${song.location}</i>`, { closeButton: false });
      state.songMarkers.push(m);
    }

    renderSongResults(seedLoc, '', verified, title);
  } catch (err) {
    resultsEl.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

function renderSongResults(seedLoc, explanation, songs, seedTitle) {
  document.getElementById('results-song').innerHTML = `
    <div class="location-group">
      <div class="results-header">
        <div class="location-label">🌍 ${seedLoc}</div>
        ${exportBtns(songs, `Crossroads: Near ${seedLoc}`)}
      </div>
      <p class="empty-state" style="margin-bottom:4px">${explanation}</p>
      ${songs.map(s => songCard(s, true)).join('')}
    </div>
  `;
}

function clearSongMarkers() {
  state.songMarkers.forEach(m => m.remove());
  state.songMarkers = [];
  clearRadiusCircle();
  state.seedCoords = null;
}

function drawRadiusCircle() {
  clearRadiusCircle();
  if (!state.seedCoords) return;
  state.radiusCircle = L.circle(
    [state.seedCoords.lat, state.seedCoords.lng],
    {
      radius: state.distance * 1000,
      color: '#1635A8',
      fillColor: '#1635A8',
      fillOpacity: 0.07,
      weight: 2,
      dashArray: '6 5',
    }
  ).addTo(map);
}

function clearRadiusCircle() {
  if (state.radiusCircle) { state.radiusCircle.remove(); state.radiusCircle = null; }
}

// ── Driving playlist ──────────────────────────────────────

// ── Song card ─────────────────────────────────────────────
// normalizeSong — defined in lib/utils.js

function songCard(raw, showLocation) {
  const s = normalizeSong(raw);
  return `
    <div class="song-card">
      <div class="song-title">${s.title}</div>
      <div class="song-artist">${s.artist}</div>
      <div class="song-meta">
        ${s.year ? `<span class="song-year">${s.year}</span>` : ''}
        ${showLocation && s.location ? `<span class="song-location-tag">📍 ${s.location}</span>` : ''}
        ${showLocation && raw._dist != null ? `<span class="song-year" style="background:#f0f4ff;color:#4a6cf7">${raw._dist} km</span>` : ''}
      </div>
      ${s.connection ? `<div class="song-connection">${s.connection}</div>` : ''}
    </div>
  `;
}


// ── Spotify PKCE ──────────────────────────────────────────
// generateCodeVerifier — defined in lib/utils.js

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function exportToSpotify(songs, playlistName) {
  if (!state.spotifyClientId) {
    alert('Add your Spotify Client ID in Settings (⚙) first.\n\nGet one free at developer.spotify.com — takes about 2 minutes.');
    return;
  }
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const redirectUri = `${location.origin}${location.pathname}`;

  sessionStorage.setItem('sp_verifier', verifier);
  sessionStorage.setItem('sp_songs', JSON.stringify(songs));
  sessionStorage.setItem('sp_playlist', playlistName);

  const params = new URLSearchParams({
    client_id: state.spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: 'playlist-modify-public playlist-modify-private',
  });

  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function handleSpotifyCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;

  history.replaceState({}, document.title, location.pathname);

  const verifier  = sessionStorage.getItem('sp_verifier');
  const songs     = JSON.parse(sessionStorage.getItem('sp_songs') || '[]');
  const playlist  = sessionStorage.getItem('sp_playlist') || 'Crossroads Mix';
  sessionStorage.removeItem('sp_verifier');
  sessionStorage.removeItem('sp_songs');
  sessionStorage.removeItem('sp_playlist');

  if (!verifier || !state.spotifyClientId) return;

  const activePanel = state.mode === 'place' ? 'results-place' : 'results-song';
  const resultsEl = document.getElementById(activePanel);
  resultsEl.insertAdjacentHTML('afterbegin', loading('Connecting to Spotify…'));

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: state.spotifyClientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${location.origin}${location.pathname}`,
        code_verifier: verifier,
      }),
    });
    if (!tokenRes.ok) throw new Error('Failed to get Spotify access token.');
    const { access_token } = await tokenRes.json();

    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const me = await meRes.json();

    const plRes = await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playlist, description: 'Made with Crossroads — Travel by Music' }),
    });
    const pl = await plRes.json();

    const uris = [];
    const notFound = [];
    for (const song of songs) {
      const q = encodeURIComponent(`track:${song.title} artist:${song.artist}`);
      const s = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const sd = await s.json();
      const track = sd.tracks?.items?.[0];
      if (track) uris.push(track.uri);
      else notFound.push(`${song.title} — ${song.artist}`);
    }

    if (uris.length > 0) {
      await fetch(`https://api.spotify.com/v1/playlists/${pl.id}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris }),
      });
    }

    const notFoundNote = notFound.length > 0 ? `<br>Not found on Spotify: ${notFound.join(', ')}` : '';
    resultsEl.insertAdjacentHTML('afterbegin', `
      <div class="success-msg">
        ✓ Playlist "<a href="${pl.external_urls.spotify}" target="_blank">${playlist}</a>" created with ${uris.length} tracks.${notFoundNote}
      </div>
    `);
  } catch (err) {
    resultsEl.insertAdjacentHTML('afterbegin', `<div class="error-msg">Spotify error: ${err.message}</div>`);
  }
}

// ── Location search autocomplete (Nominatim) ─────────────
function initLocationSearch() {
  const input    = document.getElementById('input-location-search');
  const dropdown = document.getElementById('location-dropdown');
  let timer = null;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { hideDrop(); return; }
    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div class="ac-loading">Searching…</div>';
    timer = setTimeout(() => fetchLocations(q), 350);
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    const active = dropdown.querySelector('.autocomplete-item.active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = active ? active.nextElementSibling : items[0];
      if (next) { active?.classList.remove('active'); next.classList.add('active'); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = active ? active.previousElementSibling : items[items.length - 1];
      if (prev) { active?.classList.remove('active'); prev.classList.add('active'); }
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.click();
    } else if (e.key === 'Escape') {
      hideDrop();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#location-search-wrap')) hideDrop();
  });

  async function fetchLocations(q) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (data.length === 0) { dropdown.innerHTML = '<div class="ac-loading">No results</div>'; return; }

      dropdown.innerHTML = data.map(place => {
        const label = place.display_name;
        return `<div class="autocomplete-item"
          data-lat="${place.lat}" data-lng="${place.lon}" data-name="${label.replace(/"/g,'&quot;')}">
          <div class="ac-title">${label.split(',')[0]}</div>
          <div class="ac-artist">${label.split(',').slice(1, 3).join(',').trim()}</div>
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          const lat = parseFloat(item.dataset.lat);
          const lng = parseFloat(item.dataset.lng);
          const name = item.querySelector('.ac-title').textContent;
          addPin(lat, lng, name);
          input.value = '';
          hideDrop();
        });
      });
    } catch {
      dropdown.innerHTML = '<div class="ac-loading">Search unavailable</div>';
    }
  }

  function hideDrop() {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
}

// ── YouTube export ────────────────────────────────────────
async function exportToYouTube(songs, playlistName) {
  if (!state.youtubeApiKey) {
    alert('Add your YouTube API Key in Settings (⚙) first.\n\nEnable the YouTube Data API v3 at console.cloud.google.com — it\'s free.');
    return;
  }

  const activePanel = state.mode === 'place' ? 'results-place' : 'results-song';
  const resultsEl = document.getElementById(activePanel);
  const notice = document.createElement('div');
  notice.className = 'loading';
  notice.innerHTML = `<div class="spinner"></div>Searching YouTube…`;
  resultsEl.insertAdjacentElement('afterbegin', notice);

  try {
    const videoIds = [];
    const notFound = [];
    for (const raw of songs) {
      const s = normalizeSong(raw);
      const q = encodeURIComponent(`"${s.title}" "${s.artist}"`);
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&maxResults=1&key=${state.youtubeApiKey}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const id = data.items?.[0]?.id?.videoId;
      if (id) videoIds.push(id);
      else notFound.push(`${s.title} — ${s.artist}`);
    }

    notice.remove();

    if (videoIds.length === 0) {
      resultsEl.insertAdjacentHTML('afterbegin', `<div class="error-msg">No videos found on YouTube.</div>`);
      return;
    }

    const ytUrl = `https://www.youtube.com/watch_videos?video_ids=${videoIds.join(',')}`;
    window.open(ytUrl, '_blank');

    const notFoundNote = notFound.length > 0 ? `<br>Not found: ${notFound.join(', ')}` : '';
    resultsEl.insertAdjacentHTML('afterbegin', `
      <div class="success-msg">✓ Opened YouTube playlist with ${videoIds.length} videos.${notFoundNote}</div>
    `);
  } catch (err) {
    notice.remove();
    resultsEl.insertAdjacentHTML('afterbegin', `<div class="error-msg">YouTube error: ${err.message}</div>`);
  }
}

// ── Song autocomplete (MusicBrainz) ───────────────────────
let acDebounceTimer = null;

function initAutocomplete() {
  const input    = document.getElementById('input-song-title');
  const dropdown = document.getElementById('autocomplete-dropdown');
  const artist   = document.getElementById('input-song-artist');

  input.addEventListener('input', () => {
    clearTimeout(acDebounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { hideDropdown(); return; }
    dropdown.style.display = 'block';
    dropdown.innerHTML = '<div class="ac-loading">Searching…</div>';
    acDebounceTimer = setTimeout(() => fetchSuggestions(q), 300);
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    const active = dropdown.querySelector('.autocomplete-item.active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = active ? active.nextElementSibling : items[0];
      if (next) { active?.classList.remove('active'); next.classList.add('active'); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = active ? active.previousElementSibling : items[items.length - 1];
      if (prev) { active?.classList.remove('active'); prev.classList.add('active'); }
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.click();
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrap')) hideDropdown();
  });

  async function fetchSuggestions(q) {
    try {
      const res = await fetch(
        `https://musicbrainz.org/ws/2/recording/?query=recording:${encodeURIComponent(q)}&fmt=json&limit=8`,
        { headers: { 'User-Agent': 'Crossroads/1.0 (travel-music-app)' } }
      );
      const data = await res.json();
      const recordings = data.recordings || [];
      if (recordings.length === 0) { dropdown.innerHTML = '<div class="ac-loading">No results</div>'; return; }

      dropdown.innerHTML = recordings.map((r, i) => {
        const title  = r.title || '';
        const artist = r['artist-credit']?.[0]?.artist?.name || '';
        return `<div class="autocomplete-item" data-title="${title.replace(/"/g,'&quot;')}" data-artist="${artist.replace(/"/g,'&quot;')}">
          <div class="ac-title">${title}</div>
          ${artist ? `<div class="ac-artist">${artist}</div>` : ''}
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          input.value  = item.dataset.title;
          artist.value = item.dataset.artist;
          hideDropdown();
          input.focus();
        });
      });
    } catch {
      dropdown.innerHTML = '<div class="ac-loading">Search unavailable</div>';
    }
  }

  function hideDropdown() {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }
}

// ── Helpers ───────────────────────────────────────────────
function loading(msg) {
  return `<div class="loading"><div class="spinner"></div>${msg}</div>`;
}

// ── Mode switching ────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  document.getElementById('panel-place').classList.toggle('active', mode === 'place');
  document.getElementById('panel-song').classList.toggle('active', mode === 'song');
  document.getElementById('btn-mode-place').classList.toggle('active', mode === 'place');
  document.getElementById('btn-mode-song').classList.toggle('active', mode === 'song');
  if (mode === 'place') clearSongMarkers();
}

// ── Pills ─────────────────────────────────────────────────
function initPills() {
  document.querySelectorAll('.pill-group').forEach(group => {
    group.querySelectorAll('.pill').forEach(pill => {
      pill.addEventListener('click', () => {
        group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        if (group.id === 'assoc-place') state.assocPlace = pill.dataset.value;
        if (group.id === 'assoc-song')  state.assocSong  = pill.dataset.value;
      });
    });
  });
}

// ── Settings ──────────────────────────────────────────────
async function testOllamaConnection() {
  const statusEl = document.getElementById('ollama-status');
  statusEl.innerHTML = loading('Testing…');
  try {
    const res = await fetch(`${state.ollamaUrl}/api/tags`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    const models = data.models?.map(m => m.name).join(', ') || 'none pulled yet';
    statusEl.innerHTML = `<div class="success-msg">Connected ✓ — Models: ${models}</div>`;
  } catch (err) {
    statusEl.innerHTML = `<div class="error-msg">Can't connect: ${err.message}<br>Run <code>ollama serve</code> in a terminal.</div>`;
  }
}

// ── Init ──────────────────────────────────────────────────
async function loadSecrets() {
  try {
    const res = await fetch('/secrets');
    if (!res.ok) return;
    const s = await res.json();
    if (s.spotifyClientId) { state.spotifyClientId = s.spotifyClientId; state._opSecrets.add('spotifyClientId'); }
    if (s.youtubeApiKey)   { state.youtubeApiKey   = s.youtubeApiKey;   state._opSecrets.add('youtubeApiKey'); }
    if (s.ollamaUrl)       { state.ollamaUrl       = s.ollamaUrl; }
    if (s.ollamaModel)     { state.model           = s.ollamaModel; }
  } catch {} // server.py not running — fall back to Settings UI
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSecrets();

  initMap();
  initPills();
  initLocationSearch();
  initAutocomplete();
  handleSpotifyCallback();

  document.getElementById('btn-mode-place').addEventListener('click', () => setMode('place'));
  document.getElementById('btn-mode-song').addEventListener('click',  () => setMode('song'));

  document.getElementById('btn-find-songs').addEventListener('click', findSongsForPlaces);
  document.getElementById('btn-find-nearby').addEventListener('click', findNearbySongs);

  document.getElementById('distance-slider').addEventListener('input', e => {
    state.distance = parseInt(e.target.value);
    document.getElementById('distance-label').textContent = `${state.distance} km`;
    drawRadiusCircle();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('input-model').value = state.model;
    document.getElementById('input-ollama-url').value = state.ollamaUrl;
    // Show a masked placeholder for keys that came from 1Password
    const youtubeEl = document.getElementById('input-youtube-key');
    youtubeEl.value = state._opSecrets.has('youtubeApiKey') ? '' : state.youtubeApiKey;
    youtubeEl.placeholder = state._opSecrets.has('youtubeApiKey') ? '● Managed by 1Password' : 'Recommended: use 1Password CLI via start.sh';
    document.getElementById('ollama-status').innerHTML = '';
    document.getElementById('settings-modal').classList.remove('hidden');
  });

  document.getElementById('btn-test-ollama').addEventListener('click', testOllamaConnection);

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    state.model = document.getElementById('input-model').value.trim() || 'llama3.2';
    state.ollamaUrl = document.getElementById('input-ollama-url').value.trim() || 'http://localhost:11434';
    // Only overwrite 1Password-managed keys if the user typed a new value
    const youtubeVal = document.getElementById('input-youtube-key').value.trim();
    if (youtubeVal) { state.youtubeApiKey = youtubeVal; state._opSecrets.delete('youtubeApiKey'); }
    document.getElementById('settings-modal').classList.add('hidden');
  });

  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop'))
      document.getElementById('settings-modal').classList.add('hidden');
  });
});
