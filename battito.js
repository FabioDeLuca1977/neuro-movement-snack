// battito.js · Neuro Movement Snack
// Lettura del battito condivisa dall'app e dal respiro guidato: fascia cardio Bluetooth (profilo standard)
// oppure dito sulla fotocamera posteriore con la torcia. Nessun dato esce dal dispositivo.
// Rivisto in modo indipendente (novembre 2026): vedi i commenti nei punti corretti.

const HR = {on:false, src:"none", beats:[], dev:null, cam:null, vid:null, torch:false, f:null, status:"", live:0, liveAt:0, rej:0};
const median = a => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
const hbSleep = ms => new Promise(r=>setTimeout(r,ms));

function addBeat(t, ibi, strict, rr){
  if(ibi<330 || ibi>1500) return;                     // fuori da 40–180 battiti al minuto
  const b=HR.beats;
  if(strict && b.length>=5){                           // fotocamera: scarto i salti isolati
    const m=median(b.slice(-5).map(x=>x.ibi));
    if(Math.abs(ibi-m)>m*0.3){                         // accetto un ritmo nuovo solo se si ripete uguale
      HR.rej = (HR.rejIbi && Math.abs(ibi-HR.rejIbi)<ibi*0.15) ? HR.rej+1 : 1; HR.rejIbi=ibi;
      if(HR.rej<3) return; }
  }
  HR.rej=0; HR.rejIbi=0; b.push({t, ibi, hr:60000/ibi, rr:!!rr}); if(b.length>900) b.shift();
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
  if(rr.length){ let t=now; for(let i=rr.length-1;i>=0;i--){ addBeat(t, rr[i], false, true); t-=rr[i]; } HR.beats.sort((a,b)=>a.t-b.t); }
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
  stopCam();
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
  if(!F.ok){ Object.assign(F,{ok:true, okSince:t, base:r, sm:0, prev:0, prev2:0, amp:0, lastPeak:0, lo:0, pp:0}); }
  // sotto i 15 fotogrammi al secondo il battito non si legge in modo affidabile: non conto
  if(t-F.okSince>2000 && HR.fps<15){ HR.status="slow"; F.lastPeak=0; return; }
  HR.status = t-F.okSince<5000 ? "warm" : "ok";
  F.base += (r-F.base)*(1-Math.exp(-dt/0.35));          // tolgo la deriva lenta, compresa quella del respiro
  F.sm += ((F.base-r)-F.sm)*(1-Math.exp(-dt/0.1));      // e il rumore veloce
  // altezza di ogni picco misurata dalla valle che lo precede: così la deriva lenta del respiro non conta
  F.lo = Math.min(F.lo, F.sm); F.pp *= Math.exp(-dt/3);
  // tempo minimo tra due battiti: 330 ms (180 battiti al minuto), poi il 45% del ritmo trovato.
  // Il doppio conteggio per l'onda dicrota lo evita già il confronto con l'altezza dei picchi.
  const refr = HR.beats.length>=5 ? Math.max(330, 0.45*median(HR.beats.slice(-5).map(x=>x.ibi))) : 330;
  if(F.prev>F.prev2 && F.prev>=F.sm){                        // un massimo locale
    const prom = F.prev - F.lo;
    if(t-F.okSince<=2000){ F.pp=Math.max(F.pp, prom); F.lo=F.prev; }   // i primi 2 s servono a conoscere l'ampiezza
    else if(prom > F.pp*0.5 && F.prevT-F.lastPeak>refr){
      // il picco vero cade tra due fotogrammi: lo stimo con una parabola sui tre campioni
      const den=F.prev2-2*F.prev+F.sm, off = den<0 ? Math.max(-0.5,Math.min(0.5,0.5*(F.prev2-F.sm)/den)) : 0;
      const pt = F.prevT + off*(F.prev2T ? (t-F.prev2T)/2 : 0);
      if(F.lastPeak) addBeat(pt, pt-F.lastPeak, true);
      F.lastPeak=pt; F.pp=Math.max(F.pp, prom); F.lo=F.prev;
    }
  }
  F.prev2=F.prev; F.prev2T=F.prevT; F.prev=F.sm; F.prevT=t;
}
function stopCam(){ try{ HR.cam?.getTracks().forEach(t=>t.stop()); }catch(e){} HR.cam=null; HR.vid=null; }
addEventListener("pagehide", ()=>{ stopCam(); try{ HR.dev?.gatt.disconnect(); }catch(e){} });

