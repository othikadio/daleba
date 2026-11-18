# Brand 2 script formula: one small request escalates

1. **Tiny, reasonable request (0-5 s).** It sounds like it takes ten seconds.
2. **The bot says yes and does too much.** A panel shows the damage as an exact number.
3. **Escalation ladder (3-5 rungs):** each fix creates a bigger absurd problem. Every rung has a straight-faced justification.
4. **Rising human panic:** tone goes confused, then bargaining, then shouting. Use `mood` `shock`, `angry`, then `tired`.
5. **Reversal (about 75% through):** the system turns on the human: locked out of their own site, proved not human, told they are the problem.
6. **Last rung or twist (final 3-5 s):** the block deadpans one more escalation, or the rival is discovered. End on the human's short reaction.

**Rules:** no end card and no spoken CTA, because the loop is the growth engine. The final line should make the opening funnier on replay. 48-60 seconds beats longer.

## What every strong reel in this format shares
- **Length and pace:** 48-84 seconds, 17-33 lines, usually 2-6 words a line. A cut every 2-3 seconds.
- **Two voices, no narrator.** Every fact arrives as an argument between two characters. Nobody explains to the camera.
- **The first line names the bot and states the problem.** Stakes land inside 3 seconds.
- **Exact numbers, never round ones.** A precise number reads as true and funny.
- **The audience's private embarrassment is the topic:** copy-pasting code, being stuck on rate limits, 200 applications, not understanding your own app. Viewers share what exposes them.
- **The bot wins the exchange, deadpan.** The human overreacts. The bot answers in 1-4 words.
- **The last line is a button or a callback,** not a summary. Set it up in the first 15 seconds.

## Emotion tags: the voice is half the performance
Every line starts with a tag in angle brackets, and tags can change inside a line. The voice acts them and they never show in captions. They also set the character's face, so a separate `mood` is rarely needed.
- **Feelings:** `<happy>` `<excited>` `<sad>` `<hurt>` `<angry>` `<frustrated>` `<shocked>` `<scared>` `<tired>` `<proud>` `<curious>` `<gentle>`
- **Delivery:** `<sarcastic>` `<deadpan>` `<teasing>` `<whispers>` `<quiet>` `<shouting>` `<nervous>` `<laughing>`
- **Sounds and timing:** `<laughs>` `<sighs>` `<short pause>` `<long pause>`

Good: `"<sad> One. <short pause> <hurt> It said unsubscribe."`

Rules: change the emotion between lines, because a flat run of one tone sounds like a robot. Place a pause right before a punchline. Let a line break mid-thought: "I... <nervous> I can explain." Use contractions and fragments, and write how people really talk.

## Line craft
- Write for the ear. If a line needs a comma, split it into two lines.
- A reply under 4 words is the default. A long line must earn it with a list or an escalation.
- Rule of three with the third item breaking the pattern.
- Cut every greeting, "so basically", "as you know" and any sentence that only moves the plot.
- Read the script aloud at speed; 130-170 words is about right.

## Always write original lines
Never copy another creator's jokes or wording. Write fresh topics, numbers and punchlines.

## Bot name
Use the name in `brand/voice.json` under `bot.scriptName` in every script. The other `name` values are API labels and are never spoken.
