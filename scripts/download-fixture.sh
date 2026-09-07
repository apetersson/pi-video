#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
mkdir -p fixtures
curl -L --fail --retry 2 -o fixtures/qwen-model-card.mp4 https://qianwen-res.oss-accelerate.aliyuncs.com/Qwen3.5/demo/video/N1cdUjctpG8.mp4
