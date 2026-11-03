import { createHash } from 'node:crypto';

export const TTL = 72 * 60 * 60 * 1000;
export const DOCK_IDS = ['16','17','18','19'];
export const STATUSES = ['no_trailer','empty','loading','ready'];
export const PERMISSIONS = ['dock.update','message.send','users.manage','roles.manage'];
export const DEFAULT_ROLES = {
  master: {id:'master',name:'Master',permissions:[...PERMISSIONS]},
  supervisor: {id:'supervisor',name:'Supervisor',permissions:['dock.update','message.send']},
  lead: {id:'lead',name:'Lead',permissions:['dock.update','message.send']},
  forklift_driver: {id:'forklift_driver',name:'Forklift Driver',permissions:['dock.update','message.send']},
  netsuite_operator: {id:'netsuite_operator',name:'NetSuite Operator',permissions:['dock.update','message.send']},
  viewer: {id:'viewer',name:'Viewer',permissions:[]}
};
export class DomainError extends Error {
  constructor(code,message) {super(message);this.code=code;}
}
export function normalizeName(value) {
  if (typeof value !== 'string') throw new DomainError('invalid-argument','Enter a display name.');
  const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>48||/[\u0000-\u001f\u007f]/.test(name)) throw new DomainError('invalid-argument','Display names must contain 2–48 characters.');
  return name;
}
export function loginEmail(name) {
  return `${createHash('sha256').update(normalizeName(name).toLowerCase()).digest('hex')}@users.suja-life-tools.invalid`;
}
export function safeText(value,max=1000) {
  if(value==null)return '';
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new DomainError('invalid-argument',`Text must be at most ${max} characters.`);
  return value.trim();
}
export function can(user,permission) {return !!user?.active && (user.roleId==='master'||user.permissions?.includes(permission));}
export function requirePermission(user,permission) {if(!can(user,permission))throw new DomainError('permission-denied','Your assigned role cannot perform this action.');}
export function visibleEvents(events,now) {return Object.fromEntries(Object.entries(events||{}).filter(([,e])=>Number.isFinite(e?.createdAt)&&e.createdAt>now-TTL&&e.createdAt<=now));}
export function applyDockUpdate(dock,payload,actor,now,eventId) {
  requirePermission(actor,'dock.update');
  const id=String(payload.dockId);
  if(!DOCK_IDS.includes(id)||!STATUSES.includes(payload.status))throw new DomainError('invalid-argument','Choose a valid dock and status.');
  const before=dock?.current||{dockId:id,status:'unconfirmed',trailerId:'',revision:0,updatedAt:null};
  if(!Number.isInteger(payload.expectedRevision)||payload.expectedRevision!==before.revision)throw new DomainError('aborted','This dock changed while you were editing. Review the latest status and try again.');
  const trailerId=payload.status==='no_trailer'?'':safeText(payload.trailerId,40);
  const note=safeText(payload.note,500);
  if(payload.status==='ready'&&payload.lockedConfirmed!==true)throw new DomainError('failed-precondition','Confirm the trailer is physically locked before marking it ready.');
  // Corrections are allowed, but ready/locked trailers cannot be edited back to loading accidentally.
  if(before.status==='ready'&&payload.status==='loading'&&!note)throw new DomainError('failed-precondition','Explain why the locked trailer is being reopened.');
  if(before.status===payload.status&&before.trailerId===trailerId&&!note)throw new DomainError('failed-precondition','Choose a new status, trailer number, or add an update note.');
  const current={dockId:id,status:payload.status,trailerId,lockedConfirmed:payload.status==='ready',revision:before.revision+1,updatedAt:now,updatedBy:actor.uid,updatedByName:actor.displayName,updatedByRole:actor.roleName};
  const event={id:eventId,dockId:id,fromStatus:before.status,status:payload.status,trailerId,lockedConfirmed:payload.status==='ready',previousTrailerId:before.trailerId||'',note,createdAt:now,expiresAt:now+TTL,actorUid:actor.uid,actorName:actor.displayName,actorRole:actor.roleName,revision:current.revision};
  return {current,history:{...visibleEvents(dock?.history,now),[eventId]:event}};
}
export function validateRole(input) {
  if(!/^[a-z][a-z0-9_]{1,39}$/.test(input?.id)||input.id==='master')throw new DomainError('invalid-argument','Use a unique lowercase role ID. The master role is protected.');
  const name=safeText(input.name,40);
  if(!name)throw new DomainError('invalid-argument','Enter a role name.');
  const permissions=Array.isArray(input.permissions)?[...new Set(input.permissions)]:[];
  if(permissions.some(p=>!PERMISSIONS.includes(p)))throw new DomainError('invalid-argument','Unknown role permission.');
  // Account/role administration is reserved for the configured master identity.
  if(permissions.some(p=>p==='users.manage'||p==='roles.manage'))throw new DomainError('invalid-argument','Account and role administration belong to the Master role.');
  return {id:input.id,name,permissions};
}
export function messageVisible(message,user) {
  return message && (message.senderUid===user.uid||message.audienceType==='team'||(message.audienceType==='role'&&message.audienceId===user.roleId)||(message.audienceType==='user'&&message.audienceId===user.uid));
}
