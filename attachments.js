import {device} from './platform.js';
// Transient, hash-checked, pull-based peer transfers. No database or disk archive.
export const FILE_LIMIT=16*1024*1024;
const CHUNK=12288,BUDGET=device.transferBudget,PREVIEW=/^image\/(png|jpeg|gif|webp)$/;
export function fileMetadata(value){return value&&/^[-\w]{16}$/.test(value.id)&&/^[-\w]{43}$/.test(value.hash)&&typeof value.name==='string'&&value.name.length<=160&&Number.isSafeInteger(value.size)&&value.size>0&&value.size<=FILE_LIMIT&&typeof value.mime==='string'&&value.mime.length<100?value:null;}
const digest=async data=>{const b=new Uint8Array(await crypto.subtle.digest('SHA-256',data));return btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
export class Attachments{
 constructor(api){Object.assign(this,api);this.limit=device.fileLimit;this.files=new Map();this.pending=new Map();this.failed=new Set();this.rates=new Map();this.serving=new Map();this.timer=setInterval(()=>this.tick(),1000);}
 used(){return [...this.files.values()].reduce((n,f)=>n+f.meta.size,0)+[...this.pending.values()].reduce((n,p)=>n+p.meta.size,0);}
 manifest(id){return this.session.state.messages?.find(m=>m.data.attachment?.id===id&&fileMetadata(m.data.attachment));}
 async publish(file,room=this.session.room){
  const limit=this.limit||FILE_LIMIT;if(!file.size||file.size>limit)throw Error(`Choose a file up to ${limit/1048576} MB.`);if(this.used()+file.size>BUDGET)throw Error('This lounge’s transfer memory is full. Clear a local copy in Settings → Live transfers.');
  const meta={id:this.uid(),name:file.name.slice(0,160),size:file.size,mime:PREVIEW.test(file.type)?file.type:'application/octet-stream',hash:await digest(await file.arrayBuffer())};
  if(this.stopped||!this.session.active)return false;if(this.used()+file.size>BUDGET)throw Error('Transfer memory is full. Clear a local copy first.');this.keep(meta,file,room);const event=this.emit('message',{text:'',name:this.session.profile.name,attachment:meta},room);if(!event){this.remove(meta.id);return false;}return true;
 }
 keep(meta,blob,room){this.files.set(meta.id,{meta,blob,room,url:URL.createObjectURL(blob)});}
 remove(id){const f=this.files.get(id);if(f)URL.revokeObjectURL(f.url);this.files.delete(id);this.pending.delete(id);this.failed.add(id);}
 request(meta){
  const event=this.manifest(meta.id);if(this.stopped||!event||this.files.has(meta.id)||this.pending.has(meta.id))return;
  if(meta.size>(this.limit||FILE_LIMIT)||this.pending.size>=4||this.used()+meta.size>BUDGET){this.failed.add(meta.id);this.toast('This file exceeds the available transfer memory on this device.');return;}
  this.failed.delete(meta.id);const p={meta,room:event.room,owner:event.actor,transfer:this.uid(),data:new Uint8Array(meta.size),received:new Set(),wanted:new Set(),at:performance.now(),started:performance.now(),last:0};this.pending.set(meta.id,p);this.pull(p);this.refresh('attachment');
 }
 pull(p){if(this.stopped||this.pending.get(p.meta.id)!==p||p.verifying)return;const total=Math.ceil(p.meta.size/CHUNK);if(!p.wanted.size)for(let i=0;i<total&&p.wanted.size<4;i++)if(!p.received.has(i))p.wanted.add(i);p.last=performance.now();const target=this.session.members.has(p.owner)&&p.last-p.started<8000?p.owner:null;this.mesh.send({type:'file-get',file:p.meta.id,transfer:p.transfer,indices:[...p.wanted]},target);}
 async receive(actor,v){
  if(this.stopped||!this.session.members.has(actor))return;
  if(v.type==='file-get'){
   const f=this.files.get(v.file),event=this.manifest(v.file);if(!f||!event||!/^[-\w]{16}$/.test(v.transfer)||!Array.isArray(v.indices)||v.indices.length>4)return;
   const now=performance.now(),rate=this.rates.get(actor)||{at:now,count:0};if(now-rate.at>1000){rate.at=now;rate.count=0;}if(++rate.count>16)return;this.rates.set(actor,rate);if((this.serving.get(actor)||0)>=2)return;this.serving.set(actor,(this.serving.get(actor)||0)+1);
   try{for(const index of new Set(v.indices)){if(!Number.isSafeInteger(index)||index<0||index*CHUNK>=f.meta.size)continue;const bytes=new Uint8Array(await f.blob.slice(index*CHUNK,(index+1)*CHUNK).arrayBuffer());if(this.stopped)return;await this.mesh.send({type:'file-chunk',file:v.file,transfer:v.transfer,index,data:btoa(String.fromCharCode(...bytes))},actor);}}finally{this.serving.set(actor,Math.max(0,(this.serving.get(actor)||1)-1));}return;
  }
  if(v.type!=='file-chunk')return;const p=this.pending.get(v.file);if(!p||p.verifying||v.transfer!==p.transfer||!p.wanted.has(v.index)||typeof v.data!=='string'||v.data.length>CHUNK*4/3+4)return;
  let bytes;try{bytes=Uint8Array.from(atob(v.data),c=>c.charCodeAt(0));}catch{return;}if(bytes.length!==Math.min(CHUNK,p.meta.size-v.index*CHUNK))return;
  p.data.set(bytes,v.index*CHUNK);p.received.add(v.index);p.wanted.delete(v.index);p.at=performance.now();
  if(p.received.size===Math.ceil(p.meta.size/CHUNK)){
   p.verifying=true;const hash=await digest(p.data);if(this.stopped||this.pending.get(v.file)!==p)return;
   if(hash!==p.meta.hash){this.pending.delete(v.file);this.failed.add(v.file);this.toast('That transfer did not match its fingerprint. Request it again from a trusted live peer.');}
   else{this.pending.delete(v.file);this.keep(p.meta,new Blob([p.data],{type:p.meta.mime}),p.room);}this.refresh('attachment');return;
  }
  if(!p.wanted.size)this.pull(p);if(performance.now()-(p.rendered||0)>200){p.rendered=performance.now();this.refresh('attachment');}
 }
 tick(){if(this.stopped)return;for(const [id,p]of this.pending){if(!this.session.state.rooms?.[p.room]||performance.now()-p.at>30000){this.pending.delete(id);this.failed.add(id);this.toast('Transfer paused: no live copy responded. You can retry while someone still has the file.');this.refresh('attachment');}else if(performance.now()-p.last>1500)this.pull(p);}for(const [id,f]of this.files)if(!this.session.state.rooms?.[f.room])this.remove(id);}
 html(meta){
  if(!fileMetadata(meta))return '';const f=this.files.get(meta.id),p=this.pending.get(meta.id),size=meta.size<1048576?`${Math.ceil(meta.size/1024)} KB`:`${(meta.size/1048576).toFixed(1)} MB`;
  if(f)return `<div class="message-file">${PREVIEW.test(meta.mime)?`<a href="${f.url}" download="${this.esc(meta.name)}"><img src="${f.url}" alt="${this.esc(meta.name)}" loading="lazy"></a>`:''}<a href="${f.url}" download="${this.esc(meta.name)}">↓ ${this.esc(meta.name)}</a><small>${size} · local copy</small></div>`;
  if(!p&&!this.failed.has(meta.id)&&PREVIEW.test(meta.mime)&&meta.size<=2*1048576)queueMicrotask(()=>this.request(meta));
  return `<div class="message-file"><strong>${this.esc(meta.name)}</strong><small>${size} · ${p?`Receiving ${Math.round(p.received.size/Math.ceil(meta.size/CHUNK)*100)}%`:'Available from live peers'}</small><button data-file-${p?'cancel':'receive'}="${meta.id}">${p?'Cancel':'Receive file'}</button></div>`;
 }
 click(e){const receive=e.target.closest('[data-file-receive]'),cancel=e.target.closest('[data-file-cancel]');if(receive){const meta=this.manifest(receive.dataset.fileReceive)?.data.attachment;if(meta)this.request(meta);}if(cancel){this.pending.delete(cancel.dataset.fileCancel);this.failed.add(cancel.dataset.fileCancel);this.refresh('attachment');}}
 dialog(){this.modal('Live transfers',`<p>Files stay in this lounge’s memory. Clearing your copy frees memory; it does not erase copies other members received.</p><div class="transfer-list">${[...this.files.values()].map(f=>`<div><span>${this.esc(f.meta.name)} · ${(f.meta.size/1048576).toFixed(1)} MB</span><button data-clear-file="${f.meta.id}">Clear local copy</button></div>`).join('')||'<p>No files held here.</p>'}</div><p>${(this.used()/1048576).toFixed(1)} / ${BUDGET/1048576} MB of live transfer memory. Individual limit: ${(this.limit||FILE_LIMIT)/1048576} MB.</p>`);document.querySelectorAll('[data-clear-file]').forEach(b=>b.onclick=()=>{this.remove(b.dataset.clearFile);this.refresh('attachment');this.dialog();});}
 stop(){this.stopped=true;clearInterval(this.timer);for(const f of this.files.values())URL.revokeObjectURL(f.url);this.files.clear();this.pending.clear();this.rates.clear();this.serving.clear();this.failed.clear();}
}
