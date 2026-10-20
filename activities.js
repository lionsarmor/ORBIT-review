import {Arcade} from './arcade.js';
export class Activities{
 constructor(api){Object.assign(this,api);this.mode='';this.room='';this.localURLs=new Map();this.remoteStreams=new Map();this.chessSelection=null;this.arcade=new Arcade({...api,activities:this});}
 resetView(){this.arcade.park();this.mode='';this.chessSelection=null;this.backgroundOnly=false;}
 stop(){this.arcade.stop();this.mode='';this.streams?.getTracks().forEach(t=>t.stop());this.streams=null;for(const u of this.localURLs.values())URL.revokeObjectURL(u);this.localURLs.clear();this.remoteStreams.clear();document.querySelectorAll('audio[id^="voice-"]').forEach(a=>{a.srcObject=null;a.remove();});this.media=null;this.$('#activity-content').replaceChildren();}
 setBackgroundOnly(value){this.backgroundOnly=value;this.render(this.session.state.rooms[this.session.room]?.mode||'ambient','view');}
 render(mode,reason){
  this.arcade.reconcile();this.sharedMode=mode;
  const toggle=this.$('#background-toggle');if(toggle){toggle.hidden=mode==='ambient'&&!this.backgroundOnly;toggle.textContent=this.backgroundOnly?'Return to activity':'Chat background';toggle.setAttribute('aria-pressed',String(!!this.backgroundOnly));}
  const view=this.backgroundOnly?'ambient':mode;
  const changed=this.mode!==view||this.room!==this.session.room||reason==='view';
  if(changed){this.arcade.park();this.mode=view;this.room=this.session.room;this.chessSelection=null;this.media=null;this.$('#activity-content').replaceChildren();}
  this.$('#ambient').style.display=view==='ambient'?'':'none';
  if(view==='ambient')return;
  if(view==='watch'){if(changed||reason==='watch')this.renderWatch();return;}
  if(view==='whiteboard'){if(changed)this.board();if(changed||['stroke','board-clear'].includes(reason))this.drawBoard();return;}
  if(view==='chess'){if(changed||reason==='chess')this.chess();return;}
  if(view==='emulator'){if(changed)this.arcade.show();else this.arcade.updateView();return;}
  if(view==='tasks'){if(changed||reason==='task')this.tasks();return;}
  if(view==='news'){if(changed||reason==='link')this.links();}
 }
 panel(title,tools,body){this.$('#activity-content').innerHTML=`<section class="activity-panel"><div class="activity-toolbar"><h2>${title}</h2>${tools}</div>${body}</section>`;}
 shareDialog(){
  const {$,modal,esc}=this;
  modal('Something to share',`<form id="share-form"><label>Video link<input id="video-url" type="url" required placeholder="Direct .mp4 / .webm or a YouTube link"></label><button class="primary wide">Watch together ↗</button></form><div class="settings-section button-group"><button id="screen-share">Share screen / window</button><button id="local-share">Open a local video</button><button id="voice-share">${this.streams?.getAudioTracks().length?'Stop microphone':'Join voice'}</button><button id="stop-share">Stop sharing</button><input id="local-video" type="file" accept="video/*,audio/*" hidden></div><p>Everyone receives the same playback commands. Browsers may require each person to press Play once. Screen and local-media sharing depend on your browser. Protected streaming sites cannot be embedded.</p>`);
  $('#share-form').onsubmit=e=>{e.preventDefault();this.watch($('#video-url').value);this.closeModal();};
  $('#screen-share').onclick=async()=>{try{if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Screen sharing is unavailable in this browser.');const s=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:24},audio:true});await this.publish(s);this.closeModal();}catch(e){this.toast(e.message);}};
  $('#local-share').onclick=()=>$('#local-video').click();
  $('#local-video').onchange=async e=>{
   const f=e.target.files[0];if(!f)return;
   const token=`local:${this.uid()}`,url=URL.createObjectURL(f);this.localURLs.set(token,url);
   this.emit('watch',{url:token,title:f.name,playing:true,time:0,at:Date.now()});this.emit('activity',{mode:'watch'});this.closeModal();
   const video=$('#watch-video');if(!video)return;
   try{await video.play();const capture=video.captureStream||video.mozCaptureStream;if(capture){await this.mesh.share(capture.call(video));this.toast('Local video is streaming to the space.');}else this.toast('This browser cannot stream local media. Use screen sharing on desktop.');}catch(e){this.toast(e.message);}
  };
  $('#voice-share').onclick=async()=>{try{
   if(this.streams?.getAudioTracks().length){await this.publish(null);return this.closeModal();}
   const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   this.streams?.getTracks().forEach(t=>t.stop());this.streams=s;await this.mesh.share(s);this.closeModal();this.toast('Microphone shared with people in this space.');
  }catch(e){this.toast(e.message);}};
  $('#stop-share').onclick=async()=>{await this.publish(null);this.closeModal();};
 }
 async publish(stream){
  this.streams?.getTracks().forEach(t=>t.stop());this.streams=stream;await this.mesh.share(stream);
  if(stream){stream.getVideoTracks()[0]?.addEventListener('ended',()=>this.publish(null));this.emit('watch',{url:`local:screen:${this.session.id}`,title:'Live screen',playing:true,time:0,at:Date.now()});this.emit('activity',{mode:'watch'});}
  else{this.emit('watch',{url:'',title:'',playing:false});this.toast('Sharing stopped.');}
 }
 stream(id,stream,key='main'){
  if(key.startsWith('arcade:')){this.arcade.stream(id,stream);return;}
  this.remoteStreams.set(id,stream);
  if(stream.getVideoTracks().length&&this.mode==='watch')this.renderWatch();
  if(!stream.getVideoTracks().length){let audio=document.getElementById(`voice-${id}`);if(!audio){audio=document.createElement('audio');audio.id=`voice-${id}`;audio.autoplay=true;document.body.append(audio);}audio.srcObject=stream;audio.play().catch(()=>this.toast('Tap Share → Join voice to enable audio playback.'));}
 }
 postedVideo(url){if(this.videoKind(url)!=='link')this.watch(url);}
 videoKind(url){
  try{const u=new URL(url);if(['youtube.com','www.youtube.com','youtu.be','m.youtube.com','www.youtube-nocookie.com'].includes(u.hostname))return'youtube';if(/\.(mp4|webm|ogg|m4v|mp3)(?:$|\?)/i.test(url))return'video';}catch{}
  return'link';
 }
 watch(url){const valid=this.safeURL(url);if(!valid)return this.toast('Use a valid http or https video link.');this.emit('watch',{url:valid,title:new URL(valid).hostname,playing:true,time:0,at:Date.now()});this.emit('activity',{mode:'watch'});}
 renderWatch(){
  const {$,esc,session}=this,w=session.state.watch[session.room];
  if(!w?.url){$('#activity-content').innerHTML='<div class="watch-container" style="background:transparent"><div class="media-empty"><span class="eyebrow">THE BEST SEAT IS NEXT TO YOUR PEOPLE</span><h2 style="margin-top:18px">Make it a movie night.</h2><p>Paste a video into chat, share a screen, or add something to Up next.</p><button id="watch-open" class="primary">Choose something ↗</button></div></div>';$('#watch-open').onclick=()=>this.shareDialog();return;}
  const kind=w.url.startsWith('local:')?'local':this.videoKind(w.url);
  if(kind==='link'){
   $('#activity-content').innerHTML=`<div class="watch-container"><div class="media-empty"><h2>Open this together</h2><p>This service needs its own player. Playback cannot be synchronized here. Screen sharing is available where the service permits it.</p><a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(w.title)} ↗</a><p><button id="external-share">Share a screen</button></p></div></div>`;$('#external-share').onclick=()=>this.shareDialog();return;
  }
  if(kind==='youtube'){this.youtube(w);return;}
  const same=this.media?.dataset.source===w.url;
  if(!same){
   $('#activity-content').innerHTML='<div class="watch-container"><video id="watch-video" controls playsinline></video><button id="enable-play" class="play-prompt">▶ Enable playback</button></div>';
   const video=$('#watch-video');this.media=video;video.dataset.source=w.url;video.autoplay=true;
   if(kind==='local'){
    if(this.localURLs.has(w.url))video.src=this.localURLs.get(w.url);
    else{const stream=w.actor===session.id?this.streams:this.remoteStreams.get(w.actor);if(stream){video.srcObject=stream;video.muted=w.actor===session.id;}else{video.poster='assets/aurora.png';this.toast('Waiting for the shared stream…');}}
   }else video.src=w.url;
   $('#enable-play').onclick=()=>video.play().then(()=>$('#enable-play')?.remove()).catch(e=>this.toast(e.message));
   video.onplaying=()=>$('#enable-play')?.remove();
   const send=type=>{
    if(video.srcObject||w.url.startsWith('local:'))return;
    const desired=session.state.watch[session.room];
    if(type==='seeked'&&this.expectedSeek!=null&&Math.abs(video.currentTime-this.expectedSeek)<.3){this.expectedSeek=null;return;}
    if(type!=='seeked'&&desired?.playing===!video.paused)return;
    this.expectedSeek=null;this.emit('watch',{url:w.url,title:w.title,playing:!video.paused,time:video.currentTime,at:Date.now()});
   };
   video.onplay=()=>send('play');video.onpause=()=>send('pause');video.onseeked=()=>send('seeked');
   video.onended=()=>this.toast('That’s a wrap. Choose the next activity in Up next.');
   video.onerror=()=>this.toast('The browser cannot play this link. Try a direct video file or screen sharing.');
  }
  const video=this.media;
  if(kind==='local'){
   const arriving=w.actor===session.id?this.streams:this.remoteStreams.get(w.actor);
   if(!this.localURLs.has(w.url)&&arriving&&video.srcObject!==arriving){video.srcObject=arriving;video.muted=w.actor===session.id;video.play().catch(()=>{});}
   return;
  }
  if(video.srcObject)return;
  const target=Math.max(0,Number(w.time)||0)+(w.playing?Math.max(0,(Date.now()-w.at)/1000):0);
  if(video.readyState>0&&Math.abs(video.currentTime-target)>.25){this.expectedSeek=Number.isFinite(video.duration)?Math.min(target,video.duration):target;video.currentTime=this.expectedSeek;}
  if(w.playing)video.play().catch(()=>{});else video.pause();
  if(video.readyState<1)video.onloadedmetadata=()=>this.renderWatch();
 }
 youtube(w){
  const {$,esc}=this,u=new URL(w.url);let id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.split('/').at(-1);
  if(!/^[\w-]{11}$/.test(id)){this.toast('That YouTube video ID is not valid.');return;}
  if(this.youtubeId!==id||!$('#youtube-frame')){
   this.youtubeId=id;
   $('#activity-content').innerHTML=`<div class="watch-container"><iframe id="youtube-frame" title="Shared YouTube video" src="https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&playsinline=1&origin=${encodeURIComponent(location.origin)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="video-sync-controls"><button id="yt-play">Play for everyone</button><button id="yt-pause">Pause for everyone</button><label>Seek (seconds)<input id="yt-time" type="number" min="0" value="0"></label><button id="yt-seek">Sync position</button></div></div>`;
   $('#yt-play').onclick=()=>this.emit('watch',{...this.session.state.watch[this.session.room],playing:true,at:Date.now()});
   $('#yt-pause').onclick=()=>this.emit('watch',{...this.session.state.watch[this.session.room],playing:false,time:this.ytTime||0,at:Date.now()});
   $('#yt-seek').onclick=()=>this.emit('watch',{...this.session.state.watch[this.session.room],time:Number($('#yt-time').value)||0,at:Date.now()});
   if(!this.ytListener){this.ytListener=e=>{if(e.origin!=='https://www.youtube-nocookie.com'||e.source!==$('#youtube-frame')?.contentWindow)return;try{const data=typeof e.data==='string'?JSON.parse(e.data):e.data;if(data.info?.currentTime)this.ytTime=data.info.currentTime;}catch{}};window.addEventListener('message',this.ytListener);}
   $('#youtube-frame').onload=()=>{$('#youtube-frame')?.contentWindow.postMessage(JSON.stringify({event:'listening'}),'https://www.youtube-nocookie.com');this.youtube(this.session.state.watch[this.session.room]);};
  }
  const command=(func,args=[])=>$('#youtube-frame')?.contentWindow.postMessage(JSON.stringify({event:'command',func,args}),'https://www.youtube-nocookie.com');
  command('seekTo',[Math.max(0,Number(w.time)||0),true]);command(w.playing?'playVideo':'pauseVideo');
 }
 board(){
  const {$}=this;
  this.panel('A blank canvas. All yours.',`<div class="board-controls"><input id="ink" type="color" value="#35516c" aria-label="Ink color"></div><select id="brush" aria-label="Brush width"><option value="3">Fine</option><option value="7">Bold</option><option value="18">Marker</option></select><button id="board-clear">Clear board</button>`,`<canvas id="whiteboard" class="board-canvas" width="1200" height="700" aria-label="Shared whiteboard"></canvas>`);
  const c=$('#whiteboard');let stroke=null;
  const point=e=>{const r=c.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
  c.onpointerdown=e=>{if(!this.session.active)return;stroke={color:$('#ink').value,width:Number($('#brush').value),points:[point(e)]};c.setPointerCapture(e.pointerId);};
  c.onpointermove=e=>{if(stroke){stroke.points.push(point(e));this.drawBoard(stroke);if(stroke.points.length>2000)c.onpointerup();}};
  c.onpointerup=()=>{if(stroke){this.emit('stroke',stroke);stroke=null;}};
  c.onpointercancel=()=>stroke=null;$('#board-clear').onclick=()=>this.emit('board-clear');
 }
 drawBoard(extra){
  const c=this.$('#whiteboard');if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
  for(const s of [...(this.session.state.strokes[this.session.room]||[]),...(extra?[extra]:[])]){
   if(!/^#[0-9a-f]{6}$/i.test(s.color))continue;
   ctx.strokeStyle=s.color;ctx.lineWidth=Math.min(30,Math.max(1,Number(s.width)||3));ctx.lineCap=ctx.lineJoin='round';ctx.beginPath();
   s.points.forEach((p,i)=>{if(!Array.isArray(p)||p.length!==2)return;const x=Math.max(0,Math.min(1,p[0]))*c.width,y=Math.max(0,Math.min(1,p[1]))*c.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  }
 }
 chess(){
  const {$,session,core,esc}=this;let state;
  try{state=JSON.parse(core.chess_state(session.state.chess[session.room]?.fen||''));}catch{return;}
  const computer=session.state.chess[session.room]?.computer||false;
  const pieces={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟','·':'', '.':''};
  this.panel('A friendly match',`<select id="chess-opponent" aria-label="Chess opponent"><option value="peer">People in this space</option><option value="computer">Computer · casual</option></select><button id="chess-reset">New game</button>`,`<div class="chess-board">${[...state.board].map((p,i)=>{const square='abcdefgh'[i%8]+(8-Math.floor(i/8));return `<button class="square ${(Math.floor(i/8)+i%8)%2?'dark':''} ${p===p.toLowerCase()?'black':''} ${this.chessSelection===square?'selected':''} ${this.chessSelection&&state.legal.some(m=>m.startsWith(this.chessSelection+square))?'legal':''}" data-square="${square}" aria-label="${square} ${p==='.'?'empty':p}">${pieces[p]}</button>`;}).join('')}</div><p class="game-status">${state.turn} to move · ${esc(state.status)}${computer?' · You play white':' · Shared board'}</p>`);
  $('#chess-opponent').value=computer?'computer':'peer';
  $('#chess-opponent').onchange=e=>this.emit('chess',{reset:true,computer:e.target.value==='computer'});
  $('#chess-reset').onclick=()=>{this.chessSelection=null;this.emit('chess',{reset:true,computer});};
  $('.chess-board').onclick=e=>{
   const b=e.target.closest('[data-square]');if(!b||state.over||computer&&state.turn==='black')return;
   const dest=b.dataset.square,move=state.legal.find(m=>m===this.chessSelection+dest)||state.legal.find(m=>m===this.chessSelection+dest+'q');
   if(move){this.chessSelection=null;this.emit('chess',{before:session.state.chess[session.room]?.fen||'',move});if(computer)setTimeout(()=>{const fen=session.state.chess[session.room]?.fen||'';const s=JSON.parse(core.chess_state(fen));if(s.turn==='black'&&!s.over)this.emit('chess',{before:fen,move:core.chess_computer(fen)});},250);}
   else{this.chessSelection=dest;this.chess();}
  };
 }
 receive(id,v){this.arcade.receive(id,v);}
 controllers(){this.arcade.controllers();}
 tasks(){
  const {$,esc,session}=this;this.panel('A little progress, together',`<button id="task-add">＋ Add a task</button>`,`<div class="task-columns">${['todo','doing','done'].map(status=>`<section class="task-column"><h3>${{todo:'To do',doing:'In progress',done:'Done'}[status]}</h3>${Object.values(session.state.tasks).filter(t=>t.room===session.room&&t.status===status).map(t=>`<div class="task-card">${esc(t.title)}<select data-task="${esc(t.id)}" aria-label="Status for ${esc(t.title)}">${['todo','doing','done'].map(s=>`<option value="${s}" ${s===status?'selected':''}>${s}</option>`).join('')}</select></div>`).join('')}</section>`).join('')}</div>`);
  $('#task-add').onclick=()=>{this.modal('One small thing',`<form id="task-form"><label>Task<input id="task-title" maxlength="120" required placeholder="Pick a movie for Friday"></label><button class="primary wide">Add task</button></form>`);$('#task-form').onsubmit=e=>{e.preventDefault();this.emit('task',{id:this.uid(),title:$('#task-title').value,status:'todo'});this.closeModal();};};
  document.querySelectorAll('[data-task]').forEach(s=>s.onchange=()=>this.emit('task',{...session.state.tasks[s.dataset.task],status:s.value}));
 }
 links(){
  const {$,esc,session}=this;const links=Object.values(session.state.links).filter(l=>l.room===session.room);
  this.panel('Worth a look',`<button id="link-add">＋ Add a link</button>`,links.length?links.map(l=>`<a class="link-card" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title||new URL(l.url).hostname)} ↗<p>${esc(l.url)}</p></a>`).join(''):'<div class="empty-state">A shared shelf for articles, music, useful tools, and things to come back to while you’re here.</div>');
  $('#link-add').onclick=()=>{this.modal('Something worth sharing',`<form id="link-form"><label>Title<input id="link-title" maxlength="100"></label><label>URL<input id="link-url" type="url" required></label><button class="primary wide">Share link</button></form>`);$('#link-form').onsubmit=e=>{e.preventDefault();const url=this.safeURL($('#link-url').value);if(url){this.emit('link',{id:this.uid(),title:$('#link-title').value,url});this.closeModal();}};};
 }
}
