import {Mesh,b64,bytes,random} from './mesh.js';
import init,{chess_state,chess_play,chess_computer,Chip8} from './pkg/orbit_core.js';
import {Activities} from './activities.js';
import {Connectors} from './connectors.js';
import {face,facesIn} from './faces.js';
import {appBase,deployment} from './runtime.js';
import {Identity,invitation,design,readImage,image} from './identity.js';

export const $=s=>document.querySelector(s);
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const uid=()=>b64(random(12));
export function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
let toastTimer;
export function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
export function modal(title,html){for(const l of lounges.values())l.activities.arcade.release();$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();}
export function closeModal(){$('#modal').close();}

const icons={ambient:'◌',watch:'▷',whiteboard:'✎',chess:'♘',emulator:'▦',tasks:'☑',news:'↗'};
const defaultRooms=[{id:'lounge',name:'Lounge',mode:'ambient'},{id:'cinema',name:'Watch party',mode:'watch'},{id:'arcade',name:'Playroom',mode:'emulator'},{id:'studio',name:'Studio',mode:'whiteboard'}];
const identity=new Identity();let storageError='';
try{await identity.open();}catch(e){storageError=e.message;identity.recoveryRequired=true;identity.value={format:'orbit-id',version:1,id:crypto.randomUUID(),name:'Friend',avatar:'',about:'',settings:{},lounges:[],templates:[]};}
export const lounges=new Map();const joining=new Set();let selected=null,current=null;
export let mesh,session,activities;
let unread,awayReplies,due,idleTimer,soundEnabled=false,clock24=false;
const connectors=new Connectors({modal,closeModal,toast,esc,$});
function context(){
 const l={key:uid(),unread:new Map(),awayReplies:new Set(),due:new Set(),session:{active:false,id:'',name:identity.value.name,profile:{name:identity.value.name,avatar:identity.value.avatar,about:identity.value.about},room:'lounge',dm:null,members:new Map(),events:new Map(),eventBytes:0,private:[],drafts:new Map(),clock:0,state:{},privacy:'direct',notifications:identity.value.settings['orbit.notifications']==='1'&&'Notification'in window&&Notification.permission==='granted'},mesh:new Mesh()};
 l.activities=new Activities({emit:(...args)=>within(l,()=>emit(...args)),session:l.session,toast,modal,closeModal,esc,$,safeURL,uid,mesh:l.mesh,isVisible:()=>selected===l,core:{chess_state,chess_play,chess_computer,Chip8}});
 wire(l);return l;
}
function bind(l){current=l;mesh=l.mesh;session=l.session;activities=l.activities;unread=l.unread;awayReplies=l.awayReplies;due=l.due;}
function within(l,work){const old=current;bind(l);try{return work();}finally{bind(old);}}
const homeContext=context();bind(homeContext);
function saveIdentity(){if(!identity.db||identity.recoveryRequired)return toast(storageError||'Storage unavailable. Import/export your ID before closing.');identity.save().catch(e=>toast(e.message));}
const stored=k=>{try{return localStorage.getItem(k);}catch{return null;}};
function preference(k,v){try{localStorage.setItem(k,v);}catch{}identity.value.settings[k]=String(v);saveIdentity();}
function skin(name){
 if(!['orbit','buddy','roddy'].includes(name))name='orbit';
 document.documentElement.dataset.skin=name;
 $('#brand-mark').src=`assets/${{orbit:'orbit.svg',buddy:'buddy.png',roddy:'roddy-full.svg'}[name]}`;
 $('#brand-mark').alt=name.toUpperCase();
 $('#edition').textContent=name==='orbit'?'TOGETHER, FOR NOW':`ORBIT / ${name.toUpperCase()} EDITION`;
 document.querySelectorAll('[data-skin]').forEach(e=>{if(e.tagName==='BUTTON')e.classList.toggle('selected',e.dataset.skin===name);});
 preference('orbit.skin',name);
}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-skin]');if(b)skin(b.dataset.skin);});
for(const [k,v]of Object.entries(identity.value.settings))try{localStorage.setItem(k,v);}catch{}
skin(stored('orbit.skin')||'orbit');
$('#modal-close').onclick=closeModal;
$('#entry-name').value=identity.value.name;
$('#entry-name').onchange=()=>{identity.value.name=$('#entry-name').value.trim().slice(0,24)||'Friend';saveIdentity();for(const l of lounges.values())within(l,()=>{session.profile.name=identity.value.name;emit('profile',session.profile);});renderHub();};
$('#entry-form').onsubmit=e=>{e.preventDefault();enter(true,'',identity.value.templates[Number($('#home-template').value)]&&$('#home-template').value!==''?identity.value.templates[Number($('#home-template').value)]:null);};
$('#join-space').onclick=()=>enter(false);
let initialInvite='';if(location.hash.length>1){initialInvite=location.href;$('#join-code').value=initialInvite;history.replaceState(null,'',location.pathname);}
export async function enter(create,input=$('#join-code').value,template=null){
 const name=$('#entry-name').value.trim().slice(0,24)||identity.value.name;
 identity.value.name=name;saveIdentity();let saved,joinKey,joiningHere=false;
 try{
  if(create&&identity.value.lounges.length>=50)throw Error('Your ID remembers up to 50 lounges. Forget an old invitation first.');
  if(!create){const parsed=invitation(input);input=parsed.code;joinKey=parsed.id;if(joining.has(joinKey))return toast('That lounge is already connecting.');const existing=lounges.get(parsed.id);if(existing){activate(existing);return;}saved=identity.value.lounges.find(x=>x.id===parsed.id);if(!saved){if(identity.value.lounges.length>=50)throw Error('Your ID can remember up to 50 lounges.');saved={...parsed,name:'Invited lounge',logo:'',alias:'',auto:false,design:null};identity.value.lounges.push(saved);if(identity.value.lounges.length>50)throw Error('Your ID can remember up to 50 lounges.');saveIdentity();}}
  if(lounges.size+joining.size>=4)throw Error('Up to four live lounges per window in this build. Leave one before joining another.');
  joinKey=joinKey||uid();joining.add(joinKey);joiningHere=true;$('#entry-status').textContent='Connecting…';await init();const l=context();l.session.privacy=identity.value.settings['orbit.privacy']||homeContext.session.privacy||selected?.session.privacy||'direct';
  try{const result=await l.mesh.start(input,create,{name,avatar:identity.value.avatar,about:identity.value.about,status:'Here'},l.session.privacy);Object.assign(l.session,{active:true,id:result.id,name,profile:{name,avatar:identity.value.avatar,about:identity.value.about,status:'Here'}});l.session.members.set(result.id,l.session.profile);l.key=l.mesh.room;lounges.set(l.key,l);l.status='connected';
   if(create){saved={id:l.key,code:result.code,name:template?.name||'Tonight',logo:template?.logo||'',alias:'',auto:false,design:template||null};identity.value.lounges.push(saved);}
   l.saved=saved;activate(l);if(create)within(l,()=>{emit('space',{name:saved.name});if(template)emit('design',design(template));});else within(l,()=>{rebuild();render();});saveIdentity();$('#join-code').value='';$('#lounge-code').value='';$('#entry-status').textContent='Your ID is saved on this device.';
  }catch(e){l.mesh.leave();l.activities.stop();l.activities.arcade.destroy();throw e;}
 }catch(e){if(saved)saved.state=/ended/.test(e.message)?'ended':'unknown';$('#entry-status').textContent=e.message;toast(e.message);renderHub();}finally{if(joiningHere){joining.delete(joinKey);renderHub();}}
}
export function activate(l){
 if(selected){selected.session.drafts.set(selected.session.dm||selected.session.room,$('#message').value);selected.activities.deactivate();}
 selected=l;bind(l||homeContext);document.body.classList.toggle('home-view',!l);$('#welcome').hidden=!!l;$('#workspace').classList.toggle('at-home',!l);$('#invite').disabled=$('#leave').disabled=!l;
 document.body.classList.remove('menu-open');if(l){if(!session.dm)l.unread.delete(session.room);l.activities.active=true;l.activities.mode='';$('#message').value=session.drafts.get(draftKey())||'';render();}else{homeContext.activities.active=false;$('#activity-content').replaceChildren();$('#messages').replaceChildren();$('#rooms').replaceChildren();$('#members').replaceChildren();$('#space-name').textContent='Your lounges';$('#room-title').textContent='Saved lounges';$('#room-subtitle').textContent='On this device';$('#member-count').textContent='0';}
 renderHub();applyLoungeDesign();
}
// Deterministically ordered operations converge after concurrent edits and late joins.
// The log is capped in memory; no room data is put in localStorage/IndexedDB.
export function emit(type,data={},room=session.room){
 if(!session.active)return toast('Create or join a space first.');
 if(type==='watch')data={...data,stamp:performance.now()};
 const event={id:uid(),actor:session.id,n:++session.clock,at:Date.now(),room,type,data};
 if(accept(event,session.id)){mesh.send({type:'event',event});return event;}
}
const allowed=new Set(['space','room','activity','message','reaction','queue','queue-remove','stroke','board-clear','chess','rom','task','link','watch','profile','game','design','owner','game-standby','game-host']);
function accept(event,actor,snapshot=false){
 if(!event||!allowed.has(event.type)||typeof event.id!=='string'||event.id.length>40||typeof event.actor!=='string'||(!snapshot&&event.actor!==actor)||!Number.isSafeInteger(event.n)||event.n<1||event.n>1e9||!event.data||typeof event.data!=='object'||typeof event.room!=='string')return false;
 if(session.events.has(event.id))return false;
 const size=JSON.stringify(event).length;
 if(session.events.size>=2000||session.eventBytes+size>1500000){toast('This space has reached its activity limit. Start a fresh space to continue.');return false;}
 if(size>400000)return false;
 if(['__proto__','constructor','prototype'].includes(event.room)||['__proto__','constructor','prototype'].includes(event.data.id)||['__proto__','constructor','prototype'].includes(event.data.message))return false;
 session.eventBytes+=size;
 session.clock=Math.max(session.clock,event.n);session.events.set(event.id,event);rebuild();
 if(event.type==='message'&&event.actor!==session.id){
  if(current!==selected||session.room!==event.room||session.dm)unread.set(event.room,(unread.get(event.room)||0)+1);
  notify(event.data.name,event.data.text);wakeChat();
 }
 render(event.type);return true;
}
function rebuild(){
 const s={name:'Tonight',rooms:Object.fromEntries(defaultRooms.map(r=>[r.id,{...r}])),messages:[],reactions:{},queue:{},strokes:{},tasks:{},links:{},chess:{},rom:{},games:{},watch:{},profiles:{},owner:'',logo:'',background:'',accent:''};
 const ordered=[...session.events.values()].sort((a,b)=>a.n-b.n||a.actor.localeCompare(b.actor)||a.id.localeCompare(b.id));
 for(const e of ordered){
  const d=e.data,r=e.room;
  switch(e.type){
   case 'space':if(!s.owner){s.name=String(d.name||'Tonight').slice(0,40);s.owner=e.actor;}break;
   case 'owner':if(s.owner===d.previous&&(e.actor===d.previous||e.actor===d.next&&!session.members.has(d.previous)))s.owner=d.next;break;
   case 'design':if(e.actor===s.owner){try{const value=design(d);if(value.rooms.length){const old=s.rooms;s.rooms=Object.fromEntries(value.rooms.map(r=>[r.id,{...r}]));}Object.assign(s,{name:value.name,logo:value.logo,background:value.background,accent:value.accent});}catch{}}break;
   case 'room':if(e.actor===s.owner&&typeof d.name==='string'&&Object.keys(s.rooms).length<40)s.rooms[d.id]={id:d.id,name:d.name.slice(0,40),mode:'ambient'};break;
   case 'activity':if(s.rooms[r]&&icons[d.mode])s.rooms[r].mode=d.mode;break;
   case 'message':if(typeof d.text==='string'&&d.text.length<=4000)s.messages.push(e);break;
   case 'reaction':if(typeof d.emoji==='string'&&d.emoji.length<10){s.reactions[d.message]??={};s.reactions[d.message][e.actor]=d.emoji;}break;
   case 'queue':if(typeof d.title==='string')s.queue[d.id]={...d,actor:e.actor};break;
   case 'queue-remove':delete s.queue[d.id];break;
   case 'stroke':if(Array.isArray(d.points)&&d.points.length<3000){s.strokes[r]??=[];s.strokes[r].push(d);}break;
   case 'board-clear':s.strokes[r]=[];break;
   case 'chess':try{const previous=s.chess[r]?.fen||'';if(d.reset)s.chess[r]={fen:'',computer:!!d.computer};else if(d.before===previous)s.chess[r]={...s.chess[r],fen:JSON.parse(chess_play(previous,d.move)).fen};}catch{}break;
   case 'game':if(d.action==='start'&&(!s.games[r]||!session.members.has(s.games[r].host))&&typeof d.id==='string'&&d.id.length<=40&&typeof d.name==='string'&&d.name.length<=100&&['nes','snes','n64','genesis','atari'].includes(d.system))s.games[r]={id:d.id,name:d.name,system:d.system,host:e.actor};else if(d.action==='end'&&s.games[r]?.id===d.id&&s.games[r]?.host===e.actor)delete s.games[r];break;
   case 'game-standby':if(s.games[r]?.id===d.id&&s.games[r].host===e.actor)s.games[r].standby=d.next;break;
   case 'game-host':if(s.games[r]?.id===d.id&&s.games[r].host===d.previous&&(e.actor===d.previous||e.actor===s.games[r].standby&&!session.members.has(d.previous))){s.games[r].host=d.next;s.games[r].standby=null;}break;
   case 'rom':if(typeof d.rom==='string'&&d.rom.length<5000)s.rom[r]={...d,actor:e.actor,event:e.id};break;
   case 'task':if(typeof d.title==='string'&&['todo','doing','done'].includes(d.status))s.tasks[d.id]={...d,room:r};break;
   case 'link':if(safeURL(d.url))s.links[d.id]={...d,room:r};break;
   case 'watch':if(!d.url||safeURL(d.url)||d.url.startsWith('local:'))s.watch[r]={...d,actor:e.actor,event:e.id};break;
   case 'profile':s.profiles[e.actor]=d;break;
  }
 }
 for(const key of Object.keys(s.games))if(!s.rooms[key])delete s.games[key];
 if(!s.rooms[session.room])session.room=Object.keys(s.rooms)[0]||'lounge';
 session.state=s;
 for(const [id,p]of Object.entries(s.profiles))if(session.members.has(id))session.members.set(id,p);
}
function wire(l){
l.mesh.addEventListener('joined',e=>within(l,()=>{
 const {id,profile}=e.detail;session.members.set(id,profile);
 mesh.send({type:'snapshot',events:[...session.events.values()],profiles:[...session.members]},id);
 activities.arcade.peerJoined(id);
 render();toast(`${profile.name||'Someone'} joined your space.`);
}));
l.mesh.addEventListener('left',e=>within(l,()=>{const name=session.members.get(e.detail)?.name;session.members.delete(e.detail);activities.arcade.peerLeft(e.detail);if(session.dm===e.detail){session.dm=null;if(selected===l)selectRoom(session.room);}render();if(name)toast(`${name} left.`);electOwner(l);}));
l.mesh.addEventListener('data',e=>within(l,()=>{
 if(!session.active)return;
 const {id,value:v}=e.detail;
 if(v.type==='event')accept(v.event,id);
 else if(v.type==='snapshot'&&Array.isArray(v.events)&&v.events.length<=2000){
  // Snapshots are invite-holder assertions, never a cryptographic identity proof.
  for(const event of v.events)if(!session.events.has(event?.id))accept(event,id,true);
  render();
 }else if(v.type==='dm'&&typeof v.text==='string'&&v.text.length<=4000&&typeof v.id==='string'){
  if(session.private.some(m=>m.id===v.id))return;
  session.private.push({...v,from:id,to:session.id,at:Date.now()});if(session.private.length>500)session.private.shift();
  notify(session.members.get(id)?.name,v.text);wakeChat();renderMessages();
  if(session.profile.status==='Away'&&session.profile.away&&!awayReplies.has(id)){awayReplies.add(id);sendDM(id,`Away: ${session.profile.away}`);}
 }else activities.receive(id,v);
}));
l.mesh.addEventListener('error',e=>toast(e.detail));
l.mesh.addEventListener('ended',()=>leaveLounge(l));
l.mesh.addEventListener('stream',e=>l.activities.stream(e.detail.id,e.detail.stream,e.detail.key));
l.mesh.addEventListener('connection',e=>{l.status=e?.detail?.state==='peer-only'?'peer only':l.mesh.reconnecting?'reconnecting':'connected';if(selected===l)renderStatus();renderHub();});
l.mesh.addEventListener('recovered',()=>within(l,()=>{for(const id of l.mesh.peers.keys())l.mesh.send({type:'snapshot',events:[...l.session.events.values()]},id);render();}));
}
function notify(name,text){if(soundEnabled)new Audio('assets/sounds/message.wav').play().catch(()=>{});if(session.notifications&&document.hidden&&Notification.permission==='granted')new Notification(`ORBIT · ${name||'Message'}`,{body:String(text).slice(0,100)});}
function renderStatus(){if(current!==selected)return;$('#stage-status span').textContent=session.active?`${session.members.size} here · ${session.privacy==='relay'?'Relay only':'Peer connections'} · Memory only`:'Ready when you are';}
export function render(reason){
 if(!session.state.rooms)rebuild();
 activities.arcade.reconcile();activities.cleanupRooms();rememberDesign(current);if(current!==selected){renderHub();return;}
 const s=session.state,r=s.rooms[session.room]||s.rooms.lounge;
 $('#space-name').textContent=s.name;
 $('#rooms').innerHTML=Object.values(s.rooms).map(r=>`<button class="room ${r.id===session.room&&!session.dm?'active':''}" data-room="${esc(r.id)}"><span class="room-glyph">${esc(r.icon||icons[r.mode])}</span>${esc(r.name)}${unread.get(r.id)?`<b>${unread.get(r.id)}</b>`:''}</button>`).join('');
 $('#members').innerHTML=[...session.members].map(([id,p])=>`<button class="member" data-member="${esc(id)}"><span class="avatar">${image(p.avatar,70000)?`<img src="${image(p.avatar,70000)}" alt="">`:esc(String(p.name||'?').slice(0,2).toUpperCase())}</span><span class="member-name">${esc(p.name)}${id===session.id?' <small>you · ': '<small>'}${esc(p.status||'Here')}</small></span></button>`).join('');
 $('#member-count').textContent=session.members.size;
 $('#room-title').textContent=session.dm?session.members.get(session.dm)?.name||'Private chat':r.name;
 $('#room-icon').textContent=session.dm?'↗':icons[r.mode];
 $('#room-subtitle').textContent=session.dm?'Private · only the two of you':'A little space to be together';
 $('#activity').value=r.mode;
 $('#message').placeholder=`Message ${session.dm?session.members.get(session.dm)?.name:r.name}…`;
 $('#chat-context').style.display=session.dm?'block':'none';$('#chat-context').textContent='Private conversation · click a room to return';
 renderMessages();renderQueue();renderStatus();renderHub();applyLoungeDesign();
 activities.render(r.mode,reason);
}
function renderMessages(){
 if(current!==selected)return;
 const items=session.dm?session.private.filter(m=>m.from===session.dm||m.to===session.dm).map(m=>({id:m.id,actor:m.from,at:m.at,data:{name:session.members.get(m.from)?.name||'Member',text:m.text}})):session.state.messages?.filter(m=>m.room===session.room)||[];
 const box=$('#messages'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<50;
 box.innerHTML=items.slice(-100).map(m=>{
  const d=m.data,reactions=Object.values(session.state.reactions[m.id]||{}),image=typeof d.image==='string'&&/^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(d.image)?d.image:null;
  return `<article class="message" data-message="${esc(m.id)}"><span class="avatar">${esc(String(d.name||'?').slice(0,2).toUpperCase())}</span><div class="message-body"><strong>${esc(d.name)}</strong><time>${new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:!clock24})}</time><p>${linkify(d.text)}</p>${image?`<img src="${image}" alt="Shared image">`:''}${reactions.length?`<button class="reaction" data-react="${esc(m.id)}">${esc(reactions.join(' '))}</button>`:''}${!session.dm?`<button class="react-add" data-react="${esc(m.id)}" aria-label="React to message">☺＋</button>`:''}</div></article>`;
 }).join('');
 if(atBottom)box.scrollTop=box.scrollHeight;
}
function linkify(t){return String(t).split(/(https?:\/\/[^\s<>]+)/g).map(part=>/^https?:\/\//.test(part)?`<a href="${esc(part)}" target="_blank" rel="noopener noreferrer">${esc(part.length>60?part.slice(0,57)+'…':part)}</a>`:facesIn(esc(part))).join('');}
function draftKey(){return session.dm||session.room;}
function selectRoom(id){session.drafts.set(draftKey(),$('#message').value);session.dm=null;session.room=id;unread.delete(id);$('#message').value=session.drafts.get(id)||'';activities.resetView();render();document.body.classList.remove('menu-open');}
$('#rooms').onclick=e=>{const b=e.target.closest('[data-room]');if(b)selectRoom(b.dataset.room);};
$('#members').onclick=e=>{
 const b=e.target.closest('[data-member]');if(!b)return;
 const id=b.dataset.member,p=session.members.get(id);
 if(id===session.id)return settings();
 modal(p.name,`<p>${esc(p.about||'Enjoying a little time together.')}</p><p>${esc(p.status||'Here')}</p><button id="dm-open" class="primary wide">Private message ↗</button>`);
 $('#dm-open').onclick=()=>{session.drafts.set(draftKey(),$('#message').value);session.dm=id;$('#message').value=session.drafts.get(id)||'';render();closeModal();document.body.classList.remove('menu-open');$('#message').focus();};
};
$('#add-room').onclick=()=>{modal('A new room',`<form id="room-form"><label>Room name<input id="new-room-name" maxlength="40" required placeholder="Late night radio"></label><button class="primary wide">Create room</button></form>`);$('#room-form').onsubmit=e=>{e.preventDefault();const id=uid();emit('room',{id,name:$('#new-room-name').value.trim()});closeModal();selectRoom(id);};};
$('#activity').onchange=e=>{session.dm=null;activities.backgroundOnly=false;emit('activity',{mode:e.target.value});};
$('#start-watch').onclick=()=>activities.shareDialog();
$('#share').onclick=()=>activities.shareDialog();
$('#invite').onclick=()=>{
 const link=new URL(`#${mesh.code}`,appBase).href;
 modal('Bring your people',`<p>Anyone with this code can join while the space is alive. Share it privately.</p><label>Invitation link<textarea id="invite-value" rows="4" readonly>${esc(link)}</textarea></label><button id="copy-invite" class="primary wide">Copy invitation</button><div class="notice" style="margin-top:16px">Up to 8 people in this first build. Friends need to reach this app’s address. ${['localhost','127.0.0.1'].includes(location.hostname)?'A localhost link only works on this computer.':'This link uses the live review connection helper.'}</div>`);
 $('#copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(link);toast('Invitation copied.');}catch{$('#invite-value').select();toast('Select and copy the invitation.');}};
};
$('#leave').onclick=()=>leave();
function electOwner(l){within(l,()=>{const previous=session.state.owner;if(previous&&!session.members.has(previous)){const next=[...session.members.keys()].sort()[0];if(next===session.id)emit('owner',{previous,next});}});}
export function leaveLounge(l=selected){
 if(!l)return;within(l,()=>{const next=[...session.members.keys()].filter(id=>id!==session.id).sort()[0];if(session.state.owner===session.id&&next)emit('owner',{previous:session.id,next});});
 l.mesh.leave();l.activities.stop();l.activities.arcade.destroy();l.session.active=false;l.session.events.clear();l.session.private=[];l.session.drafts.clear();l.session.members.clear();lounges.delete(l.key);if(l.saved)l.saved.state='saved';
 if(selected===l)activate(null);renderHub();
}
function leave(){leaveLounge();}
window.addEventListener('pagehide',()=>{for(const l of lounges.values())l.mesh.leave();connectors.disconnectAll();});
function sendDM(to,text){const m={type:'dm',id:uid(),text,from:session.id,to,at:Date.now()};session.private.push(m);mesh.send(m,to);renderMessages();}
$('#composer').onsubmit=e=>{
 e.preventDefault();const text=$('#message').value.trim();if(!text||!session.active)return;
 if(session.dm)sendDM(session.dm,text);else{
  emit('message',{text,name:session.profile.name});
  const urls=text.match(/https?:\/\/\S+/g)||[];for(const u of urls.slice(0,1))activities.postedVideo(u);
 }
 $('#message').value='';session.drafts.delete(draftKey());wakeChat();$('#messages').scrollTop=$('#messages').scrollHeight;
};
$('#message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#composer').requestSubmit();}};
$('#emoji').onclick=()=>{modal('Say it with a face',`<p>The original BUDDY faces</p><div class="button-group">${['S','G','W','F','A'].map(c=>`<button data-emoji=":${c}:">${face(c)}</button>`).join('')}</div><div class="emoji-grid" style="margin-top:16px">${['🙂','😄','😂','🥰','😎','🤔','😴','🥳','👽','🛸','❤️','👍','🔥','🎮','🍿','✨'].map(x=>`<button data-emoji="${x}">${x}</button>`).join('')}</div><p>Images and animated GIFs can also be shared with the ＋ button.</p>`);$('#modal-body').onclick=e=>{const b=e.target.closest('[data-emoji]');if(b){$('#message').value+=b.dataset.emoji;closeModal();$('#message').focus();}};};
$('#messages').onclick=e=>{const b=e.target.closest('[data-react]');if(b)emit('reaction',{message:b.dataset.react,emoji:'👍'});};
$('#attachment').onclick=()=>{if(session.dm)return toast('Image sharing is available in rooms.');$('#image-file').click();};
$('#image-file').onchange=async e=>{
 const f=e.target.files[0];e.target.value='';if(!f)return;
 if(f.size>250000)return toast('Choose an image or GIF smaller than 250 KB for this mesh build.');
 if(!['image/png','image/jpeg','image/gif','image/webp'].includes(f.type))return toast('Choose a PNG, JPEG, WebP or GIF.');
 const data=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(f);});
 emit('message',{text:f.name,name:session.profile.name,image:data});
};
function wakeChat(){$('#chat-overlay').classList.remove('idle');clearTimeout(idleTimer);idleTimer=setTimeout(()=>$('#chat-overlay').classList.add('idle'),7000);}
$('#chat-overlay').onpointermove=wakeChat;$('#message').oninput=wakeChat;
$('#chat-mode').onchange=e=>{$('#chat-overlay').className=e.target.value;wakeChat();};
function toggleQueue(show){$('#queue').classList.toggle('closed',!show);$('#queue-toggle').setAttribute('aria-expanded',String(show));}
$('#queue-toggle').onclick=()=>toggleQueue($('#queue').classList.contains('closed'));$('#queue-close').onclick=()=>toggleQueue(false);
if(innerWidth<850)toggleQueue(false);
$('#mobile-menu').onclick=()=>document.body.classList.toggle('menu-open');
$('#stage').addEventListener('pointerdown',()=>document.body.classList.remove('menu-open'));
let splitStart;
$('#splitter').onpointerdown=e=>{splitStart={y:e.clientY,h:$('#room-section').offsetHeight};e.currentTarget.setPointerCapture(e.pointerId);};
$('#splitter').onpointermove=e=>{if(splitStart)$('#room-section').style.height=`${Math.min(380,Math.max(85,splitStart.h+e.clientY-splitStart.y))}px`;};
$('#splitter').onpointerup=()=>splitStart=null;
$('#splitter').onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();$('#room-section').style.height=`${Math.min(380,Math.max(85,$('#room-section').offsetHeight+(e.key==='ArrowUp'?-20:20)))}px`;}};

