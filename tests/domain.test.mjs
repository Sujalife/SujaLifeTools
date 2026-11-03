import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TTL,DEFAULT_ROLES,loginEmail,normalizeName,can,applyDockUpdate,visibleEvents,messageVisible,validateRole} from '../functions/domain.mjs';
const now=1793700000000;
const actor={uid:'alex',displayName:'Alex',roleId:'lead',roleName:'Lead',active:true,permissions:['dock.update','message.send']};
const update={dockId:'16',status:'empty',trailerId:'SJ-42',note:'',expectedRevision:0};
function code(fn,expected){assert.throws(fn,error=>error.code===expected);}

test('display name login is case and spacing insensitive, accepts non-email names',()=>{
  assert.equal(loginEmail('  Sean   Sommer '),loginEmail('sean sommer'));
  assert.equal(loginEmail('Ｓｅａｎ'),loginEmail('Sean'));
  assert.match(loginEmail('NetSuite Operator 1'),/^[a-f0-9]{64}@users\.suja-life-tools\.invalid$/);
  assert.equal(normalizeName(' Alex\tJones '),'Alex Jones');
});
test('initial dock is unconfirmed until authorized first update, records server actor',()=>{
  const dock=applyDockUpdate(null,{...update,actorName:'Impersonated',createdAt:1},actor,now,'event-1');
  assert.equal(dock.current.revision,1);
  assert.equal(dock.history['event-1'].fromStatus,'unconfirmed');
  assert.equal(dock.history['event-1'].actorName,'Alex');
  assert.equal(dock.history['event-1'].createdAt,now);
  assert.equal(dock.history['event-1'].expiresAt,now+TTL);
});
test('viewers and inactive accounts cannot update docks',()=>{
  for(const forbidden of [{...actor,permissions:[]},{...actor,active:false},{...actor,roleId:'master',active:false}])code(()=>applyDockUpdate(null,update,forbidden,now,'id'),'permission-denied');
  assert.equal(can({...actor,roleId:'master'},'users.manage'),true);
});
test('concurrent update cannot overwrite a newer revision',()=>{
  const first=applyDockUpdate(null,update,actor,now,'first');
  code(()=>applyDockUpdate(first,{...update,status:'loading'},actor,now+1,'second'),'aborted');
  const second=applyDockUpdate(first,{...update,status:'loading',expectedRevision:1},actor,now+1,'second');
  assert.equal(second.current.revision,2);assert.equal(Object.keys(second.history).length,2);
});
test('trailer number is optional, removing a trailer clears it',()=>{
  for(const status of ['empty','loading','ready'])assert.equal(applyDockUpdate(null,{...update,status,trailerId:'',lockedConfirmed:status==='ready'},actor,now,'id').current.trailerId,'');
  const before=applyDockUpdate(null,update,actor,now,'first');
  const removed=applyDockUpdate(before,{...update,status:'no_trailer',expectedRevision:1},actor,now+1,'second');
  assert.equal(removed.current.trailerId,'');assert.equal(removed.history.second.previousTrailerId,'SJ-42');
});
test('marking ready requires physical lock confirmation',()=>{
  code(()=>applyDockUpdate(null,{...update,status:'ready'},actor,now,'ready'),'failed-precondition');
  code(()=>applyDockUpdate(null,{...update,status:'ready',lockedConfirmed:'true'},actor,now,'ready'),'failed-precondition');
  const ready=applyDockUpdate(null,{...update,status:'ready',lockedConfirmed:true},actor,now,'ready');
  assert.equal(ready.current.lockedConfirmed,true);assert.equal(ready.history.ready.lockedConfirmed,true);
});
test('reopening a ready trailer requires a reason',()=>{
  const before=applyDockUpdate(null,{...update,status:'ready',lockedConfirmed:true},actor,now,'ready');
  code(()=>applyDockUpdate(before,{...update,status:'loading',expectedRevision:1},actor,now+1,'reopen'),'failed-precondition');
  const corrected=applyDockUpdate(before,{...update,status:'loading',expectedRevision:1,note:'QA requested additional checks.'},actor,now+1,'reopen');
  assert.equal(corrected.current.status,'loading');
});
test('invalid dock, status, overlong note, and empty duplicate are rejected',()=>{
  for(const payload of [{...update,dockId:'20'},{...update,status:'fake'},{...update,note:'x'.repeat(501)}])code(()=>applyDockUpdate(null,payload,actor,now,'id'),'invalid-argument');
  const dock=applyDockUpdate(null,update,actor,now,'first');
  code(()=>applyDockUpdate(dock,{...update,expectedRevision:1},actor,now+1,'second'),'failed-precondition');
});
test('history and callable reads exclude 72-hour-old records at exact boundary',()=>{
  const events={expired:{createdAt:now-TTL},old:{createdAt:now-TTL-1},live:{createdAt:now-TTL+1},future:{createdAt:now+1}};
  assert.deepEqual(Object.keys(visibleEvents(events,now)),['live']);
  const dock=applyDockUpdate({history:events},update,actor,now,'new');
  assert.deepEqual(Object.keys(dock.history),['live','new']);
});
test('team, role, personal, and sender message visibility is enforced',()=>{
  assert.equal(messageVisible({audienceType:'team'},actor),true);
  assert.equal(messageVisible({audienceType:'role',audienceId:'lead'},actor),true);
  assert.equal(messageVisible({audienceType:'role',audienceId:'master'},actor),false);
  assert.equal(messageVisible({audienceType:'user',audienceId:'alex'},actor),true);
  assert.equal(messageVisible({audienceType:'user',audienceId:'someone-else'},actor),false);
  assert.equal(messageVisible({senderUid:'alex',audienceType:'user',audienceId:'someone-else'},actor),true);
});
test('custom roles cannot become master or gain account administration',()=>{
  code(()=>validateRole({id:'master',name:'Master',permissions:[]}),'invalid-argument');
  code(()=>validateRole({id:'shipping',name:'Shipping',permissions:['users.manage']}),'invalid-argument');
  code(()=>validateRole({id:'shipping',name:'Shipping',permissions:['unexpected']}),'invalid-argument');
  assert.deepEqual(validateRole({id:'shipping',name:'Shipping',permissions:['dock.update','dock.update']}),{id:'shipping',name:'Shipping',permissions:['dock.update']});
  assert.equal(DEFAULT_ROLES.viewer.permissions.length,0);
});
test('RTDB rules deny all client writes and history/message reads',async()=>{
  const rules=JSON.parse(await readFile(new URL('../database.rules.json',import.meta.url),'utf8')).rules;
  assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);
  const walk=node=>{for(const [key,value] of Object.entries(node)){if(key==='.write')assert.equal(value,false);else if(value&&typeof value==='object')walk(value);}};walk(rules);
  assert.equal(rules.toolsV1.docks.$dock.history['.read'],undefined);
  assert.equal(rules.toolsV1.messages['.read'],undefined);
  assert.match(rules.toolsV1.directory['.read'],/active/);
  assert.match(rules.toolsV1.profiles.$uid['.read'],/auth.uid === \$uid/);
});
