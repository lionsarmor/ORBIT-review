// A separate phone entry shares the same origin-local ID, not a different account.
export const device=Object.freeze(document.documentElement.dataset.device==='phone'?{phone:true,liveLounges:2,fileLimit:8*1048576,transferBudget:32*1048576}:{phone:false,liveLounges:4,fileLimit:16*1048576,transferBudget:64*1048576});
let installPrompt;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
export async function installPhone(){if(installPrompt){const event=installPrompt;installPrompt=null;await event.prompt();return true;}return false;}
export async function registerShell(){if('serviceWorker'in navigator&&window.isSecureContext)try{return await navigator.serviceWorker.register(new URL('sw.js',import.meta.url),{scope:new URL('./',import.meta.url).pathname});}catch{return null;}}
