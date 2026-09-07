"""Transport checks and a conservative scene-description regression heuristic.

Matching prose is not independent proof of visual understanding. Compare frames
manually when changing fixtures or evaluating model quality.
"""
import hashlib
import json
import os
import re
from pathlib import Path

CANONICAL_SHA256 = 'eb20f82e79f7772edeb608eff50fde844a89e8f71530f9912efd85ba136f13dc'
SCENES = [
    ('excavated earthen pit', [r'\b(?:excavat\w*|earthen)\b', r'\bpit\b']),
    ('nine vessels arranged together', [r'\b(?:row|arrang\w*|group)\b', r'\b(?:nine|9)\b.{0,80}\b(?:jars?|vessels?)\b']),
    ('painted panel with flowers and a bird', [r'\b(?:panel|wood\w*)\b', r'\b(?:flowers?|floral|blossoms?)\b', r'\b(?:bird|pheasant|peacock)\b']),
    ('damaged furniture', [r'\b(?:collaps\w*|damag\w*|broken|fragments?|decay\w*)\b', r'\b(?:furniture|chairs?|tables?)\b']),
    ('two coffins', [r'\b(?:two|2|pair of)\b.{0,50}\bcoffins?\b']),
    ('carved stone doorway', [r'\b(?:carved|stone)\b', r'\b(?:doorway|portal|doors?)\b']),
]
NEGATION = re.compile(r"\b(?:no|not|never|without|cannot|can't|unable|neither)\b")


def validate_canonical(text):
    # Require distinct, ordered observations with related attributes/counts.
    # A noun inventory, a refusal, or mentions copied from the question do not pass.
    segments = [part.strip().lower().replace('**', '') for part in re.split(r'\n+|(?<=[.!?])\s+', text) if part.strip()]
    previous = -1
    matched = []
    for name, patterns in SCENES:
        candidates = [index for index, segment in enumerate(segments)
                      if index > previous and not NEGATION.search(segment)
                      and all(re.search(pattern, segment) for pattern in patterns)]
        assert candidates, f'Missing ordered canonical scene evidence: {name}'
        previous = candidates[0]
        matched.append(name)
    return matched


def validate_run(rows, transport, canonical=False):
    reads = [row for row in rows if row.get('type') == 'tool_execution_end' and row.get('toolName') == 'read']
    assert any(not row.get('isError') and row.get('result', {}).get('details', {}).get('piVideo', {}).get('version') == 1
               for row in reads), 'No successful video read'
    answers = [row['message'] for row in rows if row.get('type') == 'message_end' and row.get('message', {}).get('role') == 'assistant']
    assert answers, 'No final assistant message'
    final = answers[-1]
    assert final.get('stopReason') == 'stop', 'Assistant did not finish successfully'
    text = ' '.join(block.get('text', '') for block in final.get('content', []) if block.get('type') == 'text')
    assert text.strip(), 'Empty answer'
    assert transport and all(row.get('markers') is False for row in transport), 'Missing marker-cleanup evidence or a marker leaked'
    assert any(row.get('videos') == 1 and len(row.get('videoBytes', [])) == 1 and row['videoBytes'][0] > 1000
               and row.get('formats') in (['input_video'], ['video_url']) for row in transport), 'No native video payload observed'
    if canonical:
        validate_canonical(text)
    return text


def main():
    root = Path(__file__).resolve().parent.parent
    canonical = not os.environ.get('PI_VIDEO_TEST_FILE')
    if canonical:
        digest = hashlib.sha256((root / 'fixtures/qwen-model-card.mp4').read_bytes()).hexdigest()
        assert digest == CANONICAL_SHA256, 'Canonical fixture checksum mismatch'
    rows = [json.loads(line) for line in (root / 'runs/current-pi.jsonl').read_text().splitlines()]
    transport = [json.loads(line) for line in (root / 'runs/transport.jsonl').read_text().splitlines()]
    validate_run(rows, transport, canonical)
    print('PASS: actual pi video read, native transport, and no temporary markers')
    if canonical:
        print('PASS: six ordered canonical scene checks (prose heuristic; no niche-jar answer or audio claim)')


if __name__ == '__main__':
    main()
