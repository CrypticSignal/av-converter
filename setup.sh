#!/bin/bash

set -euo pipefail

DOMAIN="av-converter.com"
EMAIL="theaudiophile@outlook.com"

# Package installation, firewall changes and cron files require root privileges.
[[ $EUID -eq 0 ]] || { echo "Run with sudo bash setup.sh" >&2; exit 1; }
# Resolve project-relative paths from this script, regardless of the caller's directory.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

log() {
  local green='\033[0;32m'
  local reset='\033[0m'
  echo -e "${green}$*${reset}"
  echo
}

LOCAL_MODE=false
for arg in "$@"; do
  if [ "$arg" == "--local" ]; then
    LOCAL_MODE=true
  fi
done

# Update system packages safely
log "Updating system packages..."
apt-get update -y
apt-get upgrade -y

# -----------------------------------------------------------------------------------------------------------------------------
# Docker installation and setup:

log "Installing prerequisites for Docker..."
# dnsutils supplies dig; iptables manages host rules; cron restores rules and renews TLS.
apt-get install -y ca-certificates curl dnsutils iptables cron

if ! command -v docker &> /dev/null; then
  log "Installing Docker and Compose from Ubuntu packages..."
  # Ubuntu packages support this VPS without adding a separate Docker repository.
  apt-get install -y docker.io docker-compose-v2
fi
# Fail early if Docker exists but the required Compose v2 plugin is unavailable.
docker compose version

# Allow web traffic without removing SSH or Oracle's existing firewall rules.
log "Allowing HTTP and HTTPS through the host firewall..."
# -w waits for the firewall lock; -C avoids duplicate rules on repeated runs.
# Insert missing rules first so Oracle's final INPUT reject does not block them.
for port in 80 443; do
  iptables -w -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
    iptables -w -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
# Reapply only these IPv4 rules at boot, without saving Docker's dynamic chains.
# The quoted heredoc writes the commands literally; cron runs them as root.
cat > /etc/cron.d/av-converter-firewall <<'EOF'
@reboot root /usr/sbin/iptables -w -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || /usr/sbin/iptables -w -I INPUT 1 -p tcp --dport 80 -j ACCEPT
@reboot root /usr/sbin/iptables -w -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || /usr/sbin/iptables -w -I INPUT 1 -p tcp --dport 443 -j ACCEPT
EOF
# Cron files must not be group/world-writable; enable cron now and at boot.
chmod 644 /etc/cron.d/av-converter-firewall
systemctl enable --now cron
log "Also allow TCP 80/443 in Oracle Cloud, and point your domain at this VPS."

log "Checking if Docker is running..."
if docker info > /dev/null 2>&1; then
  log "Docker is already running."
else
  log "Enabling and starting Docker service..."
  if command -v systemctl &> /dev/null && systemctl list-unit-files | grep -q docker.service; then
    systemctl enable --now docker
  elif command -v service &> /dev/null && service docker status >/dev/null 2>&1; then
    log "systemctl not found or docker.service missing, trying service command..."
    service docker start
  elif command -v snap &> /dev/null && snap list docker &> /dev/null; then
    log "Docker installed via snap, starting snap.docker.dockerd..."
    systemctl enable --now snap.docker.dockerd.service || snap start docker
  else
    log "Could not automatically start docker service. Starting dockerd in background as a fallback..."
    dockerd > /dev/null 2>&1 &
    sleep 3
  fi
fi


# ------------------------------------------------------------------------------------------------------------------------------

curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
log "Installing Node.js..."
apt-get install -y nodejs

log "Installing yarn..."
npm install --global yarn

log "Installing dependencies..."
# Use the committed dependency versions and fail instead of rewriting yarn.lock.
yarn install --frozen-lockfile

log "Building the project..."
yarn build

# Production requires this bind-mounted file, even for anonymous downloads.
if [ ! -e cookies.txt ]; then
  # An empty Netscape-format file permits anonymous downloads. Existing cookies stay untouched.
  printf '# Netscape HTTP Cookie File\n' > cookies.txt
  # Let the non-root downloader container read this new file; it contains no credentials.
  chmod 644 cookies.txt
fi

cd docker/prod || exit 1

log "Stopping and removing any existing containers for this project..."
docker compose down

# If running this script with --local
if [ "$LOCAL_MODE" = true ]; then
  log "Running in local mode. Skipping SSL and creating HTTP-only Nginx config..."
  
  cat <<'EOL' > nginx.conf
events {}

http {
    include mime.types;
    # Shared per-IP request counters used by the logging endpoint below.
    limit_req_zone $binary_remote_addr zone=visit_logging:10m rate=2r/s;
    
    server {
        listen 80;
        server_name localhost;

        # Send downloader requests to its private container, preserving the API path.
        location /api/ {
            # Match the backend form-body limit; preserve visitor IP for per-IP limits.
            client_max_body_size 8k;
            proxy_pass http://downloader:8000;
            proxy_set_header X-Real-IP $remote_addr;
            # Allow long downloads/recordings and stream progress without proxy buffering.
            proxy_read_timeout 24h;
            proxy_buffering off;
        }

        # Limit tiny visit reports; replace client-supplied forwarding headers to prevent spoofing.
        location /logging {
            limit_req zone=visit_logging burst=10 nodelay;
            limit_req_status 429;
            client_max_body_size 2k;
            proxy_pass http://logging:3000;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
        }

        # Proxy monitoring, including HTTP/1.1 WebSocket upgrades for live features.
        location /grafana/ {
            proxy_pass http://grafana:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        location /game {
            root /;
            try_files $uri /game/game.html;
        }

        location / {
            add_header 'Cross-Origin-Embedder-Policy' 'require-corp';
            add_header 'Cross-Origin-Opener-Policy' 'same-origin';
            root /usr/share/nginx/html;
            try_files $uri /index.html =404;

            # Disable caching
            add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
            expires off;
        }
    }
}
EOL

  # Rebuild backend images so startup uses the current source, not a stale image.
  docker compose up --detach --build
  docker compose restart nginx

