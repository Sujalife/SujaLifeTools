import test, {before, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {ref, set, update, get, serverTimestamp} from 'firebase/database';
import {setLogLevel} from 'firebase/app';
setLogLevel('silent');

if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST)throw Error('Run npm run test:rules. This suite only connects to a local Firebase emulator.');
const [host,portString]=process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(':');
if(!['127.0.0.1','localhost'].includes(host))throw Error('Integration tests require a loopback emulator host.');
// Firebase Node WebSockets honor proxy variables even for loopback URLs.
for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])delete process.env[key];
const TTL=72*60*60*1000;
let env;
const profiles={
 master:{uid:'master',displayName:'Sean',roleId:'master',active:true,createdAt:1},
 lead:{uid:'lead',displayName:'Alex',roleId:'lead',active:true,createdAt:1},
 viewer:{uid:'viewer',displayName:'Pat',roleId:'viewer',active:true,createdAt:1},
 driver:{uid:'driver',displayName:'Morgan',roleId:'driver',active:true,createdAt:1},
 pending:{uid:'pending',displayName:'Pending',roleId:'viewer',active:false,createdAt:1}
};
const roles={
 master:{id:'master',name:'Master',permissions:{dockUpdate:true,messageSend:true}},
 lead:{id:'lead',name:'Lead',permissions:{dockUpdate:true,messageSend:true}},
 driver:{id:'driver',name:'Forklift Driver',permissions:{dockUpdate:true,messageSend:true}},
 viewer:{id:'viewer',name:'Viewer',permissions:{dockUpdate:false,messageSend:false}}
};
const db=(uid,provider='password')=>uid?env.authenticatedContext(uid,{firebase:{sign_in_provider:provider}}).database():env.unauthenticatedContext().database();
const path=value=>`toolsV2/${value}`;
const r=(database,value)=>ref(database,path(value));
const admin=async callback=>env.withSecurityRulesDisabled(async context=>callback(context.database()));
async function seed(data){await admin(database=>set(r(database,''),data));}
function dockWrite({uid='lead',id='16',before=null,status='loading',trailerId='SJ-21',note='',auditId='audit-new',time=serverTimestamp(),lockedConfirmed=status==='ready',revision=(before?.revision||0)+1}={}){
 const person=profiles[uid],role=roles[person.roleId];
 const current={dockId:id,status,trailerId:status==='no_trailer'?'':trailerId,lockedConfirmed,revision,updatedAt:time,updatedBy:uid,updatedByName:person.displayName,updatedByRole:role.name,auditId};
 const event={id:auditId,dockId:id,fromStatus:before?.status||'unconfirmed',status,trailerId:current.trailerId,previousTrailerId:before?.trailerId||'',note,lockedConfirmed,createdAt:time,actorUid:uid,actorName:person.displayName,actorRole:role.name,revision};
 return {current,event,updates:{current,[`history/${auditId}`]:event}};
}
async function saveDock(database,options){const write=dockWrite(options);await update(r(database,`docks/${write.current.dockId}`),write.updates);return write;}
function message({id='message-1',uid='lead',audienceType='team',audienceId='team',createdAt=serverTimestamp()}={}){const person=profiles[uid];return {id,body:'Dock update for the team.',audienceType,audienceId,senderUid:uid,senderName:person.displayName,senderRole:roles[person.roleId].name,createdAt,system:false};}

before(async()=>{env=await initializeTestEnvironment({projectId:'demo-suja-life-tools',database:{host,port:Number(portString),rules:await readFile(new URL('../database.rules.json',import.meta.url),'utf8')}});});
beforeEach(async()=>{await env.clearDatabase();await seed({config:{masterUid:'master'},profiles, directory:profiles,roles});});
after(async()=>{await env?.cleanup();});

test('unauthenticated and anonymous identities cannot read or write operational data',async()=>{
 await saveDock(db('lead'));
 for(const database of [db(),db('lead','anonymous')]){
  await assertFails(get(r(database,'directory')));
  await assertFails(get(r(database,'docks/16/current')));
  await assertFails(update(r(database,'docks/16'),dockWrite({auditId:'attack'}).updates));
  await assertFails(set(r(database,'profiles/anonymous'),profiles.lead));
 }
});

