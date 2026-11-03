import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatform,displayNameLoginAddress} from '../dist/shared/platform.js';
import {createHash} from 'node:crypto';
const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
globalThis.window={addEventListener(){},removeEventListener(){}};

test('display names map consistently to unique password login addresses',async()=>{
  assert.equal(await displayNameLoginAddress('  Ｓｅａｎ  '),await displayNameLoginAddress('sean'));
  assert.equal(await displayNameLoginAddress('Sean   Sommer'),await displayNameLoginAddress('Sean Sommer'));
  assert.notEqual(await displayNameLoginAddress('Alex'),await displayNameLoginAddress('Alex Rivera'));
  const expected=createHash('sha256').update('netsuite operator 1').digest('hex')+'@users.suja-life-tools.invalid';
  assert.equal(await displayNameLoginAddress('NetSuite Operator 1'),expected);
});
test('missing Firebase config provides signed-out setup, without live sample data',async()=>{
  const platform=await createPlatform({}, {demo:true});
  try{const state=platform.getSnapshot();assert.equal(state.mode,'setup');assert.equal(state.user,null);assert.deepEqual(state.docks,{});await assert.rejects(platform.login('Sean','passphrase'),/awaiting Firebase setup/);}finally{platform.destroy();}
});
test('failed Firebase SDK load leaves usable signed-out platform with error',async()=>{
  // Node rejects HTTPS module imports; this exercises the browser's SDK-load failure path.
  const platform=await createPlatform({apiKey:'public-config',projectId:'test',appId:'test'});
  try{const state=platform.getSnapshot();assert.equal(state.mode,'live');assert.equal(state.user,null);assert.equal(state.connected,false);assert.match(state.error,/could not load/);assert.deepEqual(state.docks,{});await assert.rejects(platform.login('Sean','passphrase'),/could not load/);}finally{platform.destroy();}
});
