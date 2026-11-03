import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { DEFAULT_ROLES, DOCK_IDS, TTL, DomainError, applyDockUpdate, normalizeName, loginEmail, safeText, validateRole, visibleEvents, messageVisible } from './domain.mjs';

initializeApp({databaseURL:'https://suja-life-tools-default-rtdb.firebaseio.com'});
const db=getDatabase(), auth=getAuth();
const masterUid=defineString('SUJA_MASTER_UID');
const root=db.ref('toolsV1');
const callable=handler=>onCall({region:'us-central1',maxInstances:10},async request=>{
  try {return await handler(request);}
  catch(error) {
    if(error instanceof HttpsError)throw error;
    if(error instanceof DomainError)throw new HttpsError(error.code,error.message);
    // Do not log callable payloads: account creation contains a passphrase.
    if(error?.code==='auth/email-already-exists')throw new HttpsError('already-exists','That display name already has an account.');
    if(error?.code==='auth/invalid-password')throw new HttpsError('invalid-argument','Use a passphrase with at least 8 characters.');
    console.error('Suja callable failed',error?.code||error?.name||'unknown');
    throw new HttpsError('internal','The update could not be completed. Please try again.');
  }
});
function authenticated(request) {
  if(!request.auth?.uid)throw new HttpsError('unauthenticated','Sign in to continue.');
  return request.auth.uid;
}
async function actor(request) {
  const uid=authenticated(request);
  const profile=(await root.child(`profiles/${uid}`).get()).val();
  if(!profile?.active)throw new HttpsError('permission-denied','Your account has not been activated by the Master.');
  if(profile.roleId==='master'&&uid!==masterUid.value())throw new HttpsError('permission-denied','This Master account is not configured for this project.');
  const role=(await root.child(`roles/${profile.roleId}`).get()).val();
  if(!role)throw new HttpsError('permission-denied','Your assigned role is unavailable.');
  return {...profile,uid,roleName:role.name,permissions:role.permissions||[]};
}
async function master(request) {
  const person=await actor(request);
  if(person.uid!==masterUid.value()||person.roleId!=='master')throw new HttpsError('permission-denied','Only the Master can manage accounts and roles.');
  return person;
}
function publicProfile(profile) {return {uid:profile.uid,displayName:profile.displayName,roleId:profile.roleId,active:profile.active};}

