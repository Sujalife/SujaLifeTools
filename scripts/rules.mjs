import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// All application authorization lives in Realtime Database rules; no Cloud Functions.
// Console-only Master pin: toolsV2/config/masterUid. Never grant a first-visitor claim.
const ns="root.child('toolsV2')";
const password="auth != null && auth.token.firebase.sign_in_provider === 'password'";
const pinned=`(${password} && auth.uid === ${ns}.child('config/masterUid').val())`;
const profile=`${ns}.child('profiles').child(auth.uid)`;
const role=`${ns}.child('roles').child(${profile}.child('roleId').val())`;
const active=`(${password} && ${profile}.child('active').val() === true)`;
const member=`(${password} && (${pinned} || ${profile}.child('active').val() === true))`;
const permission=key=>`(${active} && (${pinned} || ${role}.child('permissions/${key}').val() === true))`;
const TTL=259200000;
const and=(...parts)=>parts.filter(Boolean).map(s=>`(${s})`).join(' && ');
const string=(max,min=0)=>`newData.isString() && newData.val().length >= ${min} && newData.val().length <= ${max}`;
const boolean='newData.isBoolean()';
const snapshotFields=(target,fields)=>fields.map(f=>`newData.child('${f}').val() === ${target}.child('${f}').val()`).join(' && ');
const record=(fields,extra='')=>({'.validate':and(`newData.hasChildren(${JSON.stringify(Object.keys(fields))})`,extra),...Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{'.validate':value}])),'$other':{'.validate':false}});

function profileRules(mirrorPath){
  const counterpart=`newData.parent().parent().child('${mirrorPath}').child($uid)`;
  return {
    '.read':`${password} && auth.uid === $uid`,
    '.write':and('newData.exists()',`(${pinned} || (${password} && auth.uid === $uid && !data.exists() && newData.child('active').val() === false && newData.child('roleId').val() === 'viewer'))`),
    ...record({
      uid:"newData.isString() && newData.val() === $uid && $uid.matches(/^[-A-Za-z0-9_]{1,128}$/)",
      displayName:and(string(48,2),"!data.exists() || newData.val() === data.val()"),
      roleId:and(string(40,2),"newData.val().matches(/^[a-z][a-z0-9_]{1,39}$/)"),
      active:boolean,
      createdAt:"newData.isNumber() && ((!data.exists() && newData.val() === now) || (data.exists() && newData.val() === data.val()))"
    },and(
      snapshotFields(counterpart,['uid','displayName','roleId','active','createdAt']),
      `($uid === ${ns}.child('config/masterUid').val() ? newData.child('roleId').val() === 'master' && newData.child('active').val() === true : newData.child('roleId').val() !== 'master')`,
      `(newData.child('active').val() === false && newData.child('roleId').val() === 'viewer') || newData.parent().parent().child('roles').child(newData.child('roleId').val()).exists()`
    ))
  };
}

function roleRules(){return {
  '.write':and(pinned,'newData.exists()'),
  ...record({
    id:"newData.isString() && newData.val() === $role && $role.matches(/^[a-z][a-z0-9_]{1,39}$/)",
    name:string(40,1),
    permissions:"newData.hasChildren(['dockUpdate','messageSend'])"
  },"$role !== 'master' || (newData.child('name').val() === 'Master' && newData.child('permissions/dockUpdate').val() === true && newData.child('permissions/messageSend').val() === true)"),
  permissions:{'.validate':"newData.hasChildren(['dockUpdate','messageSend'])",dockUpdate:{'.validate':boolean},messageSend:{'.validate':boolean},'$other':{'.validate':false}}
};}

