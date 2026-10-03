FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
COPY knowledge ./knowledge
RUN pip install --no-cache-dir .

ENV FENCECOACH_KNOWLEDGE_DIR=/app/knowledge
EXPOSE 8000
CMD ["uvicorn", "fencecoach.api:app", "--host", "0.0.0.0", "--port", "8000"]
