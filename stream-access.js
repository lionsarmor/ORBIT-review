// Provider authentication stays on the provider's origin, outside the shared stage.
export const streamProviders=[
 {id:'netflix',name:'Netflix',host:'netflix.com',login:'https://www.netflix.com/login'},
 {id:'prime',name:'Prime Video',host:'primevideo.com',login:'https://www.primevideo.com/'},
 {id:'disney',name:'Disney+',host:'disneyplus.com',login:'https://www.disneyplus.com/identity/login'}
];
export function streamProvider(input){try{const u=new URL(input);if(u.protocol!=='https:'||u.username||u.password)return null;return streamProviders.find(p=>u.hostname===p.host||u.hostname.endsWith('.'+p.host))||null;}catch{return null;}}
export class StreamAccess{
 constructor(api){Object.assign(this,api);this.confirmed=new Map();}
 dialog(){const {$,esc}=this;this.modal('Your seat at movie night',`<p>Sign in privately on the service you use. The provider checks your credentials there; ORBIT never asks for or receives your password, cookies or subscription details.</p><div class="stream-services">${streamProviders.map(p=>`<a class="outlined stream-service" href="${esc(p.login)}" target="_blank" rel="noopener noreferrer">${esc(p.name)} · sign in ↗</a>`).join('')}</div><p>After posting a streaming link, use Check this title to confirm it plays on your device. Readiness is your own confirmation, not automatic account verification. It is cleared when you leave or wipe this visit.</p><p>These sign-ins stay outside the community-controlled Web browser. Provider playback and DRM restrictions still apply; synchronized provider playback is not yet available.</p>`);}
 render(w){
  const {$,esc}=this,p=streamProvider(w.url),url=new URL(w.url),key=this.session.room+':'+w.url,confirmed=this.confirmed.has(key),label=p?.name||url.hostname;
  $('#activity-content').innerHTML=`<div class="watch-container"><div class="media-empty stream-access"><span class="eyebrow">YOUR SEAT AT MOVIE NIGHT</span><h2>${esc(label)}</h2><p>Open the service privately to sign in and check that this title plays on your device.</p><div class="button-group"><a class="outlined stream-service" id="stream-sign-in" href="${esc(p?.login||url.origin+'/')}" target="_blank" rel="noopener noreferrer">${p?'Sign in privately':'Open website privately'} ↗</a><a class="primary stream-service" id="stream-check-title" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Check this title ↗</a></div><label class="toggle-row stream-ready"><span>I checked playback on this device</span><input id="stream-ready" type="checkbox" ${confirmed?'checked':''}></label><p id="stream-access-status" role="status">${confirmed?'Ready · confirmed by you for this visit':'Your service verifies your credentials in its own window. ORBIT cannot inspect your account.'}</p><p class="stream-access-note">This service uses its own player. Shared play/pause is not available here. Screen sharing may be available where capture is supported.</p>${devicePhone()?'':'<button id="external-share">Screen sharing options</button>'}</div></div>`;
  $('#stream-ready').onchange=e=>{e.target.checked?this.confirmed.set(key,true):this.confirmed.delete(key);$('#stream-access-status').textContent=e.target.checked?'Ready · confirmed by you for this visit':'Check the title on its service to confirm access.';};
  $('#external-share')?.addEventListener('click',()=>this.shareDialog());
 }
 stop(){this.confirmed.clear();}
}
function devicePhone(){return document.documentElement.dataset.device==='phone';}
