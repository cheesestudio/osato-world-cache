import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSnapshot, publicPages, publicPlay} from './publish.mjs';

const letter = {id:1,body:'Public letter',createdAt:'2026-10-19T01:00:00.000Z',nickname:null};
const snapshot = () => ({ok:true,generatedAt:'2026-10-19T01:00:00.000Z',bottles:[letter],messages:[],receipts:[]});
const options = request => ({request,wait:async()=>{},warn:()=>{}});

test('transient server errors retry and recover', async () => {
  let calls=0;
  const result=await fetchSnapshot('https://source.invalid','test-secret',options(async()=>++calls<3?new Response('Unavailable',{status:500}):Response.json(snapshot())));
  assert.equal(calls,3); assert.equal(result.ready,true);
});
test('network failures retry without logging credentials', async () => {
  let calls=0;
  const result=await fetchSnapshot('https://source.invalid','test-secret',options(async()=>{if(++calls<2)throw new TypeError('network');return Response.json(snapshot());}));
  assert.equal(calls,2); assert.equal(result.ready,true);
});
test('persistent server errors still fail instead of silently passing', async () => {
  let calls=0;
  await assert.rejects(fetchSnapshot('https://source.invalid','test-secret',options(async()=>{calls++;return new Response('private server details',{status:500});})),/HTTP 500 after 3/);
  assert.equal(calls,3);
});
test('authentication failures fail immediately', async () => {
  let calls=0;
  await assert.rejects(fetchSnapshot('https://source.invalid','test-secret',options(async()=>{calls++;return new Response('',{status:403});})),/HTTP 403 after 1/);
  assert.equal(calls,1);
});
test('daily D1 limits defer publishing without retrying', async () => {
  let calls=0;
  const result=await fetchSnapshot('https://source.invalid','test-secret',options(async()=>{calls++;return Response.json({code:'D1_DAILY_READ_LIMIT',retryAt:'2026-10-20T00:00:00Z'},{status:429});}));
  assert.deepEqual(result,{ready:false,code:'D1_DAILY_READ_LIMIT',retryAt:'2026-10-20T00:00:00.000Z'}); assert.equal(calls,1);
});
test('application budgets remain a deferred refresh', async () => {
  const result=await fetchSnapshot('https://source.invalid','test-secret',options(async()=>new Response('',{status:429})));
  assert.deepEqual(result,{ready:false,code:'WORLD_DAILY_BUDGET',retryAt:null});
});
test('public output keeps all pages and strips private fields', () => {
  const data=snapshot(); data.bottles=Array.from({length:65},(_,i)=>({...letter,id:i+1,email:'never publish',reply:'private',owner_id:'private-user'}));
  const pages=publicPages(data);
  assert.deepEqual(pages.map(p=>p.bottles.length),[32,32,1]); assert.equal(pages[0].pages,3);
  assert.ok(!JSON.stringify(pages).includes('private')); assert.ok(!JSON.stringify(pages).includes('never publish'));
});
test('malformed rows cannot produce a partial replacement', () => {
  for(const data of [{...snapshot(),bottles:[{...letter,id:'bad'}]}, {...snapshot(),receipts:[{action:'room',nonce:'bad',id:1}]}, {...snapshot(),messages:[{...letter,nickname:'name',source:'bad'}]}])
    assert.throws(()=>publicPages(data),/schema is invalid/);
});
test('an empty sea retains a readable first page', () => {
  assert.equal(publicPages({...snapshot(),bottles:[]})[0].total,0);
});
test('truncated response bodies retry and recover', async () => {
  let calls=0;
  const result=await fetchSnapshot('https://source.invalid','test-secret',options(async()=>++calls===1?
    {status:200,ok:true,json:async()=>{throw new TypeError('interrupted stream');}}:Response.json(snapshot())));
  assert.equal(calls,2); assert.equal(result.ready,true);
});
test('invalid JSON fails safely without echoing response contents', async () => {
  await assert.rejects(fetchSnapshot('https://source.invalid','test-secret',options(async()=>new Response('{private-response-details'))),error=>
    error.message.includes('not valid JSON') && !error.message.includes('private-response-details'));
});

const play = () => ({
  sessions:[{id:'00000000-0000-4000-8000-000000000001',nickname:'一起玩的旅人',kind:'meetup',title:'今晚打台球',body:'欢迎新朋友',
    startsAt:1792641600000,endsAt:1792645200000,capacity:4,memberCount:2,worldUrl:'https://vrchat.com/home/world/wrld_00000000-0000-4000-8000-000000000001'}],
  statuses:[{nickname:'旅人',mood:'play',body:'想找人一起逛图',expiresAt:1792645200000}],
});

test('old snapshots remain readable and new play data is available on every page', () => {
  assert.deepEqual(publicPages(snapshot())[0].play, {sessions:[],statuses:[]});
  const data={...snapshot(),play:play(),bottles:Array.from({length:33},(_,i)=>({...letter,id:i+1}))};
  const pages=publicPages(data);
  assert.equal(pages.length,2);
  assert.deepEqual(pages[0].play,play());
  assert.deepEqual(pages[1].play,play());
});

test('play exports strip private fields from both containers and every row', () => {
  const data=play();
  data.sessions[0].ownerId='private-owner'; data.sessions[0].participants=['private-participant'];
  data.statuses[0].userId='private-user'; data.statuses[0].email='private-email';
  data.privateReplies=['private-reply'];
  assert.deepEqual(publicPlay(data),play());
  assert.ok(!JSON.stringify(publicPlay(data)).includes('private-'));
});

test('private instance invitations and arbitrary URL hosts cannot enter public map pages', () => {
  const urls=[
    'javascript:alert(1)', 'https://vrchat.com.evil.invalid/home/world/wrld_00000000-0000-4000-8000-000000000001',
    'https://vrchat.com/home/launch?worldId=wrld_00000000-0000-4000-8000-000000000001&instanceId=1~private(usr_00000000-0000-4000-8000-000000000002)',
    'https://vrchat.com/home/launch?worldId=wrld_00000000-0000-4000-8000-000000000001&instanceId=1~group(grp_00000000-0000-4000-8000-000000000002)~groupAccessType(members)',
  ];
  for(const url of urls) {
    const data=play();data.sessions[0].worldUrl=url;
    assert.throws(()=>publicPages({...snapshot(),play:data}),/Public play schema is invalid/);
  }
});

test('public room URLs, expiry values and small map capacity limits are checked', () => {
  const data=play();
  data.sessions[0].worldUrl='https://vrchat.com/home/launch?worldId=wrld_00000000-0000-4000-8000-000000000001&instanceId=123~region(jp)';
  assert.equal(publicPlay(data).sessions.length,1);
  for(const invalid of [
    {...play(),sessions:Array.from({length:7},()=>play().sessions[0])},
    {...play(),statuses:Array.from({length:13},()=>play().statuses[0])},
    {...play(),statuses:[{...play().statuses[0],expiresAt:'tomorrow'}]},
    {...play(),sessions:[{...play().sessions[0],memberCount:5}]},
  ]) assert.throws(()=>publicPlay(invalid),/Public play schema is invalid/);
});
