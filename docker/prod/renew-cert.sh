#!/bin/bash
# Renew the TLS certificate if it expires within 30 days, then make Nginx use it.
# setup.sh schedules this twice a day with cron.

set -euo pipefail

# Cron runs with a minimal PATH that may not include docker.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd "$(dirname "$0")"

echo "$(date): running certbot renew"
docker compose run --rm certbot renew --non-interactive

# Check the config, then reload Nginx so it reads the (possibly new) certificate.
# -T: no terminal is attached when cron runs this.
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
