// battito.js · Neuro Movement Snack
// Lettura del battito condivisa dall'app e dal respiro guidato: fascia cardio Bluetooth (profilo standard)
// oppure dito sulla fotocamera posteriore con la torcia. Nessun dato esce dal dispositivo.
// Rivisto in modo indipendente (novembre 2026): vedi i commenti nei punti corretti.

const HR = {on:false, src:"none", beats:[], dev:null, cam:null, vid:null, torch:false, f:null, status:"", live:0, liveAt:0, rej:0};
const median = a => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
const hbSleep = ms => new Promise(r=>setTimeout(r,ms));

function addBeat(t, ibi, strict){
  if(ibi<330 || ibi>1500) return;                     // fuori da 40–180 battiti al minuto
  const b=HR.beats;
  if(strict && b.length>=5){                           // fotocamera: scarto i salti isolati
    const m=median(b.slice(-5).map(x=>x.ibi));
    if(Math.abs(ibi-m)>m*0.3){                         // accetto un ritmo nuovo solo se si ripete uguale
      HR.rej = (HR.rejIbi && Math.abs(ibi-HR.rejIbi)<ibi*0.15) ? HR.rej+1 : 1; HR.rejIbi=ibi;
      if(HR.rej<3) return; }
  }
  HR.rej=0; HR.rejIbi=0; b.push({t, ibi, hr:60000/ibi}); if(b.length>900) b.shift();
}
// Collegamento alla fascia: un solo ascoltatore per caratteristica; la disconnessione di una fascia vecchia
// non tocca quella nuova. La pagina può impostare HR.onDisconnect per avvisare.
async function hbConnect(){
  const dev = await navigator.bluetooth.requestDevice({filters:[{services:["heart_rate"]}]});
  const srv = await (await dev.gatt.connect()).getPrimaryService("heart_rate");
  const ch = await srv.getCharacteristic("heart_rate_measurement");
  if(!ch.__nms){ ch.__nms=true; ch.addEventListener("characteristicvaluechanged", e=>onHrm(e.target.value)); }
  await ch.startNotifications();
  if(!dev.__nms){ dev.__nms=true; dev.addEventListener("gattserverdisconnected", ()=>{ if(HR.dev!==dev) return; HR.dev=null; if(HR.onDisconnect) HR.onDisconnect(); }); }
  if(HR.dev && HR.dev!==dev) try{ HR.dev.gatt.disconnect(); }catch(e){}
  HR.dev=dev;
  return dev;
}
// Formato standard Bluetooth "Heart Rate Measurement": battito e, se c'è, intervalli tra battiti in 1/1024 s
function onHrm(dv){
  const now=performance.now(), f=dv.getUint8(0); let o=1;
  const hr = (f&1) ? dv.getUint16(o,true) : dv.getUint8(o); o += (f&1) ? 2 : 1;
  if(f&8) o+=2;
  const rr=[]; if(f&16) for(; o+1<dv.byteLength; o+=2) rr.push(dv.getUint16(o,true)*1000/1024);
  HR.live=hr; HR.liveAt=now;
  if(!HR.on) return;
  if(rr.length){ let t=now; for(let i=rr.length-1;i>=0;i--){ addBeat(t, rr[i], false); t-=rr[i]; } HR.beats.sort((a,b)=>a.t-b.t); }
  else if(hr>0 && !(f&16)) addBeat(now, 60000/hr, false); // solo fasce che non mandano mai gli intervalli: un valore al secondo
}

