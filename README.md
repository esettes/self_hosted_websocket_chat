# Chat

Simple intranet chat prototype.

MVP goals
- Home page: list chats + "New chat" button
- Each chat lives at /c/<token>
- Realtime messages over WebSocket

Structure
- server/   Node HTTP + WebSocket server
- public/   Static UI
- docs/     Roadmap and deploy notes

Quick start (after deps)
1) npm install
2) npm run dev
3) open http://localhost:8080

Notes
- SQLite persistence is enabled by default (file: server/db/chat.sqlite)
- Override DB path with `DB_PATH=/path/to/chat.sqlite`
- Use in-memory store with `STORE=memory`
- Admin delete access via `ADMIN_TOKEN=your-secret`
- New chats can include an optional 5-character password required to access the room
- Chat creators can set a custom name once at creation (optional)
- Chats are deleted automatically after 24 hours
- Reports are stored in SQLite and visible to admins at `/reports` (requires `ADMIN_TOKEN`)
- Optional fingerprint pepper: set `FINGERPRINT_SALT` to salt the IP+user-agent hash stored for rate limiting and reports
- Creator rate limits:
  - First `CREATOR_SEED_LIMIT` visitors get a higher limit (`CREATOR_SEED_DAILY_LIMIT` chats per 24h per fingerprint)
  - Everyone else can create one chat per 24h
- Reverse proxy: set `TRUST_PROXY_HOPS` to the number of proxies in front of the app (default `1` for a single Caddy proxy; use `2` if you add another proxy in front).