// battiti puliti. Uno sbaglio di lettura o un battito anticipato lascia un'impronta precisa: un intervallo corto
// seguito (o preceduto) da uno lungo, perché il tempo totale non cambia. Tolgo quindi:
// - gli intervalli oltre il 32% dalla mediana dei 5 attorno (battiti saltati o doppi);
// - quelli oltre il 12% con un vicino spostato nel verso opposto (la coppia corto-lungo).
// Così l'onda del respiro vera, anche molto ampia, resta. E tolgo i doppioni con lo stesso istante.
function cleanBeats(b0){
  const dev=b0.map((x,i)=>{ const m=median(b0.slice(Math.max(0,i-2),i+3).map(y=>y.ibi)); return (x.ibi-m)/m; });
  const out=[];
  for(let i=0;i<b0.length;i++){
    const d=dev[i];
    if(Math.abs(d)>0.32) continue;
    if(Math.abs(d)>0.12 && [dev[i-1],dev[i+1]].some(v=>v!==undefined && Math.sign(v)===-Math.sign(d) && Math.abs(v)>0.12)) continue;
    if(out.length && b0[i].t-out[out.length-1].t<1) continue;
    out.push(b0[i]);
  }
  return out;
}
// variabilità cardiaca a breve termine (RMSSD, in ms) sui battiti puliti; servono almeno 20 intervalli
function rmssd(beats){
  const b=cleanBeats(beats); if(b.length<21) return null;
  if(!b.every(x=>x.rr)) return null;                 // solo con gli intervalli veri della fascia, non dai battiti al minuto
  let s=0; for(let i=1;i<b.length;i++){ const d=b[i].ibi-b[i-1].ibi; s+=d*d; }
  return Math.sqrt(s/(b.length-1));
}
// battito medio dagli intervalli (non dalla media dei battiti istantanei, che lo sovrastima)
function hbMean(beats){
  const b=cleanBeats(beats); if(b.length<8) return null;
  return 60000/(b.reduce((a,x)=>a+x.ibi,0)/b.length);
}

