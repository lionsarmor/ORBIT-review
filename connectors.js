// A connector is inert until explicitly enabled. Service data never enters Mesh.
import {apiURL} from './runtime.js';
export class Connectors{
 constructor(api){Object.assign(this,api);this.services=new Map();this.generation=new Map();this.pending=new Map();this.$('#modal').addEventListener('close',()=>{if(this.loginName){this.generation.set(this.loginName,(this.generation.get(this.loginName)||0)+1);this.loginName=null;}});}
 active(name){return this.services.has(name);}
 async api(name,path,body,token){
  const s=this.services.get(name),controller=new AbortController();this.pending.set(controller,name);
  try{const r=await fetch(apiURL(`connectors/${name}/api/${path}`),{signal:controller.signal,method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token||s?.token?{Authorization:`Bearer ${token||s.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const v=await r.json();if(!r.ok||v.error)throw Error(v.error||`Service returned ${r.status}`);return v;}finally{this.pending.delete(controller);}
 }
 login(name){
  const {$,esc}=this;
  this.loginName=name;const generation=(this.generation.get(name)||0)+1;this.generation.set(name,generation);
  this.modal(name==='buddy'?'Connect BUDDY Network':'Connect NINA',`<p>${name==='buddy'?'Use your BUDDY account. Private messages use the existing BUDDY encryption identity.':'NINA is a legacy AIM-compatible service. Its TOC connection is unencrypted; these conversations are not private ORBIT rooms.'}</p><form id="connector-login"><label>Username<input id="connector-user" required autocomplete="username"></label><label>Password<input id="connector-password" type="password" required autocomplete="current-password"></label><button class="primary wide">Connect</button><p id="connector-error" role="status"></p></form>`);
  $('#connector-login').onsubmit=async e=>{
   e.preventDefault();const user=$('#connector-user').value.trim(),password=$('#connector-password').value;$('#connector-error').textContent='Connecting…';
   try{
    const result=await this.api(name,'session',{user,password,platform:'web',environment:'web'});
    if(this.generation.get(name)!==generation){await this.api(name,'logout',{},result.token).catch(()=>{});return;}
    if(name==='buddy'){try{const device=await RelayE2E.unlock(result.user||user,password);await this.api(name,'e2e/device',device,result.token);}catch(error){await this.api(name,'logout',{},result.token).catch(()=>{});throw error;}}
    this.services.set(name,{token:result.token,user:result.user||user,state:{},interval:null});
    if($('#connector-password'))$('#connector-password').value='';await this.refresh(name);
    if(this.generation.get(name)!==generation){await this.disconnect(name);return;}
    this.services.get(name).interval=setInterval(()=>this.refresh(name).catch(()=>{}),15000);this.loginName=null;this.closeModal();this.renderLinks();this.open(name);
   }catch(e){if($('#connector-error'))$('#connector-error').textContent=e.message;}
  };
 }
 async refresh(name){
  const s=this.services.get(name);if(!s)return;
  const state=await this.api(name,'state');if(this.services.get(name)!==s)return;
  s.state=state;this.api(name,'heartbeat').catch(()=>{});
 }
 async disconnect(name){
  this.generation.set(name,(this.generation.get(name)||0)+1);
  for(const [controller,service]of this.pending)if(service===name)controller.abort();
  const s=this.services.get(name);if(!s)return;clearInterval(s.interval);this.services.delete(name);
  if(name==='buddy')RelayE2E.lock();this.renderLinks();
  if(this.view===name){this.closeModal();this.view=null;}
  await this.api(name,'logout',{},s.token).catch(()=>{});
  this.toast(`${name.toUpperCase()} disconnected. Local service access cleared.`);
 }
 disconnectAll(){for(const name of new Set([...this.services.keys(),...this.generation.keys()]))this.disconnect(name);}
 renderLinks(){
  this.$('#service-links').innerHTML=[...this.services.keys()].map(name=>`<button data-service="${name}">${name==='buddy'?'BUDDY Network':'NINA'} ↗</button>`).join('');
  document.querySelectorAll('[data-service]').forEach(b=>b.onclick=()=>this.open(b.dataset.service));
 }
 open(name){
  const s=this.services.get(name);if(!s)return;this.view=name;
  const {$,esc}=this,state=s.state,friends=Array.isArray(state.friends)?state.friends:Object.keys(state.friends||{}),groups=state.groups||state.rooms||[];
  const names=a=>(Array.isArray(a)?a:Object.keys(a)).map(v=>typeof v==='string'?v:v.name||v.user).filter(Boolean);
  this.modal(`${name.toUpperCase()} · ${s.user}`,`<p>Service conversations have their own privacy and history rules.</p><div class="form-row"><div><h3>Friends</h3>${names(friends).map(f=>`<button class="room" data-service-target="${esc(f)}" data-kind="P">${esc(f)}</button>`).join('')||'<p>No friends imported.</p>'}</div><div><h3>Rooms</h3>${names(groups).map(f=>`<button class="room" data-service-target="${esc(f)}" data-kind="G">${esc(f)}</button>`).join('')||'<p>No rooms imported.</p>'}</div></div><form id="service-open"><label>Open friend or room<input id="service-target" required></label><select id="service-kind"><option value="P">Private message</option><option value="G">Room</option></select> <button>Open</button></form><div class="settings-section"><button id="service-refresh">Refresh</button> <button id="service-off">Disconnect</button></div>`);
  document.querySelectorAll('[data-service-target]').forEach(b=>b.onclick=()=>this.conversation(name,b.dataset.serviceTarget,b.dataset.kind));
  $('#service-open').onsubmit=async e=>{e.preventDefault();const target=$('#service-target').value,kind=$('#service-kind').value;try{if(name==='buddy'&&kind==='G')await this.api(name,'group',{target});this.conversation(name,target,kind);}catch(error){this.toast(error.message);}};
  $('#service-refresh').onclick=async()=>{try{await this.refresh(name);this.open(name);}catch(e){this.toast(e.message);}};
  $('#service-off').onclick=()=>this.disconnect(name);
 }
 async conversation(name,target,kind){
  const s=this.services.get(name);if(!s)return;const {$,esc}=this;this.view=name;
  this.modal(`${name.toUpperCase()} / ${target}`,`<div id="service-messages" class="service-messages"></div><form id="service-send"><label>Message<input id="service-text" required maxlength="96"></label><button class="primary">Send</button> <button type="button" id="service-reload">Refresh</button> <button type="button" id="service-back">Back</button></form><p id="service-error"></p>`);
  const load=async()=>{
   if(!this.services.has(name))return;
   try{
    let messages;
    if(name==='buddy'&&kind==='P'){
     const own=await this.api(name,`e2e/devices?user=${encodeURIComponent(s.user)}`),other=await this.api(name,`e2e/devices?user=${encodeURIComponent(target)}`);
     const directory={[s.user]:own.devices,[target]:other.devices};
     for(const[user,devices]of Object.entries(directory))await RelayE2E.trust(user,devices);
     s.directory=directory;
     const result=await this.api(name,`e2e/messages?target=${encodeURIComponent(target)}&deviceId=${RelayE2E.device().deviceId}`);
     messages=await Promise.all((result.messages||[]).map(m=>RelayE2E.open(m,target)));
    }else{const result=await this.api(name,`messages?kind=${kind}&target=${encodeURIComponent(target)}`);messages=Array.isArray(result)?result:result.messages||[];}
    if(!this.services.has(name)||!$('#service-messages'))return;
    $('#service-messages').innerHTML=messages.map(m=>`<p><strong>${esc(m.from||m.sender)}</strong> ${esc(m.webText||m.text)}</p>`).join('')||'<p>No messages yet.</p>';
   }catch(e){if($('#service-error'))$('#service-error').textContent=e.message;}
  };
  $('#service-send').onsubmit=async e=>{
   e.preventDefault();if(!this.services.has(name))return;
   try{const text=$('#service-text').value;if(name==='buddy'&&kind==='P'){if(!s.directory)throw Error('Secure conversation is not ready.');await this.api(name,'e2e/message',await RelayE2E.seal(target,text,s.directory));}else await this.api(name,'message',{kind,target,text});$('#service-text').value='';await load();}
   catch(e){$('#service-error').textContent=e.message;}
  };
  $('#service-reload').onclick=load;$('#service-back').onclick=()=>this.open(name);await load();
 }
}
