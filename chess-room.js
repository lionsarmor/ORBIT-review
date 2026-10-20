// Seats and moves share the same ordered, ephemeral lounge event history.
export const freshChess=()=>({fen:'',mode:'peer',players:{white:null,black:null},computer:false});
export function chessEvent(previous,event,{owner,members,core}){
 const g=previous||freshChess(),d=event.data,actor=event.actor,players={...g.players};
 if(event.type==='chess-seat'){
  if(!['white','black'].includes(d.side)||g.mode!=='peer')return g;
  if(d.release){if(players[d.side]===actor||actor===owner&&players[d.side]===d.previous&&!members.has(d.previous))players[d.side]=null;}
  else if(!players[d.side]&&!Object.values(players).includes(actor))players[d.side]=actor;
  return {...g,players};
 }
 if(d.reset){
  if(Object.values(players).some(Boolean)&&actor!==owner&&!Object.values(players).includes(actor))return g;
  const mode=['peer','local','computer'].includes(d.mode)?d.mode:d.computer?'computer':'peer';
  return {...freshChess(),mode,computer:mode==='computer',players:mode==='peer'?{white:null,black:null}:{white:actor,black:mode==='computer'?'computer':actor}};
 }
 if(d.before!==g.fen)return g;
 try{
  const state=JSON.parse(core.chess_state(g.fen)),side=state.turn;
  if(g.mode==='computer'){if(actor!==players.white)return g;}
  else if(g.mode==='local'){if(actor!==players.white)return g;}
  else if(players[side]!==actor){if(players[side]||Object.values(players).includes(actor))return g;players[side]=actor;}
  const result=JSON.parse(core.chess_play(g.fen,d.move));return {...g,players,fen:result.fen};
 }catch{return g;}
}
export function renderChess(a){
 const {$,session,core,esc}=a,room=session.room,g=session.state.chess[room]||freshChess();let state;
 try{state=JSON.parse(core.chess_state(g.fen));}catch{return;}
 const pieces={K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟','·':'','.':''},owns=Object.values(g.players).includes(session.id),canReset=owns||session.id===session.state.owner||!Object.values(g.players).some(Boolean);
 const seats=['white','black'].map(side=>{const id=g.players[side],mine=id===session.id,label=id==='computer'?'Computer':id?session.members.get(id)?.name||'Reconnecting…':'Open seat';return `<div class="player-seat ${mine?'yours':''}"><b>${side==='white'?'♔ White':'♚ Black'}</b><span>${esc(label)}</span>${g.mode==='peer'?`<button data-chess-seat="${side}" aria-pressed="${mine}" ${id&&!mine||!mine&&owns?'disabled':''}>${mine?'Release':'Claim'}</button>`:''}</div>`;}).join('');
 a.panel('A friendly match',`<select id="chess-opponent" aria-label="Chess opponent" ${canReset?'':'disabled'}><option value="peer">Room match</option><option value="local">Local two-player</option><option value="computer">Computer · casual</option></select><button id="chess-reset" ${canReset?'':'disabled'}>New game</button>`,`<div class="chess-seats">${seats}</div><div class="chess-board">${[...state.board].map((p,i)=>{const square='abcdefgh'[i%8]+(8-Math.floor(i/8));return `<button class="square ${(Math.floor(i/8)+i%8)%2?'dark':''} ${p===p.toLowerCase()?'black':''} ${a.chessSelection===square?'selected':''} ${a.chessSelection&&state.legal.some(m=>m.startsWith(a.chessSelection+square))?'legal':''}" data-square="${square}" aria-label="${square} ${p==='.'?'empty':p}">${pieces[p]}</button>`;}).join('')}</div><p class="game-status">${state.turn} to move · ${esc(state.status)} · ${owns?'Your seat is reserved':'Choose an open seat, or watch the match'}</p>`);
 $('#chess-opponent').value=g.mode;$('#chess-opponent').onchange=e=>a.emit('chess',{reset:true,mode:e.target.value},room);
 $('#chess-reset').onclick=()=>{a.chessSelection=null;a.emit('chess',{reset:true,mode:g.mode},room);};
 document.querySelectorAll('[data-chess-seat]').forEach(b=>b.onclick=()=>a.emit('chess-seat',{side:b.dataset.chessSeat,release:b.getAttribute('aria-pressed')==='true'},room));
 $('.chess-board').onclick=e=>{
  const b=e.target.closest('[data-square]');if(!b||state.over)return;
  const side=state.turn,seat=g.players[side];if(g.mode==='computer'&&side==='black'||g.mode!=='peer'&&g.players.white!==session.id||g.mode==='peer'&&(seat&&seat!==session.id||!seat&&owns))return a.toast('That side belongs to another player. Choose an open seat or enjoy the match.');
  const dest=b.dataset.square,move=state.legal.find(m=>m===a.chessSelection+dest)||state.legal.find(m=>m===a.chessSelection+dest+'q');
  if(move){a.chessSelection=null;a.emit('chess',{before:g.fen,move},room);}else{a.chessSelection=dest;a.chess();}
 };
}
