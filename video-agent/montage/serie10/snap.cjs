// usage: node snap.cjs <video_dir> <out.jpg> t1 t2 ...  → planche de captures
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const [dir, out, ...ts] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: .3 });
  await p.goto('file://' + path.resolve(dir, 'index.html')); await p.evaluate(() => document.fonts.ready);
  const shots = [];
  for (const t of ts) {
    await p.evaluate((t) => { const tl = window.__timelines.main; tl.seek(+t);
      document.querySelectorAll('.clip').forEach(c => { const s = +c.dataset.start, d = +c.dataset.duration; c.style.visibility = (t >= s && t < s + d) ? 'visible' : 'hidden'; }); }, t);
    await p.waitForTimeout(60); shots.push(await p.screenshot({ type: 'jpeg', quality: 70 }));
  }
  const fs = require('fs'); const tmp = out + '_d'; fs.mkdirSync(tmp, { recursive: true });
  shots.forEach((s, i) => fs.writeFileSync(`${tmp}/${String(i).padStart(2, '0')}.jpg`, s));
  require('child_process').execSync(`ffmpeg -v error -y -i ${tmp}/%02d.jpg -vf tile=${ts.length}x1 ${out}`); fs.rmSync(tmp, { recursive: true });
  await b.close();
})();
