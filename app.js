import {Mesh,b64,bytes,random} from './mesh.js';
import init,{chess_state,chess_play,chess_computer,Chip8} from './pkg/orbit_core.js';
import {Activities} from './activities.js';
import {Connectors} from './connectors.js';
import {face,facesIn} from './faces.js';
import {appBase,deployment} from './runtime.js';

export const $=s=>document.querySelector(s);
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const uid=()=>b64(random(12));
export function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
let toastTimer;
export function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
export function modal(title,html){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();}
export function closeModal(){$('#modal').close();}
export const mesh=new Mesh();
const icons={ambient:'◌',watch:'▷',whiteboard:'✎',chess:'♘',emulator:'▦',tasks:'☑',news:'↗'};
const defaultRooms=[{id:'lounge',name:'Lounge',mode:'ambient'},{id:'cinema',name:'Watch party',mode:'watch'},{id:'arcade',name:'Playroom',mode:'emulator'},{id:'studio',name:'Studio',mode:'whiteboard'}];
export const session={active:false,id:'',name:'',profile:{},room:'lounge',dm:null,members:new Map(),events:new Map(),eventBytes:0,private:[],drafts:new Map(),clock:0,state:{},privacy:'direct',notifications:false};
export const activities=new Activities({emit,session,toast,modal,closeModal,esc,$,safeURL,uid,mesh,core:{chess_state,chess_play,chess_computer,Chip8}});
const connectors=new Connectors({modal,closeModal,toast,esc,$});
let idleTimer,unread=new Map(),awayReplies=new Set(),soundEnabled=false,clock24=false;
const stored=k=>{try{return localStorage.getItem(k);}catch{return null;}};
function preference(k,v){try{localStorage.setItem(k,v);}catch{}}
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
skin(stored('orbit.skin')||'orbit');
$('#modal-close').onclick=closeModal;
$('#welcome').addEventListener('cancel',e=>e.preventDefault());
$('#entry-form').onsubmit=e=>{e.preventDefault();enter(true);};
$('#join-space').onclick=()=>enter(false);
if(location.hash.length>1){$('#join-code').value=location.href;history.replaceState(null,'',location.pathname);}
async function enter(create){
 const name=$('#entry-name').value.trim().slice(0,24);if(!name){$('#entry-status').textContent='Choose a name first.';return;}
 $('#create-space').disabled=$('#join-space').disabled=true;$('#entry-status').textContent='Opening your space…';
 try{
  await init();
  const result=await mesh.start($('#join-code').value.trim(),create,{name,status:'Here',about:''},session.privacy);
  Object.assign(session,{active:true,id:result.id,name,profile:{name,status:'Here',about:''},room:'lounge',dm:null,clock:0});
  session.members.set(result.id,session.profile);
  $('#welcome').close();$('#join-code').value='';$('#entry-status').textContent='No account. No stored chat history.';
  $('#invite').disabled=$('#leave').disabled=false;$('#connection-dot').classList.add('live');$('#connection-dot').title='Space open';
  if(create)emit('space',{name:'Tonight'});else rebuild();
  render();toast(create?'Your space is ready. Invite your people.':'Joined. Connecting directly to the people here…');
 }catch(e){mesh.leave();$('#entry-status').textContent=e.message||String(e);}
 finally{$('#create-space').disabled=$('#join-space').disabled=false;}
}
$('#welcome').showModal();

