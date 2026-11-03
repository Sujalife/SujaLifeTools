import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatform,hasPermission} from '../dist/shared/platform.js';
import {publicRoleName} from '../dist/shared/profile-display.js';

globalThis.window={addEventListener(){},removeEventListener(){}};
const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const config={apiKey:'public-test-config',projectId:'demo-suja-life-tools',appId:'test-app'};
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};

// SDK boundary fake: Auth and database transport are replaced, not platform methods.
function fakeSdk({signedIn=true,masterPending=false,denyPreferenceReads=false,denyPreferenceWrites=false,optimisticPreferenceFailure=false}={}){
 const master={uid:'master',displayName:'Sean'},apps=[],authByName=new Map(),authListeners=new Map(),dbListeners=new Set(),accounts=new Map(),deletedUsers=[],deletedApps=[],persistence=[];
 const profile={uid:'master',displayName:'Sean',roleId:masterPending?'viewer':'master',active:!masterPending,createdAt:123456};
 const role=(id,name,dockUpdate=false,messageSend=false)=>({id,name,permissions:{dockUpdate,messageSend}});
 const data={toolsV2:{config:{masterUid:'master'},profiles:signedIn?{master:profile}:{},directory:signedIn?{master:profile}:{},roles:{master:role('master','Master',true,true),viewer:role('viewer','Viewer'),lead:role('lead','Lead',true,true)}}};
 let failWrites=false,sequence=0,signupCount=0;
 const at=path=>path.split('/').filter(Boolean).reduce((value,key)=>value?.[key],data);
 const snapshot=path=>({val:()=>path==='.info/connected'?true:path==='.info/serverTimeOffset'?0:structuredClone(at(path)??null),exists:()=>path.startsWith('.info/')||at(path)!=null});
 const resolveTime=(value,timestamp)=>value&&typeof value==='object'?(value['.sv']==='timestamp'?timestamp:Array.isArray(value)?value.map(item=>resolveTime(item,timestamp)):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveTime(v,timestamp)]))):value;
 function write(path,value,timestamp=Date.now()){const keys=path.split('/').filter(Boolean);let target=data;for(const key of keys.slice(0,-1))target=target[key]??={};if(value===null)delete target[keys.at(-1)];else target[keys.at(-1)]=resolveTime(value,timestamp);}
 function notifyDb(){for(const listener of [...dbListeners])queueMicrotask(()=>{if(dbListeners.has(listener))listener.callback(snapshot(listener.path));});}
 function notifyAuth(auth){for(const callback of authListeners.get(auth)||[])queueMicrotask(()=>callback(auth.currentUser));}
 const app={getApps:()=>apps,initializeApp:(_config,name)=>{const value={name};apps.push(value);return value;},deleteApp:async value=>{deletedApps.push(value.name);apps.splice(apps.indexOf(value),1);}};
 const auth={
  browserLocalPersistence:'local',inMemoryPersistence:'memory',
  getAuth(value){if(!authByName.has(value.name))authByName.set(value.name,{app:value,currentUser:value.name==='suja-life-tools'&&signedIn?master:null});return authByName.get(value.name);},
  async setPersistence(value,mode){persistence.push({name:value.app.name,mode});},
  onAuthStateChanged(value,callback){const listeners=authListeners.get(value)||new Set();listeners.add(callback);authListeners.set(value,listeners);queueMicrotask(()=>{if(listeners.has(callback))callback(value.currentUser);});return()=>listeners.delete(callback);},
  async signOut(value){value.currentUser=null;notifyAuth(value);},
  async createUserWithEmailAndPassword(value,email,_passphrase){signupCount++;if(accounts.has(email))throw Object.assign(Error('duplicate'),{code:'auth/email-already-in-use'});const user={uid:`new-${++sequence}`,email,displayName:null};accounts.set(email,user);value.currentUser=user;notifyAuth(value);return {user};},
  async updateProfile(user,patch){Object.assign(user,patch);},
  async deleteUser(user){deletedUsers.push(user.uid);accounts.delete(user.email);for(const value of authByName.values())if(value.currentUser?.uid===user.uid){value.currentUser=null;notifyAuth(value);}},
  async signInWithEmailAndPassword(value,email){const user=accounts.get(email);if(!user)throw Object.assign(Error('invalid'),{code:'auth/invalid-credential'});value.currentUser=user;notifyAuth(value);return {user};}
 };
 const database={
  getDatabase:()=>({}),ref:(_database,path)=>({path}),serverTimestamp:()=>({'.sv':'timestamp'}),push:value=>({path:`${value.path}/event-${++sequence}`,key:`event-${sequence}`}),
  onValue(value,callback,onError){const listener={path:value.path,callback};dbListeners.add(listener);queueMicrotask(()=>{if(!dbListeners.has(listener))return;if(denyPreferenceReads&&value.path.startsWith('toolsV2/notificationPreferences/')){dbListeners.delete(listener);onError?.(Object.assign(Error('rules denied'),{code:'PERMISSION_DENIED'}));return;}callback(value.path==='.info/connected'?{val:()=>true}:value.path==='.info/serverTimeOffset'?{val:()=>0}:snapshot(value.path));});return()=>dbListeners.delete(listener);},
  async get(value){return snapshot(value.path);},
  async update(value,changes){if(failWrites)throw Object.assign(Error('rules denied'),{code:'PERMISSION_DENIED'});const timestamp=Date.now();for(const [key,item] of Object.entries(changes))write(`${value.path}/${key}`,item,timestamp);notifyDb();},
  async set(value,item){
   if(failWrites)throw Object.assign(Error('rules denied'),{code:'PERMISSION_DENIED'});
   if(denyPreferenceWrites&&value.path.startsWith('toolsV2/notificationPreferences/')){
    if(optimisticPreferenceFailure){const before=structuredClone(at(value.path)??null);write(value.path,item);notifyDb();await settle();write(value.path,before);notifyDb();await settle();}
    throw Object.assign(Error('rules denied'),{code:'PERMISSION_DENIED'});
   }
   write(value.path,item);notifyDb();
  }
 };
 return {sdk:{app,auth,database},data,apps,accounts,deletedUsers,deletedApps,persistence,authByName,set failWrites(value){failWrites=value;},set denyPreferenceReads(value){denyPreferenceReads=value;},set denyPreferenceWrites(value){denyPreferenceWrites=value;},get signupCount(){return signupCount;},get mainAuth(){return authByName.get('suja-life-tools');},notifyDb};
}

