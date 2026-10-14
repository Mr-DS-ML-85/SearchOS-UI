# ============================================================
# SearchOS Web UI — production image
# ============================================================
FROM python:3.12-slim AS base

# --- security: never run as root ---------------------------------
RUN groupadd --system app && useradd --system --gid app --home /app app

WORKDIR /app

# --- dependencies ------------------------------------------------
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# --- application -------------------------------------------------
COPY webui ./webui
COPY .env ./env
RUN chown -R app:app /app
USER app

# --- runtime -----------------------------------------------------
ENV PYTHONUNBUFFERED=1 \
    WEBUI_HOST=0.0.0.0 \
    WEBUI_PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/health', timeout=3)" || exit 1

CMD ["uvicorn", "webui.server:create_app()", "--factory", "--host", "0.0.0.0", "--port", "8787", "--workers", "2"]
