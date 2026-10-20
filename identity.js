// Durable local identity. Only this allowlisted document is ever persisted.
const encode=new TextEncoder(),decode=new TextDecoder();
const b64=b=>{const bytes=new Uint8Array(b),parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(parts.join(''));};
const un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const text=(v,n)=>typeof v==='string'?v.slice(0,n):'';
export function image(v,limit=220000){return typeof v==='string'&&v.length<=limit&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)?v:'';}
export function invitation(input){
 let code=String(input).trim();
 try{if(code.includes('://')){const u=new URL(code);if(!['https:','http:'].includes(u.protocol))throw Error();code=u.hash.slice(1);}const token=JSON.parse(decode.decode(Uint8Array.from(atob(code.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));if(token.v!==1||!/^[-\w]{24}$/.test(token.r)||!/^[-\w]{43}$/.test(token.k))throw Error();return {id:token.r,code};}catch{throw Error('That lounge code is not valid.');}
}
export function design(d={}){
 const modes=['ambient','watch','whiteboard','chess','emulator','tasks','news'];
 const rooms=Array.isArray(d.rooms)?d.rooms.slice(0,40).map((r,i)=>({id:/^[\w-]{1,40}$/.test(r.id)&&!['__proto__','constructor','prototype'].includes(r.id)?r.id:`room-${i}`,name:text(r.name,40)||'Room',icon:text(r.icon,8),mode:modes.includes(r.mode)?r.mode:'ambient'})):[];
 if(new Set(rooms.map(r=>r.id)).size!==rooms.length)throw Error('Duplicate room IDs in design.');
 return {name:text(d.name,40)||'My lounge',logo:image(d.logo,70000),background:image(d.background),accent:/^#[a-f\d]{6}$/i.test(d.accent)?d.accent:'#d4a06c',rooms};
}
export function validate(v){
 if(!v||v.format!=='orbit-id'||v.version!==1||typeof v.name!=='string'||!Array.isArray(v.lounges)||!Array.isArray(v.templates)||v.lounges.length>50||v.templates.length>12)throw Error('This is not a supported ORBIT ID card.');
 const lounges=[];for(const raw of v.lounges){const entry=invitation(raw.code);if(lounges.some(l=>l.id===entry.id))continue;lounges.push({...entry,name:text(raw.name,40)||'Saved lounge',logo:image(raw.logo,70000),alias:text(raw.alias,40),auto:!!raw.auto,design:raw.design?design(raw.design):null});}
 const settings={};const rules={skin:v=>['orbit','buddy','roddy'].includes(v),opacity:v=>/^\d{1,2}$/.test(v)&&Number(v)<=70,sound:v=>['0','1'].includes(v),notifications:v=>['0','1'].includes(v),clock24:v=>['0','1'].includes(v),background:v=>['default','plain','custom'].includes(v),'background.image':v=>!!image(v,1500000),pad:v=>/^[0-3]$/.test(v),deadzone:v=>Number(v)>=.1&&Number(v)<=.6&&/^0\.\d+$/.test(v),privacy:v=>['direct','relay'].includes(v)};
 for(const [key,value]of Object.entries(v.settings||{})){const rule=rules[key.replace(/^orbit\./,'')];if(key.startsWith('orbit.')&&typeof value==='string'&&rule&&rule(value))settings[key]=value;}

 return {format:'orbit-id',version:1,id:text(v.id,64)||crypto.randomUUID(),name:text(v.name,24)||'Friend',avatar:image(v.avatar,70000),about:text(v.about,160),settings,lounges,templates:v.templates.map(design)};
}
export class Identity extends EventTarget{
 async open(){
  this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open('orbit-identity',1);r.onupgradeneeded=()=>r.result.createObjectStore('local');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Device storage is unavailable. Your ID will not be saved.'));});
  const get=key=>new Promise((resolve,reject)=>{const r=this.db.transaction('local').objectStore('local').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  this.key=await get('key');const sealed=await get('card');
  if(sealed&&!this.key)throw Error('The saved ID key is missing. Import your backup to recover.');
  if(!this.key)this.key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  if(sealed){try{this.value=validate(JSON.parse(decode.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:sealed.iv},this.key,sealed.data))));}catch{throw Error('Your saved ID could not be read. Exported backups can be imported; the unreadable copy has not been replaced.');}}
  else{this.value=validate({format:'orbit-id',version:1,name:'RODDY',lounges:[],templates:[],settings:{}});await this.save();}
  return this;
 }
 async save(){
  if(this.recoveryRequired)throw Error('Import a backup before replacing the unreadable saved ID.');
  const value=validate(this.value);if(JSON.stringify(value).length>2500000)throw Error('Your ID is too large. Remove an image or unused design first.');const operation=async()=>{const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv},this.key,encode.encode(JSON.stringify(value)));await new Promise((resolve,reject)=>{const t=this.db.transaction('local','readwrite');t.objectStore('local').put(this.key,'key');t.objectStore('local').put({iv,data},'card');t.oncomplete=resolve;t.onerror=()=>reject(Error('Could not save your ID. Free device storage or export a backup.'));t.onabort=t.onerror;});};
  this.pending=(this.pending||Promise.resolve()).catch(()=>{}).then(operation);await this.pending;this.dispatchEvent(new Event('change'));
 }
 async export(passphrase){
  if(passphrase.length<8)throw Error('Use a backup passphrase of at least 8 characters.');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await derive(passphrase,salt);
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encode.encode(JSON.stringify(validate(this.value))));
  return JSON.stringify({format:'orbit-id-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:310000,salt:b64(salt),iv:b64(iv),data:b64(data)});
 }
 async read(file,passphrase){
  if(file.size>4000000)throw Error('This ID card is too large.');
  let v;try{v=JSON.parse(await file.text());}catch{throw Error('This file is not an ORBIT ID card.');}
  if(v.format!=='orbit-id-encrypted'||v.version!==1||v.kdf!=='PBKDF2-SHA256'||v.iterations!==310000||typeof v.data!=='string')throw Error('Unsupported ID card version or format.');
  try{const salt=un64(v.salt),iv=un64(v.iv);if(salt.length!==16||iv.length!==12)throw Error();const key=await derive(passphrase,salt);v=JSON.parse(decode.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,un64(v.data))));}catch{throw Error('The passphrase is incorrect or this card is damaged.');}
  const value=validate(v);value.lounges.forEach(l=>l.auto=false);return value;
 }
 async import(value,merge){
  const next=validate(value);if(merge){const existing=this.value;next.lounges=[...existing.lounges,...next.lounges.filter(l=>!existing.lounges.some(x=>x.id===l.id))];next.templates=[...existing.templates,...next.templates].slice(0,12);}
  const old=this.value,required=this.recoveryRequired;this.value=validate(next);this.recoveryRequired=false;if(!this.key)this.key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);try{await this.save();}catch(e){this.value=old;this.recoveryRequired=required;throw e;}
 }
 async forget(){await this.pending?.catch(()=>{});await new Promise((resolve,reject)=>{const t=this.db.transaction('local','readwrite');t.objectStore('local').clear();t.oncomplete=resolve;t.onerror=()=>reject(t.error);});this.db.close();}
}
async function derive(passphrase,salt){const base=await crypto.subtle.importKey('raw',encode.encode(passphrase),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:310000},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function readImage(file,max=1600){
 if(!file)return '';if(file.size>8000000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPG or WebP under 8 MB.');
 const bitmap=await createImageBitmap(file),scale=Math.min(1,max/bitmap.width,max/bitmap.height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const result=canvas.toDataURL('image/jpeg',.65);if(result.length>220000)throw Error('Choose a smaller or simpler image.');return result;
}