// Deterministically ordered operations converge after concurrent edits and late joins.
// The log is capped in memory; no room data is put in localStorage/IndexedDB.
export function emit(type,data={},room=session.room){
 if(!session.active)return toast('Create or join a space first.');
 const event={id:uid(),actor:session.id,n:++session.clock,at:Date.now(),room,type,data};
 if(accept(event,session.id)){mesh.send({type:'event',event});return event;}
}
const allowed=new Set(['space','room','activity','message','reaction','queue','queue-remove','stroke','board-clear','chess','rom','task','link','watch','profile']);
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
  if(session.room!==event.room||session.dm)unread.set(event.room,(unread.get(event.room)||0)+1);
  notify(event.data.name,event.data.text);wakeChat();
 }
 render(event.type);return true;
}
function rebuild(){
 const s={name:'Tonight',rooms:Object.fromEntries(defaultRooms.map(r=>[r.id,{...r}])),messages:[],reactions:{},queue:{},strokes:{},tasks:{},links:{},chess:{},rom:{},watch:{},profiles:{}};
 const ordered=[...session.events.values()].sort((a,b)=>a.n-b.n||a.actor.localeCompare(b.actor)||a.id.localeCompare(b.id));
 for(const e of ordered){
  const d=e.data,r=e.room;
  switch(e.type){
   case 'space':s.name=String(d.name||'Tonight').slice(0,40);break;
   case 'room':if(typeof d.name==='string'&&Object.keys(s.rooms).length<40)s.rooms[d.id]={id:d.id,name:d.name.slice(0,40),mode:'ambient'};break;
   case 'activity':if(s.rooms[r]&&icons[d.mode])s.rooms[r].mode=d.mode;break;
   case 'message':if(typeof d.text==='string'&&d.text.length<=4000)s.messages.push(e);break;
   case 'reaction':if(typeof d.emoji==='string'&&d.emoji.length<10){s.reactions[d.message]??={};s.reactions[d.message][e.actor]=d.emoji;}break;
   case 'queue':if(typeof d.title==='string')s.queue[d.id]={...d,actor:e.actor};break;
   case 'queue-remove':delete s.queue[d.id];break;
   case 'stroke':if(Array.isArray(d.points)&&d.points.length<3000){s.strokes[r]??=[];s.strokes[r].push(d);}break;
   case 'board-clear':s.strokes[r]=[];break;
   case 'chess':try{const previous=s.chess[r]?.fen||'';if(d.reset)s.chess[r]={fen:'',computer:!!d.computer};else if(d.before===previous)s.chess[r]={...s.chess[r],fen:JSON.parse(chess_play(previous,d.move)).fen};}catch{}break;
   case 'rom':if(typeof d.rom==='string'&&d.rom.length<5000)s.rom[r]={...d,actor:e.actor,event:e.id};break;
   case 'task':if(typeof d.title==='string'&&['todo','doing','done'].includes(d.status))s.tasks[d.id]={...d,room:r};break;
   case 'link':if(safeURL(d.url))s.links[d.id]={...d,room:r};break;
   case 'watch':if(!d.url||safeURL(d.url)||d.url.startsWith('local:'))s.watch[r]={...d,actor:e.actor,event:e.id};break;
   case 'profile':s.profiles[e.actor]=d;break;
  }
 }
 session.state=s;
 for(const [id,p]of Object.entries(s.profiles))if(session.members.has(id))session.members.set(id,p);
}
mesh.addEventListener('joined',e=>{
 const {id,profile}=e.detail;session.members.set(id,profile);
 mesh.send({type:'snapshot',events:[...session.events.values()],profiles:[...session.members]},id);
 render();toast(`${profile.name||'Someone'} joined your space.`);
});
mesh.addEventListener('left',e=>{const name=session.members.get(e.detail)?.name;session.members.delete(e.detail);if(session.dm===e.detail)selectRoom(session.room);render();if(name)toast(`${name} left.`);});
mesh.addEventListener('data',e=>{
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
});
mesh.addEventListener('error',e=>toast(e.detail));
mesh.addEventListener('ended',()=>leave());
mesh.addEventListener('stream',e=>activities.stream(e.detail.id,e.detail.stream));
mesh.addEventListener('connection',()=>renderStatus());
function notify(name,text){if(soundEnabled)new Audio('assets/sounds/message.wav').play().catch(()=>{});if(session.notifications&&document.hidden&&Notification.permission==='granted')new Notification(`ORBIT · ${name||'Message'}`,{body:String(text).slice(0,100)});}
function renderStatus(){$('#stage-status span').textContent=session.active?`${session.members.size} here · ${session.privacy==='relay'?'Relay only':'Peer connections'} · Memory only`:'Ready when you are';}
export function render(reason){
 if(!session.state.rooms)rebuild();
 const s=session.state,r=s.rooms[session.room]||s.rooms.lounge;
 $('#space-name').textContent=s.name;
 $('#rooms').innerHTML=Object.values(s.rooms).map(r=>`<button class="room ${r.id===session.room&&!session.dm?'active':''}" data-room="${esc(r.id)}"><span class="room-glyph">${icons[r.mode]}</span>${esc(r.name)}${unread.get(r.id)?`<b>${unread.get(r.id)}</b>`:''}</button>`).join('');
 $('#members').innerHTML=[...session.members].map(([id,p])=>`<button class="member" data-member="${esc(id)}"><span class="avatar">${esc(String(p.name||'?').slice(0,2).toUpperCase())}</span><span class="member-name">${esc(p.name)}${id===session.id?' <small>you · ': '<small>'}${esc(p.status||'Here')}</small></span></button>`).join('');
 $('#member-count').textContent=session.members.size;
 $('#room-title').textContent=session.dm?session.members.get(session.dm)?.name||'Private chat':r.name;
 $('#room-icon').textContent=session.dm?'↗':icons[r.mode];
 $('#room-subtitle').textContent=session.dm?'Private · only the two of you':'A little space to be together';
 $('#activity').value=r.mode;
 $('#message').placeholder=`Message ${session.dm?session.members.get(session.dm)?.name:r.name}…`;
 $('#chat-context').style.display=session.dm?'block':'none';$('#chat-context').textContent='Private conversation · click a room to return';
 renderMessages();renderQueue();renderStatus();
 activities.render(r.mode,reason);
}
function renderMessages(){
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
$('#activity').onchange=e=>{session.dm=null;emit('activity',{mode:e.target.value});};
$('#start-watch').onclick=()=>activities.shareDialog();
$('#share').onclick=()=>activities.shareDialog();
$('#invite').onclick=()=>{
 const link=new URL(`#${mesh.code}`,appBase).href;
 modal('Bring your people',`<p>Anyone with this code can join while the space is alive. Share it privately.</p><label>Invitation link<textarea id="invite-value" rows="4" readonly>${esc(link)}</textarea></label><button id="copy-invite" class="primary wide">Copy invitation</button><div class="notice" style="margin-top:16px">Up to 8 people in this first build. Friends need to reach this app’s address. ${['localhost','127.0.0.1'].includes(location.hostname)?'A localhost link only works on this computer.':'This link uses the live review connection helper.'}</div>`);
 $('#copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(link);toast('Invitation copied.');}catch{$('#invite-value').select();toast('Select and copy the invitation.');}};
};
$('#leave').onclick=()=>leave();
function leave(){
 mesh.leave();activities.stop();connectors.disconnectAll();
 session.active=false;session.events.clear();session.eventBytes=0;session.members.clear();session.private=[];session.drafts.clear();session.clock=0;session.dm=null;session.room='lounge';session.profile={};session.id='';session.name='';
 unread.clear();awayReplies.clear();due.clear();$('#message').value='';$('#invite').disabled=$('#leave').disabled=true;$('#connection-dot').classList.remove('live');closeModal();$('#modal-body').replaceChildren();rebuild();render();$('#welcome').showModal();
}
window.addEventListener('pagehide',()=>{mesh.leave();connectors.disconnectAll();});
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

function renderQueue(){
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
const due=new Set();setInterval(()=>{if(!session.active)return;for(const q of Object.values(session.state.queue||{}))if(q.when&&q.when<=Date.now()&&!due.has(q.id)){due.add(q.id);toast(`It’s time for ${q.title}. Open Up next to start.`);}},10000);

$('#settings').onclick=settings;
function settings(){
 modal('Make it yours',`<div class="skin-options">${['orbit','buddy','roddy'].map(s=>`<button class="skin-tile ${document.documentElement.dataset.skin===s?'selected':''}" data-skin="${s}"><img src="assets/${{orbit:'orbit.svg',buddy:'buddy.png',roddy:'roddy-full.svg'}[s]}" alt=""><strong>${s.toUpperCase()}</strong></button>`).join('')}</div>
 <div class="settings-section"><h3>Your presence</h3><form id="profile-form"><div class="form-row"><label>Name<input id="profile-name" maxlength="24" value="${esc(session.profile.name||'')}"></label><label>Status<select id="profile-status"><option>Here</option><option>Away</option><option>Busy</option></select></label></div><label>About you<input id="profile-about" maxlength="160" value="${esc(session.profile.about||'')}"></label><label>Away reply<input id="profile-away" maxlength="160" value="${esc(session.profile.away||'')}"></label><button>Update presence</button></form></div>
 <div class="settings-section"><h3>This device</h3><label>Chat opacity when idle<input id="opacity" type="range" min="0" max="70" value="${stored('orbit.opacity')||25}"></label><label class="toggle-row">Desktop notifications<input id="notifications" type="checkbox" ${session.notifications?'checked':''}></label><label class="toggle-row">Original BUDDY message sound<input id="sounds" type="checkbox" ${soundEnabled?'checked':''}></label><label class="toggle-row">24-hour clock<input id="clock24" type="checkbox" ${clock24?'checked':''}></label><button id="controllers" class="wide">Gamepads & controls ↗</button></div>
 <div class="settings-section"><h3>Connection privacy</h3><label>For the next space<select id="privacy"><option value="direct">Direct first · encrypted relay fallback</option><option value="relay">Hide my IP · relay only</option></select></label><p>Direct peers can see each other’s IP address. Relay only requires your own configured TURN service and never falls back to direct.</p><div class="notice">Early development build: encrypted peer transport and encrypted messages, with an unaudited invite-key handshake. Do not use for sensitive conversations yet.</div></div>
 <div class="settings-section"><h3>Optional networks</h3><p>${deployment.review?'Optional account connectors are available in the local app. They are disabled on this public review site.':'Separate service conversations. Turning a connector off removes local access. Server history follows that service’s rules.'}</p>${['buddy','nina'].map(s=>`<label class="toggle-row">${s==='buddy'?'BUDDY Network':'NINA / AIM'}<input type="checkbox" data-connector="${s}" ${connectors.active(s)?'checked':''} ${deployment.review?'disabled':''}></label>`).join('')}</div>`);
 $('#profile-status').value=session.profile.status||'Here';
 $('#profile-form').onsubmit=e=>{e.preventDefault();if(!session.active)return toast('Join a space first.');session.profile={name:$('#profile-name').value.trim()||session.name,status:$('#profile-status').value,about:$('#profile-about').value,away:$('#profile-away').value};session.members.set(session.id,session.profile);awayReplies.clear();emit('profile',session.profile);toast('Presence updated.');};
 $('#opacity').oninput=e=>{document.documentElement.style.setProperty('--idle-opacity',e.target.value/100);preference('orbit.opacity',e.target.value);};
 $('#privacy').value=session.privacy;$('#privacy').onchange=e=>{session.privacy=e.target.value;toast('Privacy choice applies when you next join or create a space.');};
 $('#notifications').onchange=async e=>{session.notifications=e.target.checked&&'Notification'in window&&(await Notification.requestPermission())==='granted';e.target.checked=session.notifications;};
 $('#controllers').onclick=()=>activities.controllers();
 $('#sounds').onchange=e=>{soundEnabled=e.target.checked;preference('orbit.sound',soundEnabled?'1':'0');if(soundEnabled)new Audio('assets/sounds/message.wav').play().catch(()=>{});};
 $('#clock24').onchange=e=>{clock24=e.target.checked;preference('orbit.clock24',clock24?'1':'0');renderMessages();};
 document.querySelectorAll('[data-connector]').forEach(el=>el.onchange=()=>{if(el.checked)connectors.login(el.dataset.connector);else connectors.disconnect(el.dataset.connector);});
}
document.documentElement.style.setProperty('--idle-opacity',(stored('orbit.opacity')||25)/100);
soundEnabled=stored('orbit.sound')==='1';clock24=stored('orbit.clock24')==='1';
window.addEventListener('keydown',e=>{if(e.key==='F7'){e.preventDefault();settings();}if(e.key==='Escape'&&!$('#modal').open)document.body.classList.remove('menu-open');});
rebuild();render();wakeChat();
