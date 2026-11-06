"""Exercise deployment with local Git repositories and a fake Yarn; no server needed."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('deploy.sh').resolve()


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'server'
        self.remote = self.root / 'remote.git'
        self.run_cmd('git', 'init', '--bare', str(self.remote))
        self.run_cmd('git', 'clone', str(self.remote), str(self.repo))
        self.run_cmd('git', 'checkout', '-b', 'master', cwd=self.repo)
        self.run_cmd('git', 'config', 'user.name', 'Test', cwd=self.repo)
        self.run_cmd('git', 'config', 'user.email', 'test@example.invalid', cwd=self.repo)
        (self.repo / 'tracked').write_text('initial')
        self.commit = self.push_commit('Initial')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        yarn = self.bin / 'yarn'
        yarn.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$YARN_LOG"\nexit "${YARN_EXIT:-0}"\n')
        yarn.chmod(0o755)
        self.log = self.root / 'yarn.log'

    def run_cmd(self, *args, **kwargs):
        return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs).stdout.strip()

    def push_commit(self, message):
        self.run_cmd('git', 'add', 'tracked', cwd=self.repo)
        self.run_cmd('git', 'commit', '-m', message, cwd=self.repo)
        self.run_cmd('git', 'push', 'origin', 'master', cwd=self.repo)
        return self.run_cmd('git', 'rev-parse', 'HEAD', cwd=self.repo)

    def deploy(self, commit=None, **extra):
        env = {**os.environ, 'PATH': f'{self.bin}:{os.environ["PATH"]}', 'YARN_LOG': str(self.log), **extra}
        return subprocess.run(['bash', str(SCRIPT), commit or self.commit, str(self.repo)],
                              env=env, capture_output=True, text=True)

    def test_deploys_exact_commit_and_installs_before_deploying(self):
        old = self.commit
        (self.repo / 'tracked').write_text('tested update')
        self.commit = self.push_commit('Tested update')
        self.run_cmd('git', 'checkout', '--detach', old, cwd=self.repo)
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.run_cmd('git', 'rev-parse', 'HEAD', cwd=self.repo), self.commit)
        self.assertEqual(self.log.read_text().splitlines(), ['install --frozen-lockfile', 'deploy-all'])

    def test_superseded_commit_does_not_deploy(self):
        (self.repo / 'tracked').write_text('newer')
        latest = self.push_commit('Newer')
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Skipping superseded', result.stdout)
        self.assertFalse(self.log.exists())
        self.assertEqual(self.run_cmd('git', 'rev-parse', 'HEAD', cwd=self.repo), latest)

    def test_preserves_local_edits(self):
        (self.repo / 'tracked').write_text('local edit')
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())
        self.assertEqual((self.repo / 'tracked').read_text(), 'local edit')

    def test_failed_install_stops_before_deployment(self):
        result = self.deploy(YARN_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.log.read_text().splitlines(), ['install --frozen-lockfile'])

    def test_rejects_invalid_commit(self):
        self.assertNotEqual(self.deploy(commit='master').returncode, 0)
        self.assertFalse(self.log.exists())

    def test_server_lock_prevents_overlap(self):
        import fcntl
        with (self.repo / '.git' / 'deploy.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Another deployment is running', result.stderr)
        self.assertFalse(self.log.exists())
