# Narration scripting and timing

Recorded speech or any user-chosen TTS provider is acceptable. The following ElevenLabs-specific examples apply only when that provider is chosen; verify its current supported models/options rather than assume a named model exists. Final timing uses the supplied audio, not estimated word budgets.

> Detailed production guidance: load only for the current task. The SKILL.md entrypoint and current customer/project instructions take precedence. Section numbers below refer to this production manual; use the entrypoint guide table to locate a different topic. Do not assume any installed tool, private library, universal approval or specific narration provider.

## 10. ElevenLabs voiceover

- Model: **Eleven v4** (or v3) for expressive VO; Multilingual v2 for stable long reads/PVCs where needed.
- **v3/v4: no SSML `<break>`**. Use punctuation: `…` hesitation, `—` short pause, line breaks, short sentences. `<break time="1.0s"/>` only on older models (≤3 s, sparingly).
- **Audio tags** in square brackets before/after a line: `[excited]` `[whispers]` `[sighs]` `[laughs]` `[curious]` `[sarcastic]` `[thoughtful]` `[surprised]` `[warmly]` `[dramatically]` `[impressed]` `[frustrated sigh]`; be explicit (`[low, gravelly voice]`) so tags aren't read as sound effects. Avoid SFX tags (`[applause]`) in VO.
- Tags must fit the voice's character; test 2–3 takes. CAPS = emphasis (sparingly). Write naturally, like a script.
- **Pronunciation:** v4 IPA in slashes `/ˈnoʊʃən/`; or alias/phoneme pronunciation dictionaries for brand names/acronyms. Spell numbers/units as spoken when unsure.
- Generate per scene/paragraph (easier retakes, layering), keep same voice + settings; adjust `speed` instead of rewriting; remove any spoken stage directions in post.
- Example: `[warmly] Most teams lose hours every week… [curious] but what if that just — stopped? [excited] Meet Flow.`

### 10a. Writing the paste-ready ElevenLabs script (deliverable before any build)

**Length → word budget** (natural VO ≈ 2.3–2.6 words/s; leave ≈ 1.5 s at the end for logo/CTA hold):
| Video | Words (VO) | Lines |
|---|---|---|
| 15 s | 30–38 | 4–6 |
| 30 s | 65–75 | 8–12 |
| 45 s | 100–110 | 12–16 |
| 60 s | 135–150 | 16–22 |
| 90 s | 200–220 | 24–32 |
Count the words in the paste block (tags excluded) and state the estimate: `≈ 142 words ≈ 58 s at 2.45 w/s`.

**Writing rules**
- One idea per line; short sentences (≤ 14 words). Line breaks = natural breath pauses; `…` = hesitation; `—` = short beat. Empty line = longer pause between sections.
- Hook in the first line (≤ 3 s, ≤ 8 words). CTA = last line, word-for-word what appears on screen.
- Write numbers, units, symbols, acronyms and URLs **as spoken**: "twenty-four seven", "three x faster", "A-I", "dot com". No emojis, hashtags, markdown, bullets or stage directions in the paste block.
- Tags: max 1 per 1–2 lines, only where the emotion changes; match the voice's character. CAPS on 1 word per section max.
- Brand names/odd words: give an alias spelling ("Notion" → "NOH-shun") or v4 IPA `/ˈnoʊʃən/`, or tell the user to add it to a pronunciation dictionary.
- Model-specific: v3/v4 → punctuation + tags, no `<break>`. Multilingual v2 / Turbo / Flash → no audio tags (they get read aloud); use `<break time="0.6s"/>` sparingly instead.
- Keep on-screen keywords (for kinetic type) in a separate list, not in the paste block.

**Deliver exactly this format:**
````
## VO script – <project> (v1)
Target: 60 s · ≈ 142 words ≈ 58 s
Model: Eleven v3 (or v4)      Voice: <library voice name or description, e.g. "deep, calm male narrator, documentary, American">
Settings: Stability 40–50 % (Natural) · Similarity 75 % · Style 0–20 % · Speed 1.0 · Speaker boost on
Export: MP3 44.1 kHz 192 kbps (mp3_44100_192) · one file for the whole script (or one per section if marked)

--- PASTE INTO ELEVENLABS (copy everything between the lines) ---
[thoughtful] Nobody drew this.
Not one line… not one frame.

[curious] So where did it come from?
…
[warmly] Start yours today — link below.
--- END ---

On-screen keywords: NOBODY · DREW · THIS · …
Pronunciation notes: …
Alt hook (variant B): …
````
Also give a **variant B** of the hook (and CTA if useful) so the user can A/B pick.

**Tell the user how to generate it:** open elevenlabs.io → Text to Speech → choose the model and voice → set the settings → paste the block → Generate 2–3 takes → download the best as MP3 → send it to you / put it in `assets/vo/vo_v1.mp3`. If one line sounds wrong, regenerate only that line (paste it alone with the same settings) and send it as `vo_line07_fix.mp3` — you'll splice it on a pause. Don't edit the text after approval without telling you (timing and captions come from it).
