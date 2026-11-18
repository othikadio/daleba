# Sound workflow — ElevenLabs generation + local analysis

## Generation route and local fallback
Generate new SFX with ElevenLabs through `reference/elevenlabs-sfx.md` after prompt/credit/privacy approval. Keep reference analysis, candidate ranking, timing, editing and mixing local. No Stable Audio or other local generative model is included or required.

## Baseline: useful without AI models
Use the customer's own licensed SFX library or project-local assets, FFmpeg, and local NumPy/SciPy procedural recipes. Add librosa/soundfile for waveform analysis. Resolve paths using `reference/portability.md`; do not assume a venv, private sound folder or installed models. **No audio samples, original downloads, private catalog or review decisions are bundled.** Basic ticks/pops/swishes can be synthesized locally; realistic Foley needs the customer's licensed source or a permissioned new download.

Use this guide's event-to-sound map. The customer may maintain a relative-path catalog with source/author/licence, quality, processing and hashes. `templates/sfx-catalog.example.json` is an empty catalog plus `reference/sfx-catalog-format.md` documents fields; `scripts/verify_sfx.py` can verify such a catalog when present. Missing custom audio is reported as not configured, not as a verified library. The workflow must still work with procedural candidates or clearly identify the Foley gap. Do not claim that conversion of lossy OGG/MP3 to WAV makes it a lossless master. Do not use audio from a private reference without rights.

