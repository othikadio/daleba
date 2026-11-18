# Portable setup and path resolution

Use the installed skill location as `<skill>` and the chosen working folder as `<project>`. Do not infer either from the author's machine. No private toolkit, library, model environment or customer configuration is shipped.

## Configuration precedence
- For models: explicit `--models-dir` → `MVD_MODELS` → `models_dir` in config → `~/.cache/motion-video-director/models`.
- For SFX: `MVD_SFX_LIBRARY` → `sfx_library` in config → project `<project>/assets/sfx`.
- Other overrides: `MVD_AUDIO_PYTHON`, `MVD_TOOLKIT`, `MVD_FFMPEG`, `MVD_FFPROBE`, corresponding to config keys `audio_python`, `toolkit_dir`, `ffmpeg`, `ffprobe`.
- Config: `MVD_CONFIG` → `<project>/.mvd/config.json`. Relative paths inside config resolve from the parent of its containing directory (normally the project root). Use an absolute path when storing config elsewhere. `~` and environment variables expand locally. An invalid explicit override should be fixed, not silently replaced by an author's path.
- Config does not activate/re-execute a Python environment automatically. Use `audio_python` as the quoted interpreter for audio commands and run the inventory with it. Avoid logging config or inventories in a customer distribution.

Example config (copy `config.example.json`, customize locally):
```json
{"models_dir":"~/.cache/motion-video-director/models","audio_python":null,"toolkit_dir":null,"sfx_library":null,"ffmpeg":null,"ffprobe":null}
```
Leave `sfx_library` null to use project-local `assets/sfx` if the customer supplies sounds. No audio collection is included. For custom sounds, use a project-relative path or absolute local library and keep its catalog/provenance. User decisions belong in that project, not in the shared vendor pack.

## Windows
Use `py -3` or the verified selected interpreter. Quote all paths. A new audio venv, if needed and authorized, may be created with `py -3 -m venv .venv-audio`; invoke `.venv-audio\Scripts\python.exe` explicitly. Configure paths locally. Do not assume a drive letter, Node junction or NVIDIA CUDA.

## macOS / Linux
Use a supported `python3` with venv support. With permission, `python3 -m venv .venv-audio`; use `.venv-audio/bin/python`. Install FFmpeg through the user's trusted package manager if missing. Reuse working Node/Chromium versions. CPU audio is the baseline; Apple MPS/CUDA/ROCm acceleration is opt-in only after compatibility testing. Shared Node dependencies are optional; project-local dependencies are the simplest portable fallback.

## What works without optional models
Read-only preflight, project planning, FFmpeg reference analysis/capture/encoding (once FFmpeg exists), selection from customer-supplied licensed SFX, deterministic cue/mix planning, and procedural recipes when NumPy/SciPy are installed. Core scripts do not install models or require audio API keys. CLAP/PANNs tags and CoNeTTE captions are optional capabilities with explicit unavailable fallbacks.

## Reproduction boundary
A portable file layout is not evidence of a full renderer/inference test on every OS. See the release validation for actual tested combinations. The agent must still inspect local versions and ask permission before resolving missing dependencies. Do not silently upgrade shared packages or download all optional tools.

## ElevenLabs generation
New SFX generation is hosted via ElevenLabs after approval, while analysis/editing/mixing stay local. The stdlib helper needs no local generative model or GPU; credentials use `ELEVENLABS_API_KEY` in the customer environment, never portable config or the distributed package. Run the no-argument helper for an offline plan; read `reference/elevenlabs-sfx.md` before paid requests.
