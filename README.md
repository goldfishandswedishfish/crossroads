# Crossroads — Travel the World Through Music

An interactive web app that connects places to music. Pin locations on a map and discover songs that reference them, or enter a song to find other songs about nearby places.

## What I was exploring

**Open source end-to-end**
Everything in this stack is free and open source: [Leaflet.js](https://leafletjs.com) for maps, [OpenStreetMap](https://www.openstreetmap.org) and [Nominatim](https://nominatim.org) for geocoding, [Ollama](https://ollama.com) for local LLM inference, and [MusicBrainz](https://musicbrainz.org) for song search. No proprietary APIs are required to run the core experience.

**Working with maps**
Using Leaflet and OSM to build an interactive map with draggable pins, radius circles, and custom markers. Geocoding flows in both directions — clicks reverse-geocode to place names, and song locations forward-geocode to coordinates. Real driving distances are verified with the Haversine formula so LLM results are filtered to what's actually nearby.

**Injecting secrets at runtime**
API keys never touch the browser or get stored anywhere. A small Python server (`server.py`) replaces the usual static file server and exposes a `/secrets` endpoint. Secrets are injected into the server process at launch by the [1Password CLI](https://developer.1password.com/docs/cli/) via `op run`, so credentials live only in 1Password and are never written to disk or committed to the repo.

---

## Tech stack

| Layer | Tool |
|---|---|
| Map | Leaflet.js + OpenStreetMap |
| Geocoding | Nominatim (OSM) |
| LLM | Ollama (local, CPU) |
| Song search | MusicBrainz API |
| Distance math | Haversine formula |
| Secret injection | 1Password CLI (`op run`) |
| Server | Python `http.server` |
| Export | YouTube Data API v3 |

## Setup

### Requirements
- [Ollama](https://ollama.com) running locally
- [1Password CLI](https://developer.1password.com/docs/cli/) (optional, for secret injection)
- A YouTube Data API v3 key (free, from Google Cloud Console)

### Run without 1Password
```bash
python3 server.py
```
Open `http://localhost:8081`. Add your YouTube API key in Settings (⚙).

### Run with 1Password
```bash
cp .env.tpl.example .env.tpl
# Edit .env.tpl and replace the op:// paths with your own secret references
./start.sh
```
Keys are injected at launch and shown as "Managed by 1Password" in Settings.

### Ollama model
```bash
ollama pull llama3.2
```
The model can be changed in Settings. `llama3.2:1b` is faster on older hardware.
