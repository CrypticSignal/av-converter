#!/bin/bash

set -euo pipefail

log() {
  local green='\033[0;32m'
  local reset='\033[0m'
  echo -e "${green}$*${reset}"
  echo
}

# Update system packages safely
log "Updating system packages..."
apt-get update -y
apt-get upgrade -y

# -----------------------------------------------------------------------------------------------------------------------------
# Docker installation and setup:

log "Installing prerequisites for Docker..."
apt-get install -y ca-certificates curl gnupg lsb-release

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

log "Removing all stopped containers..."
if [ "$(docker ps -aq | wc -l)" -gt 0 ]; then
  docker rm -f $(docker ps -aq)
else
  log "No containers to remove."
fi

log "Enabling and starting Docker service..."
systemctl enable --now docker

# ------------------------------------------------------------------------------------------------------------------------------

curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
log "Installing Node.js..."
apt-get install -y nodejs

log "Installing yarn..."
npm install --global yarn

log "Installing dependencies..."
yarn install

# https://github.com/ffmpegwasm/ffmpeg.wasm/issues/619#issuecomment-2726185799
log "Replacing node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js..."
cp worker.js node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js

log "Building the project..."
yarn build

cd docker/prod || exit 1

# Initial nginx config
log "Creating initial nginx configuration for certbot..."
cat <<'EOL' > /home/projects/av-converter/docker/prod/nginx.conf
events {}

http {
    include mime.types;
    
    server {
        listen 80;
        server_name av-converter.com;

        location ~ /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
    }
}
EOL

log "Starting docker compose services in detached mode..."
docker compose up --detach

# Uncomment if new SSL certificate is needed
# docker compose run --rm certbot certonly --force-renew --webroot --webroot-path /var/www/certbot/ --email hshafiq@hotmail.co.uk -d av-converter.com --agree-tos --no-eff-email

# Final nginx config
log "Creating final nginx configuration with SSL..."
cat <<'EOL' > /home/projects/av-converter/docker/prod/nginx.conf
events {}

http {
    include mime.types;
    
    server {
        listen 80;
        server_name av-converter.com;

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        listen 443 ssl;
        server_name av-converter.com;
        ssl_certificate     /etc/letsencrypt/live/av-converter.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/av-converter.com/privkey.pem;

        location /ffmpeg_wasm {
            add_header 'Cross-Origin-Embedder-Policy' 'require-corp';
            add_header 'Cross-Origin-Opener-Policy' 'same-origin';
            alias /ffmpeg_wasm/;
            try_files $uri =404;
        }

        location ~ /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location /game {
            root /game;
            try_files $uri /game.html;
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

log "Restarting nginx container..."
docker compose restart nginx

log "Setup complete."