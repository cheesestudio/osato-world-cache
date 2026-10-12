import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.WORLD_SOURCE;
const secret = process.env.WORLD_SNAPSHOT_SECRET;
if(!url || !secret) throw new Error('Publisher credentials are missing.');
const response = await fetch(url, { headers: { Authorization: 'Bearer '+secret }, signal: AbortSignal.timeout(90000) });
if(response.status===429) {
  console.log('Daily world budget reached; the last published snapshot stays available.');
  if(process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT,'ready=false\n',{flag:'a'});
  process.exit(0);
}
if(!response.ok) throw new Error('Snapshot export failed with HTTP '+response.status);
const snapshot=await response.json();
if(!snapshot.ok || !Array.isArray(snapshot.bottles) || !Array.isArray(snapshot.messages) || !Array.isArray(snapshot.receipts))
  throw new Error('Snapshot schema is invalid.');
// Strict allowlist prevents new backend fields from becoming public by accident.
const bottles=snapshot.bottles.map(b=>({id:b.id,body:b.body,createdAt:b.createdAt,nickname:b.nickname??null}));
const messages=snapshot.messages.map(m=>({id:m.id,body:m.body,createdAt:m.createdAt,nickname:m.nickname,source:m.source}));
const receipts=snapshot.receipts.map(r=>({action:r.action,nonce:r.nonce,id:r.id}));
const pages=Math.ceil(bottles.length/32);
if(pages>2048) throw new Error('Snapshot exceeds the world URL capacity.');
await mkdir('site',{recursive:true});
for(let page=0;page<Math.max(1,pages);page++) {
  await writeFile('site/page-'+page+'.json',JSON.stringify({ok:true,page,pageSize:32,total:bottles.length,pages,
    generatedAt:snapshot.generatedAt,bottles:bottles.slice(page*32,(page+1)*32),messages,receipts,readOnlyBottles:true}));
}
await writeFile('site/index.html','<!doctype html><meta charset="utf-8"><title>OSaTo World Cache</title><p>OSaTo public VRChat snapshots. <a href="https://osato-together.pages.dev">OSaTo</a></p>');
await writeFile('site/.nojekyll','');
console.log('Prepared '+bottles.length+' public bottles in '+Math.max(1,pages)+' pages; no private replies or account data.');
if(process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT,'ready=true\n',{flag:'a'});
