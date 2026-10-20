import {appBase,deployment} from './runtime.js';
export function youtubeID(value){try{const u=new URL(value);if(!['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com','youtu.be'].includes(u.hostname))return null;const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.split('/').at(-1);return /^[\w-]{11}$/.test(id)?id:null;}catch{return null;}}
export class YouTubeRoom{
 constructor(api){Object.assign(this,api);this.players=new Map();this.layer=document.createElement('div');this.layer.className='youtube-pages';this.layer.hidden=true;document.querySelector('#stage').append(this.layer);this.resize=new ResizeObserver(()=>this.position());this.resize.observe(document.querySelector('#stage'));}
 park(){this.showing=null;this.layer.hidden=true;for(const p of this.players.values())try{p.player?.mute();}catch{}}
 cleanup(){for(const [room,p]of this.players){const w=this.session.state.watch?.[room];if(!this.session.state.rooms?.[room]||!w?.url||youtubeID(w.url)!==p.id){p.player?.destroy();p.frame.remove();this.players.delete(room);}}}
 render(w){
  this.cleanup();const room=this.session.room,{$}=this,id=youtubeID(w.url);if(!id)return this.toast('That YouTube video ID is not valid.');
  if(!$('#youtube-surface')||$('#youtube-surface').dataset.youtubeRoom!==room){this.park();$('#activity-content').innerHTML=`<div class="watch-container youtube-container"><div id="youtube-surface" data-youtube-room="${this.esc(room)}"></div><div class="video-sync-controls"><button id="yt-play">Play for everyone</button><button id="yt-pause">Pause for everyone</button><label>Seek (seconds)<input id="yt-time" type="number" min="0" value="0"></label><button id="yt-seek">Sync position</button><a id="yt-original" target="_blank" rel="noopener noreferrer">Open original ↗</a><small id="yt-status">Preparing the shared player…</small></div></div>`;$('#yt-original').href=w.url;$('#yt-play').onclick=()=>this.change(room,{playing:true});$('#yt-pause').onclick=()=>this.change(room,{playing:false});$('#yt-seek').onclick=()=>this.change(room,{time:Number($('#yt-time').value)||0});}
  this.showing=room;this.layer.hidden=false;this.ensure(room,id);for(const [r,p]of this.players){p.frame.hidden=r!==room;try{r===room?p.player?.unMute():p.player?.mute();}catch{}}this.position();this.synchronize();
 }
 change(room,values){const w=this.session.state.watch?.[room];if(!w)return;this.emit('watch',{url:w.url,title:w.title,playing:w.playing,time:this.watchTime(w),...values,at:Date.now()},room);}
 async ensure(room,id){
  if(this.players.has(room))return;
  let bridge;try{bridge=new URL(deployment.youtubeBridge||(['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:8781/youtube-bridge.html':'youtube-bridge.html'),appBase);if(bridge.origin===location.origin||!['http:','https:'].includes(bridge.protocol)||location.protocol==='https:'&&bridge.protocol!=='https:')throw Error();}catch{return this.toast('An isolated video-player origin must be configured for YouTube.');}
  const frame=document.createElement('div');frame.className='youtube-page';const iframe=document.createElement('iframe');iframe.title='Isolated YouTube player';iframe.sandbox='allow-scripts allow-same-origin allow-presentation';iframe.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';iframe.referrerPolicy='origin';const bytes=crypto.getRandomValues(new Uint8Array(18)),nonce=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');
  bridge.hash=encodeURIComponent(JSON.stringify({parent:location.origin,id,nonce}));iframe.src=bridge.href;frame.append(iframe);this.layer.append(frame);const p={id,frame,ready:false,lastSeek:0,lastTick:0,info:{time:0,state:2,at:performance.now()}};this.players.set(room,p);this.position();
  const command=(name,args=[])=>iframe.contentWindow?.postMessage({nonce,command:name,args},bridge.origin);
  const listener=event=>{if(this.stopped||this.players.get(room)!==p||event.source!==iframe.contentWindow||event.origin!==bridge.origin||event.data?.nonce!==nonce)return;const value=event.data;if(value.type==='info'&&Number.isFinite(value.time)&&value.time>=0&&value.time<1e7&&[-1,0,1,2,3,5].includes(value.state))p.info={time:value.time,state:value.state,at:performance.now()};if(value.type==='ready'){p.ready=true;clearTimeout(p.timeout);if(this.showing!==room)command('mute');this.synchronize();}if(value.type==='error'){p.error=true;if(this.showing===room&&this.$('#yt-status'))this.$('#yt-status').textContent='This video cannot play here. Try Open original.';}if(value.type==='state'&&p.ready&&performance.now()>=(p.suppressUntil||0)){const w=this.session.state.watch?.[room];if(w?.actor===this.session.id&&[1,2].includes(value.state)&&w.playing!==(value.state===1))this.change(room,{playing:value.state===1});}};
  window.addEventListener('message',listener);p.timeout=setTimeout(()=>{if(!this.stopped&&!p.ready)this.toast('The isolated YouTube player could not load. Try Open original.');},18000);
  p.player={getCurrentTime:()=>p.info.time+(p.info.state===1?(performance.now()-p.info.at)/1000:0),getPlayerState:()=>p.info.state,seekTo:time=>{p.info={...p.info,time,at:performance.now()};command('seekTo',[time]);},playVideo:()=>command('playVideo'),pauseVideo:()=>command('pauseVideo'),mute:()=>command('mute'),unMute:()=>command('unMute'),destroy:()=>{clearTimeout(p.timeout);window.removeEventListener('message',listener);iframe.remove();}};
 }

 synchronize(){
  if(this.stopped)return;this.cleanup();const now=performance.now();
  for(const [room,p]of this.players){if(!p.ready||p.error)continue;const w=this.session.state.watch?.[room];if(!w)continue;try{
   const actual=p.player.getCurrentTime(),status=p.player.getPlayerState(),target=this.watchTime(w),control=p.control!==w.event;
   if(!Number.isFinite(actual)||status===3)continue;
   if(control||Math.abs(actual-target)>1.5&&now-p.lastSeek>4000){p.suppressUntil=now+900;if(Math.abs(actual-target)>.3){p.player.seekTo(target,true);p.lastSeek=now;}if(w.playing&&status!==1)p.player.playVideo();if(!w.playing&&status!==2)p.player.pauseVideo();p.control=w.event;}
   if(w.actor===this.session.id&&now-p.lastTick>2000){p.lastTick=now;this.timeline(room,{time:p.player.getCurrentTime(),playing:w.playing});}
   if(this.showing===room&&this.isVisible()){const label=this.$('#yt-status');if(label)label.textContent=`Shared timeline · ${Math.abs(actual-target).toFixed(1)}s drift · browser playback permission may be needed`;}
  }catch{}}
 }
 position(){const surface=this.$('#youtube-surface'),p=this.players.get(this.showing);if(!surface||!p||this.layer.hidden)return;const box=surface.getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect();Object.assign(p.frame.style,{left:`${box.left-stage.left}px`,top:`${box.top-stage.top}px`,width:`${box.width}px`,height:`${box.height}px`});}
 stop(){this.stopped=true;for(const p of this.players.values()){p.player?.destroy();p.frame.remove();}this.players.clear();this.resize.disconnect();this.layer.remove();}
}
