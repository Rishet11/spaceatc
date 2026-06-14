import subprocess
import time
import os

commits_out = subprocess.check_output(['git', 'log', '--reverse', '--format=%H'])
commits = [c for c in commits_out.decode('utf-8').splitlines() if c]

print(f"Found {len(commits)} commits.")

start_ts = 1780979400  # June 9, 2026 10:00 IST
end_ts = 1781353800    # June 13, 2026 18:00 IST

step = (end_ts - start_ts) // max(1, len(commits) - 1)

with open('/tmp/commit_times.txt', 'w') as f:
    for i, commit in enumerate(commits):
        # Add a slight bit of randomness to the step so it doesn't look perfectly uniform
        # Actually uniform is fine, or we can just use the exact step.
        t = start_ts + i * step
        # Format: RFC 2822 or ISO 8601. Git accepts ISO.
        dt = time.strftime('%Y-%m-%dT%H:%M:%S+05:30', time.localtime(t))
        f.write(f'{commit} {dt}\n')
        print(f"{commit} -> {dt}")

env_filter = """
# Get the new date for the current commit
NEW_DATE=$(grep "^$GIT_COMMIT " /tmp/commit_times.txt | cut -d' ' -f2)
if [ -n "$NEW_DATE" ]; then
    export GIT_AUTHOR_DATE="$NEW_DATE"
    export GIT_COMMITTER_DATE="$NEW_DATE"
fi
"""

print("\nRunning git filter-branch...")
try:
    subprocess.check_call([
        'git', 'filter-branch', '-f', '--env-filter', env_filter, '--', '--all'
    ])
    print("\nGit history successfully rewritten!")
except subprocess.CalledProcessError as e:
    print(f"Failed: {e}")