function renderQueue(){if(current!==selected)return;
 const entries=Object.values(session.state.queue||{}).sort((a,b)=>(a.when||a.added)-(b.when||b.added));
 $('#queue-count').textContent=entries.length;
 $('#queue-items').innerHTML=entries.length?entries.map((q,i)=>`<article class="queue-entry ${i===0?'now':''}"><small>${q.when?esc(new Date(q.when).toLocaleString([],{weekday:'short',hour:'2-digit',minute:'2-digit'})):i===0?'NEXT UP':'AFTER THAT'}</small><h3>${esc(q.title)}</h3><p>${esc(q.kind||'watch')} · added by ${esc(q.name)}</p><button data-play="${esc(q.id)}">Start ↗</button><button data-remove="${esc(q.id)}" aria-label="Remove ${esc(q.title)}">×</button></article>`).join(''):`<div class="queue-empty">An open evening.<br>Add a film, a game, or a plan.<br>Everyone gets a turn.</div>`;
}
function addQueue(schedule=false){
 modal(schedule?'Make a plan':'What’s next?',`<form id="queue-form"><label>Title<input id="q-title" required maxlength="80" placeholder="A movie under the stars"></label><div class="form-row"><label>Activity<select id="q-kind">${Object.entries(icons).filter(([k])=>k!=='ambient').map(([k])=>`<option>${k}</option>`).join('')}</select></label>${schedule?'<label>Start time<input id="q-time" type="datetime-local" required></label>':''}</div><label>Video or link (optional)<input id="q-url" type="url" placeholder="https://…"></label><button class="primary wide">${schedule?'Schedule event':'Add to next slot'}</button><p>Plans live only as long as this space.</p></form>`);
 $('#queue-form').onsubmit=e=>{e.preventDefault();emit('queue',{id:uid(),title:$('#q-title').value,kind:$('#q-kind').value,url:$('#q-url').value,when:schedule?new Date($('#q-time').value).getTime():0,added:Date.now(),name:session.profile.name});closeModal();};
}
$('#queue-add').onclick=()=>addQueue();$('#queue-schedule').onclick=()=>addQueue(true);
$('#queue-items').onclick=e=>{
 const del=e.target.closest('[data-remove]'),play=e.target.closest('[data-play]');
 if(del)emit('queue-remove',{id:del.dataset.remove});
 if(play){const q=session.state.queue[play.dataset.play];emit('activity',{mode:q.kind});if(q.url&&q.kind==='watch')activities.watch(q.url);else if(q.url)emit('link',{id:uid(),title:q.title,url:q.url});emit('queue-remove',{id:q.id});}
};
setInterval(()=>{for(const l of lounges.values())for(const q of Object.values(l.session.state.queue||{}))if(q.when&&q.when<=Date.now()&&!l.due.has(q.id)){l.due.add(q.id);toast(`${l.session.state.name}: time for ${q.title}.`);}},10000);