// ---------- Misura di 1 minuto prima e dopo, condivisa da app e respiro guidato ----------
// Da seduti: 15 s per assestarsi e 45 s di misura. Negli esercizi intensi la misura "dopo" parte subito e dura 60 s:
// battito medio dei primi 10 s (picco) e degli ultimi 10 s, la differenza è il recupero.
const HB_SAFE = "Se hai aritmie, un pacemaker o prendi farmaci che agiscono sul battito (per esempio beta-bloccanti), questi numeri possono non avere senso: non usarli per giudicare come stai e, per dubbi sul tuo cuore, parlane con il medico.";
let hbJob=null;
function hbStopSensors(){ HR.on=false; stopCam(); }
function hbCancel(){ if(hbJob) hbJob.cancel=true; hbJob=null; hbStopSensors(); }
const hbR = v => v==null ? null : Math.round(v*10)/10;
let hbSeq=0;
// media di una finestra solo se i battiti la coprono davvero (almeno n battiti e span ms)
function hbWin(b, n, span){ const c=cleanBeats(b); return (c.length>=n && c[c.length-1].t-c[0].t>=span) ? hbMean(c) : null; }
async function hbMeasure(src, phase, k, el){
  hbCancel();
  const vigPost = phase==="post" && k==="vig";
  const settle = vigPost ? 0 : 15000, meas = vigPost ? 60000 : 45000;
  if(src==="ble" && !HR.dev){ el.innerHTML=`<p class="small">Collega prima la fascia.</p>`; return null; }
  HR.src=src; HR.beats=[]; HR.rej=0; HR.rejIbi=0; HR.status="";
  const job = hbJob = {cancel:false, id:++hbSeq};
  el.dataset.hbjob = String(job.id);
  const mine = () => el.dataset.hbjob===String(job.id);          // questo riquadro è ancora della mia misura?
  el.innerHTML=`<div class="hbrun"><p class="small hbPhase">Preparo il sensore…</p><p class="hbnow num">–</p><p class="small muted hbMsg"></p><button class="btn hbStop">Annulla</button></div>`;
  const q = c => el.querySelector("."+c);
  q("hbStop").onclick=()=>{ job.cancel=true; };
  // lo schermo resta acceso: con il dito sulla fotocamera nessuno lo tocca
  let wake=null; try{ wake = await navigator.wakeLock?.request("screen"); }catch(e){}
  const release = () => { try{ wake?.release(); }catch(e){} wake=null; };
  if(src==="cam"){
    try{ await startCam(); }
    catch(e){ release(); if(hbJob===job){ hbJob=null; HR.on=false; } if(mine()) el.innerHTML=`<p class="small">Fotocamera non disponibile: consenti l'accesso oppure usa la fascia.</p>`; return null; }
    const myCam = HR.cam;
    if(job.cancel || hbJob!==job){                                   // annullata mentre la fotocamera si accendeva
      release(); if(HR.cam===myCam) stopCam(); if(hbJob===job){ hbJob=null; HR.on=false; } if(mine()) el.innerHTML=""; return null; }
  }
  if(job.cancel || hbJob!==job){ release(); if(hbJob===job){ hbJob=null; hbStopSensors(); } if(mine()) el.innerHTML=""; return null; }
  HR.on=true;
  const t0=performance.now(); let mStart=null;
  return await new Promise(res=>{
    const iv=setInterval(()=>{
      const now=performance.now();
      if(job.cancel || hbJob!==job || !mine()){
        clearInterval(iv); release();
        if(hbJob===job){ hbJob=null; hbStopSensors(); }              // se un'altra misura ha preso il sensore, non lo tocco
        if(mine()) el.innerHTML="";
        res(null); return; }
      if(mStart===null && now-t0>=settle) mStart=now;
      const b=HR.beats, fresh=b.length>=3 && now-b[b.length-1].t<4000;
      q("hbnow").textContent = fresh ? Math.round(median(b.slice(-5).map(x=>x.hr)))+" battiti/min" : "–";
      q("hbPhase").textContent = mStart===null
        ? `Assestati: seduto, fermo, respiro normale · ${Math.ceil((settle-(now-t0))/1000)} s`
        : `Misura in corso · ${Math.ceil((meas-(now-mStart))/1000)} s`;
      q("hbMsg").textContent = src==="cam"
        ? (HR.status==="nofinger" ? "Appoggia il dito sulla fotocamera, coprendo anche il flash." :
           HR.status==="slow" ? "La fotocamera va troppo lenta su questo telefono: la misura non sarà affidabile." :
           HR.torch===false ? "Torcia spenta: tieni il dito vicino a una luce." : "")
        : (now-HR.liveAt>5000 ? "Non ricevo dati: controlla che la fascia tocchi bene la pelle." : "");
      if(mStart!==null && now-mStart>=meas){
        clearInterval(iv); release();
        const beats=HR.beats.filter(x=>x.t>=mStart);                // i battiti dell'assestamento non contano
        hbJob=null; hbStopSensors();
        let r=null;
        if(vigPost){
          // picco: i primi 10 s da quando il sensore legge; fine: gli ultimi 10 s
          const f = beats.length ? beats[0].t : mStart;
          const pk=hbWin(beats.filter(x=>x.t<f+10000), 6, 6000), end=hbWin(beats.filter(x=>x.t>=mStart+meas-10000), 6, 6000);
          if(pk!=null && end!=null) r={hr:hbR(end), pk:hbR(pk), rec:hbR(pk-end), rm:null};
        } else {
          const hr=hbWin(beats, 20, 30000);                           // almeno 20 battiti su 30 dei 45 secondi
          // da seduti oltre 140 è quasi sempre un doppio conteggio della fotocamera (onda dicrota marcata): non lo salvo
          if(hr!=null && !(src==="cam" && hr>140)) r={hr:hbR(hr), rm: src==="ble" ? hbR(rmssd(beats)) : null};
          else if(hr!=null && mine()){ el.innerHTML=`<p class="small">Valore poco plausibile da seduti (${Math.round(hr)} battiti/min): la fotocamera ha probabilmente contato due volte. Riprova appoggiando il dito più leggero.</p>`; res(null); return; }
        }
        if(!r && mine()) el.innerHTML=`<p class="small">Misura non riuscita: ho letto troppi pochi battiti. Riprova tenendo fermo il dito o controllando la fascia.</p>`;
        res(r);
      }
    }, 250);
  });
}
// risultato prima → dopo, in parole semplici
function hbResultHTML(p, r){
  const a=p.a, i=v=>Math.round(v), si=v=>(v>0?"+":v<0?"−":"")+Math.abs(Math.round(v));
  if(p.k==="vig") return `<div class="cells">
      <div class="cell"><b class="num">${i(a.hr)} → ${i(r.pk)}</b><span>BATTITO: PRIMA → SUBITO DOPO</span></div>
      <div class="cell"><b class="num">${si(-r.rec)}</b><span>NEL MINUTO DOPO (RECUPERO)</span></div></div>
    <p class="small muted">Il recupero si confronta con le tue volte precedenti, nel diario, non con altre persone.</p>`;
  return `<div class="cells">
      <div class="cell"><b class="num">${i(a.hr)} → ${i(r.hr)}</b><span>BATTITO: PRIMA → DOPO</span></div>
      ${a.rm!=null && r.rm!=null ? `<div class="cell"><b class="num">${i(a.rm)} → ${i(r.rm)}</b><span>VARIABILITÀ (MS)</span></div>` : ""}</div>
    <p class="small muted">${p.k==="move" ? "Il battito sale per il movimento: è normale." : "Una differenza di 2–3 battiti sta nel margine di errore: conta la tendenza nel diario."}</p>`;
}
