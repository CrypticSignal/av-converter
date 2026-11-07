#!/usr/bin/env python3
"""Update the production server to the latest code: python3 deploy.py (or yarn deploy).

Run it as your normal account (not root) on a server prepared by setup.sh. It stops at
the first failing step; there is no automatic rollback, and active downloads are interrupted.
"""
import os
import subprocess
import sys

COMPOSE = ['docker', 'compose', '-f', 'docker/prod/docker-compose.yml']

STEPS = [
    # Get the latest code. --ff-only refuses to create a merge commit on the server.
    ['git', 'pull', '--ff-only'],
    # Install exactly the versions in yarn.lock.
    ['yarn', 'install', '--frozen-lockfile'],
    # Build the backend images first: if this fails, the live website is left untouched.
    # --pull also fetches newer versions of the images they're based on.
    COMPOSE + ['build', '--pull'],
    # Build the website into build/, which Nginx serves.
    ['yarn', 'build'],
    # Restart any container whose image or config changed, and wait until they're all running.
    COMPOSE + ['up', '--detach', '--remove-orphans', '--wait', '--wait-timeout', '120'],
    # Check the Nginx config, then reload it. Reloading also makes Nginx look up the
    # restarted backend containers' new addresses. (-T: no terminal needed.)
    COMPOSE + ['exec', '-T', 'nginx', 'nginx', '-t'],
    COMPOSE + ['exec', '-T', 'nginx', 'nginx', '-s', 'reload'],
]


def main():
    # Run every command from the project root, wherever this script was started from.
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isfile('downloader-password.env'):
        sys.exit('Set the video downloader password first: python3 set_password.py')
    for command in STEPS:
        print('\n$', ' '.join(command), flush=True)
        if subprocess.run(command).returncode != 0:
            sys.exit('Deployment failed at the step above.')
    print('\nDeployment complete.')


if __name__ == '__main__':
    main()