export const bootstrapMaster=callable(async request=>{
  const uid=authenticated(request);
  if(!masterUid.value()||uid!==masterUid.value())throw new HttpsError('permission-denied','Master setup is restricted to the configured Firebase UID.');
  const record=await auth.getUser(uid);
  const displayName=normalizeName(record.displayName||request.data?.displayName);
  if(record.email!==loginEmail(displayName))throw new HttpsError('failed-precondition','The Master account must use the generated display-name login address.');
  const profile={uid,displayName,roleId:'master',active:true,createdAt:Date.now()};
  const existing=(await root.child(`profiles/${uid}`).get()).val();
  if(existing)return {profile:existing};
  // An idempotent one-time bootstrap; never makes the first public registrant Master.
  await root.update({[`profiles/${uid}`]:profile,[`directory/${uid}`]:publicProfile(profile),...Object.fromEntries(Object.entries(DEFAULT_ROLES).map(([key,value])=>[`roles/${key}`,value]))});
  return {profile};
});
export const createUser=callable(async request=>{
  await master(request);
  const displayName=normalizeName(request.data?.displayName);
  const passphrase=request.data?.passphrase;
  if(typeof passphrase!=='string'||passphrase.length<8||passphrase.length>128)throw new HttpsError('invalid-argument','Use a passphrase with 8–128 characters.');
  const roleId=request.data?.roleId;
  if(typeof roleId!=='string'||!/^[a-z][a-z0-9_]{1,39}$/.test(roleId)||roleId==='master'||!(await root.child(`roles/${roleId}`).get()).exists())throw new HttpsError('invalid-argument','Choose an existing team role.');
  const record=await auth.createUser({email:loginEmail(displayName),password:passphrase,displayName,emailVerified:true});
  const profile={uid:record.uid,displayName,roleId,active:true,createdAt:Date.now()};
  try {await root.update({[`profiles/${record.uid}`]:profile,[`directory/${record.uid}`]:publicProfile(profile)});}
  catch(error){await auth.deleteUser(record.uid);throw error;}
  return publicProfile(profile);
});
export const assignRole=callable(async request=>{
  const person=await master(request);
  const {uid,roleId}=request.data||{};
  if(typeof uid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(uid)||uid===person.uid||roleId==='master')throw new HttpsError('invalid-argument','The Master account is protected.');
  if(typeof roleId!=='string'||!/^[a-z][a-z0-9_]{1,39}$/.test(roleId)||!(await root.child(`roles/${roleId}`).get()).exists())throw new HttpsError('invalid-argument','Choose an existing role.');
  const ref=root.child(`profiles/${uid}`), existing=(await ref.get()).val();
  if(!existing)throw new HttpsError('not-found','Account not found.');
  const active=request.data.active===undefined?existing.active:request.data.active===true;
  const updated={...existing,roleId,active,updatedAt:Date.now()};
  await root.update({[`profiles/${uid}`]:updated,[`directory/${uid}`]:publicProfile(updated)});
  await auth.updateUser(uid,{disabled:!active});
  if(!active)await auth.revokeRefreshTokens(uid);
  return publicProfile(updated);
});
export const saveRole=callable(async request=>{
  await master(request);
  const role=validateRole(request.data);
  await root.child(`roles/${role.id}`).set(role);
  return role;
});
export const updateDock=callable(async request=>{
  const person=await actor(request);
  const dockId=String(request.data?.dockId);
  if(!DOCK_IDS.includes(dockId))throw new HttpsError('invalid-argument','Choose dock 16, 17, 18, or 19.');
  const ref=root.child(`docks/${dockId}`), eventId=ref.child('history').push().key;
  const now=Date.now();
  // Keep an active value subscription through the transaction. A cold RTDB client
  // can invoke its transaction callback with cached null before loading remote data.
  // Warming and retaining the listener prevents a false revision conflict on a
  // subsequent update; the transaction still retries against concurrent changes.
  const keepWarm=()=>{};
  ref.on('value',keepWarm);
  try {
    await ref.once('value');
    const result=await ref.transaction(current=>applyDockUpdate(current,request.data,person,now,eventId),undefined,false);
    if(!result.committed)throw new HttpsError('aborted','This dock changed. Review the latest update.');
    // Messages include dock events directly, so no separate notification write can be lost.
    return {current:result.snapshot.child('current').val(),event:result.snapshot.child(`history/${eventId}`).val()};
  } finally {ref.off('value',keepWarm);}
});
export const getDockHistory=callable(async request=>{
  await actor(request);
  const dockId=String(request.data?.dockId);
  if(!DOCK_IDS.includes(dockId))throw new HttpsError('invalid-argument','Choose a valid dock.');
  const now=Date.now();
  const history=(await root.child(`docks/${dockId}/history`).orderByChild('createdAt').startAt(now-TTL+1).get()).val();
  return visibleEvents(history,now);
});
export const sendMessage=callable(async request=>{
  const person=await actor(request);
  if(person.roleId!=='master'&&!person.permissions.includes('message.send'))throw new HttpsError('permission-denied','Your role cannot send messages.');
  const body=safeText(request.data?.body,1500), type=request.data?.audienceType||'team';
  let audienceId=type==='team'?'team':safeText(request.data?.audienceId,128);
  if(!body||!['team','role','user'].includes(type))throw new HttpsError('invalid-argument','Enter a message and a valid audience.');
  if(type==='role'&&(!/^[a-z][a-z0-9_]{1,39}$/.test(audienceId)||!(await root.child(`roles/${audienceId}`).get()).exists()))throw new HttpsError('invalid-argument','Choose an existing role.');
  if(type==='user'&&(!/^[-A-Za-z0-9_]{1,128}$/.test(audienceId)||!(await root.child(`profiles/${audienceId}`).get()).child('active').val()))throw new HttpsError('invalid-argument','Choose an active teammate.');
  const now=Date.now(), ref=root.child('messages').push();
  const message={id:ref.key,body,audienceType:type,audienceId,senderUid:person.uid,senderName:person.displayName,senderRole:person.roleName,createdAt:now,expiresAt:now+TTL,system:false};
  await root.update({[`messages/${ref.key}`]:message,inboxVersion:now});
  return message;
});
export const getMessages=callable(async request=>{
  const person=await actor(request), now=Date.now();
  const manual=visibleEvents((await root.child('messages').orderByChild('createdAt').startAt(now-TTL+1).get()).val(),now);
  const receipts=(await root.child(`readReceipts/${person.uid}`).get()).val()||{};
  const messages=Object.values(manual).filter(m=>messageVisible(m,person));
  for(const dockId of DOCK_IDS) {
    const events=visibleEvents((await root.child(`docks/${dockId}/history`).orderByChild('createdAt').startAt(now-TTL+1).get()).val(),now);
    for(const event of Object.values(events)) {
      const labels={no_trailer:'No trailer',empty:'Empty trailer',loading:'Loading',ready:'Locked · ready for pickup'};
      messages.push({id:`dock_${dockId}_${event.id}`,body:`Dock ${dockId}: ${labels[event.status]}${event.trailerId?` · Trailer ${event.trailerId}`:''}${event.note?` — ${event.note}`:''}`,senderUid:event.actorUid,senderName:event.actorName,senderRole:event.actorRole,createdAt:event.createdAt,expiresAt:event.expiresAt,system:true,dockId,audienceType:'team',audienceId:'team'});
    }
  }
  return messages.sort((a,b)=>b.createdAt-a.createdAt).map(m=>({...m,read:!!receipts[m.id]}));
});
export const markRead=callable(async request=>{
  const person=await actor(request), id=request.data?.messageId;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(id))throw new HttpsError('invalid-argument','Choose a valid message.');
  let message;
  if(id.startsWith('dock_')) {
    const match=/^dock_(16|17|18|19)_([A-Za-z0-9_-]+)$/.exec(id);
    if(match)message=(await root.child(`docks/${match[1]}/history/${match[2]}`).get()).val();
  } else message=(await root.child(`messages/${id}`).get()).val();
  if(!message||message.createdAt<=Date.now()-TTL||(!id.startsWith('dock_')&&!messageVisible(message,person)))throw new HttpsError('not-found','Message is no longer available.');
  await root.child(`readReceipts/${person.uid}/${id}`).set({createdAt:message.createdAt,readAt:Date.now()});
  return {ok:true};
});
export const cleanupHistory=onSchedule({schedule:'every 5 minutes',region:'us-central1',timeZone:'America/Los_Angeles'},async()=>{
  const cutoff=Date.now()-TTL, updates={};
  for(const dockId of DOCK_IDS) {
    const old=await root.child(`docks/${dockId}/history`).orderByChild('createdAt').endAt(cutoff).get();
    old.forEach(child=>{updates[`docks/${dockId}/history/${child.key}`]=null;});
  }
  const oldMessages=await root.child('messages').orderByChild('createdAt').endAt(cutoff).get();
  oldMessages.forEach(child=>{updates[`messages/${child.key}`]=null;});
  const receipts=await root.child('readReceipts').get();
  receipts.forEach(user=>user.forEach(receipt=>{if(receipt.child('createdAt').val()<=cutoff)updates[`readReceipts/${user.key}/${receipt.key}`]=null;}));
  if(Object.keys(updates).length)await root.update(updates);
});
