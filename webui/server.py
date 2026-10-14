"""SearchOS Web UI: a static search page plus a thin proxy to the gateway.

The proxy exists for two reasons:

- **The API key stays on the server.** The browser talks to this process, which
  adds the gateway key itself. Putting the key in page JavaScript would hand it
  to anyone who opens devtools.
- **No CORS.** The gateway does not serve browsers; same-origin requests to this
  process avoid needing it to.

Only a fixed set of read-only endpoints and parameters is forwarded. Nothing the
browser sends chooses the upstream host, so this cannot be used to reach
anything but the configured gateway.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"

# Parameters the browser may pass through, per endpoint. Anything else is
# dropped rather than forwarded.
SEARCH_PARAMS = {"q", "sources", "num_results", "cursor", "offset", "time_range", "language", "country", "cache", "domains", "exclude_domains"}
IMAGE_PARAMS = {"q", "image_url", "limit", "source", "domains", "exclude_domains"}
SUGGEST_PARAMS = {"q", "limit"}


def _load_env_file(path: Path) -> None:
    """Read KEY=VALUE lines from .env into os.environ, without overriding."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class Settings:
    def __init__(self) -> None:
        _load_env_file(Path.cwd() / ".env")
        self.gateway_url = os.environ.get("SEARCHOS_URL", "http://127.0.0.1:8000").rstrip("/")
        self.api_key = os.environ.get("SEARCHOS_API_KEY", "")
        self.timeout = float(os.environ.get("WEBUI_GATEWAY_TIMEOUT", "60"))


def _pick(params: dict[str, Any], allowed: set[str]) -> list[tuple[str, str]]:
    return [(k, str(v)) for k, v in params.items() if k in allowed and v not in (None, "")]


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="SearchOS Web UI", docs_url=None, redoc_url=None, openapi_url=None)

    async def gateway(method: str, path: str, *, params=None, json=None) -> JSONResponse:
        headers = {"Authorization": f"Bearer {settings.api_key}"} if settings.api_key else {}
        try:
            async with httpx.AsyncClient(
                base_url=settings.gateway_url, timeout=settings.timeout, transport=transport
            ) as client:
                resp = await client.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            return JSONResponse(
                {"error": "gateway_unreachable", "message": f"Cannot reach SearchOS at {settings.gateway_url}: {exc}"},
                status_code=502,
            )
        try:
            if "application/json" in resp.headers.get("content-type", ""):
                body = resp.json()
            else:
                body = {"text": resp.text}
        except ValueError:
            body = {"error": "bad_gateway_response", "message": resp.text[:300]}
        if resp.status_code == 401:
            body = {
                "error": "unauthorized",
                "message": "SearchOS rejected the API key. Set SEARCHOS_API_KEY for the web UI.",
            }
        return JSONResponse(body, status_code=resp.status_code)

    @app.get("/api/search")
    async def search(request: Request) -> JSONResponse:
        return await gateway("GET", "/v1/search", params=_pick(dict(request.query_params), SEARCH_PARAMS))

    @app.get("/api/images")
    async def images(request: Request) -> JSONResponse:
        return await gateway("GET", "/v1/images/search", params=_pick(dict(request.query_params), IMAGE_PARAMS))

    @app.get("/api/suggest")
    async def suggest(request: Request) -> JSONResponse:
        return await gateway("GET", "/v1/suggest", params=_pick(dict(request.query_params), SUGGEST_PARAMS))

    @app.get("/api/read")
    async def read(url: str = Query(..., min_length=8, max_length=4096)) -> JSONResponse:
        # The gateway fetches the page through its own robots.txt check and
        # egress guard; this process never fetches arbitrary URLs itself.
        return await gateway("POST", "/v1/extract", json={"url": url, "format": "text", "max_chars": 40000})

    @app.get("/api/health")
    async def health() -> JSONResponse:
        return await gateway("GET", "/health")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


def main() -> None:
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="SearchOS Web UI")
    parser.add_argument("--host", default=os.environ.get("WEBUI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("WEBUI_PORT", "8787")))
    args = parser.parse_args()
    settings = Settings()
    if not settings.api_key:
        print("warning: SEARCHOS_API_KEY is not set; the gateway will reject searches", flush=True)
    print(f"SearchOS Web UI on http://{args.host}:{args.port}  (gateway: {settings.gateway_url})", flush=True)
    uvicorn.run(create_app(settings), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
