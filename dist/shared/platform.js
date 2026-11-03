/* Shared by Suja Life Tools and Suja Dock Status. No passphrase is persisted here. */
const TTL=72*60*60*1000;
const DOCKS=['16','17','18','19'];
const ALL_PERMISSIONS=['dock.update','message.send','users.manage','roles.manage'];
const ROLES={master:{id:'master',name:'Master',permissions:ALL_PERMISSIONS},supervisor:{id:'supervisor',name:'Supervisor',permissions:['dock.update','message.send']},lead:{id:'lead',name:'Lead',permissions:['dock.update','message.send']},forklift_driver:{id:'forklift_driver',name:'Forklift Driver',permissions:['dock.update','message.send']},netsuite_operator:{id:'netsuite_operator',name:'NetSuite Operator',permissions:['dock.update','message.send']},viewer:{id:'viewer',name:'Viewer',permissions:[]}};
const clone=value=>structuredClone(value);
// Browser demo IDs identify local sample records, never authentication tokens.
const demoId=()=>typeof globalThis.crypto?.randomUUID==='function'?globalThis.crypto.randomUUID():`local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
const nameOf=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');
const cutoffEvents=(events,now=Date.now())=>(Array.isArray(events)?events:Object.values(events||{})).filter(e=>e.createdAt>now-TTL&&e.createdAt<=now).sort((a,b)=>b.createdAt-a.createdAt);
function validateName(value){const name=nameOf(value);if(name.length<2||name.length>48||/[\u0000-\u001f\u007f]/.test(name))throw Error('Display names must contain 2–48 characters.');return name;}
export async function displayNameLoginAddress(displayName) {
  const normalized=validateName(displayName).toLowerCase();
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
  return `${[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')}@users.suja-life-tools.invalid`;
}
export function hasPermission(user,permission){return !!user?.active&&(user.roleId==='master'||user.permissions?.includes(permission));}
function seedDemo(){
  const now=Date.now(), roles=clone(ROLES), users={
    'demo-sean':{uid:'demo-sean',displayName:'Sean',roleId:'master',active:true},
    'demo-alex':{uid:'demo-alex',displayName:'Alex',roleId:'lead',active:true},
    'demo-morgan':{uid:'demo-morgan',displayName:'Morgan',roleId:'forklift_driver',active:true}
  };
  const statuses=['no_trailer','empty','loading','ready'], docks={}, history={};
  DOCKS.forEach((id,i)=>{
    const createdAt=now-(i+1)*14*60000, status=statuses[i], who=i%2?'demo-morgan':'demo-alex';
    const event={id:`sample-${id}`,dockId:id,fromStatus:i===3?'loading':'no_trailer',status,trailerId:i?`SJ-${204+i}`:'',lockedConfirmed:status==='ready',note:i===3?'Trailer locked. Ready for shipping to collect.':i===2?'Production loading in progress.':'',createdAt,expiresAt:createdAt+TTL,actorUid:who,actorName:users[who].displayName,actorRole:roles[users[who].roleId].name,revision:1};
    docks[id]={dockId:id,status,trailerId:event.trailerId,lockedConfirmed:status==='ready',revision:1,updatedAt:createdAt,updatedBy:who,updatedByName:event.actorName,updatedByRole:event.actorRole};history[id]=[event];
  });
  return {version:1,updatedAt:now,userId:'demo-sean',roles,users,docks,history,messages:[{id:'demo-message',body:'Dock 19 is locked and ready for pickup. Please bring an empty replacement trailer.',audienceType:'team',audienceId:'team',senderUid:'demo-alex',senderName:'Alex',senderRole:'Lead',createdAt:now-10*60000,expiresAt:now-10*60000+TTL,system:false,read:false}]};
}
export async function createPlatform(config={},options={}) {
  const listeners=new Set();
  let clockOffset=0;
  const state={mode:options.demo?'demo':'setup',connected:false,user:null,account:null,docks:{},history:{},messages:[],users:{},roles:clone(ROLES),error:null};
  const emit=()=>{state.messages=cutoffEvents(state.messages,Date.now()+clockOffset);for(const id of DOCKS)state.history[id]=cutoffEvents(state.history[id],Date.now()+clockOffset);for(const listener of listeners)listener(clone(state));};
  const api={subscribe(listener){listeners.add(listener);listener(clone(state));return()=>listeners.delete(listener);},getSnapshot:()=>clone(state)};
  let retentionMaintenance=null;const ticker=setInterval(()=>{retentionMaintenance?.();emit();},30000);api.destroy=()=>{clearInterval(ticker);listeners.clear();};
  if(options.demo){
    const key='suja-life-tools.demo.v1';let data;
    try{data=JSON.parse(localStorage.getItem(key));}catch{}
    if(!data||data.version!==1)data=seedDemo();
    const persist=()=>{data.updatedAt=Date.now();try{localStorage.setItem(key,JSON.stringify(data));}catch{};render();};
    const render=()=>{
      Object.assign(state,{connected:true,mode:'demo',docks:data.docks,history:data.history,messages:data.messages,users:data.users,roles:data.roles,error:null});
      const profile=data.users[data.userId];state.user=profile?{...profile,roleName:data.roles[profile.roleId]?.name||profile.roleId,permissions:data.roles[profile.roleId]?.permissions||[]}:null;
      state.account=state.user?{...state.user,needsMasterSetup:false}:null;
      state.messages=(data.messages||[]).filter(m=>state.user&&(m.senderUid===state.user.uid||m.audienceType==='team'||(m.audienceType==='role'&&m.audienceId===state.user.roleId)||(m.audienceType==='user'&&m.audienceId===state.user.uid)));
      emit();
    };
    retentionMaintenance=()=>{for(const id of DOCKS)data.history[id]=cutoffEvents(data.history[id]);data.messages=cutoffEvents(data.messages);try{localStorage.setItem(key,JSON.stringify(data));}catch{}};
    function requirePermission(permission){if(!hasPermission(state.user,permission))throw Error('Your assigned role cannot perform this action.');}
    function requireMaster(){if(state.user?.roleId!=='master')throw Error('Only the Master can manage accounts and roles.');}
    api.login=async(displayName,passphrase)=>{validateName(displayName);if(!passphrase)throw Error('Enter a passphrase.');data.userId='demo-sean';data.users['demo-sean'].displayName=nameOf(displayName);persist();return clone(state.user);};
    api.logout=async()=>{data.userId=null;persist();};
    api.createAccount=api.login;
    api.updateDock=async payload=>{
      requirePermission('dock.update');const id=String(payload.dockId), before=data.docks[id];
      if(!DOCKS.includes(id)||!['no_trailer','empty','loading','ready'].includes(payload.status))throw Error('Choose a valid dock and status.');
      if(payload.expectedRevision!==(before?.revision||0))throw Error('This dock changed while you were editing. Review its latest status.');
      const trailerId=payload.status==='no_trailer'?'':String(payload.trailerId||'').trim(), note=String(payload.note||'').trim();
      if(payload.status==='ready'&&payload.lockedConfirmed!==true)throw Error('Confirm the trailer is physically locked before marking it ready.');
      if(trailerId.length>40||note.length>500)throw Error('Trailer number or note is too long.');
      if(before?.status==='ready'&&payload.status==='loading'&&!note)throw Error('Explain why the locked trailer is being reopened.');
      if(before?.status===payload.status&&before?.trailerId===trailerId&&!note)throw Error('Choose a new status, trailer number, or add an update note.');
      const now=Date.now(), person=state.user, event={id:demoId(),dockId:id,fromStatus:before?.status||'unconfirmed',status:payload.status,trailerId,lockedConfirmed:payload.status==='ready',previousTrailerId:before?.trailerId||'',note,createdAt:now,expiresAt:now+TTL,actorUid:person.uid,actorName:person.displayName,actorRole:person.roleName,revision:(before?.revision||0)+1};
      data.docks[id]={dockId:id,status:payload.status,trailerId,lockedConfirmed:payload.status==='ready',revision:event.revision,updatedAt:now,updatedBy:person.uid,updatedByName:person.displayName,updatedByRole:person.roleName};data.history[id]=[event,...cutoffEvents(data.history[id])];
      data.messages.unshift({id:`dock_${id}_${event.id}`,body:`Dock ${id}: ${payload.status==='ready'?'Locked · ready for pickup':payload.status.replace('_',' ')}${trailerId?` · Trailer ${trailerId}`:''}${note?` — ${note}`:''}`,senderUid:person.uid,senderName:person.displayName,senderRole:person.roleName,createdAt:now,expiresAt:now+TTL,system:true,dockId:id,audienceType:'team',audienceId:'team',read:false});persist();return {current:clone(data.docks[id]),event};
    };
    api.sendMessage=async payload=>{requirePermission('message.send');const body=String(payload.body||'').trim();if(!body||body.length>1500)throw Error('Enter a message of 1–1,500 characters.');const now=Date.now(), message={id:demoId(),body,audienceType:payload.audienceType||'team',audienceId:payload.audienceId||'team',senderUid:state.user.uid,senderName:state.user.displayName,senderRole:state.user.roleName,createdAt:now,expiresAt:now+TTL,system:false,read:false};data.messages.unshift(message);persist();return message;};
    api.createUser=async payload=>{requireMaster();const displayName=validateName(payload.displayName);if(typeof payload.passphrase!=='string'||payload.passphrase.length<8||payload.passphrase.length>128)throw Error('Use a passphrase with 8–128 characters.');if(!data.roles[payload.roleId]||payload.roleId==='master')throw Error('Choose a team role.');if(Object.values(data.users).some(u=>nameOf(u.displayName).toLowerCase()===displayName.toLowerCase()))throw Error('That display name already exists.');const user={uid:`demo-${demoId()}`,displayName,roleId:payload.roleId,active:true};data.users[user.uid]=user;persist();return user;};
    api.saveRole=async payload=>{requireMaster();if(!/^[a-z][a-z0-9_]{1,39}$/.test(payload.id)||payload.id==='master')throw Error('Use a unique lowercase role ID.');if(!payload.name?.trim()||payload.name.length>40)throw Error('Enter a role name with at most 40 characters.');if((payload.permissions||[]).some(p=>!['dock.update','message.send'].includes(p)))throw Error('Account administration belongs to Master.');const role={id:payload.id,name:payload.name.trim(),permissions:[...new Set(payload.permissions||[])]};data.roles[role.id]=role;persist();return role;};
    api.assignRole=async payload=>{requireMaster();if(!data.users[payload.uid]||payload.uid==='demo-sean'||payload.roleId==='master'||!data.roles[payload.roleId])throw Error('Choose an existing teammate and team role.');Object.assign(data.users[payload.uid],{roleId:payload.roleId,...(payload.active===undefined?{}:{active:!!payload.active})});persist();return data.users[payload.uid];};
    api.markRead=async id=>{const message=data.messages.find(m=>m.id===id);if(message)message.read=true;persist();};
    api.getDockHistory=async id=>cutoffEvents(data.history[String(id)]);
    const storageListener=event=>{if(event.key===key&&event.newValue){try{data=JSON.parse(event.newValue);render();}catch{}}};
    window.addEventListener('storage',storageListener);const oldDestroy=api.destroy;api.destroy=()=>{oldDestroy();window.removeEventListener('storage',storageListener);};
    persist();return api;
  }
  if(!config?.apiKey||!config?.projectId||!config?.appId){
    const unavailable=async()=>{throw Error('Live accounts are awaiting Firebase setup. Use Explore demo to preview the tool.');};
    for(const method of ['login','createAccount','updateDock','sendMessage','createUser','saveRole','assignRole','markRead','getDockHistory'])api[method]=unavailable;
    api.logout=async()=>{};emit();return api;
  }
  state.mode='live';
  const NAMESPACE='toolsV2',sdkVersion=config.sdkVersion||'12.0.0';
  let appModule,authModule,dbModule,app,auth,db;
  try {
    const modules=options.sdk||{};
    [appModule,authModule,dbModule]=await Promise.all([
      modules.app||import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app.js`),
      modules.auth||import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-auth.js`),
      modules.database||import(`https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-database.js`)
    ]);
    app=appModule.getApps().find(a=>a.name==='suja-life-tools')||appModule.initializeApp(config,'suja-life-tools');
    auth=authModule.getAuth(app);db=dbModule.getDatabase(app);
    await authModule.setPersistence(auth,authModule.browserLocalPersistence);
  } catch {
    state.error='Firebase sign-in could not load. Check your connection and reload the page.';
    const unavailable=async()=>{throw Error(state.error);};
    for(const method of ['login','createAccount','updateDock','sendMessage','createUser','saveRole','assignRole','markRead','getDockHistory'])api[method]=unavailable;
    api.logout=async()=>{};emit();return api;
  }
  let baseSubscriptions=[],activeSubscriptions=[],roleMessageOff=null,generation=0,currentAuthUser=null,profile=null,pinnedMaster=null,pinLoaded=false,profileLoaded=false,pendingLoginName=null,bootstrapping=false,creatingAccount=false,serverOffset=0,activeEpoch=0,activeStarted=false,roleChannel=null,lastCleanup=0;
  let rawHistory={},rawMessages={team:{},role:{},user:{}},receipts={};
  const serverNow=()=>Date.now()+serverOffset;
  const pathRef=path=>dbModule.ref(db,path?`${NAMESPACE}/${path}`:NAMESPACE);
  const permissionDenied=error=>/permission|denied/i.test(`${error?.code||''} ${error?.message||''}`);
  function friendlyError(error,fallback='The update could not be saved. Please try again.') {
    if(permissionDenied(error))return 'Your access or the workspace rules changed. Refresh and try again, or contact your master administrator.';
    if(/network|disconnected|unavailable/i.test(`${error?.code||''} ${error?.message||''}`))return 'The workspace could not connect. Check your connection and try again.';
    return error?.message||fallback;
  }
  function authError(error) {
    if(['auth/operation-not-allowed','auth/configuration-not-found'].includes(error?.code))return 'Sign-in has not been enabled for this workspace. Contact your master administrator.';
    if(error?.code==='auth/network-request-failed')return 'Sign-in could not connect. Check your connection and try again.';
    if(['auth/invalid-api-key','auth/app-not-authorized','auth/unauthorized-domain'].includes(error?.code))return 'This workspace’s sign-in configuration needs attention. Contact your master administrator.';
    if(error?.code==='auth/too-many-requests')return 'Too many sign-in attempts. Please wait a moment and try again.';
    if(error?.code==='auth/email-already-in-use')return 'That display name already has an account. Sign in or choose another display name.';
    if(error?.code==='auth/weak-password')return 'Use a passphrase with at least 8 characters.';
    return 'Display name or passphrase did not match an active account.';
  }
  function fromRole(value,id) {
    const map=value?.permissions||{};
    return {id:value?.id||id,name:value?.name||id,permissions:Array.isArray(map)?map:[...(map.dockUpdate?['dock.update']:[]),...(map.messageSend?['message.send']:[])]};
  }
  const toRole=role=>({id:role.id,name:role.name,permissions:{dockUpdate:role.permissions?.includes('dock.update')||false,messageSend:role.permissions?.includes('message.send')||false}});
  function clearActive() {
    ++activeEpoch;
    activeSubscriptions.forEach(off=>off());activeSubscriptions=[];roleMessageOff?.();roleMessageOff=null;roleChannel=null;activeStarted=false;
    rawHistory={};rawMessages={team:{},role:{},user:{}};receipts={};
    Object.assign(state,{user:null,docks:{},history:{},messages:[],users:{},roles:clone(ROLES)});
  }
  function clearAll() {baseSubscriptions.forEach(off=>off());baseSubscriptions=[];clearActive();profile=null;profileLoaded=false;provisioningPending=false;lastCleanup=0;pinLoaded=false;pinnedMaster=null;bootstrapping=false;state.account=null;state.connected=false;state.error=null;}
  function refreshIdentity() {
    if(!currentAuthUser){state.account=null;state.user=null;return;}
    const displayName=profile?.displayName||currentAuthUser.displayName||pendingLoginName||'Your account';
    state.account={uid:currentAuthUser.uid,displayName,roleId:profile?.roleId||'viewer',active:!!profile?.active,needsMasterSetup:!pinnedMaster,isConfiguredMaster:pinnedMaster===currentAuthUser.uid};
    const allowed=!!profile?.active&&(profile.roleId!=='master'||pinnedMaster===currentAuthUser.uid);
    if(!allowed){state.user=null;return;}
    const role=state.roles[profile.roleId];
    state.user={...profile,uid:currentAuthUser.uid,roleName:role?.name||profile.roleId,permissions:profile.roleId==='master'?[...ALL_PERMISSIONS]:(role?.permissions||[])};
  }
  function rebuildMessages() {
    const now=serverNow(),all=new Map();
    for(const channel of Object.values(rawMessages))for(const value of Object.values(channel||{}))if(value?.id)all.set(value.id,value);
    const labels={no_trailer:'No trailer',empty:'Empty trailer',loading:'Loading',ready:'Locked · ready for pickup'};
    for(const id of DOCKS){
      state.history[id]=cutoffEvents(rawHistory[id],now);
      for(const event of state.history[id])all.set(`dock_${id}_${event.id}`,{id:`dock_${id}_${event.id}`,body:`Dock ${id}: ${labels[event.status]||event.status}${event.trailerId?` · Trailer ${event.trailerId}`:''}${event.note?` — ${event.note}`:''}`,senderUid:event.actorUid,senderName:event.actorName,senderRole:event.actorRole,createdAt:event.createdAt,system:true,dockId:id,audienceType:'team',audienceId:'team'});
    }
    state.messages=cutoffEvents([...all.values()],now).map(message=>({...message,read:!!receipts[message.id]}));
  }
  function watch(path,callback,bucket=baseSubscriptions,{optional=false}={}) {
    const token=generation,epoch=activeEpoch,isActive=bucket===activeSubscriptions;
    const ref=path.startsWith('.info/')?dbModule.ref(db,path):pathRef(path);
    const off=dbModule.onValue(ref,snapshot=>{if(token===generation&&(!isActive||epoch===activeEpoch))callback(snapshot.val());},error=>{
      if(token!==generation||(isActive&&epoch!==activeEpoch))return;
      if(!optional)state.error=permissionDenied(error)&&!state.user?'Publish the version 2 database rules to finish workspace setup.':friendlyError(error);
      if(path==='config/masterUid'){pinLoaded=true;pinnedMaster=null;refreshIdentity();}
      emit();
    });bucket.push(off);return off;
  }
  async function bootstrapIfPinned() {
    if(!currentAuthUser||!pinLoaded||!profileLoaded||pinnedMaster!==currentAuthUser.uid||bootstrapping||(profile?.roleId==='master'&&profile?.active))return;
    const token=generation,person=currentAuthUser;bootstrapping=true;
    try {
      const displayName=validateName(profile?.displayName||person.displayName||pendingLoginName);
      const next={uid:person.uid,displayName,roleId:'master',active:true,createdAt:profile?.createdAt||dbModule.serverTimestamp()};
      const changes={[`profiles/${person.uid}`]:next,[`directory/${person.uid}`]:next};
      for(const [id,role] of Object.entries(ROLES))changes[`roles/${id}`]=toRole(role);
      await dbModule.update(pathRef(''),changes);
      if(token!==generation)return;
      const saved=await dbModule.get(pathRef(`profiles/${person.uid}`));if(token!==generation)return;profile=saved.val();state.error=null;refreshIdentity();startActive();emit();
    } catch(error){if(token===generation){state.error=permissionDenied(error)?'Publish the version 2 database rules to finish workspace setup.':friendlyError(error);refreshIdentity();emit();}}
    finally{if(token===generation)bootstrapping=false;}
  }
  let provisioningPending=false;
  async function ensurePendingProfile() {
    if(creatingAccount||provisioningPending||bootstrapping||!currentAuthUser||!profileLoaded||!pinLoaded||profile||pinnedMaster===currentAuthUser.uid)return;
    const name=currentAuthUser.displayName||pendingLoginName;if(!name)return;
    const token=generation;provisioningPending=true;
    try {
      const next={uid:currentAuthUser.uid,displayName:validateName(name),roleId:'viewer',active:false,createdAt:dbModule.serverTimestamp()};
      await dbModule.update(pathRef(''),{[`profiles/${next.uid}`]:next,[`directory/${next.uid}`]:next});
      const saved=await dbModule.get(pathRef(`profiles/${next.uid}`));if(token===generation){profile=saved.val();state.error=null;refreshIdentity();emit();}
    }catch(error){if(token===generation){state.error=permissionDenied(error)?'Publish the version 2 database rules to finish workspace setup.':friendlyError(error);emit();}}
    finally{if(token===generation)provisioningPending=false;}
  }
  function switchRoleChannel(roleId) {
    if(roleChannel===roleId)return;
    roleMessageOff?.();roleMessageOff=null;roleChannel=roleId;rawMessages.role={};rebuildMessages();emit();
    if(!roleId)return;
    const token=generation;
    roleMessageOff=dbModule.onValue(pathRef(`messages/roles/${roleId}`),snapshot=>{if(token!==generation||roleChannel!==roleId)return;rawMessages.role=snapshot.val()||{};rebuildMessages();emit();},error=>{if(token!==generation||roleChannel!==roleId)return;state.error=friendlyError(error);emit();});
  }
  function startActive() {
    refreshIdentity();
    if(!state.user){if(activeStarted)clearActive();refreshIdentity();return;}
    if(activeStarted){switchRoleChannel(state.user.roleId);return;}
    activeStarted=true;const person=currentAuthUser;
    watch('roles',value=>{state.roles=Object.fromEntries(Object.entries(value||{}).map(([id,role])=>[id,fromRole(role,id)]));refreshIdentity();emit();},activeSubscriptions);
    watch('directory',value=>{state.users=value||{};emit();},activeSubscriptions);
    for(const id of DOCKS){
      watch(`docks/${id}/current`,value=>{if(value)state.docks[id]=value;else delete state.docks[id];emit();},activeSubscriptions);
      watch(`docks/${id}/history`,value=>{rawHistory[id]=value||{};rebuildMessages();emit();},activeSubscriptions);
    }
    watch('messages/team',value=>{rawMessages.team=value||{};rebuildMessages();emit();},activeSubscriptions);
    watch(`messages/users/${person.uid}`,value=>{rawMessages.user=value||{};rebuildMessages();emit();},activeSubscriptions);
    watch(`readReceipts/${person.uid}`,value=>{receipts=value||{};rebuildMessages();emit();},activeSubscriptions);
    switchRoleChannel(state.user.roleId);
  }
  async function purgeExpired() {
    if(!state.user||!state.connected||serverNow()-lastCleanup<60000)return;
    lastCleanup=serverNow();const cutoff=serverNow()-TTL,changes={};
    for(const id of DOCKS)for(const [key,event] of Object.entries(rawHistory[id]||{}))if(Number.isFinite(event?.createdAt)&&event.createdAt<=cutoff)changes[`docks/${id}/history/${key}`]=null;
    const paths={team:'messages/team',role:`messages/roles/${state.user.roleId}`,user:`messages/users/${state.user.uid}`};
    for(const [channel,values] of Object.entries(rawMessages))for(const [key,message] of Object.entries(values||{}))if(Number.isFinite(message?.createdAt)&&message.createdAt<=cutoff)changes[`${paths[channel]}/${key}`]=null;
    for(const [key,receipt] of Object.entries(receipts))if(Number.isFinite(receipt?.createdAt)&&receipt.createdAt<=cutoff)changes[`readReceipts/${state.user.uid}/${key}`]=null;
    if(!Object.keys(changes).length)return;
    try{await dbModule.update(pathRef(''),changes);}catch{/* Later authorized open clients may retry retention cleanup. */}
  }
  retentionMaintenance=()=>{rebuildMessages();void purgeExpired();};
  const stopAuth=authModule.onAuthStateChanged(auth,user=>{
    ++generation;clearAll();currentAuthUser=user;
    if(!user){emit();return;}
    if(user.isAnonymous){currentAuthUser=null;state.error='Use a display name and passphrase to sign in to this workspace.';emit();void authModule.signOut(auth);return;}
    refreshIdentity();emit();
    watch('.info/connected',value=>{state.connected=!!value;emit();});
    watch('.info/serverTimeOffset',value=>{serverOffset=Number(value)||0;clockOffset=serverOffset;rebuildMessages();emit();},baseSubscriptions,{optional:true});
    watch(`profiles/${user.uid}`,value=>{profileLoaded=true;profile=value||null;refreshIdentity();startActive();state.error=null;emit();void bootstrapIfPinned();void ensurePendingProfile();});
    watch('config/masterUid',value=>{pinnedMaster=typeof value==='string'&&value?value:null;pinLoaded=true;refreshIdentity();startActive();emit();void bootstrapIfPinned();void ensurePendingProfile();});
  });
  const requireActive=()=>{if(!state.user)throw Error('Your account is waiting for activation by the Master.');return state.user;};
  const requirePermission=permission=>{const person=requireActive();if(!hasPermission(person,permission))throw Error('Your assigned role cannot perform this action.');return person;};
  const requireMaster=()=>{const person=requireActive();if(person.roleId!=='master'||person.uid!==pinnedMaster)throw Error('Only the Master can manage accounts and roles.');return person;};
  function validatePassphrase(passphrase){if(typeof passphrase!=='string'||passphrase.length<8||passphrase.length>128)throw Error('Use a passphrase with 8–128 characters.');}
  async function waitForAccount(uid) {
    const ready=snapshot=>snapshot.account?.uid===uid&&(snapshot.user||(profileLoaded&&pinLoaded)||snapshot.error);
    if(ready(state))return clone(state.user||state.account);
    return new Promise((resolve,reject)=>{
      let off=null,done=false;const timer=setTimeout(()=>finish(Error('Your account is still loading. Refresh the page and try again.')),15000);
      function finish(error,value){if(done)return;done=true;clearTimeout(timer);off?.();if(error)reject(error);else resolve(value);}
      off=api.subscribe(snapshot=>{if(ready(snapshot))finish(null,snapshot.user||snapshot.account);else if(snapshot.error)finish(Error(snapshot.error));});if(done)off();
    });
  }
  api.login=async(displayName,passphrase)=>{
    try{
      if(auth.currentUser&&!state.user)await api.logout();
      pendingLoginName=validateName(displayName);state.error=null;
      const credential=await authModule.signInWithEmailAndPassword(auth,await displayNameLoginAddress(displayName),passphrase);
      return await waitForAccount(credential.user.uid);
    }catch(error){if(error?.code)throw Error(authError(error));throw error;}
  };
  api.logout=async()=>{++generation;clearAll();currentAuthUser=null;emit();await authModule.signOut(auth);};
  api.createAccount=async(displayName,passphrase)=>{
    const name=validateName(displayName);validatePassphrase(passphrase);
    if(auth.currentUser)throw Error('Sign out before creating a different account.');
    pendingLoginName=name;creatingAccount=true;let created=null;
    try {
      const credential=await authModule.createUserWithEmailAndPassword(auth,await displayNameLoginAddress(name),passphrase);created=credential.user;
      await authModule.updateProfile(created,{displayName:name});
      const next={uid:created.uid,displayName:name,roleId:'viewer',active:false,createdAt:dbModule.serverTimestamp()};
      await dbModule.update(pathRef(''),{[`profiles/${created.uid}`]:next,[`directory/${created.uid}`]:next});
      const saved=await dbModule.get(pathRef(`profiles/${created.uid}`));profileLoaded=true;profile=saved.val();refreshIdentity();emit();void bootstrapIfPinned();
      return await waitForAccount(created.uid);
    } catch(error) {
      // Keep a genuine newly authenticated identity and its UID available when
      // rules have not yet been published. It still has no operational access.
      if(created){
        currentAuthUser=created;refreshIdentity();state.error=permissionDenied(error)?'Your account was created. Publish the version 2 database rules, then refresh to finish workspace setup.':friendlyError(error);emit();
        return clone(state.account);
      }
      if(error?.code?.startsWith('auth/'))throw Error(authError(error));
      throw Error(friendlyError(error));
    } finally {creatingAccount=false;}
  };
  api.createUser=async payload=>{
    requireMaster();const name=validateName(payload.displayName);validatePassphrase(payload.passphrase);
    if(!state.roles[payload.roleId]||payload.roleId==='master')throw Error('Choose an existing team role.');
    let secondaryApp=null,secondaryAuth=null,created=null;
    try {
      secondaryApp=appModule.initializeApp(config,`suja-tools-provision-${demoId()}`);secondaryAuth=authModule.getAuth(secondaryApp);
      await authModule.setPersistence(secondaryAuth,authModule.inMemoryPersistence);
      const credential=await authModule.createUserWithEmailAndPassword(secondaryAuth,await displayNameLoginAddress(name),payload.passphrase);created=credential.user;
      await authModule.updateProfile(created,{displayName:name});
      const next={uid:created.uid,displayName:name,roleId:payload.roleId,active:true,createdAt:dbModule.serverTimestamp()};
      await dbModule.update(pathRef(''),{[`profiles/${created.uid}`]:next,[`directory/${created.uid}`]:next});
      return {...next,createdAt:serverNow()};
    } catch(error) {
      if(created){try{await authModule.deleteUser(created);}catch{};}
      if(error?.code?.startsWith('auth/'))throw Error(authError(error));
      throw Error(friendlyError(error));
    } finally {
      if(secondaryAuth){try{await authModule.signOut(secondaryAuth);}catch{}}
      if(secondaryApp){try{await appModule.deleteApp(secondaryApp);}catch{}}
    }
  };
  api.assignRole=async payload=>{
    const person=requireMaster();
    if(!payload?.uid||payload.uid===person.uid||payload.roleId==='master'||!state.roles[payload.roleId])throw Error('Choose an existing teammate and team role.');
    const existing=state.users[payload.uid];if(!existing)throw Error('Account not found.');
    const next={uid:existing.uid,displayName:existing.displayName,roleId:payload.roleId,active:payload.active===undefined?existing.active:!!payload.active,createdAt:existing.createdAt};
    try{await dbModule.update(pathRef(''),{[`profiles/${next.uid}`]:next,[`directory/${next.uid}`]:next});return next;}catch(error){throw Error(friendlyError(error));}
  };
  api.saveRole=async payload=>{
    requireMaster();if(!/^[a-z][a-z0-9_]{1,39}$/.test(payload.id)||payload.id==='master')throw Error('Use a unique lowercase role ID. The Master role is protected.');
    const name=String(payload.name||'').trim();if(!name||name.length>40)throw Error('Enter a role name with at most 40 characters.');
    const permissions=[...new Set(payload.permissions||[])];if(permissions.some(permission=>!['dock.update','message.send'].includes(permission)))throw Error('Account administration belongs to Master.');
    const role={id:payload.id,name,permissions};try{await dbModule.set(pathRef(`roles/${role.id}`),toRole(role));return role;}catch(error){throw Error(friendlyError(error));}
  };
  api.updateDock=async payload=>{
    const person=requirePermission('dock.update'),id=String(payload.dockId),before=state.docks[id];
    if(!DOCKS.includes(id)||!['no_trailer','empty','loading','ready'].includes(payload.status))throw Error('Choose a valid dock and status.');
    if(!Number.isInteger(payload.expectedRevision)||payload.expectedRevision!==(before?.revision||0))throw Error('This dock changed while you were editing. Review the latest status and try again.');
    const trailerId=payload.status==='no_trailer'?'':String(payload.trailerId||'').trim(),note=String(payload.note||'').trim();
    if(trailerId.length>40||note.length>500)throw Error('Trailer number or note is too long.');
    if(payload.status==='ready'&&payload.lockedConfirmed!==true)throw Error('Confirm the trailer is physically locked before marking it ready.');
    if(before?.status==='ready'&&payload.status==='loading'&&!note)throw Error('Explain why the locked trailer is being reopened.');
    if(before?.status===payload.status&&before?.trailerId===trailerId&&!note)throw Error('Choose a new status, trailer number, or add an update note.');
    const eventId=dbModule.push(pathRef(`docks/${id}/history`)).key,revision=(before?.revision||0)+1,timestamp=dbModule.serverTimestamp();
    const current={dockId:id,status:payload.status,trailerId,lockedConfirmed:payload.status==='ready',revision,updatedAt:timestamp,updatedBy:person.uid,updatedByName:person.displayName,updatedByRole:person.roleName,auditId:eventId};
    const event={id:eventId,dockId:id,fromStatus:before?.status||'unconfirmed',status:payload.status,trailerId,previousTrailerId:before?.trailerId||'',note,lockedConfirmed:payload.status==='ready',createdAt:timestamp,actorUid:person.uid,actorName:person.displayName,actorRole:person.roleName,revision};
    try{await dbModule.update(pathRef(`docks/${id}`),{current,[`history/${eventId}`]:event});return {current:{...current,updatedAt:serverNow()},event:{...event,createdAt:serverNow()}};}
    catch(error){throw Error(permissionDenied(error)?'This dock changed or your role no longer allows this update. Review the latest status and try again.':friendlyError(error));}
  };
  api.sendMessage=async payload=>{
    const person=requirePermission('message.send'),body=String(payload.body||'').trim(),audienceType=payload.audienceType||'team',audienceId=audienceType==='team'?'team':String(payload.audienceId||'');
    if(!body||body.length>1500)throw Error('Enter a message of 1–1,500 characters.');
    if(!['team','role','user'].includes(audienceType))throw Error('Choose a valid message audience.');
    if(audienceType==='role'&&!state.roles[audienceId])throw Error('Choose an existing role.');
    if(audienceType==='user'&&!state.users[audienceId]?.active)throw Error('Choose an active teammate.');
    const channel=audienceType==='team'?'team':`${audienceType==='role'?'roles':'users'}/${audienceId}`,ref=dbModule.push(pathRef(`messages/${channel}`));
    const message={id:ref.key,body,audienceType,audienceId,senderUid:person.uid,senderName:person.displayName,senderRole:person.roleName,createdAt:dbModule.serverTimestamp(),system:false};
    try{await dbModule.set(ref,message);return {...message,createdAt:serverNow()};}catch(error){throw Error(friendlyError(error));}
  };
  api.markRead=async id=>{
    const person=requireActive(),message=state.messages.find(item=>item.id===id);if(!message)throw Error('Message is no longer available.');
    try{await dbModule.set(pathRef(`readReceipts/${person.uid}/${id}`),{createdAt:message.createdAt,readAt:dbModule.serverTimestamp()});}catch(error){throw Error(friendlyError(error));}
  };
  api.getDockHistory=async id=>{
    requireActive();if(!DOCKS.includes(String(id)))throw Error('Choose a valid dock.');return cutoffEvents(rawHistory[String(id)],serverNow());
  };
  const oldDestroy=api.destroy;api.destroy=()=>{++generation;clearAll();currentAuthUser=null;oldDestroy();stopAuth();};emit();return api;
}
