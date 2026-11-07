#!/bin/bash
# First-time setup of an Ubuntu server. Run it from your normal account:
#
#   sudo bash setup.sh            # HTTPS for $DOMAIN, with a Let's Encrypt certificate
#   sudo bash setup.sh --local    # HTTP only, e.g. to try it out on a local machine
#
# It is safe to run again. To update an existing server, use deploy.py instead.

# Stop at the first failing command, unset variable or failing pipe.
set -euo pipefail

DOMAIN="av-converter.com"
EMAIL="theaudiophile@outlook.com"   # Let's Encrypt sends certificate expiry warnings here.

# Print a step's description in green.
log() { echo -e "\n\033[0;32m$*\033[0m"; }

# Installing packages and changing the firewall need root, but the app is built as
# your own account, so you can run deploy.py later without sudo.
if [[ $EUID -ne 0 || -z "${SUDO_USER:-}" || "$SUDO_USER" == root ]]; then
  echo "Run this with sudo from your normal account: sudo bash setup.sh" >&2
  exit 1
fi
APP_USER="$SUDO_USER"

# Work from the project root, wherever the script was started from.
cd "$(dirname "$0")"

# ---------------------------------------------------------------------------------------
log "Updating system packages..."
# Never stop to ask questions (e.g. about changed config files).
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
# curl downloads the Node.js installer; cron runs the boot-time firewall rules and certificate renewal.
apt-get install -y curl cron iptables

# ---------------------------------------------------------------------------------------
log "Installing Docker..."
# Skip if Docker is already installed (possibly from Docker's own packages, which would conflict).
if ! command -v docker >/dev/null; then
  apt-get install -y docker.io docker-compose-v2
fi
systemctl enable --now docker cron
# Let your account run docker commands. This applies from your next login.
usermod -aG docker "$APP_USER"

# ---------------------------------------------------------------------------------------
log "Opening ports 80 and 443 in the firewall..."
# Insert each rule at the top, so it comes before Oracle Cloud's final "reject everything" rule.
# -C checks whether the rule already exists, so running setup again doesn't add duplicates.
# -w waits if another program (such as Docker) is changing the firewall at the same moment.
for port in 80 443; do
  iptables -w -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
    iptables -w -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
# iptables rules are lost on reboot, so add them again at every boot.
cat > /etc/cron.d/av-converter-firewall <<'EOF'
@reboot root /usr/sbin/iptables -w -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || /usr/sbin/iptables -w -I INPUT 1 -p tcp --dport 80 -j ACCEPT
@reboot root /usr/sbin/iptables -w -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || /usr/sbin/iptables -w -I INPUT 1 -p tcp --dport 443 -j ACCEPT
EOF
log "Remember to also allow TCP ports 80 and 443 in your cloud provider's firewall (e.g. Oracle Cloud's security list)."

# ---------------------------------------------------------------------------------------
log "Installing Node.js and Yarn..."
# Ubuntu's own Node.js package is too old, so use NodeSource's.
curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
apt-get install -y nodejs
npm install --global yarn

log "Building the website..."
# Build as your account, not root, so later deploys can overwrite these files.
mkdir -p node_modules build
chown -R "$APP_USER:" node_modules build
runuser -u "$APP_USER" -- yarn install --frozen-lockfile
runuser -u "$APP_USER" -- yarn build

# The downloader container needs this file. An empty one means anonymous downloads (see the README).
if [[ ! -f cookies.txt ]]; then
  echo "# Netscape HTTP Cookie File" > cookies.txt
  chown "$APP_USER:" cookies.txt
fi

# The downloader needs a password. Change it later with: python3 set_password.py
if [[ ! -f downloader-password.env ]]; then
  log "Choose a password for the video downloader..."
  python3 set_password.py
  chown "$APP_USER:" downloader-password.env
fi

# ---------------------------------------------------------------------------------------
cd docker/prod

if [[ "${1:-}" == "--local" ]]; then
  log "Starting the site over HTTP (local mode)..."
  # NGINX_CONF picks the Nginx config file; see the nginx service in docker-compose.yml.
  NGINX_CONF=nginx-http.conf docker compose up --detach --build --wait
  log "Setup complete: http://localhost"
  exit 0
fi

# Let's Encrypt proves you own the domain by fetching a file from it over HTTP,
# so the first certificate is requested while Nginx serves plain HTTP.
if ! docker compose run --rm --entrypoint test certbot -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
  log "Getting a TLS certificate for $DOMAIN (its DNS must already point at this server)..."
  NGINX_CONF=nginx-http.conf docker compose up --detach --build --wait
  docker compose run --rm certbot certonly --webroot --webroot-path /var/www/certbot \
    --domain "$DOMAIN" --email "$EMAIL" --agree-tos --no-eff-email
fi

log "Starting the site over HTTPS..."
# Recreates Nginx with the HTTPS config (nginx.conf).
docker compose up --detach --build --wait

log "Scheduling certificate renewal..."
# Certificates last 90 days; certbot only renews them in their last 30, so running it twice a day is cheap.
echo "15 3,15 * * * root /bin/bash \"$PWD/renew-cert.sh\" >> /var/log/av-converter-certbot.log 2>&1" \
  > /etc/cron.d/av-converter-certbot

log "Setup complete: https://$DOMAIN"
log "Log out and back in before running docker commands as $APP_USER."
