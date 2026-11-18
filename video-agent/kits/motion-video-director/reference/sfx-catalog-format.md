# Optional customer-owned SFX catalog

No audio pack or personal selection data is shipped. The empty JSON template is optional; do not block procedural sound work on it. For your own reviewed files, use a JSON array with stable ID, relative path, source URL, author, licence, actual quality and processing. Save customer audition choices in the project.

The optional verifier expects `id`, `path`, `original_path`, `source_url`, `license`, `review_sha256` and `original_sha256`. Relative paths must stay within the selected library directory; hash both actual files after inspection. It checks matching bytes, not copyright ownership, actual licence validity, subjective fit or audio fidelity. One file may be both original and review source when it is unchanged; use the same relative path and hash for both fields. Never invent provenance or hashes.

Example shape (placeholders are not a ready catalog):
```json
[{"id":"customer-soft-click-01","path":"sounds/soft-click.wav","original_path":"originals/source.wav","source_url":"<actual-source-page-or-original-recording-record>","author":"<actual-author>","license":"<actual-permitted-licence>","quality":"<actual-source-format-and-limitations>","review_sha256":"<measured-sha256>","original_sha256":"<measured-sha256>"}]
```

No network access, deletion, sample restoration or downloads are performed by `verify_sfx.py`.
