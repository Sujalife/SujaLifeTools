import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatform,displayNameLoginAddress} from '../dist/shared/platform.js';
import {createHash} from 'node:crypto';
const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
globalThis.window={addEventListener(){},removeEventListener(){}};

test('display names map consistently to unique password login addresses',async()=>{
  assert.equal(await displayNameLoginAddress('  Ｓｅａｎ  '),await displayNameLoginAddress('sean'));
  assert.equal(await displayNameLoginAddress('Sean   Sommer'),await displayNameLoginAddress('Sean Sommer'));
  assert.notEqual(await displayNameLoginAddress('Alex'),await displayNameLoginAddress('Alex Rivera'));
  const expected=createHash('sha256').update('netsuite operator 1').digest('hex')+'@users.suja-life-tools.invalid';
  assert.equal(await displayNameLoginAddress('NetSuite Operator 1'),expected);
});
test('missing Firebase config provides signed-out setup, without live sample data',async()=>{
  const platform=await createPlatform({});
  try{const state=platform.getSnapshot();assert.equal(state.mode,'setup');assert.equal(state.user,null);assert.deepEqual(state.docks,{});await assert.rejects(platform.login('Sean','passphrase'),/awaiting Firebase setup/);}finally{platform.destroy();}
});
test('explicit demo preserves shared account/dock state across app paths without passphrases',async()=>{
  storage.clear();const hub=await createPlatform({}, {demo:true});
  try{
    const before=hub.getSnapshot();assert.equal(before.mode,'demo');assert.equal(before.user.roleId,'master');assert.equal(Object.keys(before.docks).length,4);
    assert.deepEqual(Object.values(before.docks).map(d=>d.status),['no_trailer','empty','loading','ready']);
    await hub.updateDock({dockId:'16',status:'empty',trailerId:'NEW-88',note:'New empty trailer spotted.',expectedRevision:before.docks['16'].revision});
    await assert.rejects(hub.updateDock({dockId:'16',status:'loading',trailerId:'NEW-88',expectedRevision:1}),/changed/);
    await hub.createUser({displayName:'New Driver',passphrase:'NEVER-PERSIST-THIS',roleId:'forklift_driver'});
    assert.equal(storage.get('suja-life-tools.demo.v1').includes('NEVER-PERSIST-THIS'),false);
    const dockApp=await createPlatform({}, {demo:true});
    try{const after=dockApp.getSnapshot();assert.equal(after.docks['16'].trailerId,'NEW-88');assert.equal(after.history['16'][0].actorName,'Sean');assert.equal(after.messages[0].system,true);assert.ok(Object.values(after.users).some(u=>u.displayName==='New Driver'));}finally{dockApp.destroy();}
  }finally{hub.destroy();}
});
test('demo ready update requires lock confirmation while trailer number stays optional',async()=>{
  storage.clear();const platform=await createPlatform({}, {demo:true});
  try{
    const revision=platform.getSnapshot().docks['16'].revision;
    await assert.rejects(platform.updateDock({dockId:'16',status:'ready',trailerId:'',expectedRevision:revision}),/physically locked/);
    await platform.updateDock({dockId:'16',status:'ready',trailerId:'',expectedRevision:revision,lockedConfirmed:true});
    assert.equal(platform.getSnapshot().docks['16'].lockedConfirmed,true);
  }finally{platform.destroy();}
});
test('demo message center filters expired and other-role messages',async()=>{
  storage.clear();const initial=await createPlatform({}, {demo:true});initial.destroy();
  const seed=JSON.parse(storage.get('suja-life-tools.demo.v1')), now=Date.now();
  seed.messages=[
    {id:'private-other',body:'Other role',audienceType:'role',audienceId:'lead',senderUid:'someone',createdAt:now-1000},
    {id:'private-master',body:'Master role',audienceType:'role',audienceId:'master',senderUid:'someone',createdAt:now-1000},
    {id:'expired',body:'Old',audienceType:'team',senderUid:'someone',createdAt:now-72*60*60*1000}
  ];storage.set('suja-life-tools.demo.v1',JSON.stringify(seed));
  const platform=await createPlatform({}, {demo:true});
  try{assert.deepEqual(platform.getSnapshot().messages.map(m=>m.id),['private-master']);}finally{platform.destroy();}
});
test('HTTP browser demo can save dock, message, and account without crypto.randomUUID',async()=>{
  storage.clear();const descriptor=Object.getOwnPropertyDescriptor(globalThis.crypto,'randomUUID');
  Object.defineProperty(globalThis.crypto,'randomUUID',{value:undefined,configurable:true});
  const platform=await createPlatform({}, {demo:true});
  try{
    const result=await platform.updateDock({dockId:'16',status:'empty',trailerId:'HTTP-1',expectedRevision:1});
    assert.match(result.event.id,/^local-/);
    assert.equal(platform.getSnapshot().docks['16'].trailerId,'HTTP-1');
    assert.match((await platform.sendMessage({body:'HTTP demo message'})).id,/^local-/);
    assert.match((await platform.createUser({displayName:'HTTP Driver',passphrase:'demo-only-123',roleId:'forklift_driver'})).uid,/^demo-local-/);
  }finally{platform.destroy();if(descriptor)Object.defineProperty(globalThis.crypto,'randomUUID',descriptor);else delete globalThis.crypto.randomUUID;}
});
test('failed Firebase SDK load leaves usable signed-out platform with error',async()=>{
  // Node rejects HTTPS module imports; this exercises the browser's SDK-load failure path.
  const platform=await createPlatform({apiKey:'public-config',projectId:'test',appId:'test'});
  try{const state=platform.getSnapshot();assert.equal(state.mode,'live');assert.equal(state.user,null);assert.equal(state.connected,false);assert.match(state.error,/could not load/);assert.deepEqual(state.docks,{});await assert.rejects(platform.login('Sean','passphrase'),/could not load/);}finally{platform.destroy();}
});
