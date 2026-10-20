// Remove superseded control updates, never chat, files, moves, design authority,
// or drawings still visible. Kept clears/removals remain replay tombstones.
export const compareEvent=(a,b)=>a.n-b.n||a.actor.localeCompare(b.actor)||a.id.localeCompare(b.id);
export function compactLog(events){
 const ordered=[...events].sort(compareEvent),latest=new Map(),clears=new Map();
 const key=e=>e.type==='profile'?JSON.stringify(['profile',e.actor]):e.type==='watch'&&validWatch(e.data)?JSON.stringify(['watch',e.room]):e.type==='reaction'&&typeof e.data.message==='string'&&typeof e.data.emoji==='string'&&e.data.emoji.length<10?JSON.stringify(['reaction',e.data.message,e.actor]):e.type==='task'&&typeof e.data.id==='string'&&typeof e.data.title==='string'&&['todo','doing','done'].includes(e.data.status)?JSON.stringify(['task',e.data.id]):e.type==='queue'&&typeof e.data.id==='string'&&typeof e.data.title==='string'||e.type==='queue-remove'&&typeof e.data.id==='string'?JSON.stringify(['queue',e.data.id]):null;
 for(const e of ordered){const k=key(e);if(k)latest.set(k,e.id);if(e.type==='board-clear')clears.set(e.room,e);}
 return ordered.filter(e=>{const k=key(e);if(k&&latest.get(k)!==e.id)return false;const clear=clears.get(e.room);if(clear&&(e.type==='stroke'||e.type==='board-clear')&&compareEvent(e,clear)<0)return false;return true;});
}

export function validWatch(d){if(typeof d?.url!=='string')return false;if(!d.url||d.url.startsWith('local:'))return true;try{return ['http:','https:'].includes(new URL(d.url).protocol);}catch{return false;}}
