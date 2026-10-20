// Runs on a DIFFERENT origin from ORBIT. No identity, invitations or chat APIs.
let config;try{config=JSON.parse(decodeURIComponent(location.hash.slice(1)));history.replaceState(null,'',location.pathname);if(!/^https?:$/.test(new URL(config.parent).protocol)||!/^[-\w]{24}$/.test(config.nonce)||!/^[-\w]{11}$/.test(config.id))throw Error();}catch{throw Error('Open this player through ORBIT.');}
let player,ready=false;
const report=(type,extra={})=>parent.postMessage({type,nonce:config.nonce,...extra},config.parent);
const info=()=>{if(!ready)return;try{report('info',{time:player.getCurrentTime(),state:player.getPlayerState()});}catch{}};
window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==config.parent||event.data?.nonce!==config.nonce||!ready)return;const {command,args=[]}=event.data;try{if(['playVideo','pauseVideo','mute','unMute'].includes(command))player[command]();else if(command==='seekTo'&&Number.isFinite(args[0])&&args[0]>=0&&args[0]<1e7)player.seekTo(args[0],true);info();}catch{}});
window.onYouTubeIframeAPIReady=()=>{player=new YT.Player('player',{host:'https://www.youtube-nocookie.com',videoId:config.id,width:'100%',height:'100%',playerVars:{origin:location.origin,playsinline:1,rel:0},events:{onReady:()=>{ready=true;report('ready');info();},onStateChange:event=>{report('state',{state:event.data});info();},onError:()=>report('error')}});};
const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>report('error');document.head.append(script);setInterval(info,500);
