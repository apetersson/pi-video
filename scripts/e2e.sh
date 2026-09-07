#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
: "${PI_VIDEO_TEST_BASE_URL:?Set PI_VIDEO_TEST_BASE_URL to the test model endpoint}"
export PI_CODING_AGENT_DIR="$PWD/runs/test-agent"
export PI_OFFLINE=1
mkdir -p runs
node --test test/*.test.mjs > runs/unit.log 2>&1
python3 scripts/setup-test.py
model="$(cat runs/model-id.txt)"
video="${PI_VIDEO_TEST_FILE:-$PWD/fixtures/qwen-model-card.mp4}"
question="${PI_VIDEO_TEST_QUESTION:-Describe the main visible scenes in chronological order as a numbered list. Include concrete appearance and any clearly countable groups. Distinguish visible evidence from anything you cannot determine. Audio is unavailable.}"
: > runs/transport.jsonl
pi -e ./index.ts -e ./scripts/test-settings.ts --provider video-test --model "$model" --tools read --no-skills --no-prompt-templates --mode json -p "Use read on $video. $question" > runs/current-pi.jsonl 2> runs/current-pi.stderr
python3 scripts/verify-e2e.py
