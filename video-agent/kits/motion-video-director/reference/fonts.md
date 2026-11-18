<!-- Motion Video Director · reference file, loaded on demand from SKILL.md -->
# Font research & sourcing (do this before the design file — step 4)
Never pick fonts from memory or default to Inter/Poppins. **Research first, then download.**

**1. Research what the video needs** (write the result into `TASTE.md` §3):
- Brand fonts from the user come first — if they gave fonts, use them and only research what's missing.
- From the brief, references, tone and intensity (§4), define the **type roles**: headline/display, keyword/accent, captions/body, and UI/mono or script only if the plan needs them. Max 2–3 families.
- For each role write the look in words (e.g. "ultra-bold condensed grotesk, sharp, tech") and the requirements: weights needed (e.g. 200 + 900), variable `wght`/`wdth` axis for kinetic animation, glyphs/languages in the script (numbers, symbols, non-Latin text), readability at caption size.
- If there are references, identify their fonts first (Firecrawl search "<brand> font", or screenshot a frame and check it on a font identifier with Playwright), then find the closest free match on the sites below.

**2. Search these sites** (in this order, with the Playwright MCP to browse and compare specimens visually, or Firecrawl to search/scrape). Most are free or free for personal use — **always read the license.**
| Site | Use for |
|---|---|
| https://freedesignresources.net/category/free-fonts/ (Free Design Resources) | display, condensed, script freebies |
| https://open-foundry.com/ (Open Foundry) | curated open-source (OFL) typefaces |
| https://www.fontshare.com/ (Fontshare) | ITF free pro fonts (Satoshi, Clash Display, General Sans, Cabinet Grotesk, Switzer…), free for commercial use |
| https://www.typedump.com/ (Typedump) | variable, display, pixel, mono free fonts |
| https://play.typedetail.com/ (Font Playground) | find and test variable fonts, preview the wght/wdth/slnt axes for kinetic type, then download from the font's own page |
| https://dirtylinestudio.com/freebies/ (Dirtyline Studio) | free display/brand fonts |
| Google Fonts (fallback only) | OFL staples when nothing above fits: Inter, Anton, Archivo Black, Permanent Marker, Caveat Brush, Space Mono |

**3. Shortlist + approve:** 2–3 candidates per role in the `fonts` array of `plan/design.html` (`chosen:false` for candidates; fields family, file, weight, role, license, source) + one line each in TASTE.md on why it fits. The design file renders a specimen of each with the real headline and keywords and flags missing files. Pick the best and show the design file for approval.

**4. Download** only from the font's official page (never from mirror/"free download" sites): with Playwright click the download button (files land in `cache/browser/`), or Firecrawl-scrape the page for the direct link and `curl -L -o`. Unzip, then move the `.ttf/.otf/.woff2` files to `assets/fonts/<Family>/`. Save the license (the included LICENSE/readme, or the license page saved as `license.md`) in the same folder, and add a `manifest.json` entry for each family.

**5. Use in code:** load the local files with `@font-face`/`FontFace` and **await `document.fonts.ready` before rendering frame 0**. Render a test still to make sure the right font shows (no fallback font, no missing glyphs).

**License rules:** personal-use-only fonts are fine for the user's personal videos, but for client or commercial work you need a commercial license or a different font. If it's unclear, ask the user. Never use a font whose license you couldn't verify, and list every font in the credits.