test('creating a teammate uses temporary in-memory Auth and preserves the Master session',async()=>{
 const mock=fakeSdk(),platform=await createPlatform(config,{sdk:mock.sdk});
 try{
  await settle();assert.equal(platform.getSnapshot().user.uid,'master');const primary=mock.mainAuth.currentUser;
  const owner=platform.getSnapshot().user;
  assert.equal(publicRoleName(owner.roleId,owner.roleName),'NetSuite Operator');
  assert.equal(owner.roleId,'master');assert.equal(owner.roleName,'Master');
  assert.ok(hasPermission(owner,'users.manage'));assert.ok(hasPermission(owner,'roles.manage'));
  assert.equal(publicRoleName('lead','Lead'),'Lead');
  assert.equal(publicRoleName('','Master'),'NetSuite Operator');
  const created=await platform.createUser({displayName:'New Driver',passphrase:'private-test-passphrase',roleId:'lead'});await settle();
  assert.equal(mock.mainAuth.currentUser,primary);assert.equal(platform.getSnapshot().user.uid,'master');
  assert.equal(mock.data.toolsV2.profiles[created.uid].active,true);assert.equal(mock.data.toolsV2.profiles[created.uid].roleId,'lead');
  assert.deepEqual(mock.data.toolsV2.profiles[created.uid],mock.data.toolsV2.directory[created.uid]);
  assert.ok(mock.persistence.some(item=>item.name.startsWith('suja-tools-provision-')&&item.mode==='memory'));
  assert.equal(mock.apps.length,1);assert.equal(mock.deletedApps.length,1);assert.deepEqual(mock.deletedUsers,[]);
 }finally{platform.destroy();}
});

