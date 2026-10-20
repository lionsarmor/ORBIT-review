import {device} from './platform.js';
import {PeerBrowser,pairBrowser} from './peer-browser.js';
export function webURL(input){
 try{const url=new URL(String(input).trim());if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>4096)return null;return url.href;}catch{return null;}
}
export class WebRoom{
 constructor(api){Object.assign(this,api);this.pages=new Map();this.hosts=new Map();this.streams=new Map();this.pending=new Set();this.starting=new Map();this.commands=new Map();this.incoming=new Map();this.layer=document.createElement('div');this.layer.className='web-pages';this.layer.hidden=true;document.querySelector('#stage').append(this.layer);this.resize=new ResizeObserver(()=>this.position());this.resize.observe(document.querySelector('#stage'));}
 park(){this.showingRoom=null;this.layer.hidden=true;}
 reconcile(){
  for(const [room,c]of this.commands)if(this.session.state.web?.[room]?.event!==c.browser||!this.session.state.web[room].url)this.commands.delete(room);
  for(const [key,c]of this.incoming)if(this.session.state.web?.[c.room]?.event!==c.browser||!this.session.members.has(c.actor))this.incoming.delete(key);
  for(const [room,host]of this.hosts){const state=this.session.state.web?.[room];if(!this.session.state.rooms[room]||!state?.url||state.event!==host.event){host.driver.close();this.hosts.delete(room);this.mesh.share(null,'web:'+room+':'+host.event);}}
  for(const [room,page]of this.pages){const state=this.session.state.web?.[room];if(!this.session.state.rooms[room]||!state?.url||state.event!==page.event){if(page.video){page.video.srcObject=null;page.video.remove();}else page.frame.src='about:blank';page.frame.remove();this.pages.delete(room);}}
  for(const [key,value]of this.streams){const state=this.session.state.web?.[value.room];if(!this.session.members.has(value.id)||state&&(!state.url||state.actor!==value.id||state.event!==value.event))this.streams.delete(key);}
 }
 synchronize(){if(!this.session.active)return;for(const [room,c]of this.commands){if(c.blocked)continue;const now=performance.now();if([...c.pending.values()].some(p=>now-p.created>8000)){c.blocked=true;c.pending.clear();this.toast('The host did not acknowledge input. Stop and restart this Web event before sending more.');continue;}for(const p of c.pending.values())if(now-p.sent>500){p.sent=now;this.mesh.send(p.value,c.host);}}for(const [room,state]of Object.entries(this.session.state.web||{}))if(state.kind==='shared'&&state.url&&!this.session.members.has(state.actor)&&this.session.state.owner===this.session.id)this.emit('web-end',{browser:state.event},room);}
 // An optional embedded copy stays local; the primary action hosts one real browser.
 open(input,room=this.session.room){const url=webURL(input);if(!url)return this.toast('Choose an http or https webpage without a password in the address.');if(location.protocol==='https:'&&new URL(url).protocol!=='https:')return this.toast('Use an HTTPS page inside this secure lounge.');const current=this.session.state.web?.[room];if(current?.kind==='shared'&&current.url)return this.toast('Stop the shared Web event before opening separate copies.');return this.emit('web',{url,kind:'local'},room);}
 async startHosted(input,room=this.session.room){
  if(device.phone){this.toast('Start shared Web events on a desktop peer. You can join and control them here.');return false;}
  const url=webURL(input);if(!url){this.toast('Choose a public http or https webpage.');return false;}
  if(this.stopped||!this.session.active||this.pending.has(room))return false;
  const existing=this.session.state.web?.[room];if(existing?.kind==='shared'&&existing.url){this.control(room,{type:'navigate',url});return true;}
  this.pending.add(room);let event,driver;
  try{
   driver=new PeerBrowser({notice:message=>this.toast(message),location:value=>{if(event&&!this.stopped&&this.session.state.web?.[room]?.event===event.id)this.emit('web-location',{browser:event.id,url:value},room);},ended:()=>{if(event&&!this.stopped)this.emit('web-end',{browser:event.id},room);}});
   this.starting.set(room,driver);await driver.start(url);
   if(this.stopped||!this.session.active||!this.session.state.rooms[room]){driver.close();return false;}
   event=this.emit('web',{url,kind:'shared'},room);
   if(!event||this.session.state.web?.[room]?.event!==event.id){driver.close();return false;}
   this.hosts.set(room,{driver,event:event.id});await this.mesh.share(driver.stream,'web:'+room+':'+event.id);
   if(this.isVisible()&&this.session.room===room)this.render();return true;
  }catch(e){driver?.close();this.toast(e.message);if(this.isVisible()&&!this.stopped)this.hostingHelp(input,room);return false;}
  finally{this.pending.delete(room);this.starting.delete(room);}
 }
 hostingHelp(input,room){
  if(device.phone)return this.modal('Web events on your phone','<p>A desktop peer hosts the shared browser. Once they start the Web event, you can click, scroll and type here. Phone browser hosting is unavailable.</p>');
  this.modal('Host a little window',`<p>The person who starts this event hosts a fresh, temporary browser on their computer. Everyone in this lounge can see and control it, including anything typed into it.</p><p>Your personal browser and files stay separate. This event has no browser audio, downloads, camera, microphone or private-network access. Phone guests can join and control; hosting needs the desktop companion.</p><div class="button-group"><button id="web-pair" class="primary">Enable hosting on this computer ↗</button><button id="web-host-confirm">Start shared browser</button></div><p id="web-pair-status" role="status">Allow Local network / Loopback access when your browser asks to connect to the companion on this computer. If blocked, change that permission in this site’s browser settings. The ORBIT desktop shortcut starts the companion automatically. For another computer, <a href="downloads/orbit-peer-browser.zip" download>download the companion</a> and follow SETUP.txt.</p><p>The event closes when its host leaves, stops it, or the lounge is wiped. Switching views keeps it running.</p>`);
  this.$('#web-pair').onclick=async()=>{const status=this.$('#web-pair-status');status.textContent='Enable hosting in the local confirmation window, then return here.';try{await pairBrowser();if(status.isConnected)status.textContent='Ready. Choose Start shared browser.';}catch(e){if(status.isConnected)status.textContent=e.message;}};
  this.$('#web-host-confirm').onclick=()=>{this.closeModal();this.startHosted(input,room);};
 }
 control(room,action){
  const state=this.session.state.web?.[room];if(this.stopped||!state?.url||state.kind!=='shared')return;
  if(state.actor===this.session.id){this.hosts.get(room)?.driver.input(action);return;}
  let commands=this.commands.get(room);if(!commands||commands.browser!==state.event){commands={browser:state.event,host:state.actor,next:1,pending:new Map()};this.commands.set(room,commands);}
  if(commands.blocked)return this.toast('Stop and restart this Web event to restore its controls.');
  if(commands.pending.size>=40)return this.toast('The shared browser is catching up. Give it a moment.');
  const seq=commands.next++,value={type:'web-input',room,browser:state.event,seq,action},now=performance.now();commands.pending.set(seq,{value,created:now,sent:now});this.mesh.send(value,state.actor);
 }
 receive(id,v){
  if(this.stopped||!this.session.members.has(id))return;
  const state=this.session.state.web?.[v.room];if(!state?.url||state.event!==v.browser||!Number.isSafeInteger(v.seq)||v.seq<1||v.seq>1e9)return;
  if(v.type==='web-ack'){const c=this.commands.get(v.room);if(id===state.actor&&c?.browser===v.browser)c.pending.delete(v.seq);return;}
  if(v.type!=='web-input')return;
  const host=this.hosts.get(v.room);if(!host||state.actor!==this.session.id||host.event!==v.browser||JSON.stringify(v.action||{}).length>20000)return;
  const now=performance.now();this.rates??=new Map();const rate=this.rates.get(id)||{at:now,count:0};if(now-rate.at>1000){rate.at=now;rate.count=0;}if(++rate.count>35)return;this.rates.set(id,rate);
  const key=id+':'+v.room;let incoming=this.incoming.get(key);if(!incoming||incoming.browser!==v.browser){incoming={actor:id,room:v.room,browser:v.browser,next:1,buffer:new Map()};this.incoming.set(key,incoming);}
  if(v.seq<incoming.next){this.mesh.send({type:'web-ack',room:v.room,browser:v.browser,seq:v.seq},id);return;}
  if(v.seq>incoming.next+40)return;
  if(!incoming.buffer.has(v.seq))incoming.buffer.set(v.seq,v.action);
  while(incoming.buffer.has(incoming.next)){const seq=incoming.next++;host.driver.input(incoming.buffer.get(seq));incoming.buffer.delete(seq);this.mesh.send({type:'web-ack',room:v.room,browser:v.browser,seq},id);}
 }