let customBackground=stored('orbit.background.image')||'';
function background(mode){
 if(!['default','plain','custom'].includes(mode)||mode==='custom'&&!customBackground)mode='default';
 const stage=$('#stage');stage.dataset.background=mode;stage.style.setProperty('--custom-background',customBackground.startsWith('data:image/jpeg;base64,')?`url("${customBackground}")`:'none');preference('orbit.background',mode);
 document.querySelectorAll('[data-background-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.backgroundChoice===mode)));
}
background(stored('orbit.background')||'default');
async function chooseBackground(file){
 if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024)return toast('Choose a JPG, PNG or WebP image under 8 MB.');
 try{const image=await createImageBitmap(file),scale=Math.min(1,1600/image.width,1000/image.height),c=document.createElement('canvas');c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);image.close();customBackground=c.toDataURL('image/jpeg',.8);background('custom');try{localStorage.setItem('orbit.background.image',customBackground);toast('Background saved on this device.');}catch{toast('Background set for this visit; device storage is full.');}}catch{toast('That image couldn’t open. Try another one.');}
}
$('#background-toggle').onclick=()=>activities.setBackgroundOnly(!activities.backgroundOnly);
$('#settings').onclick=settings;
function settings(){
 modal('Make it yours',`<div class="skin-options">${['orbit','buddy','roddy'].map(s=>`<button class="skin-tile ${document.documentElement.dataset.skin===s?'selected':''}" data-skin="${s}"><img src="assets/${{orbit:'orbit.svg',buddy:'buddy.png',roddy:'roddy-full.svg'}[s]}" alt=""><strong>${s.toUpperCase()}</strong></button>`).join('')}</div>
 <div class="settings-section"><h3>Chat background</h3><div class="background-options"><button data-background-choice="default">Default ORBIT scene</button><button data-background-choice="plain">Plain background</button><button id="background-image">Your image…</button><button id="background-remove">Remove saved image</button></div><input id="background-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><p>Only on this device. Choosing an image saves a resized copy as a local preference. Use “Chat background” at the top to return to the scene while a game keeps running.</p></div>
<button id="settings-id" class="wide">Your local ID · import / export / avatar ↗</button>
 <div class="settings-section"><h3>Your presence</h3><form id="profile-form"><div class="form-row"><label>Name<input id="profile-name" maxlength="24" value="${esc(identity.value.name)}"></label><label>Status<select id="profile-status"><option>Here</option><option>Away</option><option>Busy</option></select></label></div><label>About you<input id="profile-about" maxlength="160" value="${esc(identity.value.about)}"></label><label>Away reply<input id="profile-away" maxlength="160" value="${esc(session.profile.away||'')}"></label><button>Update presence</button></form></div>
 <div class="settings-section"><h3>This device</h3><label>Chat opacity when idle<input id="opacity" type="range" min="0" max="70" value="${stored('orbit.opacity')||25}"></label><label class="toggle-row">Desktop notifications<input id="notifications" type="checkbox" ${session.notifications?'checked':''}></label><label class="toggle-row">Original BUDDY message sound<input id="sounds" type="checkbox" ${soundEnabled?'checked':''}></label><label class="toggle-row">24-hour clock<input id="clock24" type="checkbox" ${clock24?'checked':''}></label><button id="controllers" class="wide">Gamepads & controls ↗</button></div>
 <div class="settings-section"><h3>Connection privacy</h3><label>For the next space<select id="privacy"><option value="direct">Direct first · encrypted relay fallback</option><option value="relay">Hide my IP · relay only</option></select></label><p>Direct peers can see each other’s IP address. Relay only requires your own configured TURN service and never falls back to direct.</p><div class="notice">Early development build: encrypted peer transport and encrypted messages, with an unaudited invite-key handshake. Do not use for sensitive conversations yet.</div></div>
 <div class="settings-section"><h3>Optional networks</h3><p>${deployment.review?'Optional account connectors are available in the local app. They are disabled on this public review site.':'Separate service conversations. Turning a connector off removes local access. Server history follows that service’s rules.'}</p>${['buddy','nina'].map(s=>`<label class="toggle-row">${s==='buddy'?'BUDDY Network':'NINA / AIM'}<input type="checkbox" data-connector="${s}" ${connectors.active(s)?'checked':''} ${deployment.review?'disabled':''}></label>`).join('')}</div>`);
 background(stored('orbit.background')||'default');
 document.querySelectorAll('[data-background-choice]').forEach(b=>b.onclick=()=>background(b.dataset.backgroundChoice));
 $('#background-image').onclick=()=>$('#background-file').click();$('#background-file').onchange=e=>chooseBackground(e.target.files[0]);
 $('#background-remove').onclick=()=>{customBackground='';try{localStorage.removeItem('orbit.background.image');}catch{}background('default');toast('Saved background image removed.');};
 $('#settings-id').onclick=identityDialog;
 $('#profile-status').value=session.profile.status||'Here';
 $('#profile-form').onsubmit=e=>{e.preventDefault();session.profile={name:$('#profile-name').value.trim()||session.name,status:$('#profile-status').value,about:$('#profile-about').value,away:$('#profile-away').value};identity.value.name=session.profile.name;identity.value.about=session.profile.about;$('#entry-name').value=session.profile.name;saveIdentity();for(const l of lounges.values())within(l,()=>{session.profile={...session.profile,name:identity.value.name,about:identity.value.about,avatar:identity.value.avatar};session.members.set(session.id,session.profile);awayReplies.clear();emit('profile',session.profile);});renderHub();toast('Profile saved on this device.');};
 $('#opacity').oninput=e=>{document.documentElement.style.setProperty('--idle-opacity',e.target.value/100);preference('orbit.opacity',e.target.value);};
 $('#privacy').value=identity.value.settings['orbit.privacy']||homeContext.session.privacy||'direct';$('#privacy').onchange=e=>{homeContext.session.privacy=e.target.value;identity.value.settings['orbit.privacy']=e.target.value;saveIdentity();toast('Privacy choice applies when you next join or create a space.');};
 $('#notifications').onchange=async e=>{session.notifications=e.target.checked&&'Notification'in window&&(await Notification.requestPermission())==='granted';e.target.checked=session.notifications;preference('orbit.notifications',session.notifications?'1':'0');for(const l of lounges.values())l.session.notifications=session.notifications;};
 $('#controllers').onclick=()=>activities.controllers();
 $('#sounds').onchange=e=>{soundEnabled=e.target.checked;preference('orbit.sound',soundEnabled?'1':'0');if(soundEnabled)new Audio('assets/sounds/message.wav').play().catch(()=>{});};
 $('#clock24').onchange=e=>{clock24=e.target.checked;preference('orbit.clock24',clock24?'1':'0');renderMessages();};
 document.querySelectorAll('[data-connector]').forEach(el=>el.onchange=()=>{if(el.checked)connectors.login(el.dataset.connector);else connectors.disconnect(el.dataset.connector);});
}
document.documentElement.style.setProperty('--idle-opacity',(stored('orbit.opacity')||25)/100);
soundEnabled=stored('orbit.sound')==='1';clock24=stored('orbit.clock24')==='1';
window.addEventListener('keydown',e=>{if(e.key==='F7'){e.preventDefault();settings();}if(e.key==='Escape'&&!$('#modal').open)document.body.classList.remove('menu-open');});

