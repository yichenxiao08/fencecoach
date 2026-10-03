FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY pyproject.toml README.md ./
COPY src ./src
COPY knowledge ./knowledge
RUN pip install --no-deps . && useradd --create-home --uid 10001 app \
    && mkdir -p /app/data && chown app:app /app/data

USER app
ENV FENCECOACH_KNOWLEDGE_DIR=/app/knowledge FENCECOACH_DB_PATH=/app/data/fencecoach.sqlite3
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["uvicorn", "fencecoach.api:app", "--host", "0.0.0.0", "--port", "8000"]
