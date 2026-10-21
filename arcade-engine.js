/* SPDX-License-Identifier: GPL-3.0-or-later
 * ORBIT adapter for EmulatorJS 4.2.3. Source is delivered with the player.
 * This document owns only a transient cartridge runtime, never a lounge key.
 */
window.orbitEngine={
 async boot({rom,core,name,onStarted,onError}){
  try{
   // No independent keyboard/gamepad routing or cartridge/save database.
   Object.defineProperty(navigator,'getGamepads',{value:()=>[]});
   Object.defineProperty(window,'indexedDB',{value:undefined});
   Object.defineProperty(navigator,'wakeLock',{value:undefined});
   for(const name of ['emulator','nipplejs','shaders','storage','gamepad','GameManager','socket.io.min','compression']){
    await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=`vendor/emulatorjs/src/${name}.js`;s.onload=resolve;s.onerror=()=>reject(Error('The cartridge player could not load. Please try again.'));document.head.append(s);});
   }
   // A real RAM mount lets the core unmount cleanly on window close. IDBFS
   // would persist cartridges/saves; an ordinary directory throws on unmount.
   EJS_GameManager.prototype.mountFileSystems=async function(){this.mkdir('/data');this.mkdir('/data/saves');this.FS.mount(this.FS.filesystems.MEMFS,{},'/data/saves');};
   const url=URL.createObjectURL(rom);this.url=url;
   const e=this.emulator=new EmulatorJS('#game',{
    gameUrl:url,gameName:name,system:core,dataPath:'vendor/emulatorjs/',
    disableDatabases:true,disableLocalStorage:true,noAutoFocus:true,startOnLoad:false,
    disableCue:true,threads:false,language:'en-US',volume:.65,
    defaultControllers:{0:{},1:{},2:{},3:{}},
    defaultOptions:{'virtual-gamepad':'disabled','save-save-interval':'0',webgl2Enabled:'enabled'},
    buttonOpts:{playPause:false,restart:false,saveState:false,loadState:false,gamepad:false,settings:false,fullscreen:false,exitEmulation:false,saveSavFiles:false,loadSavFiles:false,screenRecord:false}
   });
   e.on('ready',()=>{e.storage.states=new EJS_DUMMYSTORAGE();e.startButtonClicked(e.elements.parent.querySelector('.ejs_start_button'));});
   e.on('start',()=>{
    this.started=true;this.canvas=e.canvas;
    try{this.stream=e.collectScreenRecordingMediaTracks(e.canvas,30);}catch{this.stream=e.canvas.captureStream(30);}
    onStarted(this.stream);
   });
   const original=e.startGameError.bind(e);e.startGameError=message=>{original(message);onError('This cartridge didn’t boot: '+message);};
  }catch(error){onError(error.message);}
 },
 volume(value){const master=this.emulator?.Module?.AL?.currentCtx?.gain?.gain;if(master)master.value=value===0?0:1;},
 input(player,values){const m=this.emulator?.gameManager;if(!this.started||!m)return;for(let i=0;i<24;i++)m.simulateInput(player,i,values[i]||0);},
 resume(){const e=this.emulator;e?.Module?.AL?.currentCtx?.audioCtx?.resume().catch(()=>{});},
 snapshot(){return this.emulator.gameManager.getState();},
 restore(state){this.emulator.gameManager.loadState(state);},
 frames(){return this.emulator?.gameManager?.functions.getFrameNum()||0;},
 stop(){this.stream?.getTracks().forEach(t=>t.stop());if(this.url)URL.revokeObjectURL(this.url);}
};