test('pending profiles cannot view docks, activate themselves, change roles, or pin the Master',async()=>{
 const database=db('pending');
 await assertSucceeds(get(r(database,'profiles/pending')));
 await assertFails(get(r(database,'docks/16/current')));
 await assertFails(update(r(database,'profiles/pending'),{active:true,roleId:'master'}));
 await assertFails(set(r(database,'roles/lead'),roles.lead));
 await assertFails(set(r(database,'config/masterUid'),'pending'));
});

test('new password identity may create only its own inactive Viewer profile and exact directory mirror',async()=>{
 const database=db('newperson');
 const profile={uid:'newperson',displayName:'New Person',roleId:'viewer',active:false,createdAt:serverTimestamp()};
 await assertFails(set(r(database,'profiles/newperson'),profile));
 await assertFails(update(r(database,''),{'profiles/newperson':{...profile,active:true},'directory/newperson':{...profile,active:true}}));
 await assertSucceeds(update(r(database,''),{'profiles/newperson':profile,'directory/newperson':profile}));
 await assertFails(get(r(database,'docks/16/current')));
 await assertFails(update(r(database,'profiles/newperson'),{displayName:'Impersonated'}));
});

test('only configured Master can bootstrap active Master profile and roles',async()=>{
 await seed({config:{masterUid:'master'}});
 const profile={...profiles.master,createdAt:serverTimestamp()};
 await assertFails(update(r(db('intruder'),''),{'profiles/intruder':{...profile,uid:'intruder'},'directory/intruder':{...profile,uid:'intruder'},'roles/master':roles.master}));
 await assertSucceeds(update(r(db('master'),''),{'profiles/master':profile,'directory/master':profile,...Object.fromEntries(Object.entries(roles).map(([id,value])=>[`roles/${id}`,value]))}));
 await assertFails(set(r(db('master'),'config/masterUid'),'lead'));
});

test('Master provisions and assigns roles while preserving exact profile directory mirrors',async()=>{
 const database=db('master');
 const profile={uid:'teammate',displayName:'New Teammate',roleId:'viewer',active:true,createdAt:serverTimestamp()};
 await assertFails(set(r(database,'profiles/teammate'),profile));
 await assertSucceeds(update(r(database,''),{'profiles/teammate':profile,'directory/teammate':profile}));
 const stored=(await get(r(database,'directory/teammate'))).val();
 const assigned={...stored,roleId:'driver'};
 await assertSucceeds(update(r(database,''),{'profiles/teammate':assigned,'directory/teammate':assigned}));
 await assertFails(update(r(database,''),{'profiles/teammate':{...assigned,roleId:'master'},'directory/teammate':{...assigned,roleId:'master'}}));
 await assertFails(set(r(db('lead'),'roles/shipping'),{id:'shipping',name:'Shipping',permissions:{dockUpdate:true}}));
 await assertSucceeds(set(r(database,'roles/shipping'),{id:'shipping',name:'Shipping',permissions:{dockUpdate:true,messageSend:true}}));
 await assertFails(set(r(database,'roles/rogue'),{id:'rogue',name:'Rogue',permissions:{dockUpdate:true,usersManage:true}}));
});

test('active Viewer reads current dock and audit history but cannot update or administer',async()=>{
 await saveDock(db('lead'));
 const database=db('viewer');
 await assertSucceeds(get(r(database,'docks/16/current')));
 await assertSucceeds(get(r(database,'docks/16/history')));
 await assertFails(update(r(database,'docks/16'),dockWrite({uid:'viewer',auditId:'viewer-write',revision:2}).updates));
 await assertFails(set(r(database,'roles/shipping'),{id:'shipping',name:'Shipping',permissions:{dockUpdate:true}}));
});

