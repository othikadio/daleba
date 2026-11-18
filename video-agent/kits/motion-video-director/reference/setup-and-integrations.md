# Setup and optional integrations

## Core environment
Run `scripts/preflight.py` from the project using a verified Python 3.10+ interpreter. This is a stdlib-only, read-only check; Node/Chromium/FFmpeg and optional audio packages are reported independently. A missing optional tool is not an error that requires installing everything.

For code video rendering: use compatible Node + renderer dependencies, Playwright/Chromium (or an already working capture path), FFmpeg and ffprobe. For simple footage assembly FFmpeg may be enough. Select a pipeline before asking to install anything. Prefer existing compatible versions and lock files. Use a project-local Node stack when no authorized shared toolkit exists.

For procedural sound: NumPy + SciPy. For waveform analysis: librosa + soundfile. With permission create a separate audio venv and install only those packages initially. Models/PyTorch are not required for baseline SFX use. Record versions after testing; don't claim arbitrary latest packages have been tested together. Optional CLAP/PANNs require the specific local-model prerequisites described in the sound guide. CoNeTTE is experimental/manual and can be skipped.

Typical consented setup commands, not automatic actions:
```text
python -m venv .venv-audio
<venv-python> -m pip install numpy scipy librosa soundfile
```
`<venv-python>` is `.venv-audio/Scripts/python.exe` on Windows or `.venv-audio/bin/python` on macOS/Linux. Quote executable paths. Audio ML dependencies may support a narrower Python range; resolve that before installing rather than forcing them into the user's renderer environment.

## First interaction
Give a short explanation of the selected workflow and ask only for missing essentials. If the user has a project and feedback, resume directly; don't repeat a 300-word onboarding message. Start with references, story/length, aspect ratio and existing narration if known. Explain that references inform technique, not unlicensed copying. Do not promise cinematic quality from a framework alone.

For narrated work, receive the user's final recorded/generated file before timing production; guide tracks need explicit approval. A particular paid TTS service is not required. Follow project-specific approval waivers and constraints rather than always restarting approval gates.

## Optional connections
Read `reference/mcp-setup.md` only to configure a chosen integration. Firecrawl can support research, Playwright browser automation can acquire permitted assets, and stock/Lottie services may help when needed. Use native tools available to the agent; do not assume every runtime exposes these MCPs. Authentication is user-specific and is never part of a redistributed package.

New SFX generation uses ElevenLabs’ API; read `reference/elevenlabs-sfx.md`. Each buyer supplies their own securely configured key and approves credit-consuming requests. Reference analysis and mixing remain local with optional CLAP/PANNs and experimental/manual CoNeTTE. Existing licence-clear sounds and procedural recipes remain fallbacks; no local generative audio model is required. External source discovery/downloads are distinct from hosted inference and still require source/licence checks and any needed user authorization.

## Credentials and private data
Only create a `.env` when a chosen optional service needs it. `create_env.py` and `normalize_env.py` are convenience utilities, not mandatory setup. Request only relevant keys; never print values, commit `.env` or package a local config/inventory. Users should enter secrets through their agent's supported secure mechanism. Prefer existing authenticated integrations where available.

Use official asset pages and licence records. Do not bypass sign-in, payment, download restrictions or rights. A public preview can be lossy and may have a different delivery format from a purchased/lossless master; label the actual source honestly.

### Helper checks and rendering starter
Preflight verifies command exit status and reports Node >=18, Python >=3.10, optional ImageMagick, the selected project/toolkit Playwright package and whether its Chromium executable exists. Browser file presence is not a successful launch/GPU test: run the bundled starter smoke test. A missing optional audio package or ImageMagick does not require an installation. No network or browser launch occurs during preflight.

Use `templates/render/` only for a new project without a working renderer; see planning-and-tracking.md. Copy the directory to project `src/`, set package.json `type` to `module`, and reuse or explicitly authorize compatible Playwright/Chromium setup. No automatic `npx` downloads. `MVD_CHROMIUM` may point to an existing authorized browser; matching/default Chromium remains preferable.
