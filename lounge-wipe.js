import {design} from './identity.js';
import {signAuthority,verifyAuthority,wipeStatement} from './lounge-authority.js';
const validId=s=>typeof s==='string'&&/^[-\w]{12,40}$/.test(s);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export class LoungeWipe{
 constructor({mesh,session,uid,layout,apply,change,notice}){
  Object.assign(this,{mesh,session,uid,layout,apply,change,notice});
  this.epoch={number:0,id:'initial'};this.ballot=null;this.early=new Map();this.earlyReady=new Map();this.used=new Set();this.message='';this.destroyed=false;
 }
 begin(){if(this.epoch.id==='initial'){this.epoch={number:0,id:this.uid()};this.mesh.contentEpoch=this.epoch.id;}}
 coordinator(){return this.session.members.has(this.session.state.owner)?this.session.state.owner:this.roster()[0];}
 roster(){return [...this.session.members.keys()].sort();}
 creatorHere(){return this.mesh.isCreator||[...this.mesh.peers.values()].some(p=>p.creator&&p.dc?.readyState==='open');}
 ready(){
  const members=this.roster();
  return this.session.active&&!this.desynced&&!this.mesh.reconnecting&&this.mesh.ws?.readyState===1&&
   members.length===this.mesh.signalPeers.size+1&&members.every(id=>id===this.session.id||this.mesh.signalPeers.has(id)&&this.mesh.peers.get(id)?.dc?.readyState==='open'&&this.mesh.peers.get(id)?.wipeVersion===1);
 }
 send(value,to=null){return this.mesh.send({...value,base:this.epoch.id},to);}
 broadcast(value){this.send(value);this.receive(this.session.id,{...value,base:this.epoch.id});}
 joined(id){this.membershipChanged();this.send({type:'wipe-sync',epoch:this.epoch},id);}
 membershipChanged(){
  if(this.ballot&&(!same(this.ballot.roster,this.roster())||this.creatorHere()||!this.ready()))this.cancelLocal('The guest list changed. Start a new vote with everyone here.');
  this.change();
 }
 cancelLocal(message){clearTimeout(this.timer);this.ballot=null;this.pending=null;this.early.clear();this.earlyReady.clear();this.message=message;this.change();}
 request(){
  if(!this.ready())throw Error('Wait until everyone is connected and using the latest ORBIT.');
  if(this.creatorHere())throw Error('The lounge creator is here. They hold the wipe control.');
  if(this.ballot)return;
  this.pending=this.uid();const request={type:'wipe-request',request:this.pending};
  const coordinator=this.coordinator();
  if(coordinator===this.session.id)this.receive(this.session.id,{...request,base:this.epoch.id});else this.send(request,coordinator);
 }
 vote(yes){
  if(!this.ballot||this.ballot.votes.has(this.session.id)||!this.ready())return;
  this.broadcast({type:'wipe-vote',proposal:this.ballot.id,yes:!!yes});
 }
 cancel(){if(this.ballot?.requester===this.session.id)this.broadcast({type:'wipe-cancel',proposal:this.ballot.id});}
 async creatorWipe(){
  if(!this.mesh.isCreator||!this.ready())throw Error('The creator must be connected, with every member ready.');
  const base=this.epoch.id,next={number:this.epoch.number+1,id:this.uid()},layout=this.layout();
  const signature=await signAuthority(this.mesh.creatorSecret,wipeStatement(this.mesh.room,base,next,layout));
  if(this.destroyed||this.epoch.id!==base||!this.ready())throw Error('The lounge changed. Review the ticket again.');
  this.send({type:'wipe-creator',next,layout,signature});this.finish(next,'The creator gave this lounge a fresh start.',layout);
 }
 finish(next,message,layout){
  clearTimeout(this.timer);this.ballot=null;this.pending=null;this.early.clear();this.earlyReady.clear();
  this.epoch=next;this.mesh.contentEpoch=next.id;this.mesh.allowLegacyContent=false;this.message=message;this.apply(layout);this.notice(`${this.session.state.name}: ${message}`);this.change();
 }
 tally(){
  const b=this.ballot;if(!b)return;
  if(!same(b.roster,this.roster())||this.creatorHere()||!this.ready())return this.membershipChanged();
  const yes=[...b.votes.values()].filter(Boolean).length,needed=Math.floor(b.roster.length/2)+1;
  if(yes>=needed&&b.ready.size===b.roster.length)this.finish({number:this.epoch.number+1,id:b.id},`${yes} of ${b.roster.length} voted for a fresh start.`,b.layout);
  else if(b.votes.size===b.roster.length&&yes<needed)this.cancelLocal('No majority this time. Your visit continues.');
  else this.change();
 }
 async receive(id,v){
  if(this.destroyed||!this.session.active||!this.session.members.has(id))return;
  if(v.type==='wipe-sync'){
   const e=v.epoch;if(!e||!Number.isSafeInteger(e.number)||e.number<0||e.number>100000||!(e.id==='initial'&&e.number===0||validId(e.id)))return;
   if(!this.session.state.owner&&e.number>=this.epoch.number){this.epoch=e;this.mesh.contentEpoch=e.id;if(e.number>0)this.mesh.allowLegacyContent=false;}
   else if(e.id!=='initial'&&e.id!==this.epoch.id&&e.number>=this.epoch.number){this.desynced=true;this.notice('This lounge was refreshed while you were away. Reopen it from Lounge options to catch up.');this.change();}
   return;
  }
  if(v.base!==this.epoch.id)return;
  if(v.type==='wipe-creator'){
   if(!v.next||v.next.number!==this.epoch.number+1||!validId(v.next.id))return;
   let layout;try{layout=design(v.layout);if(JSON.stringify(layout)!==JSON.stringify(v.layout))return;}catch{return;}
   const base=this.epoch.id;
   if(await verifyAuthority(this.mesh.creatorPublic,wipeStatement(this.mesh.room,base,v.next,layout),v.signature)&&!this.destroyed&&this.epoch.id===base)this.finish(v.next,'The creator gave this lounge a fresh start.',layout);
   return;
  }
  if(v.type==='wipe-cancel'){
   if(this.ballot?.id===v.proposal&&id===this.ballot.requester)this.cancelLocal('Vote withdrawn. Your visit continues.');
   return;
  }
  if(v.type==='wipe-request'){
   if(this.session.id!==this.coordinator()||this.creatorHere()||!this.ready()||this.ballot||!validId(v.request))return;
   this.broadcast({type:'wipe-propose',id:this.uid(),roster:this.roster(),requester:id,request:v.request,layout:this.layout()});return;
  }
  if(v.type==='wipe-propose'){
   if(id!==this.coordinator()||this.creatorHere()||!this.ready()||this.ballot||this.used.has(v.id)||!validId(v.id)||!validId(v.request)||!same(v.roster,this.roster())||!v.roster.includes(v.requester))return;
   let layout;try{layout=design(v.layout);if(JSON.stringify(layout)!==JSON.stringify(v.layout))return;}catch{return;}
   this.used.add(v.id);if(this.used.size>128)this.used.delete(this.used.values().next().value);
   this.message='';this.ballot={layout,ready:new Set([...(this.earlyReady.get(v.id)||[])].filter(id=>v.roster.includes(id))),id:v.id,roster:[...v.roster],requester:v.requester,votes:new Map([...(this.early.get(v.id)||[])].filter(([id])=>v.roster.includes(id)))};this.early.clear();this.earlyReady.clear();
   this.timer=setTimeout(()=>this.cancelLocal('Time is up. No wipe without a majority.'),60000);
   this.change(true);this.broadcast({type:'wipe-ready',proposal:v.id});
   if(v.requester===this.session.id&&v.request===this.pending)this.vote(true);else this.tally();
   return;
  }
  if(v.type==='wipe-ready'&&validId(v.proposal)){
   if(this.ballot?.id===v.proposal&&this.ballot.roster.includes(id)){this.ballot.ready.add(id);this.tally();}
   else if(!this.ballot&&!this.used.has(v.proposal)&&this.earlyReady.size<8){if(!this.earlyReady.has(v.proposal))this.earlyReady.set(v.proposal,new Set());this.earlyReady.get(v.proposal).add(id);}
   return;
  }
  if(v.type==='wipe-vote'&&validId(v.proposal)&&typeof v.yes==='boolean'){
   if(this.ballot?.id===v.proposal){
    if(this.ballot.roster.includes(id)&&!this.ballot.votes.has(id)){this.ballot.votes.set(id,v.yes);this.tally();}
   }else if(!this.ballot&&!this.used.has(v.proposal)&&this.early.size<8){
    if(!this.early.has(v.proposal))this.early.set(v.proposal,new Map());
    if(!this.early.get(v.proposal).has(id))this.early.get(v.proposal).set(id,v.yes);
   }
  }
 }
 destroy(){this.destroyed=true;clearTimeout(this.timer);this.ballot=null;this.early.clear();this.earlyReady.clear();this.mesh.creatorSecret='';}
}