test('failed teammate provisioning rolls back only its temporary Auth account and can be retried',async()=>{
 const mock=fakeSdk(),platform=await createPlatform(config,{sdk:mock.sdk});
 try{
  await settle();const primary=mock.mainAuth.currentUser;mock.failWrites=true;
  await assert.rejects(platform.createUser({displayName:'Retry Driver',passphrase:'private-test-passphrase',roleId:'lead'}),/rules changed/);
  assert.equal(mock.mainAuth.currentUser,primary);assert.equal(mock.deletedUsers.length,1);assert.equal(mock.accounts.size,0);assert.equal(mock.apps.length,1);
  mock.failWrites=false;const user=await platform.createUser({displayName:'Retry Driver',passphrase:'private-test-passphrase',roleId:'lead'});
  assert.equal(mock.data.toolsV2.profiles[user.uid].displayName,'Retry Driver');assert.equal(mock.mainAuth.currentUser,primary);assert.equal(mock.accounts.size,1);
 }finally{platform.destroy();}
});

test('pending signup preserves its Auth UID across rules failure and recovers on reload',async()=>{
 const mock=fakeSdk({signedIn:false});mock.failWrites=true;let platform=await createPlatform(config,{sdk:mock.sdk});
 try{
  await settle();const account=await platform.createAccount('Pending Person','private-test-passphrase');await settle();
  assert.ok(account.uid);assert.equal(mock.mainAuth.currentUser.uid,account.uid);assert.equal(platform.getSnapshot().user,null);assert.equal(mock.deletedUsers.length,0);assert.equal(mock.signupCount,1);
  const uid=account.uid;platform.destroy();mock.failWrites=false;
  platform=await createPlatform(config,{sdk:mock.sdk});await settle();
  assert.equal(mock.signupCount,1);assert.equal(mock.data.toolsV2.profiles[uid].active,false);assert.equal(mock.data.toolsV2.profiles[uid].roleId,'viewer');assert.equal(platform.getSnapshot().account.uid,uid);assert.equal(platform.getSnapshot().user,null);
 }finally{platform.destroy();}
});

test('Console-pinned Master bootstraps an existing pending profile without replacing its creation time',async()=>{
 const mock=fakeSdk({masterPending:true}),platform=await createPlatform(config,{sdk:mock.sdk});
 try{
  await settle();assert.equal(platform.getSnapshot().user?.roleId,'master');
  assert.equal(mock.data.toolsV2.profiles.master.createdAt,123456);assert.equal(mock.data.toolsV2.directory.master.createdAt,123456);
  assert.equal(mock.data.toolsV2.profiles.master.active,true);assert.equal(mock.data.toolsV2.roles.forklift_driver.permissions.dockUpdate,true);
 }finally{platform.destroy();}
});


test('legacy sample workspace state cannot bypass live authentication and retires only its own storage',async()=>{
 storage.clear();
 storage.set('sujaToolsExploreDemo','1');
 storage.set('suja-life-tools.demo.v1',JSON.stringify({version:1,userId:'demo-sean',users:{'demo-sean':{uid:'demo-sean',displayName:'Sean',roleId:'master',active:true}},docks:{'16':{status:'ready',trailerId:'SAMPLE-1'}},messages:[{body:'Sample message'}]}));
 storage.set('sujaTheme','dark');
 storage.set('sujaToolsViewMode','compact');
 const authCacheKey='firebase:authUser:public-test-config:suja-life-tools';storage.set(authCacheKey,'existing-auth-cache');
 const mock=fakeSdk({signedIn:false}),platform=await createPlatform(config,{sdk:mock.sdk,demo:true});
 try{
  await settle();const state=platform.getSnapshot();
  assert.equal(state.mode,'live');assert.equal(state.user,null);assert.equal(state.account,null);
  assert.deepEqual(state.docks,{});assert.deepEqual(state.users,{});assert.deepEqual(state.messages,[]);
  assert.ok(Object.values(state.history).every(events=>events.length===0));
  assert.equal(mock.mainAuth.currentUser,null);assert.equal(mock.signupCount,0);
  await assert.rejects(platform.updateDock({dockId:'16',status:'ready',expectedRevision:0,lockedConfirmed:true}),/waiting for activation/);
  await assert.rejects(platform.login('Sean','sample-passphrase'),/did not match/);
  assert.equal(storage.has('sujaToolsExploreDemo'),false);assert.equal(storage.has('suja-life-tools.demo.v1'),false);
  assert.equal(storage.get('sujaTheme'),'dark');assert.equal(storage.get('sujaToolsViewMode'),'compact');assert.equal(storage.get(authCacheKey),'existing-auth-cache');
 }finally{platform.destroy();storage.clear();}
});

