const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.addInitScript(() => { window.__timelines = {}; });
  await p.goto('file://' + process.argv[2]);
  const c = await p.evaluate(() => window.__cues);
  require('fs').writeFileSync(process.argv[3], JSON.stringify(c, null, 0));
  console.log(c.length, 'cues', [...new Set(c.map(x => x.id))].join(' '));
  await b.close();
})();
