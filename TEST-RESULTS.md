# Validation — 2026-09-07

Release candidate: **pi-video 0.1.0**, MIT. Publication has not been performed.

## Publication checks

- `npm test`: **20 passed**, no failures or skips, on Node 24.14.0.
- `npm run test:visual`: **5 passed**. The tests reject the old tomb/jar keyword false positives, missing or reversed scenes, incorrect counts, negated descriptions, and incomplete transport evidence.
- `npm run test:pack`: **passed**. The tarball was installed with npm into an empty host and loaded through pi 0.85.0's bundled CLI.
- Packed serializer checks: **4 passed on each of Node 24.14.0 and Node 22.23.2**.
- Packed CLI/extension checks: **4 passed on each of Node 24.14.0 and Node 22.23.2**. The test prompt was consumed before agent startup; no inference ran.

The tarball contains exactly: `LICENSE`, `README.md`, `attachments.mjs`, `capabilities.mjs`, `core.mjs`, `ffmpeg.mjs`, `index.ts`, and `package.json`. Tests, fixtures, sessions, logs, runtime snapshots, credentials, and personal machine paths are excluded. Exact sizes, SHA256, and npm integrity are in `runs/release/pack-report.json`.

## Behavior covered

Explicit video denial overrides positive capability fields, including conflicts within a model and matching endpoint metadata. Another model's capability does not enable the selected model.

Actual pi serializers exercise pipe-separated IDs, long IDs, shared call prefixes, provider/model changes, Responses and Gemini payloads, and Anthropic tool-result content. References survive ID changes without reproducing provider normalization code. Videos follow complete tool-result groups; duplicate reads in one group are deduplicated. Original history and payloads remain unchanged.

The packed TypeScript entry loads through the normal bundled pi CLI and delegates ordinary text and image reads to pi. Hook tests cover selected auth/endpoint routing, both video formats, replay after agent end, text-only and unsupported-API switches, removed history, shutdown, and explicit denial. Missing/changed files, missing ffmpeg, and auth lookup errors yield omission text with no video bytes or temporary markers. Cleanup also preserves native typed-array image payloads.

## Test method and limits

The machine's npm configuration enforces a 14-day minimum release age. Registry installation of pi 0.85.0 (published September 4) and its recent dependencies was refused. The successful clean-host test instead used a disposable bundled snapshot of the already installed pi 0.85.0 runtime and dependency tree, with offline npm installation and lifecycle scripts disabled. No npm policy or installed runtime was changed. This establishes clean installation of the pi-video tarball against the existing trusted runtime, not a fresh registry download of pi under that policy.

Pi 0.85.0's unbundled loader imports an unavailable `@earendil-works/pi-server`; the smoke test uses pi's normal bundled CLI, which supplies the extension API. This upstream SDK packaging issue was not patched or added as a pi-video dependency.

Capability HTTP responses and normalized video bytes were mocked in the new packed checks. These checks verify loading, serialization, hook behavior, and omission paths; they do not establish new model quality or video decoding results. No new live inference or video conversion was run. The live model, launcher, and sampling configuration were untouched.

Current automated verification ran on macOS. The Node minimum of 22.19.0 follows pi's declared engine requirement; the exact 22.19.0 binary was not run. Pi's peer range is `^0.85.0`; the tested version is 0.85.0. Other pi minors, Linux, Windows, and remote video endpoints were not exercised here.

## Prior real-model evidence

The earlier canonical test used the full 86.355-second Qwen model-card video, SHA256 `eb20f82e79f7772edeb608eff50fde844a89e8f71530f9912efd85ba136f13dc`. The real pi read produced a native `input_video` attachment of 1,011,222 normalized bytes. The saved answer described an excavated pit, nine vessels, a flower-and-bird panel, damaged furniture, two coffins, and a carved doorway. Its broad sequence was compared with a contact sheet, which was inspected again during this audit. The stronger six-scene prose validator accepts that saved answer.

The prose validator is a conservative regression heuristic, not independent proof of visual understanding. **The number of jars discovered in chamber niches was not visually established.** No audio was analyzed, and the revised default e2e prompt asks for visible chronological observations instead of an unverified niche-jar answer.

The earlier rotated phone clip passed a real pi read after orientation normalization: the model described a handheld pan across printed cards on dark fabric and identified TUNE TAG. Resuming the saved session rehydrated its video for a follow-up without another read. These are historical tests, not fresh inference results for this packaging revision. Earlier server position warnings remain outside this extension's verified scope.

## Release status

The npm registry returned 404 for `pi-video`; the authenticated GitHub API returned 404 for `apetersson/pi-video`. These checks neither reserve a package name nor prove publishing rights. This directory has no Git repository; no repository was created, and nothing was committed, pushed, or published.

A read-only `npm whoami` returned 401 Unauthorized. Npm authentication must be restored before publishing. Explicit user approval of the exact tarball is also required. GitHub installation is documented conditionally on repository publication. The manifest includes `pi-package` for npm-based catalog discovery.

Runtime limits remain: OpenAI-compatible Chat Completions transport only; visual content without audio; original files up to 256 MiB; normalization to a maximum edge of 640 pixels; original files required for replay. Server-side frame sampling is unchanged and is never overridden by the extension.