const allAlerts=()=>({statuses:{no_trailer:true,empty:true,loading:true,ready:true},teamMessages:true,roleMessages:true,directMessages:true});
const pickupAlerts=()=>({statuses:{no_trailer:false,empty:false,loading:false,ready:true},teamMessages:false,roleMessages:true,directMessages:false});

function seedInbox(mock){
 const now=Date.now();
 const events=Object.fromEntries(['no_trailer','empty','loading','ready'].map((status,index)=>[`change-${index}`,{id:`change-${index}`,dockId:'16',status,createdAt:now-5000+index*1000,actorUid:'master',actorName:'Sean',actorRole:'Master',trailerId:status==='no_trailer'?'':'SJ-21'}]));
 mock.data.toolsV2.docks={'16':{current:{dockId:'16',status:'ready',revision:4,trailerId:'SJ-21'},history:events}};
 const manual=(id,audienceType)=>({id,audienceType,createdAt:now-1000,body:`${audienceType} message`,senderUid:'master',senderName:'Sean',system:false});
 mock.data.toolsV2.messages={team:{'manual-team':manual('manual-team','team')},roles:{master:{'manual-role':manual('manual-role','role')}},users:{master:{'manual-direct':manual('manual-direct','user')}}};
}

test('personal alert choices filter selected dock statuses and manual channels without altering history or receipts',async()=>{
 storage.clear();const mock=fakeSdk();seedInbox(mock);const platform=await createPlatform(config,{sdk:mock.sdk});
 try{
  await settle();assert.equal(platform.getSnapshot().messages.length,7);assert.deepEqual(platform.getSnapshot().notificationPreferences,allAlerts());
  assert.deepEqual(await platform.saveNotificationPreferences(pickupAlerts()),{synced:true});await settle();
  let state=platform.getSnapshot();
  assert.deepEqual(state.messages.map(message=>message.id).sort(),['dock_16_change-3','manual-role']);
  assert.equal(state.history['16'].length,4);assert.equal(state.docks['16'].status,'ready');
  assert.deepEqual(mock.data.toolsV2.notificationPreferences.master,pickupAlerts());
  assert.equal(state.notificationPreferencesSync,'synced');
  await platform.markRead('dock_16_change-3');await settle();
  assert.equal(platform.getSnapshot().messages.find(message=>message.id==='dock_16_change-3').read,true);
  const noAlerts=allAlerts();for(const key of Object.keys(noAlerts.statuses))noAlerts.statuses[key]=false;noAlerts.teamMessages=false;noAlerts.roleMessages=false;noAlerts.directMessages=false;
  await platform.saveNotificationPreferences(noAlerts);await settle();assert.deepEqual(platform.getSnapshot().messages,[]);
  await platform.saveNotificationPreferences(allAlerts());await settle();state=platform.getSnapshot();
  assert.equal(state.messages.length,7);assert.equal(state.messages.find(message=>message.id==='dock_16_change-3').read,true);assert.equal(state.history['16'].length,4);
 }finally{platform.destroy();storage.clear();}
});

