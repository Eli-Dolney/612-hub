FROM node:22-bookworm-slim AS node
FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# yt-dlp also needs a JS runtime in the API container for YouTube challenges.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY server/requirements.txt /app/server/requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r server/requirements.txt 'bgutil-ytdlp-pot-provider==1.3.1'
COPY server /app/server
RUN mkdir -p /app/downloads /app/music /app/guest-tmp /data
EXPOSE 8788
CMD ["python", "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8788"]