test('authorized dock update atomically records current status and server time audit',async()=>{
 const database=db('lead');
 await assertSucceeds(saveDock(database,{status:'empty',trailerId:''}));
 const current=(await get(r(database,'docks/16/current'))).val(),history=(await get(r(database,`docks/16/history/${current.auditId}`))).val();
 assert.equal(current.revision,1);assert.equal(current.status,'empty');assert.equal(history.actorUid,'lead');assert.equal(history.actorName,'Alex');assert.equal(history.actorRole,'Lead');assert.equal(history.createdAt,current.updatedAt);assert.ok(Math.abs(history.createdAt-Date.now())<5000);
 const second=dockWrite({before:current,status:'loading',auditId:'audit-second'});
 await assertSucceeds(update(r(database,'docks/16'),second.updates));
 assert.equal((await get(r(database,'docks/16/current/revision'))).val(),2);
});

test('stale revision cannot overwrite a newer dock update',async()=>{
 const database=db('lead');await saveDock(database);
 await assertFails(update(r(database,'docks/16'),dockWrite({auditId:'stale',revision:1}).updates));
 assert.equal((await get(r(database,'docks/16/current/revision'))).val(),1);
});

test('current-only, event-only, actor/time forgery, child field writes, and deletion are denied',async()=>{
 const database=db('lead');const first=await saveDock(database);const current=(await get(r(database,'docks/16/current'))).val();
 const next=dockWrite({before:current,auditId:'next',status:'ready'});
 await assertFails(set(r(database,'docks/16/current'),next.current));
 await assertFails(set(r(database,'docks/16/history/next'),next.event));
 await assertFails(set(r(database,'docks/16/current/status'),'ready'));
 await assertFails(set(r(database,'docks/16/current'),null));
 await assertFails(set(r(database,`docks/16/history/${first.event.id}`),null));
 await assertFails(set(r(database,`docks/16/history/${first.event.id}/note`),'Changed audit'));
 for(const mutation of [
  w=>{w.current.updatedBy='master';w.event.actorUid='master';},
  w=>{w.current.updatedByName='Sean';w.event.actorName='Sean';},
  w=>{w.current.updatedByRole='Master';w.event.actorRole='Master';},
  w=>{w.current.updatedAt=Date.now()-10000;w.event.createdAt=w.current.updatedAt;},
  w=>{w.current.updatedAt=Date.now()+10000;w.event.createdAt=w.current.updatedAt;},
  w=>{w.event.fromStatus='ready';},
  w=>{w.event.revision=1;},
 ]){const w=dockWrite({before:current,auditId:'forged',status:'empty'});mutation(w);await assertFails(update(r(database,'docks/16'),{current:w.current,'history/forged':w.event}));}
});

test('ready requires lock confirmation and reopening a ready trailer requires a reason',async()=>{
 const database=db('lead');
 await assertFails(update(r(database,'docks/16'),dockWrite({status:'ready',lockedConfirmed:false}).updates));
 await saveDock(database,{status:'ready'});const before=(await get(r(database,'docks/16/current'))).val();
 await assertFails(update(r(database,'docks/16'),dockWrite({before,status:'loading',auditId:'reopen'}).updates));
 await assertSucceeds(update(r(database,'docks/16'),dockWrite({before,status:'loading',auditId:'reopen',note:'QA requested a load check.'}).updates));
});

test('expired cleanup may delete old history but never current or fresh audit',async()=>{
 await saveDock(db('lead'));const database=db('viewer'), old=dockWrite({auditId:'expired',time:Date.now()-TTL-5000}).event;
 await admin(database=>set(r(database,'docks/16/history/expired'),old));
 await assertSucceeds(set(r(database,'docks/16/history/expired'),null));
 await assertFails(set(r(database,'docks/16/history/audit-new'),null));
 await assertFails(set(r(database,'docks/16/current'),null));
 assert.equal((await get(r(database,'docks/16/current/status'))).val(),'loading');
});

