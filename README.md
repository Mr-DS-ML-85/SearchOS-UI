# SearchOS Web UI

A beautiful, production-grade web interface for [SearchOS](https://github.com/SearchOS/SearchOS) — a self-hosted search API for AI agents.

![Python](https://img.shields.io/badge/Python-3.12-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **Unified search bar** — persistent, Google-style search in the topbar with live autocomplete
- **Web search** — local index, vector, and live web results with relevance scores, source badges, and query-aware snippets
- **Image search** — text-to-image (CLIP) and image-to-image (reverse search by URL)
- **Domain filtering** — restrict results to specific domains
- **Time range filters** — day, week, month, year
- **Reader mode** — extract and read any result URL in a clean modal
- **Cursor pagination** — load more results without page jumps
- **Dark glassmorphism UI** — aurora orbs, backdrop blur, smooth animations
- **Responsive** — works on mobile and desktop
- **Production-ready** — Docker support, healthchecks, non-root user

## Quick Start

### Docker (recommended)

```bash
cp .env.example .env
# edit .env with your SearchOS gateway URL and API key
docker compose up -d --build
```

The UI is at `http://localhost:8787`.

### Local development

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env
python -m uvicorn "webui.server:create_app" --factory --host 0.0.0.0 --port 8787
```

## Configuration

All configuration is via environment variables (`.env`):

| Variable | Default | Description |
|---|---|---|
| `SEARCHOS_URL` | `http://127.0.0.1:8000` | SearchOS gateway URL |
| `SEARCHOS_API_KEY` | — | API key for the gateway |
| `WEBUI_HOST` | `0.0.0.0` | Bind address |
| `WEBUI_PORT` | `8787` | Bind port |
| `WEBUI_GATEWAY_TIMEOUT` | `60` | Upstream timeout in seconds |

## API Endpoints (proxied)

| Endpoint | Description |
|---|---|
| `GET /api/search` | Web search — `q`, `sources`, `num_results`, `time_range`, `domains`, `cursor` |
| `GET /api/images` | Image search — `q` or `image_url`, `limit`, `domains` |
| `GET /api/suggest` | Query autocomplete — `q`, `limit` |
| `GET /api/read` | Extract page content — `url` |
| `GET /api/health` | Gateway health status |

## Project Structure

```
searchos-webui/
├── webui/
│   ├── server.py          # FastAPI proxy (keeps API key server-side)
│   └── static/
│       ├── index.html     # SPA markup
│       ├── app.css        # Dark glassmorphism styles
│       └── app.js         # Frontend logic
├── Dockerfile             # Production image
├── docker-compose.yml     # One-command deploy
├── requirements.txt
├── .env.example
└── README.md
```

## Security

- The API key never leaves the server — the browser talks only to the web UI proxy
- Only a fixed allow-list of read-only params is forwarded upstream
- Non-root Docker user
- No arbitrary URL fetching from the browser

## License

MIT
