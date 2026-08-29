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

function parseFiveModsProfileDownloads(html) {
  // Read the profile-wide total from the stat label directly following the
  // download icon. Download figures inside individual mod cards deliberately
  // do not match this structure and must not be summed.
  const match = html.match(
    /<span\b[^>]*class=["'][^"']*\bstat-icon\b[^"']*\bfa-download\b[^"']*["'][^>]*>\s*<\/span>\s*<span\b[^>]*class=["'][^"']*\bstat-label\b[^"']*["'][^>]*>\s*([\d.,]+)\s*Downloads?\s*<\/span>/i
  );
  if (!match) throw new Error('Profile download total not found on 5mods profile');

  const value = Number.parseInt(match[1].replace(/[.,]/g, ''), 10);
  if (!Number.isFinite(value)) throw new Error('Invalid profile download total on 5mods profile');
  return String(value);
}

async function fetchFiveModsDownloads() {
  const url = process.env.FIVEMODS_PROFILE_URL || 'https://de.gta5-mods.com/users/Geigro%20Developing';
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!res.ok) throw new Error(`5mods HTTP ${res.status}`);
  return parseFiveModsProfileDownloads(await res.text());
}

async function fetchLibertyCityDownloads() {
  const { chromium } = require('playwright');
  const profileUrl = process.env.LIBERTYCITY_PROFILE_URL || 'https://libertycity.net/user/GEIGRO+Developing/';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(profileUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);
    const matches = await page.locator('.params .p_row').evaluateAll((rows) => rows
      .map((row) => (row.textContent || '').trim().match(/^Downloads:\s*([\d,.]+)$/i))
      .filter(Boolean)
      .map((match) => Number.parseInt(match[1].replace(/[,.]/g, ''), 10))
      .filter((value) => Number.isFinite(value)));
    if (!matches.length) throw new Error('No file download figures found on LibertyCity profile');
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