test('team, role and personal message channels enforce audiences and sender identity',async()=>{
 const lead=db('lead'),viewer=db('viewer'),driver=db('driver');
 await assertSucceeds(set(r(lead,'messages/team/message-1'),message()));
 await assertSucceeds(get(r(viewer,'messages/team')));
 await assertFails(set(r(viewer,'messages/team/viewer-write'),message({id:'viewer-write',uid:'viewer'})));
 await assertSucceeds(set(r(lead,'messages/roles/driver/role-message'),message({id:'role-message',audienceType:'role',audienceId:'driver'})));
 await assertSucceeds(get(r(driver,'messages/roles/driver')));
 await assertFails(get(r(viewer,'messages/roles/driver')));
 await assertFails(get(r(lead,'messages')));
 await assertSucceeds(set(r(lead,'messages/users/viewer/personal-message'),message({id:'personal-message',audienceType:'user',audienceId:'viewer'})));
 await assertSucceeds(get(r(viewer,'messages/users/viewer')));
 await assertFails(get(r(driver,'messages/users/viewer')));
 const forged=message({id:'forged'});forged.senderUid='master';forged.senderName='Sean';forged.senderRole='Master';
 await assertFails(set(r(lead,'messages/team/forged'),forged));
 await assertFails(set(r(lead,'messages/roles/driver/mismatch'),message({id:'mismatch',audienceType:'team'})));
});

const notificationPreferences=()=>({statuses:{no_trailer:false,empty:true,loading:false,ready:true},teamMessages:true,roleMessages:true,directMessages:true});

test('active members own their notification preferences without access to another person, including Master',async()=>{
 const viewer=db('viewer'),lead=db('lead'),master=db('master'),settings=notificationPreferences();
 await assertSucceeds(set(r(viewer,'notificationPreferences/viewer'),settings));
 assert.deepEqual((await assertSucceeds(get(r(viewer,'notificationPreferences/viewer')))).val(),settings);
 await assertSucceeds(set(r(viewer,'notificationPreferences/viewer/statuses/loading'),true));
 assert.equal((await get(r(viewer,'notificationPreferences/viewer/statuses/loading'))).val(),true);
 for(const database of [lead,master]){
  await assertFails(get(r(database,'notificationPreferences/viewer')));
  await assertFails(set(r(database,'notificationPreferences/viewer'),settings));
  await assertFails(set(r(database,'notificationPreferences/viewer'),null));
 }
 await assertFails(get(r(viewer,'notificationPreferences')));
 await assertSucceeds(set(r(master,'notificationPreferences/master'),settings));
 await assertSucceeds(set(r(viewer,'notificationPreferences/viewer'),null));
 assert.equal((await get(r(viewer,'notificationPreferences/viewer'))).exists(),false);
});

test('notification preferences validate exact required boolean fields and reject access-related additions',async()=>{
 const database=db('viewer'),settings=notificationPreferences();
 for(const malformed of [
  {...settings,teamMessages:'true'},
  {...settings,directMessages:1},
  {...settings,statuses:{...settings.statuses,ready:'yes'}},
  {...settings,statuses:{...settings.statuses,unconfirmed:true}},
  {...settings,statuses:{no_trailer:false,empty:true,ready:true}},
  {...settings,roleId:'master'},
  {...settings,permissions:{dockUpdate:true}},
  {statuses:settings.statuses,teamMessages:true,roleMessages:true},
 ])await assertFails(set(r(database,'notificationPreferences/viewer'),malformed));
 await assertSucceeds(set(r(database,'notificationPreferences/viewer'),settings));
 await assertFails(set(r(database,'notificationPreferences/viewer/statuses/ready'),null));
 await assertFails(set(r(database,'notificationPreferences/viewer/roleMessages'),null));
});

test('notification preferences deny pending, unauthenticated, anonymous, and deactivated identities',async()=>{
 const settings=notificationPreferences();
 for(const [database,uid] of [[db('pending'),'pending'],[db(),'viewer'],[db('viewer','anonymous'),'viewer']]){
  await assertFails(get(r(database,`notificationPreferences/${uid}`)));
  await assertFails(set(r(database,`notificationPreferences/${uid}`),settings));
 }
 const viewer=db('viewer');
 await assertSucceeds(set(r(viewer,'notificationPreferences/viewer'),settings));
 const inactive={...profiles.viewer,active:false};
 await assertSucceeds(update(r(db('master'),''),{'profiles/viewer':inactive,'directory/viewer':inactive}));
 await assertFails(get(r(viewer,'notificationPreferences/viewer')));
 await assertFails(set(r(viewer,'notificationPreferences/viewer'),settings));
 await assertFails(set(r(viewer,'notificationPreferences/viewer'),null));
});

