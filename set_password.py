#!/usr/bin/env python3
"""Set or change the video downloader's password: python3 set_password.py

Saves only the password's SHA-256 hash, in downloader-password.env in the project root
(never committed). If the production downloader is running, it's restarted so the new
password applies straight away.
"""
import getpass
import hashlib
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
PASSWORD_FILE = ROOT / 'downloader-password.env'
COMPOSE = ['docker', 'compose', '-f', str(ROOT / 'docker/prod/docker-compose.yml')]


def main():
    password = getpass.getpass('New downloader password: ')
    if not password:
        sys.exit('The password cannot be empty.')
    if getpass.getpass('Repeat it: ') != password:
        sys.exit('The passwords did not match.')
    digest = hashlib.sha256(password.encode()).hexdigest()
    # Readable only by you, as it's enough to test password guesses against.
    file = os.open(PASSWORD_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with open(file, 'w') as output:
        output.write(f'DOWNLOADER_PASSWORD_SHA256={digest}\n')
    print(f'Saved the password hash in {PASSWORD_FILE.name}.')

    # Docker Compose reads the file when it creates the container, so restart a running one.
    try:
        running = subprocess.run(COMPOSE + ['ps', '--quiet', 'downloader'], capture_output=True, text=True)
    except FileNotFoundError:  # No Docker, e.g. running locally without it.
        return
    if running.returncode == 0 and running.stdout.strip():
        subprocess.run(COMPOSE + ['up', '--detach', '--wait', 'downloader'], check=True)
        print('Restarted the downloader with the new password.')


if __name__ == '__main__':
    main()