Optional free-source discovery, only if the customer authorizes it: Kenney (https://kenney.nl/assets/interface-sounds and https://kenney.nl/assets/ui-audio) or individually licence-verified Freesound recordings (https://freesound.org/). Check actual asset terms and download quality, retain source/creator/licence and audition before use. This is guidance, not a bundled library or downloader. Never copy the publisher's personal collection into a customer package.

## Optional model capabilities
| Tool | Use | Requirements / limitation |
|---|---|---|
| ElevenLabs Sound Effects API | Default route for new SFX generation | Each buyer’s own key; approved text prompt, request count and credit use. Read `reference/elevenlabs-sfx.md`. No private reference upload or unapproved paid calls. |
| CLAP | Rank candidate audio against scene-specific textual descriptions | Optional complete local `laion/clap-htsat-unfused` snapshot; about 614.53 MB for the previously inspected binary weight, other versions may differ. No model supplied/assumed installed. Scores are similarity, not probability or quality judgments. |
| PANNs Cnn14 | Optional AudioSet clip tags / embeddings | Optional 327,428,481-byte checkpoint and label metadata. Clip-level, not frame-level SED. Official source and restricted loading required below. |
| CoNeTTE | Contextual short-clip captions | **Experimental/manual setup, not needed for baseline sound.** Published inspected checkpoint ~202.63 MB; dependencies/resources extra. No tested inference adapter is shipped. Skip captions unless the local integration is separately installed and verified. No committed delivery date or integration claim. |
| librosa + NumPy/SciPy | Coarse onset candidates, envelopes, RMS, filters, sample math and procedural generation | Check selected audio Python; waveform validation is still necessary. |
| jsfxr / Audacity / Surge XT | Optional procedural synth / manual audition/editing / advanced local synth | Not bundled or assumed installed; no automatic setup. |
| Demucs | Optional music-separation diagnostics only | Four music stems are not a clean SFX track. No dependency for the baseline workflow. |

CPU is the portable starting point; GPU optimization is optional after checking actual support. Keep individual selected checkpoints below 1 GB; total environment, tokenizer resources, cache and RAM can be much larger. Never download just because a tool appears in this table.

## Reference analysis and cue selection
1. Identify visual events and the requested reference windows. Extract original-mix audio; use FFmpeg spectrogram/waveform evidence and librosa onset candidates. Short crops are better than whole-video captions for subtle SFX.
2. Refine coarse onsets against the original waveform; speech/music can trigger false positives. A source peak is not necessarily its perceived contact. Optional Demucs can smear events and put SFX in several music stems; never label drums as all SFX or calculate a reliable SFX/VO ratio from contaminated stems.
3. If locally configured, use CLAP descriptions to rank approved candidates; use PANNs only when class hints help. CoNeTTE captions require separately verified setup. Models do not equal human hearing, source identification certainty or expert taste. Mark unavailable/ambiguous evidence honestly.
4. Fill a cue table: `animation_id / event / frame / sound_id or recipe / source_anchor_sample / gain / pan / tail_end / evidence`. Reuse suitable customer-approved assets first; generate new sounds with consented ElevenLabs requests. Use procedural supporting layers or permissioned licence-clear sources where appropriate, especially if generation is unavailable or real Foley is more suitable. Never copy reference audio into a final without rights.

## Event-to-sound direction
- Hover: one quiet tick when entering a new target, not every frame or while resting.
- Click/model choice: distinct short contact at actual press/selection; optional soft confirmation at a visible checkmark.
- File drag/drop: velocity-shaped movement texture, small pop/body or appropriate material Foley at landing, short settle. Add paper only when motivated; a wooden impact is not verified paper Foley.
- Cards/dropdowns: compact pop/body at expansion, restrained movement envelope, no trailer riser by default.
- Text: 40–150 ms dry ticks/pops on meaningful word groups; a short texture for decoding/typing; slightly stronger hero-word body if appropriate. Don't spam 30 identical clicks per second.
- Camera: soft filtered movement follows acceleration, settles with the camera, no tail after the effect ends. Calm moves can intentionally be silent.
- Real objects: match material/action. Real vegetable chopping needs blade/food contact; a knife-motion swish is not a substitute. Use real pan/sizzle/liquid sounds for recognizable cooking/sips when needed.
- Every meaningful animation needs deliberate coverage, not a sample every frame: shared envelopes, grouped texture and documented silence are valid. Let each project's taste and customer audition override these starting points.

## Procedural recipes and exact timing
`procedural_sfx.py` provides seeded ticks, pops, swishes and small drop bodies with NumPy/SciPy. jsfxr is optional; Surge XT can help more complex layers only after a verified local setup. These tools do not convincingly synthesize every real Foley. Preserve originals and save derived assets plus recipe/processing/seed in the project manifest.

At 30 fps / 48 kHz a frame is 1,600 samples. `target = round(frame * sr / fps)`; `placement = target - source_anchor`. Align the actual transient/contact; don't blindly align file start or loudest peak. Shape/fade tails to the move's end. Cue data and video must share the beat map so retiming stays synchronized.

Keep VO, UI/text, movement, Foley and optional music separate. Mute source recording audio when requested. Mix each cue against actual speech; 5–10 dB under VO is only a starting range, not a universal peak rule. Avoid harsh highs, masking consonants, repetitive samples and long transition tails. A +20% amplitude request means ×1.2 (~+1.58 dB); -20% means ×0.8 (~-1.94 dB), scoped to the requested bus/range. Prevent clipping.

Test mixed range previews before full export: quiet playback, mono, visible actions and speech clarity. A global LUFS measurement does not prove clicks are audible. Use the project's master target (often -14 LUFS integrated / ≤-1.5 dBTP), FFmpeg two-pass loudnorm where appropriate. Don't claim subjective listening when only metrics/models were used. Respect no-music and the customer's render/review directions.

## Optional model setup and safety
The bundled `setup_audio_models.py` prints an **offline plan by default**. It installs no packages. Its implemented download path is **PANNs from the authors' original Zenodo record only**, no mirror fallback. The record publishes 327,428,481 bytes and MD5 `541141fa2ee191a88f24a3219fff024e`; the helper additionally pins SHA256 `0dc499e40e9761ef5ea061ffc77697697f277f6a960894903df3ada000e34b31`, derived from matching bytes checked against that published size/MD5. Metadata source: https://zenodo.org/api/records/3987831 . Attribute Kong et al., DOI 10.5281/zenodo.3987831 (CC-BY-4.0).

Download only after explicit consent, including acknowledgement of legacy pickle format:
```text
python "<skill>/scripts/setup_audio_models.py"
python "<skill>/scripts/setup_audio_models.py" --download panns --allow-downloads --accept-legacy-pth
python "<skill>/scripts/setup_audio_models.py" --verify "<models>/panns/Cnn14_mAP=0.431.pth"
```
This does not deserialize the model. Hashes establish matching bytes, not absolute safety. Never load arbitrary `.pth` files. PANNs inference requires current supported PyTorch (minimum 2.6), restricted `weights_only` loading enforced by the helper runtime, and the expected verified checkpoint. Never retry with `weights_only=False` or disable safety because an older environment fails.

`panns_inference` also expects `~/panns_data/class_labels_indices.csv` and can attempt a legacy download if it is absent. This release guards against that import-time download. Provision the labels separately from the authors' official repository after approval (https://github.com/qiuqiangkong/audioset_tagging_cnn/blob/master/metadata/class_labels_indices.csv), inspect/save provenance, then copy to the package-required local location. Optional PANNs remains unavailable until that step is done. Do not treat it as a clean-machine one-command inference integration.

For CLAP, manually acquire a complete snapshot from the publisher `laion/clap-htsat-unfused` at a reviewed immutable commit, including config, processor/tokenizer files and one supported weight format. Prefer safetensors where the publisher provides compatible files; don't claim every snapshot has them. Preserve revision/hashes; runtime loads local files only, with remote code disabled. No opaque mirror fallback or unsafe pickle bypass. This release does not automate CLAP snapshot acquisition.

For experimental CoNeTTE, review https://github.com/Labbeti/conette-audio-captioning and publisher `Labbeti/conette`; provision a compatible environment and tokenizer/resources after permission. Verify offline inference on short 1–30 s / 32 kHz analysis clips before integrating captions. No tested CLI/adapter or package installation is promised by this release. Fall back to waveform evidence/optional existing CLAP for analysis. Hosted SFX generation is a separate consented ElevenLabs step, not an analysis fallback.

## Commands
Run from the project using its selected audio Python; resolve `<skill>` locally:
```text
python "<skill>/scripts/audio_inventory.py"
python "<skill>/scripts/audio_tag.py" "cache/reference-window.wav" --onsets --json "cache/onsets.json"
python "<skill>/scripts/audio_tag.py" "assets/sfx" --clap --prompts "plan/sfx-descriptions.json" --json "cache/ranks.json"
python "<skill>/scripts/audio_tag.py" "cache/reference-window.wav" --panns --json "cache/tags.json"
python "<skill>/scripts/procedural_sfx.py" pop "cache/pop-test.wav" --duration 0.12 --seed 4
python "<skill>/scripts/verify_sfx.py"
```
Prompt JSON example: `{"dry_click":"a short soft dry interface click","bell":"a ringing metallic bell","swish":"an airy movement swish"}`. Use meaningful contrasts, not similarity as a probability. `--clap` skips implicit PANNs; `--onsets` uses no models. No flags retains legacy PANNs tagging and therefore needs its optional dependencies. Match mode uses PANNs embeddings; an explicit reviewed `--library` path is required.