function dockRules(){
  const freshEvent="newData.parent().child('history').child(newData.child('auditId').val())";
  const futureCurrent="newData.parent().parent().child('current')";
  const oldCurrent="data.parent().parent().child('current')";
  const actorChecks=and(
    `newData.child('actorUid').val() === auth.uid`,
    `newData.child('actorName').val() === ${profile}.child('displayName').val()`,
    `newData.child('actorRole').val() === ${role}.child('name').val()`
  );
  const currentFields={
    dockId:"newData.isString() && newData.val() === $dock",
    status:"newData.isString() && (newData.val() === 'no_trailer' || newData.val() === 'empty' || newData.val() === 'loading' || newData.val() === 'ready')",
    trailerId:string(40),lockedConfirmed:boolean,
    revision:"newData.isNumber() && newData.val() % 1 === 0 && newData.val() >= 1",
    updatedAt:'newData.isNumber() && newData.val() === now',
    updatedBy:`newData.isString() && newData.val() === auth.uid`,
    updatedByName:`newData.isString() && newData.val() === ${profile}.child('displayName').val()`,
    updatedByRole:`newData.isString() && newData.val() === ${role}.child('name').val()`,
    auditId:"newData.isString() && newData.val().matches(/^[-A-Za-z0-9_]{1,128}$/)"
  };
  const eventFields={
    id:"newData.isString() && newData.val() === $event && $event.matches(/^[-A-Za-z0-9_]{1,128}$/)",
    dockId:currentFields.dockId,
    fromStatus:"newData.isString() && (newData.val() === 'unconfirmed' || newData.val() === 'no_trailer' || newData.val() === 'empty' || newData.val() === 'loading' || newData.val() === 'ready')",
    status:currentFields.status,trailerId:string(40),previousTrailerId:string(40),note:string(500),lockedConfirmed:boolean,
    createdAt:'newData.isNumber() && newData.val() === now',
    actorUid:`newData.isString() && newData.val() === auth.uid`,
    actorName:`newData.isString() && newData.val() === ${profile}.child('displayName').val()`,
    actorRole:`newData.isString() && newData.val() === ${role}.child('name').val()`,
    revision:currentFields.revision
  };
  return {
    '.validate':"($dock === '16' || $dock === '17' || $dock === '18' || $dock === '19') && newData.hasChild('current')",
    current:{
      '.read':member,
      '.write':and(permission('dockUpdate'),'newData.exists()'),
      ...record(currentFields,and(
        `newData.child('revision').val() === (data.exists() ? data.child('revision').val() + 1 : 1)`,
        "newData.child('lockedConfirmed').val() === (newData.child('status').val() === 'ready')",
        "newData.child('status').val() !== 'no_trailer' || newData.child('trailerId').val() === ''",
        `!data.parent().child('history').child(newData.child('auditId').val()).exists()`,
        `!data.exists() || newData.child('auditId').val() !== data.child('auditId').val()`,
        `${freshEvent}.child('id').val() === newData.child('auditId').val()`,
        `${freshEvent}.child('dockId').val() === $dock`,
        `${freshEvent}.child('status').val() === newData.child('status').val()`,
        `${freshEvent}.child('trailerId').val() === newData.child('trailerId').val()`,
        `${freshEvent}.child('lockedConfirmed').val() === newData.child('lockedConfirmed').val()`,
        `${freshEvent}.child('revision').val() === newData.child('revision').val()`,
        `${freshEvent}.child('createdAt').val() === now`,
        `${freshEvent}.child('actorUid').val() === newData.child('updatedBy').val()`,
        `${freshEvent}.child('actorName').val() === newData.child('updatedByName').val()`,
        `${freshEvent}.child('actorRole').val() === newData.child('updatedByRole').val()`
      ))
    },
    history:{
      '.read':member,'.indexOn':['createdAt'],
      '$event':{
        '.write':`((${permission('dockUpdate')} && !data.exists() && newData.exists()) || (${member} && data.exists() && !newData.exists() && data.child('createdAt').isNumber() && data.child('createdAt').val() <= now - ${TTL}))`,
        ...record(eventFields,and(
          actorChecks,
          `${futureCurrent}.child('auditId').val() === $event`,
          `${futureCurrent}.child('revision').val() === newData.child('revision').val()`,
          `${futureCurrent}.child('status').val() === newData.child('status').val()`,
          `${futureCurrent}.child('trailerId').val() === newData.child('trailerId').val()`,
          `${futureCurrent}.child('lockedConfirmed').val() === newData.child('lockedConfirmed').val()`,
          `${futureCurrent}.child('updatedAt').val() === now`,
          `${futureCurrent}.child('updatedBy').val() === auth.uid`,
          `newData.child('fromStatus').val() === (${oldCurrent}.exists() ? ${oldCurrent}.child('status').val() : 'unconfirmed')`,
          `newData.child('previousTrailerId').val() === (${oldCurrent}.exists() ? ${oldCurrent}.child('trailerId').val() : '')`,
          `(newData.child('fromStatus').val() !== 'ready' || newData.child('status').val() !== 'loading' || newData.child('note').val().length > 0)`,
          `(newData.child('fromStatus').val() !== newData.child('status').val() || newData.child('previousTrailerId').val() !== newData.child('trailerId').val() || newData.child('note').val().length > 0)`,
          "newData.child('lockedConfirmed').val() === (newData.child('status').val() === 'ready')",
          "newData.child('status').val() !== 'no_trailer' || newData.child('trailerId').val() === ''"
        ))
      }
    },
    '$other':{'.validate':false}
  };
}

