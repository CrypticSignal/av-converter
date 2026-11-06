# Production notes

## Production updates

On an already provisioned server, run `yarn deploy-all` or `python3 deploy.py`.
Python 3.12+, Node.js 26+, Yarn, Docker Compose v2 with `up --wait` support,
existing TLS certificates, and root `cookies.txt` are required. Use `setup.sh`
for initial VPS provisioning. Direct Python invocation works from any directory.

The script installs locked frontend dependencies, builds backend images with
`--pull`, builds the frontend, starts Nginx and its dependencies, and validates
and reloads Nginx. Certbot renewal remains a separate scheduled task. `--pull`
refreshes build base images, not standalone Nginx/Grafana/Loki images.

Commands stop on failure; there is no automatic rollback. The frontend is built
into the live `build/` directory, and backend recreation interrupts downloads.
Startup waiting checks container state, not application readiness. Check the site
and downloader after deployment.

## YouTube cookies

For private, access-controlled deployments, a Netscape-format cookie export can help with YouTube sign-in challenges. **Cookies are login credentials:** never commit them, expose them to visitors, or use a personal session on a public downloader. Sessions can expire or fail to authenticate.

Production Docker requires `cookies.txt` in the project root. Create it before starting the service and make it readable by the container's `downloader` user, using restrictive permissions. It is mounted read-only, not included in the image. After adding or replacing it, run:

```sh
docker compose -f docker/prod/docker-compose.yml up -d --build downloader
docker compose -f docker/prod/docker-compose.yml exec -T nginx nginx -s reload
```

## Downloader configuration

Behind Nginx, the backend reads the visitor's address from `X-Real-IP`, which it accepts only from private or loopback addresses.

Production Docker limits the downloader to two CPUs and 2 GiB of memory, and keeps its port private.

