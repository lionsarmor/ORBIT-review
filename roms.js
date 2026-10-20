// Cartridge detection is separate from the engine, so rejected files never boot.
export const systems={
 nes:{name:'NES',core:'fceumm',players:2,extensions:'.nes',limit:16},
 snes:{name:'SNES',core:'snes9x',players:2,extensions:'.sfc, .smc',limit:16},
 n64:{name:'Nintendo 64',core:'mupen64plus_next',players:4,extensions:'.z64, .n64, .v64',limit:64},
 genesis:{name:'Genesis / Mega Drive',core:'picodrive',players:2,extensions:'.md, .gen, .bin',limit:16},
 atari:{name:'Atari 2600',core:'stella2014',players:2,extensions:'.a26, .bin',limit:1}
};
export function detectROM(name,b){
 const ext=name.split('.').pop().toLowerCase(),text=(a,z)=>String.fromCharCode(...b.subarray(a,z));
 if(['zip','7z','rar','gz'].includes(ext))throw Error('Your cartridge is still in its suitcase! Unzip it, then drop the ROM itself.');
 if(b.length<128)throw Error('That cartridge looks a little empty. Try a complete ROM file.');
 let system;
 if(text(0,4)==='NES\x1a'){
  if(!b[4]||b.length<16+b[4]*16384+b[5]*8192+((b[6]&4)?512:0))throw Error('This NES cartridge is missing a few pieces. Try a complete dump.');
  system='nes';
 }else if([[0x80,0x37,0x12,0x40],[0x37,0x80,0x40,0x12],[0x40,0x12,0x37,0x80]].some(a=>a.every((v,i)=>b[i]===v))&&b.length>=4096)system='n64';
 else if(text(0x100,0x104)==='SEGA')system='genesis';
 else if(['sfc','smc'].includes(ext)&&b.length>=32768&&[0x7fc0,0xffc0,0x40ffc0].some(base=>{
  const p=base+(b.length%1024===512?512:0);return p+64<=b.length&&(b[p+0x1c]|b[p+0x1d]<<8) !==0&&((b[p+0x1c]^b[p+0x1e])===255)&&((b[p+0x1d]^b[p+0x1f])===255);
 }))system='snes';
 else if(['a26','bin'].includes(ext)&&[2048,4096,8192,12288,16384,32768,65536].includes(b.length)&&(()=>{
  const reset=b[b.length-4]|b[b.length-3]<<8;return (reset&0xf000)===0xf000;
 })())system='atari';
 if(!system)throw Error('A cartridge from another galaxy! Try an NES, SNES, N64, Genesis or Atari 2600 ROM. This file isn’t a recognized cartridge for those systems.');
 if(b.length>systems[system].limit*1024*1024)throw Error('That cartridge is too big for this flight. Try a standard cartridge dump.');
 return system;
}
