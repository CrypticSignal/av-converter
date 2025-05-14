#!/bin/bash

apt-get update && apt-get upgrade -y

# -----------------------------------------------------------------------------------------------------------------------------
# Docker:

# Add Docker's official GPG key
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update

# Install Docker packages if not already installed
if ! command -v docker &> /dev/null; then
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "Docker is already installed."
fi

systemctl enable --now docker
# ------------------------------------------------------------------------------------------------------------------------------
apt-get install -y npm
npm install --global yarn

git clone https://github.com/CrypticSignal/av-converter.git
cd av-converter/frontend
yarn install && yarn build
cd ../docker/prod

# Initial nginx config
cat <<EOL > /home/projects/av-converter/docker/prod/nginx.conf
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

docker compose up --detach
docker compose run --rm certbot certonly --force-renew --webroot --webroot-path /var/www/certbot/ --email hshafiq@hotmail.co.uk -d av-converter.com --agree-tos --no-eff-email

# Final nginx config
cat <<EOL > /home/projects/av-converter/docker/prod/nginx.conf
events {}

http {
    include mime.types;

    server {
        listen 80;
        server_name av-converter.com;

        location / {
            return 301 https://\$host\$request_uri;
        }
    }

    server {
        listen 443 ssl;
        server_name av-converter.com;
        ssl_certificate     /etc/letsencrypt/live/av-converter.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/av-converter.com/privkey.pem;

        location / {
            root /usr/share/nginx/html;
            try_files \$uri /index.html =404;
            add_header 'Cross-Origin-Embedder-Policy' 'require-corp';
            add_header 'Cross-Origin-Opener-Policy' 'same-origin';
        }

        location /api {
            proxy_pass http://backend:8080;
        }

        location /game {
            root /game;
            try_files \$uri /game.html;
        }

        location ~ /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
    }
}
EOL

docker compose restart nginx

echo "Showing running containers..."
docker ps