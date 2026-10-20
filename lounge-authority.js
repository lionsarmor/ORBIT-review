// A durable creator capability is separate from ephemeral chat/transport keys.
const encode=new TextEncoder();
const pack=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unpack=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function createAuthority(){
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 return {publicKey:pack(await crypto.subtle.exportKey('raw',key.publicKey)),secret:pack(await crypto.subtle.exportKey('pkcs8',key.privateKey))};
}
export async function signAuthority(secret,value){
 const key=await crypto.subtle.importKey('pkcs8',unpack(secret),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 return pack(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encode.encode(JSON.stringify(value))));
}
export async function verifyAuthority(publicKey,value,signature){
 try{
  if(!/^[-\w]{87}$/.test(publicKey)||!/^[-\w]{86}$/.test(signature))return false;
  const key=await crypto.subtle.importKey('raw',unpack(publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unpack(signature),encode.encode(JSON.stringify(value)));
 }catch{return false;}
}
export const presence=(room,id,key)=>['ORBIT creator presence',room,id,key];
export const wipeStatement=(room,base,next,layout)=>['ORBIT wipe live content',room,base,next,layout];
