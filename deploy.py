#!/usr/bin/env python3
"""Update an existing production installation with python3 deploy.py."""

from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def run(*command):
    print(f'$ {shlex.join(command)}', flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def compose(*arguments):
    run('docker', 'compose', '-f', 'docker/prod/docker-compose.yml', *arguments)


def main():
    if not (ROOT / 'cookies.txt').is_file():
        raise FileNotFoundError('cookies.txt must exist in the project root before deployment.')
    compose('config', '--quiet')
    run('yarn', 'install', '--frozen-lockfile', '--non-interactive')

    # Build images first: a failed image build must not replace live frontend assets.
    compose('build', '--pull')
    run('yarn', 'build')

    # Nginx starts its Compose dependencies, without starting the one-off Certbot service.
    compose('up', '-d', '--remove-orphans', '--wait', '--wait-timeout', '120', 'nginx')
    compose('exec', '-T', 'nginx', 'nginx', '-t')
    # Refresh upstream addresses after backend containers are recreated.
    compose('exec', '-T', 'nginx', 'nginx', '-s', 'reload')
    print('Deployment commands completed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f'Deployment failed: {exc}', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