test('account alert preferences preserve false values and follow realtime changes while invalid saves are rejected',async()=>{
 storage.clear();const mock=fakeSdk();seedInbox(mock);mock.data.toolsV2.notificationPreferences={master:pickupAlerts()};const platform=await createPlatform(config,{sdk:mock.sdk});
 try{
  await settle();assert.deepEqual(platform.getSnapshot().notificationPreferences,pickupAlerts());
  assert.equal(platform.getSnapshot().notificationPreferencesSync,'synced');
  const emptyOnly=pickupAlerts();emptyOnly.statuses.ready=false;emptyOnly.statuses.empty=true;emptyOnly.roleMessages=false;
  mock.data.toolsV2.notificationPreferences.master=emptyOnly;mock.notifyDb();await settle();
  assert.deepEqual(platform.getSnapshot().notificationPreferences,emptyOnly);
  assert.deepEqual(platform.getSnapshot().messages.map(message=>message.id),['dock_16_change-1']);
  const missing=allAlerts();delete missing.statuses.ready;
  await assert.rejects(platform.saveNotificationPreferences(missing));
  await assert.rejects(platform.saveNotificationPreferences({...allAlerts(),teamMessages:'false'}));
  await assert.rejects(platform.saveNotificationPreferences({...allAlerts(),roleId:'master'}));
  assert.deepEqual(mock.data.toolsV2.notificationPreferences.master,emptyOnly);assert.equal(platform.getSnapshot().user.roleId,'master');
 }finally{platform.destroy();storage.clear();}
});

test('unavailable account sync keeps alert settings on this device per UID without breaking the workspace or leaking on logout',async()=>{
 storage.clear();const mock=fakeSdk({denyPreferenceReads:true,denyPreferenceWrites:true});seedInbox(mock);let platform=await createPlatform(config,{sdk:mock.sdk});
 try{
  await settle();assert.equal(platform.getSnapshot().user.uid,'master');assert.equal(platform.getSnapshot().error,null);assert.equal(platform.getSnapshot().notificationPreferencesSync,'device');
  const teammate=await platform.createUser({displayName:'Other Operator',passphrase:'private-test-passphrase',roleId:'lead'});await settle();
  assert.deepEqual(await platform.saveNotificationPreferences(pickupAlerts()),{synced:false});await settle();
  assert.deepEqual(platform.getSnapshot().messages.map(message=>message.id).sort(),['dock_16_change-3','manual-role']);assert.equal(platform.getSnapshot().error,null);
  assert.equal(mock.data.toolsV2.notificationPreferences?.master,undefined);
  platform.destroy();platform=await createPlatform(config,{sdk:mock.sdk});await settle();
  assert.deepEqual(platform.getSnapshot().notificationPreferences,pickupAlerts());assert.equal(platform.getSnapshot().user.uid,'master');
  await platform.logout();await settle();assert.deepEqual(platform.getSnapshot().messages,[]);assert.deepEqual(platform.getSnapshot().notificationPreferences,allAlerts());
  await platform.login('Other Operator','private-test-passphrase');await settle();
  assert.equal(platform.getSnapshot().user.uid,teammate.uid);assert.deepEqual(platform.getSnapshot().notificationPreferences,allAlerts());assert.equal(platform.getSnapshot().error,null);
 }finally{platform.destroy();storage.clear();}
});

test('a denied optimistic preferences write cannot replace the chosen device settings with the server rollback',async()=>{
 storage.clear();const mock=fakeSdk({denyPreferenceWrites:true,optimisticPreferenceFailure:true});seedInbox(mock);mock.data.toolsV2.notificationPreferences={master:allAlerts()};let platform=await createPlatform(config,{sdk:mock.sdk});
 try{
  await settle();assert.equal(platform.getSnapshot().notificationPreferencesSync,'synced');
  assert.deepEqual(await platform.saveNotificationPreferences(pickupAlerts()),{synced:false});await settle();
  const state=platform.getSnapshot();
  assert.deepEqual(mock.data.toolsV2.notificationPreferences.master,allAlerts());
  assert.deepEqual(state.notificationPreferences,pickupAlerts());assert.equal(state.notificationPreferencesSync,'device');assert.equal(state.error,null);
  assert.deepEqual(state.messages.map(message=>message.id).sort(),['dock_16_change-3','manual-role']);
  platform.destroy();mock.denyPreferenceReads=true;platform=await createPlatform(config,{sdk:mock.sdk});await settle();
  assert.deepEqual(platform.getSnapshot().notificationPreferences,pickupAlerts());assert.equal(platform.getSnapshot().notificationPreferencesSync,'device');
 }finally{platform.destroy();storage.clear();}
});