else
  # Initial nginx config
  log "Creating initial nginx configuration for certbot..."
  cat <<'EOL' > nginx.conf
events {}

http {
    include mime.types;
    # Shared per-IP request counters used by the logging endpoint below.
    limit_req_zone $binary_remote_addr zone=visit_logging:10m rate=2r/s;
    
    server {
        listen 80;
        server_name DOMAIN_PLACEHOLDER;

        # Serve certificate validation over HTTP, without requiring an HTTPS redirect.
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
    }
}
EOL

  sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" nginx.conf

  log "Restarting Nginx to pick up initial config..."
  # Rebuild backend images so startup uses the current source, not a stale image.
  docker compose up --detach --build
  docker compose restart nginx
  log "Waiting 3 seconds to give Nginx time to fully start..."
  # Give Nginx time to fully start
  sleep 3

  # Check if SSL certificates already exist
  log "Checking for existing SSL certificate..."
  if ! docker compose run --rm --entrypoint sh certbot -c "ls /etc/letsencrypt/live/$DOMAIN/fullchain.pem" >/dev/null 2>&1; then
    log "No SSL certificate found."
    
    # Check DNS resolution before attempting certbot
    log "Checking if $DOMAIN resolves to this server..."
    RESOLVED_IP=$(dig +short "$DOMAIN" A | tail -1)
    if [ -z "$RESOLVED_IP" ]; then
      log "ERROR: $DOMAIN does not resolve to any IP address."
      log "Please ensure your domain's DNS A record points to this server's IP address."
      exit 1
    fi
    
    log "Domain resolves to: $RESOLVED_IP"
    log "Requesting new SSL certificate from Let's Encrypt..."
    if docker compose run --rm certbot certonly --webroot --webroot-path /var/www/certbot/ --email "$EMAIL" -d "$DOMAIN" --agree-tos --no-eff-email; then
      log "SSL certificate created successfully!"
    else
      log "ERROR: Failed to obtain SSL certificate. Check DNS and firewall settings."
      exit 1
    fi
  else
    log "SSL certificate already exists! Skipping Certbot generation."
  fi

  # Final nginx config
  log "Creating final nginx configuration with SSL..."
  cat <<'EOL' > nginx.conf
events {}

http {
    include mime.types;
    # Shared per-IP request counters used by the logging endpoint below.
    limit_req_zone $binary_remote_addr zone=visit_logging:10m rate=2r/s;
    
    server {
        listen 80;
        server_name DOMAIN_PLACEHOLDER;

        # Serve certificate validation over HTTP, without requiring an HTTPS redirect.
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl;
        server_name DOMAIN_PLACEHOLDER;
        ssl_certificate     /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        # Send downloader requests to its private container, preserving the API path.
        location /api/ {
            # Match the backend form-body limit; preserve visitor IP for per-IP limits.
            client_max_body_size 8k;
            proxy_pass http://downloader:8000;
            proxy_set_header X-Real-IP $remote_addr;
            # Allow long downloads/recordings and stream progress without proxy buffering.
            proxy_read_timeout 24h;
            proxy_buffering off;
        }

        # Limit tiny visit reports; replace client-supplied forwarding headers to prevent spoofing.
        location /logging {
            limit_req zone=visit_logging burst=10 nodelay;
            limit_req_status 429;
            client_max_body_size 2k;
            proxy_pass http://logging:3000;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
        }

        # Proxy monitoring, including HTTP/1.1 WebSocket upgrades for live features.
        location /grafana/ {
            proxy_pass http://grafana:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        location /game {
            root /;
            try_files $uri /game/game.html;
        }

        location / {
            add_header 'Cross-Origin-Embedder-Policy' 'require-corp';
            add_header 'Cross-Origin-Opener-Policy' 'same-origin';
            root /usr/share/nginx/html;
            try_files $uri /index.html =404;

            # Disable caching
            add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
            expires off;
        }
    }
}
EOL

  sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" nginx.conf

  log "Validating and restarting nginx container..."
  # Validate the new on-disk config in a disposable container before restarting Nginx.
  docker compose run --rm --no-deps nginx nginx -t
  docker compose restart nginx

  log "Scheduling certificate renewal twice daily..."
  # A root-only wrapper quotes the absolute script path safely, including spaces.
  printf '#!/bin/bash\nexec /bin/bash %q\n' "$PWD/renew-cert.sh" > /usr/local/sbin/av-converter-renew
  chmod 700 /usr/local/sbin/av-converter-renew
  # Run at 03:15 and 15:15 in the server's timezone; append output to the renewal log.
  echo '15 3,15 * * * root /usr/local/sbin/av-converter-renew >> /var/log/av-converter-certbot.log 2>&1' > /etc/cron.d/av-converter-certbot
  # Permit cron to read the schedule without allowing other users to modify it.
  chmod 644 /etc/cron.d/av-converter-certbot
fi

log "Setup complete."