function messageRules(type,idExpression){return {
  '.write':`((${permission('messageSend')} && !data.exists() && newData.exists()) || (${member} && data.exists() && !newData.exists() && data.child('createdAt').isNumber() && data.child('createdAt').val() <= now - ${TTL}))`,
  ...record({
    id:"newData.isString() && newData.val() === $message && $message.matches(/^[-A-Za-z0-9_]{1,128}$/)",
    body:string(1500,1),
    audienceType:`newData.val() === '${type}'`,
    audienceId:`newData.isString() && newData.val() === ${idExpression}`,
    senderUid:'newData.isString() && newData.val() === auth.uid',
    senderName:`newData.isString() && newData.val() === ${profile}.child('displayName').val()`,
    senderRole:`newData.isString() && newData.val() === ${role}.child('name').val()`,
    createdAt:'newData.isNumber() && newData.val() === now',
    system:'newData.val() === false'
  },type==='role'?`${ns}.child('roles').child($role).exists()`:type==='user'?`${ns}.child('profiles').child($recipient).child('active').val() === true`:'')
};}

function notificationPreferenceRules(){return {
  '.read':and(active,'auth.uid === $uid'),
  // Deleting one's own whole record resets preferences; required children cannot be deleted individually.
  '.write':and(active,'auth.uid === $uid',"$uid.matches(/^[-A-Za-z0-9_]{1,128}$/)"),
  ...record({
    statuses:"newData.hasChildren(['no_trailer','empty','loading','ready'])",
    teamMessages:boolean,roleMessages:boolean,directMessages:boolean
  }),
  statuses:record({no_trailer:boolean,empty:boolean,loading:boolean,ready:boolean})
};}

export function generateRules(){return {rules:{'.read':false,'.write':false,toolsV2:{
  config:{'.read':password,'.write':false},
  profiles:{'$uid':profileRules('directory')},
  directory:{'.read':member,'$uid':profileRules('profiles')},
  roles:{'.read':member,'$role':roleRules()},
  docks:{'$dock':dockRules()},
  messages:{
    team:{'.read':member,'.indexOn':['createdAt'],'$message':messageRules('team',"'team'")},
    roles:{'$role':{'.read':and(active,`${profile}.child('roleId').val() === $role`),'.indexOn':['createdAt'],'$message':messageRules('role','$role')}},
    users:{'$recipient':{'.read':and(active,'auth.uid === $recipient'),'.indexOn':['createdAt'],'$message':messageRules('user','$recipient')}}
  },
  notificationPreferences:{'$uid':notificationPreferenceRules()},
  readReceipts:{'$uid':{
    '.read':and(active,'auth.uid === $uid'),'.indexOn':['createdAt'],
    '$message':{
      '.write':and(active,'auth.uid === $uid',"$message.matches(/^[-A-Za-z0-9_]{1,180}$/)",`newData.exists() || (data.exists() && data.child('createdAt').isNumber() && data.child('createdAt').val() <= now - ${TTL})`),
      ...record({createdAt:`newData.isNumber() && newData.val() <= now && newData.val() > now - ${TTL} && (!data.exists() || newData.val() === data.val())`,readAt:'newData.isNumber() && newData.val() === now'})
    }
  }}
}}};}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const destination=resolve(import.meta.dirname,'..','database.rules.json');
  await writeFile(destination,JSON.stringify(generateRules(),null,2)+'\n');
  console.log('Generated database.rules.json (toolsV2 direct RTDB, Console-pinned Master).');
}
