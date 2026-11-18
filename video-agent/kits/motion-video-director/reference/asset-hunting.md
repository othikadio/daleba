<!-- Motion Video Director · reference file, loaded on demand from SKILL.md -->
# 16. Visual asset hunting with the Playwright MCP (browse any site, grab assets yourself)

Use this whenever the plan needs an image, texture, photo, footage clip, icon, mockup or style reference that the API MCPs (Pixabay/Unsplash, LottieFiles, Freesound) don't cover well — e.g. Pinterest moodboards, Behance/Dribbble shots, brand sites, product pages, font specimen pages, free texture sites. **Do it yourself; don't ask the user to search.**

**Source order:** (1) API MCPs with clear licenses (Pixabay/Unsplash/Lottie/Freesound) → (2) free-license sites browsed visually (Unsplash web, Pixabay web, textures.com free, brand press kits, the user's own sites/socials) → (3) Pinterest/Behance/Dribbble/any site, mainly for **references and moodboards**, or for final use only when the original source's license allows it.

**Loop (per asset need):**
1. **Write the brief first** (1 line in PROGRESS.md): what, where it's used, style (from `plan/design.html`), aspect/size, and 3–5 search queries (vary wording: "lime green translucent keycap macro", "jelly keycap close up"…).
2. **Open + search:** `browser_navigate` to the site → dismiss cookie/consent pop-ups → `browser_type` the query into the search bar → `browser_press_key Enter` → `browser_wait_for` results.
3. **Look at the results:** `browser_take_screenshot` (scroll 2–3 times with `browser_press_key PageDown` for more). Judge visually against the brief: style match, colour/palette, lighting, angle, resolution, no watermark, no text/logos in the way, fits 9:16 crop. Use `browser_snapshot` to get element refs for clicking.
4. **Open the best 3–6 candidates** (`browser_click`), screenshot each detail page, check size/quality, author and the **original source link** (on Pinterest a pin usually links to the origin site — follow it; credit and license live there).
5. **Download the full-resolution file:**
   - Prefer the site's own Download button (saves to the MCP `--output-dir`, then move to `assets/…`).
   - Otherwise read the media URL via `browser_evaluate` (e.g. `() => [...document.images].map(i => i.currentSrc).filter(u => u.includes('pinimg'))`) and fetch it with the terminal: `curl -L -o assets/images/<name>.jpg "<url>"`. Pinterest: swap the size folder (`/236x/`, `/474x/`, `/736x/`) for `/originals/` to get the largest version.
   - Video: take the `<video>` src or the `.m3u8` from `browser_network_requests` → `ffmpeg -i "<m3u8>" -c copy assets/footage/<name>.mp4` (or `yt-dlp "<page url>"` if installed).
6. **Verify:** `ffprobe` (resolution, duration, codec), view the file, reject low-res/blurry/watermarked ones, remove duplicates. Name files descriptively (`keycap_lime_macro_01.jpg`).
7. **Show the picks:** build a contact sheet (`magick montage assets/images/new_*.jpg -tile 4x -geometry 400x400+8+8 renders/previews/assets_<topic>.jpg`) and present it with source links; the user approves before anything is used in a final render.
8. **Log:** every file → `manifest.json` (path, page URL, direct URL, author, license, `"use": "final" | "reference-only"`) + a LOG.md line.

**Logins & safety:** if a site needs sign-in (Pinterest often does), ask the user to sign in themselves in the Playwright browser window (the persistent `--user-data-dir` keeps them logged in next time); never ask for passwords in chat. Respect the site's terms and robots rules, go slowly (no bulk scraping, ≤ ~30 downloads per session unless asked), never remove watermarks or bypass paywalls/DRM.
**License rule:** Pinterest/Behance/Dribbble images belong to their creators. Without a clear license at the original source, mark the file `reference-only` — use it for style matching, moodboards and §13-style analysis, then recreate the look in code — and ask the user before putting it in a published video.
