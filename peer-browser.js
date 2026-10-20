// Only a temporary companion capability is stored here, never in an ID card.
const bridgeOrigin='http://127.0.0.1:8770';
let access='';try{access=sessionStorage.getItem('orbit.peer-browser')||'';}catch{}
export function pairBrowser(){
 const nonce=crypto.randomUUID().replaceAll('-','');
 const popup=window.open(`${bridgeOrigin}/pair?origin=${encodeURIComponent(location.origin)}&nonce=${nonce}`,'orbit-peer-browser','popup,width=640,height=680');
 return new Promise((resolve,reject)=>{
  const end=()=>{clearTimeout(timer);window.removeEventListener('message',listener);};
  const listener=e=>{if(e.source!==popup||e.origin!==bridgeOrigin||e.data?.type!=='orbit-host-paired'||e.data.nonce!==nonce||!/^[-\w]{43}$/.test(e.data.token))return;end();access=e.data.token;try{sessionStorage.setItem('orbit.peer-browser',access);}catch{}resolve();};
  const timer=setTimeout(()=>{end();reject(Error('Start the desktop companion, then choose Enable hosting again.'));},120000);window.addEventListener('message',listener);
  if(!popup){end();reject(Error('Allow the ORBIT hosting popup, then try again.'));}
 });
}
export class PeerBrowser{
 constructor({frame,location:locationChanged,notice,ended}){this.onframe=frame;this.onlocation=locationChanged;this.notice=notice;this.onended=ended;this.canvas=document.createElement('canvas');this.canvas.width=1280;this.canvas.height=800;this.canvas.className='web-host-canvas';this.context=this.canvas.getContext('2d',{alpha:false});this.context.fillStyle='#19140f';this.context.fillRect(0,0,1280,800);this.stream=this.canvas.captureStream(8);this.stream.getVideoTracks()[0].contentHint='detail';this.closed=false;this.refresh=setInterval(()=>{if(!this.closed){this.context.drawImage(this.canvas,0,0);this.stream.getVideoTracks()[0]?.requestFrame?.();}},125);}
 async start(url){
  if(!access)throw Error('Enable hosting on this computer first.');
  await new Promise((resolve,reject)=>{
   const ws=this.socket=new WebSocket('ws://127.0.0.1:8770/browser');let started=false;
   const timeout=setTimeout(()=>{reject(Error('The peer browser did not start. Check the desktop companion.'));this.close();},35000);
   ws.onopen=()=>ws.send(JSON.stringify({type:'auth',token:access}));
   ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}
    if(m.type==='ready'){this.send({type:'start',url});this.heartbeat=setInterval(()=>this.send({type:'ping'}),10000);}
    if(m.type==='started'){started=true;clearTimeout(timeout);resolve();}
    if(m.type==='frame')this.draw(m.data);
    if(m.type==='location')this.onlocation?.(m.url);
    if(m.type==='notice')this.notice?.(m.message);
    if(m.type==='ended'){this.close();this.onended?.();}
   };
   ws.onerror=()=>{if(!started){clearTimeout(timeout);reject(Error('Start the ORBIT desktop companion to host a shared browser.'));}this.close();};
   ws.onclose=()=>{clearTimeout(timeout);if(!started)reject(Error('Hosting permission expired. Enable hosting on this computer again.'));const unexpected=!this.closed;this.close();if(unexpected)this.onended?.();};
  });return this;
 }
 async draw(data){if(this.drawing||this.closed)return;this.drawing=true;try{const blob=await(await fetch('data:image/jpeg;base64,'+data)).blob(),bitmap=await createImageBitmap(blob);if(!this.closed)this.context.drawImage(bitmap,0,0,1280,800);bitmap.close();this.onframe?.();}catch{}finally{this.drawing=false;}}
 send(value){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(value));}
 input(action){this.send({type:'input',action});}
 close(){if(this.closed)return;this.closed=true;clearInterval(this.heartbeat);clearInterval(this.refresh);this.send({type:'stop'});this.socket?.close();this.stream.getTracks().forEach(t=>t.stop());this.canvas.remove();}
}
