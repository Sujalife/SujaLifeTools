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
  const state={mode:options.demo?'demo':'setup',connected:false,user:null,docks:{},history:{},messages:[],users:{},roles:clone(ROLES),error:null};
  const emit=()=>{state.messages=cutoffEvents(state.messages);for(const id of DOCKS)state.history[id]=cutoffEvents(state.history[id]);for(const listener of listeners)listener(clone(state));};
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
      state.messages=(data.messages||[]).filter(m=>state.user&&(m.senderUid===state.user.uid||m.audienceType==='team'||(m.audienceType==='role'&&m.audienceId===state.user.roleId)||(m.audienceType==='user'&&m.audienceId===state.user.uid)));
      emit();
    };
    retentionMaintenance=()=>{for(const id of DOCKS)data.history[id]=cutoffEvents(data.history[id]);data.messages=cutoffEvents(data.messages);try{localStorage.setItem(key,JSON.stringify(data));}catch{}};
    function requirePermission(permission){if(!hasPermission(state.user,permission))throw Error('Your assigned role cannot perform this action.');}
    function requireMaster(){if(state.user?.roleId!=='master')throw Error('Only the Master can manage accounts and roles.');}
    api.login=async(displayName,passphrase)=>{validateName(displayName);if(!passphrase)throw Error('Enter a passphrase.');data.userId='demo-sean';data.users['demo-sean'].displayName=nameOf(displayName);persist();return clone(state.user);};
    api.logout=async()=>{data.userId=null;persist();};
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
    for(const method of ['login','updateDock','sendMessage','createUser','saveRole','assignRole','markRead','getDockHistory'])api[method]=unavailable;
    api.logout=async()=>{};emit();return api;
  }
  state.mode='live';
  const sdk=config.sdkVersion||'12.0.0';
  let appModule,authModule,dbModule,fnModule,app,auth,db,functions;
  try {
    [appModule,authModule,dbModule,fnModule]=await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${sdk}/firebase-app.js`),import(`https://www.gstatic.com/firebasejs/${sdk}/firebase-auth.js`),import(`https://www.gstatic.com/firebasejs/${sdk}/firebase-database.js`),import(`https://www.gstatic.com/firebasejs/${sdk}/firebase-functions.js`)
    ]);
    app=appModule.getApps().find(a=>a.name==='suja-life-tools')||appModule.initializeApp(config,'suja-life-tools');
    auth=authModule.getAuth(app);db=dbModule.getDatabase(app);functions=fnModule.getFunctions(app,config.functionsRegion||'us-central1');
    await authModule.setPersistence(auth,authModule.browserLocalPersistence);
  } catch {
    state.error='Firebase sign-in could not load. Check your connection and reload the page.';
    const unavailable=async()=>{throw Error(state.error);};
    for(const method of ['login','updateDock','sendMessage','createUser','saveRole','assignRole','markRead','getDockHistory'])api[method]=unavailable;
    api.logout=async()=>{};emit();return api;
  }
  const call=async(name,payload)=>{try{return(await fnModule.httpsCallable(functions,name)(payload)).data;}catch(error){throw Error(error.message?.replace(/^Firebase:\s*/,'')||'The update could not be completed.');}};
  let cleanups=[], currentAuthUser=null, generation=0, historyTimer, pendingLoginName=null;
  const clearSubscriptions=()=>{cleanups.forEach(fn=>fn());cleanups=[];if(historyTimer)clearInterval(historyTimer);};
  const clearOperational=()=>Object.assign(state,{connected:false,user:null,docks:{},history:{},messages:[],users:{},roles:clone(ROLES),error:null});
  function decorate(){if(!currentAuthUser||!state.users[currentAuthUser.uid])return;const profile=state.users[currentAuthUser.uid],role=state.roles[profile.roleId];state.user=profile.active?{...profile,roleName:role?.name||profile.roleId,permissions:role?.permissions||[]}:null;}
  const refreshMessages=async()=>{if(!state.user)return;const token=generation;try{const messages=await call('getMessages',{});if(token!==generation)return;state.messages=messages;emit();}catch(error){if(token!==generation)return;state.error=error.message;emit();}};
  const refreshHistory=async id=>{if(!state.user)return;const token=generation;try{const history=await call('getDockHistory',{dockId:id});if(token!==generation)return;state.history[id]=Object.values(history).sort((a,b)=>b.createdAt-a.createdAt);emit();}catch(error){if(token!==generation)return;state.error=error.message;emit();}};
  const watch=(path,callback)=>{const token=generation;const off=dbModule.onValue(dbModule.ref(db,path),snapshot=>{if(token===generation)callback(snapshot.val());},error=>{if(token!==generation)return;state.error=error.message;state.connected=false;emit();});cleanups.push(off);};
  const stopAuth=authModule.onAuthStateChanged(auth,async user=>{
    const token=++generation;clearSubscriptions();currentAuthUser=user;clearOperational();emit();
    if(!user)return;
    try{
      let profileSnapshot=await dbModule.get(dbModule.ref(db,`toolsV1/profiles/${user.uid}`));
      if(!profileSnapshot.exists()){await call('bootstrapMaster',{displayName:user.displayName||pendingLoginName});profileSnapshot=await dbModule.get(dbModule.ref(db,`toolsV1/profiles/${user.uid}`));}
      if(token!==generation)return;
      const profile=profileSnapshot.val();if(!profile?.active)throw Error('Your account has not been activated by the Master.');
      state.users[user.uid]=profile;decorate();
      watch('.info/connected',value=>{state.connected=!!value;emit();});
      watch('toolsV1/roles',value=>{state.roles=value||{};decorate();emit();});
      watch('toolsV1/directory',value=>{state.users=value||{};decorate();emit();});
      watch(`toolsV1/profiles/${user.uid}`,value=>{if(!value?.active){++generation;currentAuthUser=null;clearSubscriptions();clearOperational();state.error='Your account is inactive. Contact the Master.';}else{state.users[user.uid]=value;decorate();}emit();});
      watch('toolsV1/inboxVersion',()=>refreshMessages());
      for(const id of DOCKS)watch(`toolsV1/docks/${id}/current`,value=>{if(value)state.docks[id]=value;else delete state.docks[id];emit();refreshHistory(id);refreshMessages();});
      historyTimer=setInterval(()=>{for(const id of DOCKS)refreshHistory(id);refreshMessages();},60000);
      emit();
    }catch(error){if(token!==generation)return;state.error=error.message||'Your account is not yet enabled.';emit();}
  });
  api.login=async(displayName,passphrase)=>{
    let credential;
    try{pendingLoginName=validateName(displayName);state.error=null;credential=await authModule.signInWithEmailAndPassword(auth,await displayNameLoginAddress(displayName),passphrase);}
    catch{throw Error('Display name or passphrase did not match an active account.');}
    // Resolve only after the provisioned profile/bootstrap has loaded, not just Firebase Auth.
    return new Promise((resolve,reject)=>{
      let stop=null,finished=false;
      const timer=setTimeout(()=>finish(Error('Your account is still loading. Check the connection and try again.')),30000);
      function finish(error,user){if(finished)return;finished=true;clearTimeout(timer);stop?.();if(error)reject(error);else resolve(user);}
      const listener=snapshot=>{if(snapshot.user?.uid===credential.user.uid)finish(null,snapshot.user);else if(snapshot.error)finish(Error(snapshot.error));};
      stop=api.subscribe(listener);if(finished)stop();
    });
  };
  api.logout=async()=>{++generation;currentAuthUser=null;clearSubscriptions();clearOperational();emit();await authModule.signOut(auth);};
  api.updateDock=payload=>call('updateDock',payload);
  api.sendMessage=async payload=>{const message=await call('sendMessage',payload);await refreshMessages();return message;};
  api.createUser=payload=>call('createUser',payload);
  api.saveRole=payload=>call('saveRole',payload);
  api.assignRole=payload=>call('assignRole',payload);
  api.markRead=async id=>{await call('markRead',{messageId:id});await refreshMessages();};
  api.getDockHistory=async id=>{await refreshHistory(String(id));return state.history[String(id)]||[];};
  const oldDestroy=api.destroy;api.destroy=()=>{++generation;currentAuthUser=null;oldDestroy();clearSubscriptions();stopAuth();};emit();return api;
}
