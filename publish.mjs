import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const delays = [5000, 15000];

export async function fetchSnapshot(url, secret, { request = fetch, wait = pause, warn = console.warn } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await request(url, { headers: { Authorization: 'Bearer ' + secret }, signal: AbortSignal.timeout(25000) });
    } catch {
      if (attempt === 2) throw new Error('Snapshot request failed after 3 attempts; the published cache was preserved.');
      warn('Snapshot request timed out or failed; retrying (' + (attempt + 1) + '/3).');
      await wait(delays[attempt]);
      continue;
    }
    if (response.status === 429) {
      const detail = await response.json().catch(() => null);
      const code = ['D1_DAILY_READ_LIMIT', 'D1_DAILY_WRITE_LIMIT'].includes(detail?.code) ? detail.code : 'WORLD_DAILY_BUDGET';
      const retryAt = typeof detail?.retryAt === 'string' && Number.isFinite(Date.parse(detail.retryAt)) ? new Date(detail.retryAt).toISOString() : null;
      return { ready: false, code, retryAt };
    }
    if ([500, 502, 503, 504].includes(response.status) && attempt < 2) {
      await response.body?.cancel();
      warn('Snapshot export returned HTTP ' + response.status + '; retrying (' + (attempt + 1) + '/3).');
      await wait(delays[attempt]);
      continue;
    }
    if (!response.ok) throw new Error('Snapshot export failed with HTTP ' + response.status + ' after ' + (attempt + 1) + ' attempt(s); the published cache was preserved.');
    try {
      return { ready: true, snapshot: await response.json() };
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Snapshot response is not valid JSON; the published cache was preserved.');
      if (attempt === 2) throw new Error('Snapshot response could not be read after 3 attempts; the published cache was preserved.');
      warn('Snapshot response could not be read; retrying (' + (attempt + 1) + '/3).');
      await wait(delays[attempt]);
    }
  }
}

export function publicPages(snapshot) {
  const validId = value => Number.isSafeInteger(value) && value > 0;
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const letter = b => b && validId(b.id) && typeof b.body === 'string' && validDate(b.createdAt) && (b.nickname == null || typeof b.nickname === 'string');
  if (!snapshot?.ok || !validDate(snapshot.generatedAt) || !Array.isArray(snapshot.bottles) || !snapshot.bottles.every(letter) ||
      !Array.isArray(snapshot.messages) || !snapshot.messages.every(m => letter(m) && typeof m.nickname === 'string' && ['world','web'].includes(m.source)) ||
      !Array.isArray(snapshot.receipts) || !snapshot.receipts.every(r => r && validId(r.id) && ['room','bottle'].includes(r.action) && /^[a-f0-9]{32}$/.test(r.nonce)))
    throw new Error('Snapshot schema is invalid; the published cache was preserved.');
  if (snapshot.bottles.length > 65536) throw new Error('Snapshot exceeds the world URL capacity.');
  // Only these public fields may reach GitHub Pages.
  const bottles = snapshot.bottles.map(b => ({id:b.id,body:b.body,createdAt:b.createdAt,nickname:b.nickname??null}));
  const messages = snapshot.messages.map(m => ({id:m.id,body:m.body,createdAt:m.createdAt,nickname:m.nickname,source:m.source}));
  const receipts = snapshot.receipts.map(r => ({action:r.action,nonce:r.nonce,id:r.id}));
  const pages = Math.ceil(bottles.length / 32);
  return Array.from({length:Math.max(1,pages)}, (_, page) => ({ok:true,page,pageSize:32,total:bottles.length,pages,
    generatedAt:snapshot.generatedAt,bottles:bottles.slice(page*32,(page+1)*32),messages,receipts,readOnlyBottles:true}));
}

export async function main() {
  const url = process.env.WORLD_SOURCE, secret = process.env.WORLD_SNAPSHOT_SECRET;
  if (!url || !secret) throw new Error('Publisher credentials are missing.');
  const result = await fetchSnapshot(url, secret);
  if (!result.ready) {
    const summary = 'Refresh deferred: ' + result.code + '. No new snapshot was published; the last cache remains available.' +
      (result.retryAt ? ' Quota resets at ' + result.retryAt + '.' : ' The next scheduled run will try again.');
    console.log(summary);
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, 'ready=false\n', {flag:'a'});
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n', {flag:'a'});
    return;
  }
  const pages = publicPages(result.snapshot);
  await mkdir('site', {recursive:true});
  for (const page of pages) await writeFile('site/page-' + page.page + '.json', JSON.stringify(page));
  await writeFile('site/index.html','<!doctype html><meta charset="utf-8"><title>OSaTo World Cache</title><p>OSaTo public VRChat snapshots. <a href="https://osato-together.pages.dev">OSaTo</a></p>');
  await writeFile('site/.nojekyll','');
  const summary = 'Prepared ' + result.snapshot.bottles.length + ' public bottles in ' + pages.length + ' pages. Generated at ' + result.snapshot.generatedAt + '.';
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, 'ready=true\n', {flag:'a'});
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n', {flag:'a'});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
