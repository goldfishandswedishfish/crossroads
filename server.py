#!/usr/bin/env python3
"""
Crossroads local server.
Run directly:  python3 server.py
Run with 1Password:  op run --env-file=.env.tpl -- python3 server.py
"""
import http.server
import json
import os
import socketserver
from pathlib import Path

PORT      = 8081
SERVE_DIR = Path(__file__).parent

# Secrets injected by `op run`. Fall back to empty string so the app
# still starts without 1Password — users can enter keys in Settings.
SECRETS = {
    'spotifyClientId': os.getenv('SPOTIFY_CLIENT_ID', ''),
    'youtubeApiKey':   os.getenv('YOUTUBE_API_KEY', ''),
    'ollamaUrl':       os.getenv('OLLAMA_URL', 'http://localhost:11434'),
    'ollamaModel':     os.getenv('OLLAMA_MODEL', 'llama3.2'),
}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SERVE_DIR), **kwargs)

    def do_GET(self):
        if self.path == '/secrets':
            body = json.dumps(SECRETS).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def log_message(self, fmt, *args):
        # Suppress /secrets from appearing in the log to avoid leaking key presence
        if args and '/secrets' in str(args[0]):
            return
        super().log_message(fmt, *args)

if __name__ == '__main__':
    # Bind to 127.0.0.1 only — /secrets is not reachable from other machines
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
        print(f'\nCrossroads running at http://localhost:{PORT}\n')
        for k, v in SECRETS.items():
            status = '✓ set via 1Password' if v else '— not set (use Settings)'
            print(f'  {k}: {status}')
        print()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')