 stream(id,stream,key){const split=key.lastIndexOf(':'),room=key.slice(4,split),event=key.slice(split+1);if(split<5||room.length>60||!/^[-\w]{12,40}$/.test(event))return;this.streams.set(id+':'+room+':'+event,{id,room,event,stream});if(this.isVisible()&&this.session.room===room&&this.$('#web-room'))this.render();}
 render(){
  if(this.stopped)return;
  const {$,esc,session}=this,room=session.room,state=session.state.web?.[room],shared=state?.kind==='shared'&&!!state.url;
  if(!$('#web-room')||$('#web-room').dataset.webRoom!==room){
   this.park();$('#activity-content').innerHTML=`<section id="web-room" class="web-room" data-web-room="${esc(room)}"><form id="web-address-form" class="web-address-bar"><span class="web-room-symbol" aria-hidden="true">◎</span><button id="web-back" type="button" title="Back in shared browser" aria-label="Back in shared browser">←</button><input id="web-address" aria-label="Shared webpage address" type="url" placeholder="Paste a webpage address…" autocomplete="off" required><button id="web-load" class="primary">Host together ↗</button><button id="web-reload" type="button" title="Reload webpage for everyone" aria-label="Reload webpage for everyone">⟳</button><button id="web-stop" type="button" title="Close the webpage for everyone" aria-label="Close webpage for everyone">×</button></form><div id="web-surface" class="web-surface"></div><div class="web-room-note"><span id="web-status"></span><button id="web-local" type="button">Browse separately</button><a id="web-original" target="_blank" rel="noopener noreferrer">Open original ↗</a><button id="web-help" type="button" aria-label="About shared webpages">?</button></div><form id="web-type-form" class="web-type-bar" hidden><input id="web-type-input" aria-label="Type into shared webpage" placeholder="Type here for the shared page…" maxlength="2000" autocomplete="off"><button>Send text ↗</button><button id="web-enter" type="button">Enter</button></form></section>`;
   $('#web-address-form').onsubmit=e=>{e.preventDefault();const value=$('#web-address').value;if(session.state.web?.[room]?.kind==='shared'&&session.state.web[room].url)this.control(room,{type:'navigate',url:webURL(value)});else this.hostingHelp(value,room);};
   $('#web-local').onclick=()=>this.open($('#web-address').value,room);
   $('#web-back').onclick=()=>this.control(room,{type:'back'});
   $('#web-reload').onclick=()=>{const current=session.state.web?.[room];if(current?.kind==='shared')this.control(room,{type:'reload'});else if(current?.url)this.open(current.url,room);};
   $('#web-stop').onclick=()=>{const current=session.state.web?.[room];this.emit('web',{url:'',browser:current?.event},room);};
   $('#web-help').onclick=()=>this.hostingHelp($('#web-address').value,room);
   $('#web-type-form').onsubmit=e=>{e.preventDefault();const input=$('#web-type-input');if(input.value)this.control(room,{type:'text',text:input.value});input.value='';};
   $('#web-enter').onclick=()=>this.control(room,{type:'key',key:'Enter'});
  }
  const address=$('#web-address');if(document.activeElement!==address)address.value=state?.url||address.value||'';
  $('#web-reload').disabled=$('#web-stop').disabled=!state?.url;$('#web-back').hidden=!shared;$('#web-local').hidden=shared;$('#web-type-form').hidden=!shared;$('#web-load').textContent=shared?'Go together ↗':device.phone?'Desktop host needed':'Host together ↗';$('#web-load').disabled=device.phone&&!shared;
  $('#web-status').textContent=shared?`One browser · hosted by ${session.members.get(state.actor)?.name||'a lounge member'} · everyone can control · video only`:state?.url?'Separate copies · clicks and sign-ins stay local':'Browse together on a peer’s computer, or open separate copies';
  const original=$('#web-original');original.hidden=!state?.url;if(state?.url)original.href=state.url;else original.removeAttribute('href');
  const surface=$('#web-surface');
  if(!state?.url){this.park();surface.innerHTML='<div class="web-empty"><span aria-hidden="true">◎</span><span class="eyebrow">ONE WINDOW. EVERYONE INVITED.</span><h2>Where shall we go?</h2><p>Paste a public webpage above.<br>You host the event. Your people join the adventure.</p><small>One temporary browser on the host’s computer.<br>Everyone can click, type and scroll. Chat stays right here.</small></div>';return;}
  surface.replaceChildren();let page=this.pages.get(room);
  if(!page){
   let frame,video;
   if(shared){frame=document.createElement('div');frame.className='web-page web-shared';video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;frame.append(video);const input=document.createElement('div');input.className='web-input-surface';input.tabIndex=0;input.setAttribute('role','application');input.setAttribute('aria-label','Shared webpage. Click, type or scroll to control the host browser.');frame.append(input);this.bindInput(input,room);const waiting=document.createElement('span');waiting.className='web-stream-wait';waiting.textContent='Connecting to the host’s window…';frame.append(waiting);video.onplaying=()=>waiting.hidden=true;}
   else{frame=document.createElement('iframe');frame.title=`Local webpage — ${new URL(state.url).hostname}`;frame.className='web-page';frame.sandbox='allow-scripts allow-forms allow-same-origin allow-popups';frame.allow='fullscreen';frame.referrerPolicy='no-referrer';frame.src=state.url;}
   page={frame,video,event:state.event};this.pages.set(room,page);this.layer.append(frame);
  }
  if(page.video){const stream=state.actor===session.id?this.hosts.get(room)?.driver.stream:this.streams.get(state.actor+':'+room+':'+state.event)?.stream;if(stream&&page.video.srcObject!==stream){page.video.srcObject=stream;page.video.play().catch(()=>{});}}
  this.showingRoom=room;this.layer.hidden=false;for(const [id,p]of this.pages)p.frame.hidden=id!==room;this.position();
 }
 bindInput(input,room){
  const point=e=>{const box=input.getBoundingClientRect(),scale=Math.min(box.width/1280,box.height/800),x=(e.clientX-box.left-(box.width-1280*scale)/2)/scale,y=(e.clientY-box.top-(box.height-800*scale)/2)/scale;return x>=0&&x<1280&&y>=0&&y<800?{x,y}:null;};
  let gesture;
  input.onpointerdown=e=>{if(e.button!==0)return;const p=point(e);if(!p)return;e.preventDefault();input.focus();input.setPointerCapture(e.pointerId);gesture=[p];};
  input.onpointermove=e=>{if(!gesture||gesture.length>=80)return;const p=point(e);if(p&&Math.hypot(p.x-gesture.at(-1).x,p.y-gesture.at(-1).y)>4)gesture.push(p);};
  input.onpointerup=e=>{if(!gesture)return;const points=gesture;gesture=null;const p=point(e)||points.at(-1);if(points.length>2)this.control(room,{type:'drag',points:[...points.slice(0,79),p]});else this.control(room,{type:'click',...p});};
  input.onpointercancel=()=>gesture=null;
  input.oncontextmenu=e=>{e.preventDefault();const p=point(e);if(p)this.control(room,{type:'click',...p,button:'right'});};
  input.addEventListener('wheel',e=>{e.preventDefault();const p=point(e);if(p)this.control(room,{type:'scroll',...p,dx:e.deltaX,dy:e.deltaY});},{passive:false});
  input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Tab'&&!e.ctrlKey&&!e.altKey&&!e.metaKey)return;e.preventDefault();if(e.key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey)this.control(room,{type:'text',text:e.key});else{const key=[e.ctrlKey?'Control':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.metaKey?'Meta':'',e.key===' '?'Space':e.key].filter(Boolean).join('+');this.control(room,{type:'key',key});}};
 }
 position(){const surface=this.$('#web-surface');const page=this.pages.get(this.showingRoom);if(!surface||!page||this.layer.hidden)return;const box=surface.getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect();Object.assign(page.frame.style,{left:`${box.left-stage.left}px`,top:`${box.top-stage.top}px`,width:`${box.width}px`,height:`${box.height}px`});}
 stop(){this.stopped=true;this.commands.clear();this.incoming.clear();for(const driver of this.starting.values())driver.close();this.starting.clear();for(const [room,host]of this.hosts){host.driver.close();this.mesh.share(null,'web:'+room+':'+host.event);}this.hosts.clear();for(const page of this.pages.values()){if(page.video)page.video.srcObject=null;else page.frame.src='about:blank';page.frame.remove();}this.pages.clear();this.streams.clear();this.resize.disconnect();this.layer.remove();}
}
