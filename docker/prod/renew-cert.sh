#!/bin/bash

set -euo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COMPOSE_FILE="$(dirname "$0")/docker-compose.yml"

echo "Running 'certbot renew'..."
docker compose -f "$COMPOSE_FILE" run --rm certbot renew --non-interactive "$@"

echo "Reloading Nginx..."
docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -t
docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload

echo "Done!"
