#!/usr/bin/env bash
# Start Neo4j and Redis via Docker Compose.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../docker-compose.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: docker-compose.yml not found at $COMPOSE_FILE"
  exit 1
fi

echo "Starting Neo4j and Redis..."
docker compose -f "$COMPOSE_FILE" up -d

echo "Waiting for Neo4j to be ready..."
until docker compose -f "$COMPOSE_FILE" exec -T neo4j neo4j status >/dev/null 2>&1; do
  sleep 2
done

echo "Waiting for Redis to be ready..."
until docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping >/dev/null 2>&1; do
  sleep 1
done

echo "Infrastructure is ready."
echo "  Neo4j:  bolt://localhost:7687  (browser: http://localhost:7474)"
echo "  Redis:  redis://localhost:6379"
