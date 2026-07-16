const fs = require('fs');
const path = require('path');

const outputPath = process.env.STATS_OUTPUT_PATH || path.join(__dirname, '..', 'social-stats.json');
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function log(message) {
  console.log(`[social-stats] ${message}`);
}

async function fetchYoutubeSubscribers() {
  const url = process.env.YOUTUBE_CHANNEL_URL || 'https://www.youtube.com/@GEIGRO-Developing/about';
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/"subscriberCountText":"([\d.,]+)/);
  if (!match) throw new Error('subscriberCountText not found on YouTube about page');
  return match[1].replace(/[.,]/g, '');
}

async function fetchFiveModsDownloads() {
  const url = process.env.FIVEMODS_PROFILE_URL || 'https://de.gta5-mods.com/users/Geigro%20Developing';
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!res.ok) throw new Error(`5mods HTTP ${res.status}`);
  const html = await res.text();
  // Match only the title="X Downloads" attribute — the page also repeats the same
  // figure as plain visible text right next to it, which would double-count every
  // mod if matched too. Values are still deduped since a mod can appear in more
  // than one DOM section (e.g. duplicated markup for responsive layouts).
  const seen = new Set();
  const matches = [...html.matchAll(/title="([\d.,]+)\s*Downloads?"/gi)]
    .map((m) => m[1].replace(/[.,]/g, ''))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  if (!matches.length) throw new Error('No download figures found on 5mods profile');
  return String(matches.reduce((sum, value) => sum + value, 0));
}

async function fetchLibertyCityDownloads() {
  const { chromium } = require('playwright');
  const profileUrl = process.env.LIBERTYCITY_PROFILE_URL || 'https://libertycity.net/user/GEIGRO+Developing/';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(profileUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);
    const bodyText = await page.evaluate(() => document.body.innerText);
    const matches = [...bodyText.matchAll(/Downloads:\s*\n?\s*([\d,.]+)/g)]
      .map((match) => Number.parseInt(match[1].replace(/[,.]/g, ''), 10))
      .filter((value) => Number.isFinite(value));
    if (!matches.length) throw new Error('No "Downloads:" figures found on LibertyCity profile');
    return String(matches.reduce((sum, value) => sum + value, 0));
  } finally {
    await browser.close();
  }
}

async function main() {
  const results = {};
  const errors = [];

  const sources = [
    ['youtube', fetchYoutubeSubscribers],
    ['fivemods', fetchFiveModsDownloads],
    ['libertycity', fetchLibertyCityDownloads]
  ];

  for (const [key, fetcher] of sources) {
    try {
      results[key] = await fetcher();
      log(`${key}: ${results[key]}`);
    } catch (error) {
      errors.push(`${key}: ${error.message}`);
      log(`${key} failed: ${error.message}`);
    }
  }

  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  } catch {}

  const merged = { ...existing, ...results, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  log(`Wrote ${outputPath}`);

  if (errors.length) {
    log(`Some sources failed and kept their previous cached value: ${errors.join('; ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