function rememberDesign(l){
 if(!l?.saved||!l.session.state.name)return;const state=l.session.state,entry=l.saved;
 if(entry.name!==state.name||entry.logo!==state.logo){entry.name=state.name;entry.logo=state.logo||'';saveIdentity();}
}
function applyLoungeDesign(){
 const d=selected?.session.state,stage=$('#stage');if(d?.accent){document.documentElement.style.setProperty('--accent',d.accent);const rgb=d.accent.slice(1).match(/../g).map(x=>parseInt(x,16));document.documentElement.style.setProperty('--accentText',rgb[0]*.299+rgb[1]*.587+rgb[2]*.114<140?'#fff':'#201509');}else{document.documentElement.style.removeProperty('--accent');document.documentElement.style.removeProperty('--accentText');}
 stage.style.setProperty('--lounge-background',d?.background?`url("${d.background}")`:'none');
 if((stored('orbit.background')||'default')==='default')stage.dataset.background=d?.background?'lounge':'default';
}
function loungeTile(entry,home=false){
 const l=lounges.get(entry.id),name=entry.alias||entry.name,status=joining.has(entry.id)?'connecting':l?.status||entry.state||'saved',sharing=l?.activities.streams?' · sharing':l?.activities.microphone?' · mic':'',count=l?[...l.unread.values()].reduce((a,b)=>a+b,0):0;
 return `<button class="lounge-tile ${selected===l&&l?'selected':''} ${home?'home-tile':''}" data-lounge="${esc(entry.id)}" title="${esc(name)} · ${esc(status)}"><span class="lounge-logo">${entry.logo?`<img src="${entry.logo}" alt="">`:esc(name.slice(0,2).toUpperCase())}</span><span><strong>${esc(name)}</strong><small>${esc(status)}${sharing}${count?` · ${count} unread`:''}</small></span></button>`;
}
function renderHub(){
 if(!$('#lounge-carousel'))return;const entries=identity.value.lounges;
 $('#lounge-carousel').innerHTML=entries.map(e=>loungeTile(e)).join('');$('#saved-lounges').innerHTML=entries.length?entries.map(e=>`<div class="saved-entry">${loungeTile(e,true)}<button data-saved-options="${esc(e.id)}" aria-label="Options for ${esc(e.alias||e.name)}">⋯</button></div>`).join(''):'<p class="notice">Your invitations will appear here. Join one whenever you like.</p>';
 $('#home-greeting').textContent=`Welcome home, ${identity.value.name}.`;
 const choice=$('#home-template').value;$('#home-template').innerHTML='<option value="">Fresh lounge</option>'+identity.value.templates.map((t,i)=>`<option value="${i}">${esc(t.name)}</option>`).join('');$('#home-template').value=choice;
 $('#template-list').innerHTML=identity.value.templates.length?identity.value.templates.map((t,i)=>`<div class="template-row"><span>${esc(t.name)} · ${t.rooms.length} rooms</span><button data-template-create="${i}">Create from design</button><button data-template-remove="${i}" aria-label="Remove design">×</button></div>`).join(''):'<p>No saved designs yet. Design a lounge, then save its layout.</p>';
 $('#lounge-design').disabled=!selected;$('#lounge-options').disabled=!selected;
}
function savedOptions(id){
 const entry=identity.value.lounges.find(e=>e.id===id);if(!entry)return;const l=lounges.get(id);
 modal('Saved lounge',`<p>${esc(entry.name)}</p><label>Your private nickname<input id="lounge-alias" maxlength="40" value="${esc(entry.alias)}"></label><label class="toggle-row">Reconnect when ORBIT opens<input id="lounge-auto" type="checkbox" ${entry.auto?'checked':''}></label><div class="button-group"><button id="saved-apply">Save</button>${l?'<button id="saved-leave">Leave this lounge</button><button id="saved-retry">Retry connection</button>':'<button id="saved-open">Try joining</button>'}<button id="saved-forget" class="danger">${l?'Leave and forget':'Forget invitation'}</button><button id="saved-left">Move left</button></div><p>A saved code does not restore an ended lounge. A connection failure may just mean the helper is unreachable.</p>`);
 $('#saved-apply').onclick=()=>{entry.alias=$('#lounge-alias').value.trim();entry.auto=$('#lounge-auto').checked;saveIdentity();closeModal();renderHub();};
 $('#saved-retry')?.addEventListener('click',()=>{l.mesh.retry();closeModal();});
 $('#saved-leave')?.addEventListener('click',()=>{leaveLounge(l);closeModal();});$('#saved-open')?.addEventListener('click',()=>{closeModal();enter(false,entry.code);});
 $('#saved-forget').onclick=()=>{if(l)leaveLounge(l);identity.value.lounges=identity.value.lounges.filter(e=>e!==entry);saveIdentity();closeModal();renderHub();};
 $('#saved-left').onclick=()=>{const i=identity.value.lounges.indexOf(entry);if(i>0){identity.value.lounges.splice(i,1);identity.value.lounges.splice(i-1,0,entry);saveIdentity();renderHub();}};
}
$('#home-button').onclick=()=>activate(null);$('#new-lounge').onclick=()=>{activate(null);$('#create-space').focus();};
$('#lounge-join').onsubmit=e=>{e.preventDefault();enter(false,$('#lounge-code').value);};
for(const id of ['lounge-carousel','saved-lounges'])$('#'+id).onclick=e=>{const options=e.target.closest('[data-saved-options]');if(options)return savedOptions(options.dataset.savedOptions);const tile=e.target.closest('[data-lounge]');if(!tile)return;const entry=identity.value.lounges.find(l=>l.id===tile.dataset.lounge);const live=lounges.get(entry.id);live?activate(live):enter(false,entry.code);};
$('#template-list').onclick=e=>{const create=e.target.closest('[data-template-create]'),remove=e.target.closest('[data-template-remove]');if(create)enter(true,'',identity.value.templates[Number(create.dataset.templateCreate)]);if(remove){identity.value.templates.splice(Number(remove.dataset.templateRemove),1);saveIdentity();renderHub();}};
$('#lounge-options').onclick=()=>selected&&savedOptions(selected.key);
$('#identity-card').onclick=identityDialog;
function download(text,name){const u=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function identityDialog(){
 modal('Your local ID card',`<div class="identity-preview">${identity.value.avatar?`<img src="${identity.value.avatar}" alt="Your avatar">`:'<span>◌</span>'}<div><h3>${esc(identity.value.name)}</h3><small>${identity.value.lounges.length} saved lounges · ${identity.value.templates.length} designs</small></div></div><p>Saved automatically on this device. Backups include private lounge invitations, but never chat, ROMs or live session keys.</p><button id="id-avatar">Change avatar</button><input id="id-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><label>Backup passphrase<input id="id-passphrase" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label><div class="button-group"><button id="id-export" class="primary">Export ID card</button><button id="id-import">Import ID card</button></div><input id="id-file" type="file" accept=".orbit-id,application/json" hidden><p id="id-status" role="status">Encrypted backups stay in your files. Importing is not an upload to the helper.</p><button id="id-delete" class="danger">Delete local ID…</button>`);
 $('#id-avatar').onclick=()=>$('#id-avatar-file').click();$('#id-avatar-file').onchange=async e=>{try{const value=await readImage(e.target.files[0],128);identity.value.avatar=value;saveIdentity();for(const l of lounges.values())within(l,()=>{session.profile.avatar=value;emit('profile',session.profile);});identityDialog();}catch(error){toast(error.message);}};
 $('#id-export').onclick=async()=>{try{for(const key of Object.keys(localStorage))if(key.startsWith('orbit.'))identity.value.settings[key]=localStorage.getItem(key);download(await identity.export($('#id-passphrase').value),'ORBIT.orbit-id');$('#id-status').textContent='Encrypted ID exported. Keep its passphrase separately.';}catch(e){$('#id-status').textContent=e.message;}};
 $('#id-import').onclick=()=>$('#id-file').click();$('#id-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const next=await identity.read(file,$('#id-passphrase').value);modal('Import ID preview',`<p>${esc(next.name)} · ${next.lounges.length} lounges · ${next.templates.length} designs</p><p>Nothing has been changed. Imported lounges will stay disconnected until you join or enable reconnect.</p><button id="id-merge" class="primary wide">Merge invitations and use this profile</button><button id="id-replace" class="wide danger">Replace local ID and leave live lounges</button><p id="id-import-status" role="status"></p>`);const apply=async merge=>{try{await identity.import(next,merge);storageError='';$('#identity-warning').hidden=true;if(!merge)for(const l of [...lounges.values()])leaveLounge(l);$('#entry-name').value=identity.value.name;for(const [k,v]of Object.entries(identity.value.settings))try{localStorage.setItem(k,v);}catch{}customBackground=stored('orbit.background.image')||'';skin(stored('orbit.skin')||'orbit');background(stored('orbit.background')||'default');soundEnabled=stored('orbit.sound')==='1';clock24=stored('orbit.clock24')==='1';document.documentElement.style.setProperty('--idle-opacity',(stored('orbit.opacity')||25)/100);for(const l of lounges.values())within(l,()=>{session.profile={...session.profile,name:identity.value.name,avatar:identity.value.avatar,about:identity.value.about};emit('profile',session.profile);});renderHub();closeModal();toast('ID imported and remembered on this device.');}catch(error){$('#id-import-status').textContent=error.message;}};$('#id-merge').onclick=()=>apply(true);$('#id-replace').onclick=()=>apply(false);}catch(error){$('#id-status').textContent=error.message;}};
 $('#id-delete').onclick=()=>{modal('Delete local ID?',`<p>This leaves all live lounges and removes this device’s ID, invitations, designs and ORBIT preferences. Exported backup files are separate.</p><button id="id-delete-confirm" class="danger wide">Delete ID and leave all lounges</button>`);$('#id-delete-confirm').onclick=async()=>{for(const l of [...lounges.values()])leaveLounge(l);await identity.forget();for(const key of Object.keys(localStorage))if(key.startsWith('orbit.'))localStorage.removeItem(key);location.reload();};};
}
$('#lounge-design').onclick=designer;
function designer(){
 if(!selected)return;const l=selected;if(l.session.state.owner!==l.session.id)return toast('The current lounge coordinator manages its design.');
 let draft=design({...l.session.state,rooms:Object.values(l.session.state.rooms)});
 const show=()=>{modal('Design your lounge',`<form id="designer-form"><div class="designer-preview">${draft.logo?`<img src="${draft.logo}" alt="Lounge icon preview">`:'✦'}<strong>${esc(draft.name)}</strong>${draft.background?'<small>Background selected</small>':''}</div><label>Lounge name<input id="design-name" maxlength="40" value="${esc(draft.name)}" required></label><div class="button-group"><button id="design-logo" type="button">Choose icon</button><button id="design-background" type="button">Choose background</button><button id="design-clear-background" type="button">Clear background</button></div><input id="design-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><label>Accent<input id="design-accent" type="color" value="${draft.accent}"></label><h3>Rooms</h3><div id="designer-rooms">${draft.rooms.map((r,i)=>`<div class="designer-room"><input data-room-icon="${i}" aria-label="Room icon" maxlength="8" value="${esc(r.icon)}" placeholder="◌"><input data-room-name="${i}" aria-label="Room name" maxlength="40" value="${esc(r.name)}"><select data-room-mode="${i}" aria-label="Room activity">${Object.keys(icons).map(mode=>`<option value="${mode}" ${r.mode===mode?'selected':''}>${mode}</option>`).join('')}</select><button type="button" data-room-up="${i}" aria-label="Move room up">↑</button><button type="button" data-room-delete="${i}" aria-label="Delete room">×</button></div>`).join('')}</div><button type="button" id="design-add-room">＋ Room</button><div class="button-group"><button class="primary">Apply to lounge</button><button type="button" id="design-save-template">Save as local design</button></div><p id="design-status" role="status">Designs contain appearance and room definitions, never conversations.</p></form>`);
 const collect=()=>{draft.name=$('#design-name').value;draft.accent=$('#design-accent').value;document.querySelectorAll('[data-room-name]').forEach(input=>draft.rooms[Number(input.dataset.roomName)].name=input.value);document.querySelectorAll('[data-room-icon]').forEach(input=>draft.rooms[Number(input.dataset.roomIcon)].icon=input.value);document.querySelectorAll('[data-room-mode]').forEach(input=>draft.rooms[Number(input.dataset.roomMode)].mode=input.value);};
 $('#designer-form').onsubmit=e=>{e.preventDefault();collect();if(!draft.rooms.length)return toast('Keep at least one room.');if(JSON.stringify(draft).length>350000)return toast('Choose smaller lounge images.');within(l,()=>emit('design',design(draft)));closeModal();};
 $('#design-save-template').onclick=()=>{collect();if(identity.value.templates.length>=12)return toast('Up to twelve designs fit in an ID.');identity.value.templates.push(design(draft));saveIdentity();renderHub();toast('Lounge design saved locally.');};
 $('#design-add-room').onclick=()=>{collect();if(draft.rooms.length<40)draft.rooms.push({id:uid(),name:'New room',icon:'◌',mode:'ambient'});show();};
 $('#designer-rooms').onclick=e=>{const remove=e.target.closest('[data-room-delete]'),up=e.target.closest('[data-room-up]');if(!remove&&!up)return;collect();if(remove&&draft.rooms.length>1)draft.rooms.splice(Number(remove.dataset.roomDelete),1);if(up){const i=Number(up.dataset.roomUp);if(i>0)[draft.rooms[i-1],draft.rooms[i]]=[draft.rooms[i],draft.rooms[i-1]];}show();};
 const choose=target=>{collect();$('#design-file').onchange=async e=>{try{draft[target]=await readImage(e.target.files[0],target==='logo'?128:900);show();}catch(error){toast(error.message);}};$('#design-file').click();};$('#design-logo').onclick=()=>choose('logo');$('#design-background').onclick=()=>choose('background');$('#design-clear-background').onclick=()=>{collect();draft.background='';show();};
 };show();
}
rebuild();activate(null);wakeChat();$('#identity-warning').hidden=!storageError;$('#identity-warning').textContent=storageError;$('#create-space').disabled=$('#join-space').disabled=$('#entry-name').disabled=$('#join-code').disabled=false;
if(initialInvite){$('#lounge-code').value=initialInvite;toast('Invite ready. Use Join to enter this lounge.');}
for(const saved of identity.value.lounges.filter(l=>l.auto).slice(0,4))enter(false,saved.code);
