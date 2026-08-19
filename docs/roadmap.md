# Roadmap

1) MVP
- Home page: list + new chat button
- Chat at /c/<token>
- WebSocket messages

2) Engine
- HTTP server + static files
- WS rooms per chat
- Data model: Chat + Message
- Storage: memory now, SQLite later

3) LAN test
- Run on local IP and test from phone

4) IPv6 publish
- Listen on ::
- Open firewall and router inbound rule

5) Production layer
- Reverse proxy (Caddy)
- TLS + optional DNS AAAA
