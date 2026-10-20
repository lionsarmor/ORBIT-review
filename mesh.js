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
 constructor(){super();this.peers=new Map();this.sequence=0;this.closed=true;this.stream=null;}
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
  this.ws=new WebSocket(signalURL(`signal/${this.room}/${this.id}?create=${create?1:0}`));
  const socket=this.ws;
  let chain=Promise.resolve();
  socket.onmessage=e=>{chain=chain.then(()=>{if(this.ws===socket)return this.signal(JSON.parse(e.data));}).catch(err=>this.emit('error',err.message));};
  socket.onclose=()=>{if(this.ws===socket&&!this.closed){this.emit('error','Connection helper disconnected. This client has left the space.');this.leave();this.emit('ended',{});}};
  socket.onerror=()=>{if(this.ws===socket&&!this.closed)this.emit('error','Could not reach the connection helper.');};
  this.ping=setInterval(()=>{if(this.ws?.readyState===1)this.ws.send('ping');},10000);
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(t);this.removeEventListener('ready',ready);this.removeEventListener('fatal',fatal);};
   const ready=()=>{cleanup();resolve({code,id:this.id});};
   const fatal=e=>{cleanup();this.leave();reject(Error(e.detail));};
   const t=setTimeout(()=>{cleanup();this.leave();reject(Error('Joining timed out.'));},12000);
   this.addEventListener('ready',ready,{once:true});this.addEventListener('fatal',fatal,{once:true});
  });
 }
 async signal(v){
  if(this.closed)return;
  if(v.kind==='error'){this.emit('fatal',v.error);return;}
  if(v.kind==='welcome'){this.emit('ready',{});for(const id of v.peers)await this.hello(id);return;}
  if(v.kind==='peer-joined'){await this.hello(v.id);return;}
  if(v.kind==='peer-left'){const p=this.peers.get(v.id);p?.pc?.close();this.peers.delete(v.id);this.emit('left',v.id);return;}
  if(v.kind!=='signal'||!v.from)return;
  const value=await open(this.secret,v,`${this.room}:${v.from}:${this.id}`);
  if(value.type==='hello'){
   if(this.peers.get(v.from)?.pc)return;
   const key=await crypto.subtle.importKey('raw',bytes(value.key),{name:'ECDH',namedCurve:'P-256'},false,[]);
   const pair=await crypto.subtle.deriveKey({name:'ECDH',public:key},this.identity.privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   const pc=new RTCPeerConnection({iceServers:this.iceServers,iceTransportPolicy:this.privacy==='relay'?'relay':'all'});
   const p={pc,key:pair,profile:value.profile,last:0,sendChain:Promise.resolve(),receiveChain:Promise.resolve(),candidates:[],chunks:new Map(),makingOffer:false,answerPending:false,ignoreOffer:false,polite:this.id>v.from};
   this.peers.set(v.from,p);
   pc.onicecandidate=e=>{if(e.candidate)this.sendSignal(v.from,{type:'ice',candidate:e.candidate}).catch(()=>{});};
   pc.ondatachannel=e=>this.channel(v.from,e.channel);
   pc.ontrack=e=>this.emit('stream',{id:v.from,stream:e.streams[0]||new MediaStream([e.track])});
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
   if(this.stream)for(const track of this.stream.getTracks())pc.addTrack(track,this.stream);
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
  dc.onopen=()=>this.emit('joined',{id,profile:p.profile});
  dc.onmessage=e=>{p.receiveChain=p.receiveChain.then(async()=>{
   const packet=await open(p.key,JSON.parse(e.data),`${this.room}:${id}:${this.id}`);
   if(!Number.isSafeInteger(packet.seq)||packet.seq<=p.last)return;p.last=packet.seq;
   if(packet.chunk){
    const c=packet.chunk;if(c.total>512||c.total<1||c.index<0||c.index>=c.total||c.text.length>8000)return;
    let batch=p.chunks.get(c.id);if(!batch){if(p.chunks.size>3)return;batch={parts:[],total:c.total,at:Date.now()};p.chunks.set(c.id,batch);}
    batch.parts[c.index]=c.text;
    if(batch.parts.filter(x=>typeof x==='string').length===batch.total){p.chunks.delete(c.id);this.emit('data',{id,value:JSON.parse(batch.parts.join(''))});}
    for(const[k,b]of p.chunks)if(Date.now()-b.at>10000)p.chunks.delete(k);
   }else this.emit('data',{id,value:packet.value});
  }).catch(()=>this.emit('error','Rejected an invalid peer packet.'));};
  dc.onclose=()=>this.emit('connection',{id,state:'disconnected'});
 }
 send(value,to=null){
  const text=JSON.stringify(value);if(text.length>2e6)throw Error('Activity is too large to sync.');
  for(const[id,p]of this.peers){if(to&&id!==to||p.dc?.readyState!=='open')continue;
   p.sendChain=p.sendChain.then(async()=>{
    const pieces=text.length>8000?Array.from({length:Math.ceil(text.length/8000)},(_,i)=>text.slice(i*8000,(i+1)*8000)):null;
    const batch=b64(random(8));
    for(let i=0;i<(pieces?.length||1);i++){
     if(p.dc.readyState!=='open')return;
     if(p.dc.bufferedAmount>2e6)throw Error('Peer connection is busy.');
     const packet=pieces?{seq:++this.sequence,chunk:{id:batch,index:i,total:pieces.length,text:pieces[i]}}:{seq:++this.sequence,value};
     p.dc.send(JSON.stringify(await seal(p.key,packet,`${this.room}:${this.id}:${id}`)));
    }
   }).catch(e=>this.emit('error',e.message));
  }
 }
 async share(stream){
  this.stream=stream;
  for(const[id,p]of this.peers){
   for(const s of p.pc.getSenders())if(s.track)p.pc.removeTrack(s);
   if(stream)for(const track of stream.getTracks())p.pc.addTrack(track,stream);
  }
 }
 leave(){this.closed=true;clearInterval(this.ping);clearInterval(this.iceRefresh);const socket=this.ws;this.ws=null;socket?.close();for(const p of this.peers.values())p.pc?.close();this.peers.clear();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.secret=null;this.identity=null;this.code='';}
}