const torchCap = tr => { try{ return !!(tr && tr.getCapabilities && tr.getCapabilities().torch); }catch(e){ return false; } };
function openCam(deviceId){
  const base={width:{ideal:320}, height:{ideal:240}, frameRate:{ideal:30}};
  return navigator.mediaDevices.getUserMedia({audio:false, video: deviceId ? {...base, deviceId:{exact:deviceId}} : {...base, facingMode:{ideal:"environment"}}});
}
// accende la torcia e controlla che sia davvero accesa; null = probabilmente accesa ma il telefono non lo conferma
async function torchOn(tr){
  if(!tr) return false;
  for(let i=0;i<3;i++){
    try{ await tr.applyConstraints({advanced:[{torch:true}]}); }catch(e){}
    await hbSleep(350);
    try{ if(tr.getSettings().torch===true) return true; }catch(e){}
  }
  return torchCap(tr) ? null : false;
}
async function startCam(){
  let st = await openCam(), tr = st.getVideoTracks()[0];
  // telefoni con più fotocamere posteriori: cerco quella che ha il flash, aprendole una alla volta
  if(!torchCap(tr)){
    const first = tr.getSettings().deviceId;
    try{
      const devs = (await navigator.mediaDevices.enumerateDevices())
        .filter(d=>d.kind==="videoinput" && d.deviceId && d.deviceId!==first && !/front|anterior|user|selfie|frontale/i.test(d.label));
      if(devs.length){
        st.getTracks().forEach(t=>t.stop()); st=null;
        for(const d of devs){
          let s2; try{ s2=await openCam(d.deviceId); }catch(e){ continue; }
          if(torchCap(s2.getVideoTracks()[0])){ st=s2; break; }
          s2.getTracks().forEach(t=>t.stop());
        }
        if(!st) st = await openCam(first);
        tr = st.getVideoTracks()[0];
      }
    }catch(e){ if(!st){ st=await openCam(); tr=st.getVideoTracks()[0]; } }
  }
  const v=document.createElement("video"); v.muted=true; v.playsInline=true; v.setAttribute("playsinline",""); v.srcObject=st; await v.play();
  HR.track=tr; HR.camLabel=tr.label||""; HR.torchCap=torchCap(tr);
  HR.torch = await torchOn(tr);
  HR.cam=st; HR.vid=v; HR.fr=[]; HR.fps=0; HR.camAt=performance.now();
  const c=document.createElement("canvas"); c.width=32; c.height=24; HR.cx=c.getContext("2d",{willReadFrequently:true});
  HR.f={base:0, sm:0, prev:0, prev2:0, prevT:0, lastT:0, amp:0, lastPeak:0, ok:false, okSince:0};
  const step=()=>{ if(!HR.cam) return; camFrame();
    if(v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else setTimeout(step, 33); };
  step();
}
function camFrame(){
  if(HR.vid.readyState<2) return;
  HR.cx.drawImage(HR.vid,0,0,32,24);
  const d=HR.cx.getImageData(0,0,32,24).data; let r=0,g=0,b=0;
  for(let i=0;i<d.length;i+=4){ r+=d[i]; g+=d[i+1]; b+=d[i+2]; }
  const n=d.length/4, now=performance.now();
  const FR=HR.fr||(HR.fr=[]); FR.push(now); while(FR.length && now-FR[0]>2000) FR.shift(); HR.fps=FR.length/2;
  if(HR.debug){ const D=HR.dbg||(HR.dbg={frames:[]}); D.r=r/n; D.g=g/n; D.b=b/n; D.frames.push(now); while(D.frames.length && now-D.frames[0]>1000) D.frames.shift(); }
  ppgSample(now, r/n, g/n, b/n);
}
// Fotopletismografia: a ogni battito il dito si riempie di sangue e diventa un po' più scuro
function ppgSample(t, r, g, b){
  const F=HR.f, dt = F.lastT ? Math.min(0.2,(t-F.lastT)/1000) : 0.033; F.lastT=t;
  const finger = r>40 && r>g*1.6 && r>b*1.6;            // immagine quasi tutta rossa: il dito copre l'obiettivo
  if(!finger){ F.ok=false; HR.status="nofinger"; return; }
  if(!F.ok){ Object.assign(F,{ok:true, okSince:t, base:r, sm:0, prev:0, prev2:0, amp:0, lastPeak:0}); }
  // sotto i 15 fotogrammi al secondo il battito non si legge in modo affidabile: non conto
  if(t-F.okSince>2000 && HR.fps<15){ HR.status="slow"; F.lastPeak=0; return; }
  HR.status = t-F.okSince<5000 ? "warm" : "ok";
  F.base += (r-F.base)*(1-Math.exp(-dt/0.35));          // tolgo la deriva lenta, compresa quella del respiro
  F.sm += ((F.base-r)-F.sm)*(1-Math.exp(-dt/0.1));      // e il rumore veloce
  F.amp = Math.max(F.amp*Math.exp(-dt/2.5), Math.abs(F.sm));
  // finché non conosco il ritmo, almeno 500 ms tra due battiti: evita di contare due volte lo stesso battito
  const refr = HR.beats.length>=5 ? Math.max(330, 0.45*median(HR.beats.slice(-5).map(x=>x.ibi))) : 500;
  if(F.prev>F.prev2 && F.prev>=F.sm && F.prev>F.amp*0.4 && F.prevT-F.lastPeak>refr && t-F.okSince>2000){
    // il picco vero cade tra due fotogrammi: lo stimo con una parabola sui tre campioni
    const den=F.prev2-2*F.prev+F.sm, off = den<0 ? Math.max(-0.5,Math.min(0.5,0.5*(F.prev2-F.sm)/den)) : 0;
    const pt = F.prevT + off*(F.prev2T ? (t-F.prev2T)/2 : 0);
    if(F.lastPeak) addBeat(pt, pt-F.lastPeak, true);
    F.lastPeak=pt;
  }
  F.prev2=F.prev; F.prev2T=F.prevT; F.prev=F.sm; F.prevT=t;
}
function stopCam(){ try{ HR.cam?.getTracks().forEach(t=>t.stop()); }catch(e){} HR.cam=null; HR.vid=null; }
addEventListener("pagehide", ()=>{ stopCam(); try{ HR.dev?.gatt.disconnect(); }catch(e){} });

// battiti puliti: tolgo quelli lontani più del 20% dalla mediana dei 5 battiti attorno (errori di lettura,
// battiti saltati o doppi) e i doppioni con lo stesso istante. La variazione vera del battito col respiro resta.
function cleanBeats(b0){
  const out=[];
  for(let i=0;i<b0.length;i++){
    const m=median(b0.slice(Math.max(0,i-2),i+3).map(y=>y.ibi));
    if(Math.abs(b0[i].ibi-m)>m*0.2) continue;
    if(out.length && b0[i].t-out[out.length-1].t<1) continue;
    out.push(b0[i]);
  }
  return out;
}
// variabilità cardiaca a breve termine (RMSSD, in ms) sui battiti puliti; servono almeno 20 intervalli
function rmssd(beats){
  const b=cleanBeats(beats); if(b.length<21) return null;
  let s=0; for(let i=1;i<b.length;i++){ const d=b[i].ibi-b[i-1].ibi; s+=d*d; }
  return Math.sqrt(s/(b.length-1));
}
// battito medio dagli intervalli (non dalla media dei battiti istantanei, che lo sovrastima)
function hbMean(beats){
  const b=cleanBeats(beats); if(b.length<8) return null;
  return 60000/(b.reduce((a,x)=>a+x.ibi,0)/b.length);
}
