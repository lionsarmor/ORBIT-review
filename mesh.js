// Session data stays in memory. Signaling contains encrypted SDP/identity only.
import {apiURL,signalURL} from './runtime.js';
const enc=new TextEncoder(),dec=new TextDecoder();
export const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export const bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const random=n=>crypto.getRandomValues(new Uint8Array(n));
async function seal(key,value,aad=''){
 const iv=random(12),plain=enc.encode(JSON.stringify(value));
 return {iv:b64(iv),cipher:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,plain)))};
}
async function open(key,value,aad=''){
 return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(value.iv),additionalData:enc.encode(aad)},key,bytes(value.cipher))));
}
export class Mesh extends EventTarget {
 constructor(){super();this.peers=new Map();this.sequence=0;this.closed=true;this.stream=null;this.mediaStreams=new Map();this.clockOffsets=new Map();this.lastOffsets=new Map();}
 emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
 async start(code,create,profile,privacy='direct'){
  if(!crypto.subtle)throw Error('Open ORBIT on localhost or an HTTPS address.');
  if(!this.closed)this.leave();
  let token;
  if(create){token={v:1,r:b64(random(18)),k:b64(random(32))};code=b64(enc.encode(JSON.stringify(token)));}
  else{try{const raw=code.includes('#')?code.split('#').at(-1):code;token=JSON.parse(dec.decode(bytes(raw)));code=raw;}catch{throw Error('That invite code is not valid.');}}
  if(token.v!==1||!/^[-\w]{24}$/.test(token.r)||!/^[-\w]{43}$/.test(token.k))throw Error('Invalid invite.');
  this.id=b64(random(16));this.room=token.r;this.code=code;this.profile=profile;this.closed=false;this.sequence=0;this.privacy=privacy;
  this.secret=await crypto.subtle.importKey('raw',bytes(token.k),'AES-GCM',false,['encrypt','decrypt']);
  this.identity=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);
  this.publicKey=b64(new Uint8Array(await crypto.subtle.exportKey('raw',this.identity.publicKey)));
  const config=await fetch(apiURL('config')).then(r=>{if(!r.ok)throw Error('The connection helper is unavailable.');return r.json();});
  this.iceServers=Array.isArray(config.iceServers)?config.iceServers:[];
  this.iceRefresh=setInterval(()=>this.refreshIce().catch(()=>this.emit('error','Could not refresh relay access. Reconnecting may be needed if the helper stays unavailable.')),30*60*1000);
  if(privacy==='relay'&&!this.iceServers.some(s=>JSON.stringify(s.urls).includes('turn:')||JSON.stringify(s.urls).includes('turns:'))){this.leave();throw Error('Hide my IP needs a configured TURN relay. Direct mode remains available.');}
  this.connectSignal(create);
  this.ping=setInterval(()=>{if(this.ws?.readyState===1)this.ws.send('ping');},10000);
  this.timing=setInterval(()=>{for(const id of this.peers.keys())this.send({type:'clock-ping',at:performance.now()},id);},4000);
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(t);this.removeEventListener('ready',ready);this.removeEventListener('fatal',fatal);};
   const ready=()=>{cleanup();resolve({code,id:this.id});};
   const fatal=e=>{cleanup();this.leave();reject(Error(e.detail));};
   const t=setTimeout(()=>{cleanup();this.leave();reject(Error('Joining timed out.'));},12000);
   this.addEventListener('ready',ready,{once:true});this.addEventListener('fatal',fatal,{once:true});
  });
 }
 connectSignal(create=false){
  if(this.closed)return;const socket=new WebSocket(signalURL(`signal/${this.room}/${this.id}?create=${create?1:0}`));this.ws=socket;
  let chain=Promise.resolve();socket.onmessage=e=>{chain=chain.then(()=>{if(this.ws===socket)return this.signal(JSON.parse(e.data));}).catch(()=>this.emit('error','A connection-helper response was rejected.'));};
  socket.onclose=()=>{if(this.ws!==socket||this.closed)return;if(!this.readyOnce){this.emit('fatal','The connection helper closed before joining.');return;}this.reconnect();};
  socket.onerror=()=>{};
 }
 reconnect(){
  if(this.closed)return;
  if(!this.reconnecting){this.reconnecting=true;this.recoveryUntil=performance.now()+60000;this.attempt=0;this.emit('connection',{state:'reconnecting'});this.emit('error','Connection helper unavailable. Live peer connections are being kept.');}
  if(performance.now()>this.recoveryUntil){this.reconnecting=false;this.emit('connection',{state:'peer-only'});this.emit('error','Helper recovery timed out. Existing peers remain live; use Retry connection to try again.');return;}
  clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{this.attempt++;this.connectSignal(false);},Math.min(5000,300*2**Math.min(this.attempt,4)));
 }
 retry(){if(this.ws?.readyState===1&&!this.reconnecting)return;const old=this.ws;this.ws=null;old?.close();this.reconnecting=false;this.reconnect();}
 async signal(v){
  if(this.closed)return;
  if(v.kind==='error'){if(this.readyOnce){if(this.reconnecting&&/ended or is unavailable/.test(v.error)&&!this.recreateTried){this.recreateTried=true;const old=this.ws;this.ws=null;old?.close();this.connectSignal(true);}else{this.recreateTried=false;const old=this.ws;this.ws=null;old?.close();this.reconnect();}}else this.emit('fatal',v.error);return;}
  if(v.kind==='welcome'){const recovered=this.readyOnce;this.readyOnce=true;this.reconnecting=false;this.recreateTried=false;clearTimeout(this.retryTimer);this.emit(recovered?'recovered':'ready',{});this.emit('connection',{state:'connected'});for(const id of v.peers)await this.hello(id);return;}
  if(v.kind==='peer-joined'){await this.hello(v.id);return;}
  if(v.kind==='peer-left'){const p=this.peers.get(v.id);if(p){clearTimeout(p.departure);p.departure=setTimeout(()=>{if(p.dc?.readyState!=='open')this.drop(v.id);},2000);}return;}
  if(v.kind!=='signal'||!v.from)return;
  const value=await open(this.secret,v,`${this.room}:${v.from}:${this.id}`);
  if(value.type==='hello'){
   if(this.peers.get(v.from)?.pc&&this.peers.get(v.from).pc.connectionState!=='closed')return;
   const key=await crypto.subtle.importKey('raw',bytes(value.key),{name:'ECDH',namedCurve:'P-256'},false,[]);
   const pair=await crypto.subtle.deriveKey({name:'ECDH',public:key},this.identity.privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   const pc=new RTCPeerConnection({iceServers:this.iceServers,iceTransportPolicy:this.privacy==='relay'?'relay':'all'});
   const p={pc,key:pair,profile:value.profile,last:0,sendChain:Promise.resolve(),receiveChain:Promise.resolve(),candidates:[],chunks:new Map(),mediaNames:new Map(),incomingStreams:new Map(),makingOffer:false,answerPending:false,ignoreOffer:false,polite:this.id>v.from};
   this.peers.set(v.from,p);
   pc.onicecandidate=e=>{if(e.candidate)this.sendSignal(v.from,{type:'ice',candidate:e.candidate}).catch(()=>{});};
   pc.ondatachannel=e=>this.channel(v.from,e.channel);
   pc.ontrack=e=>{const stream=e.streams[0]||new MediaStream([e.track]);if(p.incomingStreams.size>=16&&!p.incomingStreams.has(stream.id))return;p.incomingStreams.set(stream.id,stream);const key=p.mediaNames.get(stream.id);if(key)this.emit('stream',{id:v.from,stream,key});};
   pc.onconnectionstatechange=()=>{this.emit('connection',{id:v.from,state:pc.connectionState});if(pc.connectionState==='failed'){this.emit('error','A direct peer connection failed. Configure TURN for restrictive networks.');pc.close();this.peers.delete(v.from);this.emit('left',v.from);}};
   // One negotiation path for initial channels, media and ICE renewal.
   // Polite-peer rollback resolves simultaneous offers (WebRTC perfect negotiation).
   pc.onnegotiationneeded=async()=>{
    try{p.makingOffer=true;await pc.setLocalDescription();await this.sendSignal(v.from,{type:'sdp',sdp:pc.localDescription});}
    catch{if(!this.closed)this.emit('error','Could not negotiate a peer media update.');}
    finally{p.makingOffer=false;}
   };
   pc.onsignalingstatechange=()=>{if(pc.signalingState==='stable'&&p.pendingIce){const servers=p.pendingIce;p.pendingIce=null;pc.setConfiguration({...pc.getConfiguration(),iceServers:servers});pc.restartIce();}};
   if(this.id<v.from)this.channel(v.from,pc.createDataChannel('orbit',{ordered:true}));
   for(const stream of this.mediaStreams.values())for(const track of stream.getTracks())pc.addTrack(track,stream);
   return;
  }
  const p=this.peers.get(v.from);if(!p)return;
  if(value.type==='ice'){if(p.pc.remoteDescription){try{await p.pc.addIceCandidate(value.candidate);}catch(error){if(!p.ignoreOffer)throw error;}}else p.candidates.push(value.candidate);}
  if(value.type==='sdp'){
   const ready=!p.makingOffer&&(p.pc.signalingState==='stable'||p.answerPending);
   p.ignoreOffer=!p.polite&&value.sdp.type==='offer'&&!ready;
   if(p.ignoreOffer)return;
   p.answerPending=value.sdp.type==='answer';
   try{await p.pc.setRemoteDescription(value.sdp);}finally{p.answerPending=false;}
   for(const c of p.candidates.splice(0))await p.pc.addIceCandidate(c);
   if(value.sdp.type==='offer'){await p.pc.setLocalDescription();await this.sendSignal(v.from,{type:'sdp',sdp:p.pc.localDescription});}
  }
 }
 async hello(id){await this.sendSignal(id,{type:'hello',key:this.publicKey,profile:this.profile});}
 async refreshIce(){
  if(this.closed)return;
  const response=await fetch(apiURL('config'));if(!response.ok)throw Error('Relay credential refresh failed.');
  const config=await response.json();if(this.closed)return;
  const servers=Array.isArray(config.iceServers)?config.iceServers:[];
  if(this.privacy==='relay'&&!servers.some(s=>JSON.stringify(s.urls).includes('turn:')||JSON.stringify(s.urls).includes('turns:')))throw Error('Relay access is unavailable.');
  this.iceServers=servers;
  for(const[id,p]of this.peers){
   if(p.pc.signalingState!=='stable'){p.pendingIce=servers;continue;}
   p.pc.setConfiguration({...p.pc.getConfiguration(),iceServers:servers});p.pc.restartIce();
  }
 }
 async sendSignal(to,value){if(this.closed)return;const data=await seal(this.secret,value,`${this.room}:${this.id}:${to}`);if(this.ws?.readyState===1)this.ws.send(JSON.stringify({to,...data}));}
 channel(id,dc){
  const p=this.peers.get(id);p.dc=dc;
  dc.onopen=()=>{if(this.closed||this.peers.get(id)!==p){dc.close();return;}for(const [key,stream]of this.mediaStreams)this.send({type:'media-stream',key,stream:stream.id},id);this.send({type:'clock-ping',at:performance.now()},id);this.emit('joined',{id,profile:p.profile});};
  dc.onmessage=e=>{if(this.closed||this.peers.get(id)!==p)return;p.receiveChain=p.receiveChain.then(async()=>{
   const packet=await open(p.key,JSON.parse(e.data),`${this.room}:${id}:${this.id}`);
   if(!Number.isSafeInteger(packet.seq)||packet.seq<=p.last)return;p.last=packet.seq;
   if(packet.chunk){
    const c=packet.chunk;if(c.total>512||c.total<1||c.index<0||c.index>=c.total||c.text.length>8000)return;
    let batch=p.chunks.get(c.id);if(!batch){if(p.chunks.size>3)return;batch={parts:[],total:c.total,at:Date.now()};p.chunks.set(c.id,batch);}
    batch.parts[c.index]=c.text;
    if(batch.parts.filter(x=>typeof x==='string').length===batch.total){p.chunks.delete(c.id);this.deliver(id,JSON.parse(batch.parts.join('')));}
    for(const[k,b]of p.chunks)if(Date.now()-b.at>10000)p.chunks.delete(k);
   }else this.deliver(id,packet.value);
  }).catch(()=>this.emit('error','Rejected an invalid peer packet.'));};
  dc.onclose=()=>{this.emit('connection',{id,state:'disconnected'});clearTimeout(p.departure);p.departure=setTimeout(()=>{if(p.dc.readyState==='closed')this.drop(id);},1000);};
 }
 send(value,to=null){
  const text=JSON.stringify(value);if(text.length>2e6)throw Error('Activity is too large to sync.');
  const pending=[];for(const[id,p]of this.peers){if(to&&id!==to||p.dc?.readyState!=='open')continue;
   p.sendChain=p.sendChain.then(async()=>{
    const pieces=text.length>8000?Array.from({length:Math.ceil(text.length/8000)},(_,i)=>text.slice(i*8000,(i+1)*8000)):null;
    const batch=b64(random(8));
    for(let i=0;i<(pieces?.length||1);i++){
     if(p.dc.readyState!=='open')return;
     const deadline=performance.now()+10000;while(p.dc.bufferedAmount>262144&&p.dc.readyState==='open'&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));if(p.dc.readyState!=='open')return;if(p.dc.bufferedAmount>2e6)throw Error('Peer connection is busy.');
     const packet=pieces?{seq:++this.sequence,chunk:{id:batch,index:i,total:pieces.length,text:pieces[i]}}:{seq:++this.sequence,value};
     p.dc.send(JSON.stringify(await seal(p.key,packet,`${this.room}:${this.id}:${id}`)));
    }
   }).catch(e=>this.emit('error',e.message));pending.push(p.sendChain);
  }return Promise.all(pending);
 }
 drop(id){const p=this.peers.get(id);if(!p)return;clearTimeout(p.departure);p.pc.close();this.peers.delete(id);if(this.clockOffsets.has(id)){this.lastOffsets.set(id,this.clockOffsets.get(id));if(this.lastOffsets.size>32)this.lastOffsets.delete(this.lastOffsets.keys().next().value);}this.clockOffsets.delete(id);this.emit('left',id);}
 deliver(id,value){
  if(value?.type==='peer-bye'){this.drop(id);return;}
  if(value?.type==='clock-ping'&&Number.isFinite(value.at)){this.send({type:'clock-pong',at:value.at,remote:performance.now()},id);return;}
  if(value?.type==='clock-pong'&&Number.isFinite(value.at)&&Number.isFinite(value.remote)){const now=performance.now(),rtt=now-value.at;if(rtt>=0&&rtt<5000){const previous=this.clockOffsets.get(id),offset=(value.at+now)/2-value.remote;if(!previous||rtt<previous.rtt*1.5)this.clockOffsets.set(id,{rtt,offset:previous?previous.offset*.25+offset*.75:offset});}return;}
  if(value?.type==='media-stream'){
   if(typeof value.key!=='string'||value.key.length>100||typeof value.stream!=='string'||value.stream.length>100)return;
   const p=this.peers.get(id);if(!p)return;for(const [old,key]of p.mediaNames)if(key===value.key&&old!==value.stream){p.mediaNames.delete(old);p.incomingStreams.delete(old);}if(p.mediaNames.size>=16&&!p.mediaNames.has(value.stream))return;
   p.mediaNames.set(value.stream,value.key);const stream=p.incomingStreams.get(value.stream);if(stream)this.emit('stream',{id,stream,key:value.key});return;
  }
  this.emit('data',{id,value});
 }
 async share(stream,key='main'){
  const previous=this.mediaStreams.get(key);if(key==='main')this.stream=stream;
  if(stream)this.mediaStreams.set(key,stream);else this.mediaStreams.delete(key);
  for(const [id,p]of this.peers){
   if(stream)this.send({type:'media-stream',key,stream:stream.id},id);
   for(const sender of p.pc.getSenders())if(previous?.getTracks().includes(sender.track))p.pc.removeTrack(sender);
   if(stream)for(const track of stream.getTracks())p.pc.addTrack(track,stream);
  }
 }
 leave(){this.send({type:'peer-bye'});this.closed=true;this.readyOnce=false;this.reconnecting=false;clearTimeout(this.retryTimer);clearInterval(this.timing);clearInterval(this.ping);clearInterval(this.iceRefresh);const socket=this.ws;this.ws=null;socket?.close();for(const p of this.peers.values()){clearTimeout(p.departure);setTimeout(()=>p.pc?.close(),200);}this.peers.clear();for(const stream of this.mediaStreams.values())stream.getTracks().forEach(t=>t.stop());this.mediaStreams.clear();this.stream=null;this.secret=null;this.identity=null;this.code='';}
}
