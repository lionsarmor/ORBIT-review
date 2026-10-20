import {systems,detectROM} from './roms.js';

const zeros=()=>Array(24).fill(0);
const keyboard={i:23,j:21,k:22,l:20,ArrowUp:4,ArrowDown:5,ArrowLeft:6,ArrowRight:7,z:0,x:8,a:1,s:9,q:10,w:11,Enter:3,Shift:2,e:12};
const padButtons={0:0,1:8,2:1,3:9,4:10,5:11,6:12,7:13,8:2,9:3,12:4,13:5,14:6,15:7};

// Runtime ownership is independent of the currently mounted activity view.
export class Arcade{
 constructor(api){
  Object.assign(this,api);this.abort=new AbortController();const on=(target,event,handler,options={})=>target.addEventListener(event,handler,{...options,signal:this.abort.signal});this.games=new Map();this.streams=new Map();this.keys=new Set();this.touch=new Set();this.padIndex=Number(localStorage.getItem('orbit.pad')||0);this.deadzone=Number(localStorage.getItem('orbit.deadzone')||.2);this.lastInput='';
  this.parking=document.createElement('div');this.parking.className='arcade-parking';document.querySelector('#stage').append(this.parking);on(window,'resize',()=>this.position());on(document,'scroll',()=>this.position(),{capture:true});
  const key=(e,down)=>{const g=this.current();if(!g)return;const layout=g.system==='n64'?{...keyboard,z:1,x:0,a:12,ArrowUp:19,ArrowDown:18,ArrowLeft:17,ArrowRight:16}:keyboard;const k=layout[e.key]??layout[e.key.toLowerCase()];if(k===undefined)return;if(!down){this.keys.delete(k);this.sendInput(true);return;}if(!this.canInput())return;e.preventDefault();down?this.keys.add(k):this.keys.delete(k);this.sendInput();};
  on(window,'keydown',e=>key(e,true));on(window,'keyup',e=>key(e,false));
  on(window,'blur',()=>this.release());on(document,'focusin',e=>{if(e.target.matches('input,textarea,select,[contenteditable]'))this.release();});
  on(document,'visibilitychange',()=>{if(document.hidden)this.release();});
  on(window,'gamepaddisconnected',()=>this.release());
  this.timer=setInterval(()=>this.tick(),50);
 }
 current(){return this.games.get(this.session.room);}
 visible(){return this.activities.active&&this.isVisible()&&this.activities.mode==='emulator'&&!this.activities.backgroundOnly;}
 canInput(){return this.visible()&&!document.hidden&&!document.querySelector('dialog[open]')&&!document.activeElement?.matches('input,textarea,select,[contenteditable]');}
 metadata(g){return {id:g.id,system:g.system,name:g.name};}
 reconcile(){
  for(const [room,g]of this.games){const meta=this.session.state.games?.[room];if(!meta||meta.id!==g.id||!this.session.members.has(meta.host)&&!this.session.members.has(meta.standby)){this.dispose(room);continue;}g.standby=meta.standby;if(g.host!==meta.host){this.engine(g)?.stop();g.frame?.remove();g.frame=null;this.mesh.share(null,`arcade:${room}`);g.host=meta.host;g.status='booting';g.streamId='';if(g.host===this.session.id&&g.backup?.rom&&g.backup?.state)this.startEngine(g,g.backup.rom,g.backup.state);if(this.visible())this.show();}}
  for(const [room,m]of Object.entries(this.session.state.games||{})){
   if(!systems[m.system]||!this.session.members.has(m.host)||this.games.has(room))continue;
   this.games.set(room,{...m,room,seats:Array(systems[m.system].players).fill(null),blocked:[],status:'booting',revision:0,inputs:new Map(),votes:new Map()});
   if(m.host!==this.session.id)this.mesh.send({type:'arcade-sync',room,game:m.id},m.host);
  }
 }
 async load(file){
  if(!this.session.active)return this.toast('Join your people first, then drop a cartridge.');
  if(!file)return;
  if(file.size>64*1024*1024)return this.notice('That cartridge is bigger than our spaceship! The limit is 64 MB.');
  let system,bytes;try{bytes=new Uint8Array(await file.arrayBuffer());system=detectROM(file.name,bytes);}catch(e){return this.notice(e.message);}
  if(this.destroyed)return;
  if(this.current())return this.notice('A game is already on! Use Game options → End game before dropping the next cartridge.');
  if([...this.games.values()].some(g=>g.host===this.session.id))return this.notice('You’re hosting a cartridge in another room. End that game before starting the next one.');
  const room=this.session.room,id=this.uid(),g={id,room,host:this.session.id,system,name:file.name.slice(0,100),seats:Array(systems[system].players).fill(null),blocked:[],status:'booting',revision:0,inputs:new Map(),votes:new Map()};
  this.games.set(room,g);this.startEngine(g,bytes);
  this.emit('game',{action:'start',...this.metadata(g)},room);this.broadcast(g);this.updateView();
 }
 startEngine(g,bytes,state){g.bytes=bytes;
  const frame=document.createElement('iframe');frame.className='cartridge-engine';frame.title='Cartridge player';frame.allow='autoplay; gamepad';frame.src=new URL('arcade-engine.html',import.meta.url);g.frame=frame;
  frame.onload=()=>{
   if(this.games.get(g.room)!==g)return;
   frame.contentWindow.orbitEngine.boot({rom:new Blob([bytes]),name:g.name,core:systems[g.system].core,
    onStarted:async stream=>{
     if(this.games.get(g.room)!==g){stream?.getTracks().forEach(t=>t.stop());return;}
     if(state)frame.contentWindow.orbitEngine.restore(state);clearTimeout(g.bootTimer);g.status='ready';g.stream=stream;g.streamId=stream?.id;frame.contentWindow.orbitEngine.volume(this.isVisible()?1:0);
     if(stream)await this.mesh.share(stream,`arcade:${g.room}`);this.broadcast(g);this.updateView();
    },onError:message=>{if(this.games.get(g.room)!==g)return;clearTimeout(g.bootTimer);g.status='error';g.error=String(message).slice(0,200);this.broadcast(g);this.updateView();}
   });
  };
  this.parking.append(frame);
  g.bootTimer=setTimeout(()=>{if(g.status==='booting'){g.status='error';g.error='This cartridge took too long to boot. Try another ROM or a browser with WebGL 2.';this.broadcast(g);this.updateView();}},90000);
 }
 notice(text){const n=this.$('#arcade-notice');if(n){n.textContent=text;n.hidden=false;}this.toast(text);}
 broadcast(g,to){if(g.host!==this.session.id)return;g.revision++;this.mesh.send({type:'arcade-state',room:g.room,game:g.id,revision:g.revision,seats:g.seats,blocked:g.blocked,status:g.status,error:g.error||'',streamId:g.streamId||''},to);}
 peerJoined(id){for(const g of this.games.values())if(g.host===this.session.id)this.broadcast(g,id);}
 peerLeft(id){
  for(const [room,g]of this.games){
   if(g.host===id){this.clearPlayer(g,id);if(g.standby&&this.session.members.has(g.standby)){if(g.standby===this.session.id&&g.backup?.rom&&g.backup?.state)this.emit('game-host',{id:g.id,previous:id,next:this.session.id},room);else this.toast('Recovering the game on its standby host…');}else{this.dispose(room);this.toast('The cartridge host left. No standby was prepared.');}continue;}
   if(g.host===this.session.id){g.votes.delete(id);for(const votes of g.votes.values())votes.delete(id);this.clearPlayer(g,id);this.broadcast(g);}
  }this.updateView();
 }
 clearPlayer(g,id){const slot=g.seats.indexOf(id);if(slot<0)return;g.seats[slot]=null;g.inputs.delete(id);this.engine(g)?.input(slot,zeros());}
 request(action,target){const g=this.current();if(!g)return;if(action==='claim')this.release();const v={type:'arcade-action',room:g.room,game:g.id,action,target};if(g.host===this.session.id)this.receive(this.session.id,v);else this.mesh.send(v,g.host);}
 receive(id,v){
  if(!v?.type?.startsWith('arcade-'))return;
  const g=this.games.get(v.room);if(!g||g.id!==v.game||!this.session.members.has(id))return;
  if(v.type.startsWith('arcade-transfer')||v.type==='arcade-standby-offer'||v.type==='arcade-standby-accept'||v.type==='arcade-standby-ready'){this.transferMessage(g,id,v);return;}
  if(v.type==='arcade-sync'&&g.host===this.session.id)return this.broadcast(g,id);
  if(v.type==='arcade-state'){
   if(id!==g.host||!Number.isSafeInteger(v.revision)||v.revision<=g.revision||!Array.isArray(v.seats)||v.seats.length!==systems[g.system].players||!v.seats.every(p=>p===null||(typeof p==='string'&&this.session.members.has(p)))||new Set(v.seats.filter(Boolean)).size!==v.seats.filter(Boolean).length||!Array.isArray(v.blocked)||v.blocked.length>8||!v.blocked.every(p=>typeof p==='string'&&p.length<100)||!['booting','ready','error'].includes(v.status)||typeof v.streamId!=='string'||v.streamId.length>100)return;
   Object.assign(g,{revision:v.revision,seats:v.seats,blocked:v.blocked,status:v.status,error:String(v.error||'').slice(0,200),streamId:v.streamId});this.updateView();return;
  }
  if(g.host!==this.session.id)return;
  if(v.type==='arcade-input'){
   const slot=g.seats.indexOf(id);if(slot<0||g.blocked.includes(id)||!Array.isArray(v.values)||v.values.length!==24||!v.values.every(n=>Number.isInteger(n)&&n>=0&&n<=32767))return;
   const previous=g.inputs.get(id);if(previous&&performance.now()-previous.at<12&&v.values.some(Boolean))return;
   g.inputs.set(id,{values:v.values,at:performance.now()});this.engine(g)?.input(slot,v.values);return;
  }
  if(v.type!=='arcade-action')return;
  if(v.action==='claim'&&!g.blocked.includes(id)&&Number.isInteger(v.target)&&v.target>=0&&v.target<g.seats.length){const owner=g.seats[v.target];if(owner===id)this.clearPlayer(g,id);else if(owner===null){this.clearPlayer(g,id);g.seats[v.target]=id;}}
  if(v.action==='disconnect')this.clearPlayer(g,id);
  if(v.action==='end'&&id===g.host){this.emit('game',{action:'end',id:g.id},g.room);return;}
  if(v.action==='unblock'&&id===g.host)g.blocked=g.blocked.filter(p=>p!==v.target);
  if((v.action==='kick'&&id===g.host)||(v.action==='vote'&&g.seats.includes(v.target))){
   const target=v.target;if(!this.session.members.has(target))return;
   let kick=id===g.host&&v.action==='kick';
   if(!kick){let votes=g.votes.get(target);if(!votes){votes=new Set();g.votes.set(target,votes);}votes.add(id);kick=votes.size>this.session.members.size/2;}
   if(kick){if(target===g.host){this.emit('game',{action:'end',id:g.id},g.room);return;}this.clearPlayer(g,target);if(!g.blocked.includes(target))g.blocked.push(target);g.votes.delete(target);}
  }
  this.broadcast(g);this.updateView();
 }
 engine(g){return g.frame?.contentWindow?.orbitEngine;}
 stream(id,stream){this.streams.set(`${id}:${stream.id}`,stream);this.attachVideo();}
 attachVideo(){const g=this.current(),v=this.$('#arcade-video');if(!g||!v)return;const s=this.streams.get(`${g.host}:${g.streamId}`);if(s&&v.srcObject!==s){v.srcObject=s;v.play().catch(()=>{});}}
 park(){this.observer?.disconnect();this.parking.style.cssText='';this.parking.classList.remove('showing');this.release();}
 position(){const display=this.$('#arcade-display'),g=this.current();if(!display||!g?.frame||!this.visible())return;const rect=display.getBoundingClientRect(),stage=this.$('#stage').getBoundingClientRect();this.parking.classList.add('showing');Object.assign(this.parking.style,{left:(rect.left-stage.left)+'px',top:(rect.top-stage.top)+'px',width:rect.width+'px',height:rect.height+'px'});}
 show(){
  this.seatsSignature='';this.park();const {$,esc}=this,g=this.current();
  this.$('#activity-content').innerHTML=`<section class="arcade-panel"><div class="arcade-heading"><div><span class="eyebrow">PRESS START. STAY A WHILE.</span><h2>Playroom<span>✦</span></h2></div><div><button id="arcade-controls">Controls</button>${g?'<button id="arcade-options">Game options ⋯</button>':''}</div></div><div id="arcade-notice" role="status" class="notice" hidden></div><div id="arcade-field" class="${g?'arcade-playing':'arcade-drop'}" tabindex="0" aria-label="Drop a cartridge ROM here">${g?`<div id="arcade-display">${g.host===this.session.id?'':`<video id="arcade-video" autoplay playsinline></video><button id="arcade-sound">Enable game audio</button>`}</div><div class="arcade-gamebar"><div><strong>${esc(g.name)}</strong><small>${esc(systems[g.system].name)} · ${g.host===this.session.id?'Hosted on your device':`Hosted by ${esc(this.session.members.get(g.host)?.name||'a peer')}`}</small></div><span id="arcade-status"></span></div>`:`<div class="cartridge-art" aria-hidden="true"><span>✦</span><i></i><b>O R B I T</b></div><h3>Good friends.<br>Great cartridges.</h3><p>Drop a ROM here. We’ll take it from there.</p><button id="arcade-browse" class="primary">＋ Choose a ROM</button><div class="console-list">${Object.values(systems).map(s=>`<span title="${esc(s.extensions)}">${esc(s.name)}</span>`).join('')}</div><small>Your cartridge stays on your device. Your room plays together.</small>`}</div><input id="arcade-rom" type="file" accept=".nes,.sfc,.smc,.z64,.v64,.n64,.md,.gen,.bin,.a26" hidden><div id="arcade-players"></div><div id="arcade-touch" class="arcade-touch"></div><div class="arcade-extras"><button id="arcade-chess"><span>♘</span><div><strong>A little chess?</strong><small>The board is always open. ↗</small></div></button><div class="arcade-coming"><span>＋</span><div><strong>More ways to play</strong><small>A spot for our own games. Coming later.</small></div></div></div></section>`;
  $('#arcade-controls').onclick=()=>this.controllers();
  $('#arcade-chess').onclick=()=>this.emit('activity',{mode:'chess'});
  $('#arcade-browse')?.addEventListener('click',()=>$('#arcade-rom').click());$('#arcade-rom').onchange=e=>this.load(e.target.files[0]);
  const field=$('#arcade-field');field.ondragover=e=>{e.preventDefault();field.classList.add('drag-over');};field.ondragleave=()=>field.classList.remove('drag-over');field.ondrop=e=>{e.preventDefault();field.classList.remove('drag-over');const files=e.dataTransfer.files;if(files.length!==1)return this.notice('One cartridge at a time, captain!');this.load(files[0]);};
  $('#arcade-options')?.addEventListener('click',()=>this.options());
  $('#arcade-sound')?.addEventListener('click',()=>{$('#arcade-video').muted=false;$('#arcade-video').play().catch(()=>this.toast('Tap the game again to enable playback.'));});
  if(g?.frame){this.observer=new ResizeObserver(()=>this.position());this.observer.observe($('#arcade-display'));this.position();}
  this.updateView();
 }
 updateView(){
  if(!this.visible()||!this.$('#arcade-field'))return;
  const g=this.current();if(!g){if(this.$('#arcade-display'))this.show();return;}
  if(!this.$('#arcade-display'))return this.show();
  const status=this.$('#arcade-status');status.textContent=g.status==='ready'?'● Live':g.status==='booting'?'Booting your cartridge…':'Couldn’t boot';
  if(g.error){this.$('#arcade-notice').hidden=false;this.$('#arcade-notice').textContent=g.error;}
  const signature=JSON.stringify(g.seats)+g.blocked.includes(this.session.id);
  if(this.seatsSignature!==`${g.id}:${signature}`){
   this.seatsSignature=`${g.id}:${signature}`;this.$('#arcade-players').innerHTML=`<span class="eyebrow">PICK YOUR PLAYER</span><div class="player-seats">${g.seats.map((id,i)=>`<button class="player-seat ${id===this.session.id?'yours':''}" data-player-slot="${i}" aria-pressed="${id===this.session.id}" ${id&&id!==this.session.id||g.blocked.includes(this.session.id)?'disabled':''} aria-label="Player ${i+1}: ${id===this.session.id?'you, click to release':id?this.esc(this.session.members.get(id)?.name||'Taken'):'open, click to join'}"><b>P${i+1}</b><span>${id?this.esc(this.session.members.get(id)?.name||'Player'):'Open seat'}</span><small>${id===this.session.id?'Click to release':id?'Taken':'Click to play'}</small></button>`).join('')}</div>${g.blocked.includes(this.session.id)?'<p id="arcade-access" class="notice">Removed from this game · you can still watch.</p>':''}<small class="arcade-seat-note">First click gets the seat. Click yours again to free it. Browsing keeps your seat. ${g.seats.length} controller ports; player support depends on the cartridge.</small>`;
   this.$('#arcade-players').querySelectorAll('[data-player-slot]').forEach(b=>b.onclick=()=>this.request('claim',Number(b.dataset.playerSlot)));
   this.buildTouch(g);
  }
  this.attachVideo();
 }
 buildTouch(g){
  const controls=g.system==='n64'?[[4,'↑'],[6,'←'],[5,'↓'],[7,'→'],[0,'A'],[1,'B'],[12,'Z'],[10,'L'],[11,'R'],[23,'C↑'],[21,'C←'],[22,'C↓'],[20,'C→'],[3,'Start']]:[[4,'↑'],[6,'←'],[5,'↓'],[7,'→'],[0,g.system==='genesis'?'B':'B / Fire'],[8,g.system==='genesis'?'C':'A'],[1,g.system==='genesis'?'A':'Y'],[9,g.system==='genesis'?'Y':'X'],[10,'L'],[11,'R'],[2,'Select'],[3,'Start']];
  this.$('#arcade-touch').classList.toggle('touch-enabled',!!this.touchEnabled);this.$('#arcade-touch').innerHTML=g.seats.includes(this.session.id)?controls.map(([i,label])=>`<button data-arcade-key="${i}" aria-label="Game ${label}">${label}</button>`).join(''):'';
  this.$('#arcade-touch').querySelectorAll('button').forEach(b=>{const key=Number(b.dataset.arcadeKey);b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);this.touch.add(key);this.engine(g)?.resume();this.sendInput();};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>{this.touch.delete(key);this.sendInput();};});
 }
 options(){
  const g=this.current();if(!g)return;
  this.release();this.modal('Game options',`<p>${this.esc(g.name)} · ${this.esc(systems[g.system].name)}</p><p>Click your player slot again to free it for someone else. Changing views keeps your seat. Disconnect also frees your controller port. A majority of lounge members can vote to remove a player; the host can remove a player immediately.</p><div class="game-options-list">${g.seats.map((id,i)=>id?`<div><span>P${i+1} · ${this.esc(this.session.members.get(id)?.name||'Player')}${id===g.host?' · Host':''}</span>${id===this.session.id?'<button data-game-action="disconnect">Disconnect me</button>':`<button data-game-action="${g.host===this.session.id?'kick':'vote'}" data-target="${this.esc(id)}">${g.host===this.session.id?'Kick from game':'Vote to remove'}</button>`}</div>`:'').join('')}${g.host===this.session.id?g.blocked.map(id=>`<div><span>${this.esc(this.session.members.get(id)?.name||'Former player')}</span><button data-game-action="unblock" data-target="${this.esc(id)}">Allow to rejoin</button></div>`).join(''):''}</div>${g.host===this.session.id?'<button class="danger wide" data-game-action="end">End game for everyone</button><p>A prepared standby can keep the game alive after you leave.</p>':''}<p><a href="vendor/emulatorjs/NOTICE.txt" target="_blank" rel="noopener">Emulator credits & source</a></p>`);
  if(g.host===this.session.id){const box=document.createElement('div');box.className='settings-section';box.innerHTML=`<label>Standby host<select id="standby-peer">${[...this.session.members].filter(([id])=>id!==this.session.id).map(([id,p])=>`<option value="${this.esc(id)}">${this.esc(p.name)}</option>`).join('')}</select></label><button id="standby-offer">Prepare standby…</button>${g.standby?'<button id="standby-transfer">Transfer host now</button>':''}`;this.$('#modal-body').append(box);this.$('#standby-offer').onclick=()=>{const id=this.$('#standby-peer').value;if(!id)return;g.offered=id;this.mesh.send({type:'arcade-standby-offer',game:g.id,room:g.room},id);this.closeModal();};this.$('#standby-transfer')?.addEventListener('click',async()=>{await this.checkpoint(g);if(g.standby)this.emit('game-host',{id:g.id,previous:g.host,next:g.standby},g.room);this.closeModal();});}
  this.$('#modal-body').querySelectorAll('[data-game-action]').forEach(b=>b.onclick=()=>{this.request(b.dataset.gameAction,b.dataset.target);if(b.dataset.gameAction==='vote')this.toast('Vote recorded. A majority of the lounge must agree.');this.closeModal();});
 }
 async transferBytes(g,to,kind,bytes){
  if(bytes.length>(kind==='rom'?33554432:16777216))throw Error('This game is too large for standby recovery in this build.');
  for(let offset=0;offset<bytes.length;offset+=32000){if(this.games.get(g.room)!==g)throw Error('Game ended during transfer.');const chunk=bytes.subarray(offset,offset+32000);await this.mesh.send({type:'arcade-transfer',game:g.id,room:g.room,kind,offset,total:bytes.length,data:btoa(String.fromCharCode(...chunk))},to);}
 }
 async checkpoint(g){if(g.host!==this.session.id||!g.standby||g.sending||!this.session.members.has(g.standby))return;g.sending=true;try{await this.transferBytes(g,g.standby,'state',this.engine(g).snapshot());}catch(e){this.toast(e.message);g.standby=null;this.emit('game-standby',{id:g.id,next:null},g.room);}finally{g.sending=false;}}
 async transferMessage(g,id,v){
  try{
   if(v.type==='arcade-standby-offer'&&id===g.host){
    if([...this.games.values()].some(game=>game!==g&&(game.host===this.session.id||game.backup)))return this.toast('This device is already hosting or protecting another cartridge.');
    this.modal('Be the standby game host?',`<p>${this.esc(g.name)} will send its ROM and a temporary machine-state copy directly to your device. Nothing is saved to disk. If the host leaves, this device will run the game.</p><button id="standby-accept" class="primary wide">Accept temporary game copy</button><p>Stay in this lounge to keep the backup alive. Unsupported save states or a lost standby can still end the game.</p>`);
    this.$('#standby-accept').onclick=()=>{g.backup={host:id,acceptedUntil:performance.now()+120000};this.mesh.send({type:'arcade-standby-accept',game:g.id,room:g.room},id);this.closeModal();};return;
   }
   if(v.type==='arcade-standby-accept'&&g.host===this.session.id&&g.offered===id){
    if(!g.bytes||g.bytes.length>33554432)throw Error('Standby supports cartridges up to 32 MB in this build.');
    await this.transferBytes(g,id,'rom',g.bytes);await this.transferBytes(g,id,'state',this.engine(g).snapshot());await this.mesh.send({type:'arcade-transfer-complete',game:g.id,room:g.room},id);return;
   }
   if(v.type==='arcade-transfer'&&g.backup?.host===id&&id===g.host&&(g.standby===this.session.id||performance.now()<g.backup.acceptedUntil)){
    if(!['rom','state'].includes(v.kind)||!Number.isInteger(v.total)||v.total<1||v.total>(v.kind==='rom'?33554432:16777216)||!Number.isInteger(v.offset)||v.offset<0||typeof v.data!=='string'||v.data.length>43000)return;
    const bytes=Uint8Array.from(atob(v.data),c=>c.charCodeAt(0));let batch=g.backup.batch;
    if(v.offset===0){batch={kind:v.kind,total:v.total,next:0,bytes:new Uint8Array(v.total)};g.backup.batch=batch;}
    if(!batch||batch.kind!==v.kind||batch.total!==v.total||batch.next!==v.offset||v.offset+bytes.length>v.total)return;
    batch.bytes.set(bytes,v.offset);batch.next+=bytes.length;if(batch.next===batch.total){g.backup[v.kind]=batch.bytes;delete g.backup.batch;}return;
   }
   if(v.type==='arcade-transfer-complete'&&g.backup?.host===id&&g.backup.rom&&g.backup.state){this.mesh.send({type:'arcade-standby-ready',game:g.id,room:g.room},id);this.toast('Standby is ready. Game data stays in memory.');return;}
   if(v.type==='arcade-standby-ready'&&g.host===this.session.id&&g.offered===id){g.standby=id;this.emit('game-standby',{id:g.id,next:id},g.room);this.toast('Standby host ready. Recovery checkpoints update every five seconds.');return;}
  }catch(e){this.toast('Game recovery: '+e.message);}
 }
 controllers(){
  this.release();this.modal('Gamepads & controls','<p>Pair a USB, Bluetooth or phone-mounted controller with your device, then press a button. Join a player seat to take control.</p><pre id="pad-status" class="notice" style="white-space:pre-wrap"></pre><label>Controller on this device<select id="arcade-pad"><option value="0">First controller</option><option value="1">Second controller</option><option value="2">Third controller</option><option value="3">Fourth controller</option></select></label><label>Stick deadzone<input id="arcade-deadzone" type="range" min="10" max="60"></label><p>Keyboard: arrows move · Z / X / A / S are face buttons · Q / W are shoulders · E is Z trigger · Enter starts · Shift selects. N64: arrows move the stick; I / J / K / L control C buttons. Touch buttons appear below the game.</p><button id="arcade-touch-toggle">Show / hide on-screen controls</button><p>Each participant uses one seat and one controller. Keyboard, touch and gamepads are paused while typing or viewing another activity. Your seat stays reserved.</p>');
  this.$('#arcade-pad').value=this.padIndex;this.$('#arcade-pad').onchange=e=>{this.padIndex=Number(e.target.value);localStorage.setItem('orbit.pad',String(this.padIndex));};
  this.$('#arcade-deadzone').value=this.deadzone*100;this.$('#arcade-deadzone').oninput=e=>{this.deadzone=Number(e.target.value)/100;localStorage.setItem('orbit.deadzone',String(this.deadzone));};this.$('#arcade-touch-toggle').onclick=()=>{this.touchEnabled=!this.touchEnabled;this.$('#arcade-touch')?.classList.toggle('touch-enabled',this.touchEnabled);};this.updatePadStatus();
 }
 updatePadStatus(){if(!this.isVisible())return;const s=this.$('#pad-status');if(s)s.textContent=Array.from(navigator.getGamepads?.()||[]).filter(Boolean).map(p=>`${p.index+1}. ${p.id}`).join('\n')||'No controller yet. Pair one, then press a button.';}
 values(){
  const g=this.current(),v=zeros();if(!this.canInput()||!g)return v;
  for(const i of [...this.keys,...this.touch])v[i]=1;
  const pad=Array.from(navigator.getGamepads?.()||[]).filter(Boolean)[this.padIndex];
  if(pad){const mapping=g.system==='n64'?{...padButtons,0:0,1:1,2:12,3:23,6:12}:padButtons;for(const [button,key]of Object.entries(mapping))if(pad.buttons[button]?.pressed)v[key]=1;
   if(g.system==='n64'){
    for(const [axis,positive,negative]of [[0,16,17],[1,18,19],[2,20,21],[3,22,23]]){const n=pad.axes[axis]||0;if(Math.abs(n)>this.deadzone)v[n>0?positive:negative]=Math.round(Math.abs(n)*32767);}
   }else{const [x=0,y=0]=pad.axes;if(x<-this.deadzone)v[6]=1;if(x>this.deadzone)v[7]=1;if(y<-this.deadzone)v[4]=1;if(y>this.deadzone)v[5]=1;}
  }
  if(g.system==='n64'){
   v[8]=0;for(const [d,axis]of [[4,19],[5,18],[6,17],[7,16]])if(v[d])v[axis]=32767;
   for(let i=16;i<24;i++)if(v[i]===1)v[i]=32767;
  }
  return v;
 }
 sendInput(force=false){
  const g=this.current();if(!g||!g.seats.includes(this.session.id))return;const values=this.values(),signature=JSON.stringify(values);
  if(!force&&signature===this.lastInput)return;this.lastInput=signature;
  if(g.host===this.session.id){this.engine(g)?.input(g.seats.indexOf(this.session.id),values);g.inputs.set(this.session.id,{values,at:performance.now()});}
  else this.mesh.send({type:'arcade-input',room:g.room,game:g.id,values},g.host);
 }
 release(){this.keys.clear();this.touch.clear();this.lastInput='';for(const g of this.games.values()){
  const slot=g.seats.indexOf(this.session.id);if(slot<0)continue;
  if(g.host===this.session.id)this.engine(g)?.input(slot,zeros());else this.mesh.send({type:'arcade-input',room:g.room,game:g.id,values:zeros()},g.host);
 }}
 tick(){
  this.updatePadStatus();if(!this.session.active)return;
  this.sendInput(performance.now()-(this.heartbeat||0)>200);if(performance.now()-(this.heartbeat||0)>200)this.heartbeat=performance.now();
  for(const g of this.games.values())if(g.host===this.session.id&&performance.now()-(g.checkpointAt||0)>5000){g.checkpointAt=performance.now();this.checkpoint(g);}
  for(const g of this.games.values())if(g.host===this.session.id)for(const [id,input]of g.inputs)if(performance.now()-input.at>750){const slot=g.seats.indexOf(id);if(slot>=0)this.engine(g)?.input(slot,zeros());g.inputs.delete(id);}
 }
 dispose(room){const g=this.games.get(room);if(!g)return;clearTimeout(g.bootTimer);this.engine(g)?.stop();g.frame?.remove();if(g.host===this.session.id)this.mesh.share(null,`arcade:${room}`);this.games.delete(room);for(const key of this.streams.keys())if(key===`${g.host}:${g.streamId}`)this.streams.delete(key);this.seatsSignature='';}
 mute(value){for(const g of this.games.values())this.engine(g)?.volume(value?0:.65);}
 destroy(){this.destroyed=true;this.abort.abort();clearInterval(this.timer);this.parking.remove();}
 stop(){this.release();for(const room of [...this.games.keys()])this.dispose(room);this.streams.clear();this.parking.replaceChildren();}
}
