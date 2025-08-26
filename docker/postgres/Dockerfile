# Use official Postgres base image
FROM postgres:16-alpine

# Optional defaults (can be overridden at runtime)
ENV POSTGRES_USER=postgres \
    POSTGRES_PASSWORD=postgres \
    POSTGRES_DB=demo

# Seed schema and mock data on first startup
COPY init.sql /docker-entrypoint-initdb.d/01-init.sql

# Tune a couple of sensible defaults (can be overridden)
CMD ["postgres", "-c", "shared_buffers=256MB", "-c", "max_connections=100"]

