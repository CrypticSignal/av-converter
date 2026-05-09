#!/bin/bash

set -euo pipefail

DOMAIN="av-converter.com"
EMAIL="theaudiophile@outlook.com"

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
apt-get install -y ca-certificates curl gnupg lsb-release dnsutils

log "Setting up Docker GPG keyring directory..."
install -m 0755 -d /etc/apt/keyrings

log "Downloading Docker GPG key..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | tee /etc/apt/keyrings/docker.asc > /dev/null
chmod a+r /etc/apt/keyrings/docker.asc

log "Adding Docker repository..."
ARCH=$(dpkg --print-architecture)
CODENAME=$(source /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")

echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

log "Updating package lists..."
apt-get update -y

if ! command -v docker &> /dev/null; then
  log "Installing Docker..."
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  log "Docker already installed."
fi

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

curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
log "Installing Node.js..."
apt-get install -y nodejs

log "Installing yarn..."
npm install --global yarn

log "Installing dependencies..."
yarn install

# https://github.com/ffmpegwasm/ffmpeg.wasm/issues/619#issuecomment-2726185799
log "Replacing node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js..."
cp public/ffmpeg_wasm/worker.js node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js

log "Building the project..."
yarn build

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
    
    server {
        listen 80;
        server_name localhost;

        location /ffmpeg_wasm {
            add_header 'Cross-Origin-Embedder-Policy' 'require-corp';
            add_header 'Cross-Origin-Opener-Policy' 'same-origin';
            alias /ffmpeg_wasm/;
            try_files $uri =404;
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

  docker compose up --detach --build
  docker compose restart nginx

else
  # Initial nginx config
  log "Creating initial nginx configuration for certbot..."
  cat <<'EOL' > nginx.conf
events {}

http {
    include mime.types;
    
    server {
        listen 80;
        server_name DOMAIN_PLACEHOLDER;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
    }
}
EOL

  sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" nginx.conf

  log "Restarting Nginx to pick up initial config..."
  docker compose up --detach
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
    
    server {
        listen 80;
        server_name DOMAIN_PLACEHOLDER;

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl;
        server_name DOMAIN_PLACEHOLDER;
        ssl_certificate     /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;

        location /ffmpeg_wasm {
            add_header 'Cross-Origin-Embedder-Policy' 'require-corp';
            add_header 'Cross-Origin-Opener-Policy' 'same-origin';
            alias /ffmpeg_wasm/;
            try_files $uri =404;
        }

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
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

  log "Restarting nginx container..."
  docker compose restart nginx
fi

log "Setup complete."