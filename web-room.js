// Shared navigation is peer state; embedded website sessions stay in each browser.
export function webURL(input){
 try{const url=new URL(String(input).trim());if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>4096)return null;return url.href;}catch{return null;}
}
export class WebRoom{
 constructor(api){Object.assign(this,api);this.pages=new Map();this.layer=document.createElement('div');this.layer.className='web-pages';this.layer.hidden=true;document.querySelector('#stage').append(this.layer);this.resize=new ResizeObserver(()=>this.position());this.resize.observe(document.querySelector('#stage'));}
 park(){this.showingRoom=null;this.layer.hidden=true;}
 reconcile(){
  for(const [room,page]of this.pages){const state=this.session.state.web?.[room];if(!this.session.state.rooms[room]||!state?.url||state.event!==page.event){page.frame.remove();this.pages.delete(room);}}
 }
 open(input,room=this.session.room){const url=webURL(input);if(!url)return this.toast('Choose an http or https webpage without a password in the address.');if(location.protocol==='https:'&&new URL(url).protocol!=='https:')return this.toast('Use an HTTPS page inside this secure lounge.');this.emit('web',{url},room);}
 render(){
  const {$,esc,session}=this,room=session.room,state=session.state.web?.[room];
  if(!$('#web-room')||$('#web-room').dataset.webRoom!==room){
   this.park();$('#activity-content').innerHTML=`<section id="web-room" class="web-room" data-web-room="${esc(room)}"><form id="web-address-form" class="web-address-bar"><span class="web-room-symbol" aria-hidden="true">◎</span><input id="web-address" aria-label="Shared webpage address" type="url" placeholder="Paste a webpage address…" autocomplete="off" required><button id="web-load" class="primary">Load for everyone ↗</button><button id="web-reload" type="button" title="Reload the shared address for everyone" aria-label="Reload webpage for everyone">⟳</button><button id="web-stop" type="button" title="Close the webpage for everyone" aria-label="Close webpage for everyone">×</button></form><div id="web-surface" class="web-surface"></div><div class="web-room-note"><span>Shared address · each person browses locally</span><a id="web-original" target="_blank" rel="noopener noreferrer">Open original ↗</a><button id="web-help" type="button" aria-label="About shared webpages">?</button></div></section>`;
   $('#web-address-form').onsubmit=e=>{e.preventDefault();this.open($('#web-address').value,room);};
   $('#web-reload').onclick=()=>{const current=session.state.web?.[room];if(current?.url)this.open(current.url,room);};
   $('#web-stop').onclick=()=>this.emit('web',{url:''},room);
   $('#web-help').onclick=()=>this.modal('A window onto the web',`<p>Anyone here can load a shared address. Everyone can click, type and scroll in their own copy of the page.</p><p>Clicks, forms, logins and navigation inside the website stay in your browser. Use the address field to send everyone to another page. Embedded sites use their own cookies and receive their own traffic.</p><p>Some sites block embedding. Open original for those pages. Use Chat · Hidden for more space to interact, or Chat background to put the page away.</p>`);
  }
  const address=$('#web-address');if(document.activeElement!==address)address.value=state?.url||'';
  $('#web-reload').disabled=$('#web-stop').disabled=!state?.url;
  const original=$('#web-original');original.hidden=!state?.url;if(state?.url)original.href=state.url;else original.removeAttribute('href');
  const surface=$('#web-surface');
  if(!state?.url){this.park();surface.innerHTML='<div class="web-empty"><span aria-hidden="true">◎</span><span class="eyebrow">A LITTLE WINDOW. A WHOLE WORLD.</span><h2>Where shall we go?</h2><p>Drop a webpage address above.<br>Explore with your people, with chat right here.</p><small>Sites that allow embedding open in the background. Everyone can use their own copy.</small></div>';return;}
  let page=this.pages.get(room);
  if(!page){
   const frame=document.createElement('iframe');frame.title=`Web room — ${new URL(state.url).hostname}`;frame.className='web-page';frame.sandbox='allow-scripts allow-forms allow-same-origin allow-popups';frame.allow='fullscreen';frame.referrerPolicy='no-referrer';frame.src=state.url;
   page={frame,event:state.event};this.pages.set(room,page);this.layer.append(frame);
  }
  this.showingRoom=room;this.layer.hidden=false;for(const [id,p]of this.pages)p.frame.hidden=id!==room;this.position();
 }
 position(){const surface=this.$('#web-surface');const page=this.pages.get(this.showingRoom);if(!surface||!page||this.layer.hidden)return;const box=surface.getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect();Object.assign(page.frame.style,{left:`${box.left-stage.left}px`,top:`${box.top-stage.top}px`,width:`${box.width}px`,height:`${box.height}px`});}
 stop(){for(const page of this.pages.values()){page.frame.src='about:blank';page.frame.remove();}this.pages.clear();this.resize.disconnect();this.layer.remove();}
}
