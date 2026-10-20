const paths={
 news:'<rect x="3" y="4" width="15" height="16" rx="2"/><path d="M18 8h3v10a2 2 0 0 1-2 2M6 8h9M6 16h9M12 12h3"/><rect x="6" y="11" width="3" height="3" rx=".5"/>',
 chess:'<path d="m7 20 1-4c3-1 4-3 3-5l-3 2-3-2 4-5 1-3 3 2c5 1 6 7 4 11l1 4Z"/><path d="M6 21h13M8 17h9M13 8h.01"/>',
 web:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>'
};
export function roomIcon(room,escape){
 if(room.icon)return escape(room.icon);
 let kind=room.mode;
 if(kind==='ambient')kind=/\bnews(?:room)?\b/i.test(room.name)?'news':/\bchess\b/i.test(room.name)?'chess':kind;
 return paths[kind]?`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-room-symbol="${kind}">${paths[kind]}</svg>`:null;
}
