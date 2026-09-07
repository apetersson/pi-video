# pi-video

Read a video file in pi and let the **currently selected model** see it. The extension detects advertised video-input capabilities and attaches native video to the next request in the same conversation. Ordinary text and image reads keep pi's built-in behavior.

## Install

Requires Node.js 22.19.0 or newer, pi 0.85.x, and ffmpeg. The npm peer range is `^0.85.0`; other pi versions have not been validated.

This is a release candidate. The GitHub and npm commands below become usable after their respective publications.

From the intended GitHub repository, once it is published:

```sh
pi install git:github.com/apetersson/pi-video
```

After npm publication, installation will also be available with:

```sh
pi install npm:pi-video
```

Run `/reload` in pi after installation. Publishing to npm with the `pi-package` keyword enables discovery in the [pi package catalog](https://pi.dev/packages). GitHub hosting alone does not add an npm package to that catalog.

## Model capabilities

There is no default endpoint or separate video model. pi-video uses the current model's endpoint, model ID, and authentication. It checks that model's registration and matching entry in the endpoint's `/models` response for video input, for example:

```json
{
  "id": "your-model-id",
  "input_modalities": ["text", "image", "video"]
}
```

The corresponding `input`, `modalities`, `capabilities`, and `architecture.input_modalities` fields are also recognized. An explicit `video: false` in any recognized input-capability field disables video, even when another field advertises video support. Image support alone does not imply video support. Only metadata for the selected model is used; another model advertising video does not enable it for the current model.

Current transport support is **OpenAI-compatible Chat Completions** (`openai-completions` in pi):

- `video_url` with an inline MP4 data URL for compatible endpoints that accept this format.
- `input_video` for llama.cpp, detected through the matching server's `/props` response.

An endpoint can explicitly declare `video_input_format` as `video_url` or `input_video` in its model metadata. Server-side video decoding must actually be enabled. Video-capable models using other API families need additional transport adapters; a capability flag alone cannot make incompatible wire formats work.

When you switch models, capabilities are checked again. Previous video attachments are rehydrated for a compatible selected model, or omitted with a text explanation for an unsupported one. Like other conversation attachments, videos can therefore be sent to a newly selected video-capable provider.

## ffmpeg

Install ffmpeg and make it available on `PATH`:

```sh
# macOS
brew install ffmpeg

# Debian / Ubuntu
sudo apt install ffmpeg

# Windows
winget install Gyan.FFmpeg
```

The extension checks for ffmpeg at startup and gives the appropriate install command if it is missing. Restart pi after installing to pick up your updated `PATH`. `PI_VIDEO_FFMPEG` can override the executable. npm does not currently bundle or silently download ffmpeg.

## Video processing

Video reads normalize orientation, square pixels, H.264/yuv420p, and a maximum edge of 640 pixels. Full duration is preserved, and the original file is untouched. This also avoids a rotation/dimension mismatch in some server decoders. Audio is removed; this extension supplies visual content only, even when the selected model has audio capabilities.

The server controls frame sampling. pi-video does not override the sampling frame rate or send an FPS setting. Defaults and configuration belong to the selected server. The extension does not currently expose a sampling-rate setting. Fine text and small details may need a higher-resolution processing profile, which is not yet configurable.

Original files must be under 256 MiB. Video files support neither line offsets nor line limits. MP4, MOV, M4V, WebM, MKV, and AVI are recognized.

## Sessions and cache

Session history stores the original path, size, and SHA256, not video blobs. The original is validated before sending. Changed or missing files require another read. Native attachments are inserted after complete groups of tool responses, preserving tool-call ordering even when pi changes tool-call IDs during a provider switch. Temporary attachment markers exist only in request context and are removed before transmission.

If rehydration, conversion, authentication lookup, or capability discovery prevents an attachment, its tool result becomes an explicit omission message. The conversation can continue, but the model receives no video from that read; read the file again after resolving the issue.

Normalized videos are cached in `pi-video-v1` under the operating system's temporary directory. Delete that directory to clear the cache. A resumed session can reconstruct it from the original file.

## Development and tests

```sh
npm test
npm run test:visual
npm run test:pack
zsh scripts/download-fixture.sh
PI_VIDEO_TEST_BASE_URL="https://your-server.example/v1" zsh scripts/e2e.sh
```

Run these commands from a source checkout; test scripts are not shipped in the npm tarball. `test:pack` creates the exact tarball, installs it into a fresh temporary npm host, and loads its TypeScript entry through pi 0.85.0. It tests real provider serializers, tool delegation, replay, model switches, and omission paths using mocked capability responses and cached video bytes. It performs no inference. Set `PI_VIDEO_TEST_NODE` to an additional Node executable to repeat the packed serializer and CLI checks on that runtime. Tarballs and reports are saved under `runs/release/` (override with `PI_VIDEO_PACK_DIR`).

The pack test respects npm configuration, including minimum release age. If that policy excludes pi 0.85.0 and you already have that runtime installed, set `PI_VIDEO_TEST_PI_DIR=/path/to/installed/pi-coding-agent` when running `npm run test:pack`. The script copies that runtime and its installed dependencies into a temporary bundled archive and installs both archives offline into the fresh host. It does not modify the installed runtime or npm policy. The report distinguishes this test from a registry installation.

The e2e test uses the real pi CLI with an isolated profile, selects a model from the supplied test endpoint (override with `PI_VIDEO_TEST_MODEL`), and verifies a video-aware read, native payload, and absence of temporary markers. `PI_VIDEO_TEST_API_KEY` supplies test authentication if needed. Test-only environment variables do not configure the extension's runtime endpoint. Test logs and fixtures are excluded from npm distribution.

The canonical fixture is the full 86-second [Qwen model-card video](https://qianwen-res.oss-accelerate.aliyuncs.com/Qwen3.5/demo/video/N1cdUjctpG8.mp4). Its SHA256 is `eb20f82e79f7772edeb608eff50fde844a89e8f71530f9912efd85ba136f13dc`. The canonical prose check requires six distinct observations in order: an excavated pit, nine vessels arranged together, a flower-and-bird panel, damaged furniture, two coffins, and a carved doorway. Counts and related appearance must occur within the same observation; bare keywords and negated claims do not pass. This is a regression heuristic, not independent proof of model understanding. The saved original answer was compared with a contact sheet; the more specific question about jars discovered inside niches was not visually established, and audio was not analyzed.

## License

[MIT](LICENSE).
