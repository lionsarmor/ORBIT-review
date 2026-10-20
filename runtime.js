// Keep browser files portable to GitHub Pages subpaths and separate helpers.
export const appBase=new URL('./',import.meta.url);
const response=await fetch(new URL('deployment.json',appBase),{cache:'no-store'});
if(!response.ok)throw Error('Could not load the ORBIT deployment settings.');
export const deployment=await response.json();
const backend=new URL(deployment.apiBase||'./',appBase);
if(!['http:','https:'].includes(backend.protocol))throw Error('Invalid ORBIT connection-helper address.');
if(location.protocol==='https:'&&backend.protocol!=='https:')throw Error('The connection helper must use HTTPS.');
if(!backend.pathname.endsWith('/'))backend.pathname+='/';
export const apiURL=path=>new URL(path.replace(/^\/+/,''),backend);
export function signalURL(path){const u=apiURL(path);u.protocol=u.protocol==='https:'?'wss:':'ws:';return u;}