test('read receipts are owned, timestamped, and cannot forge another user',async()=>{
 const lead=db('lead'),viewer=db('viewer');await set(r(lead,'messages/team/message-1'),message());
 const createdAt=(await get(r(viewer,'messages/team/message-1/createdAt'))).val();
 await assertSucceeds(set(r(viewer,'readReceipts/viewer/message-1'),{createdAt,readAt:serverTimestamp()}));
 await assertFails(set(r(lead,'readReceipts/viewer/message-1'),{createdAt,readAt:serverTimestamp()}));
 await assertFails(get(r(lead,'readReceipts/viewer')));
 await assertFails(set(r(viewer,'readReceipts/viewer/future'),{createdAt:Date.now()+10000,readAt:serverTimestamp()}));
 await assertFails(set(r(viewer,'readReceipts/viewer/expired'),{createdAt:Date.now()-TTL-1000,readAt:serverTimestamp()}));
 await assertFails(set(r(viewer,'readReceipts/viewer/message-1'),{createdAt:createdAt-1000,readAt:serverTimestamp()}));
});


test('expired last audit deletion cannot authorize reusing its ID or a current-only update',async()=>{
 const database=db('lead');await saveDock(database);
 const current=(await get(r(database,'docks/16/current'))).val();
 const event=(await get(r(database,'docks/16/history/audit-new'))).val();
 const oldTime=Date.now()-TTL-1000;
 await admin(database=>set(r(database,'docks/16'),{current:{...current,updatedAt:oldTime},history:{'audit-new':{...event,createdAt:oldTime}}}));
 await assertSucceeds(set(r(db('viewer'),'docks/16/history/audit-new'),null));
 const reused=dockWrite({before:current,status:'empty',auditId:'audit-new'});
 await assertFails(update(r(database,'docks/16'),reused.updates));
 await assertFails(set(r(database,'docks/16/current'),{...reused.current,auditId:'different'}));
 await assertSucceeds(update(r(database,'docks/16'),dockWrite({before:current,status:'empty',auditId:'fresh-id'}).updates));
});

test('two simultaneous writers cannot both commit the same expected revision',async()=>{
 await saveDock(db('lead'));const before=(await get(r(db('lead'),'docks/16/current'))).val();
 const attempts=[
  update(r(db('lead'),'docks/16'),dockWrite({before,status:'empty',auditId:'race-lead'}).updates),
  update(r(db('driver'),'docks/16'),dockWrite({uid:'driver',before,status:'ready',auditId:'race-driver'}).updates)
 ];
 const results=await Promise.allSettled(attempts);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.filter(result=>result.status==='rejected').length,1);
 assert.equal((await get(r(db('lead'),'docks/16/current/revision'))).val(),2);
 assert.equal(Object.keys((await get(r(db('lead'),'docks/16/history'))).val()).length,2);
});

test('deactivation revokes operational access for an existing signed-in context',async()=>{
 const viewer=db('viewer');await saveDock(db('lead'));await assertSucceeds(get(r(viewer,'docks/16/current')));
 const inactive={...profiles.viewer,active:false};
 await assertSucceeds(update(r(db('master'),''),{'profiles/viewer':inactive,'directory/viewer':inactive}));
 await assertFails(get(r(viewer,'docks/16/current')));
 await assertFails(get(r(viewer,'messages/team')));
 await assertFails(set(r(viewer,'readReceipts/viewer/new'),{createdAt:serverTimestamp(),readAt:serverTimestamp()}));
});

test('fresh messages stay immutable while expired messages can be cleaned by a member',async()=>{
 await assertSucceeds(set(r(db('lead'),'messages/team/message-1'),message()));
 for(const uid of ['lead','viewer','master']){
  await assertFails(set(r(db(uid),'messages/team/message-1'),null));
  await assertFails(set(r(db(uid),'messages/team/message-1/body'),'Rewritten'));
 }
 const old=message({id:'expired-message',createdAt:Date.now()-TTL-1000});
 await admin(database=>set(r(database,'messages/team/expired-message'),old));
 await assertSucceeds(set(r(db('viewer'),'messages/team/expired-message'),null));
});
