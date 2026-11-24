// Test del battito: eseguono il codice vero (battito.js e le funzioni del respiro guidato) con dati sintetici.
// Si lanciano dalla cartella del progetto con:  node --test
// Nessuna dipendenza: solo Node 18 o più recente.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CORE = fs.readFileSync(path.join(ROOT, "battito.js"), "utf8");
const RESP = fs.readFileSync(path.join(ROOT, "respiro.html"), "utf8");

// estrae una funzione dal sorgente del respiro guidato, per nome
function grab(src, name){
  const i = src.indexOf("function " + name + "("); if(i < 0) throw new Error("manca " + name);
  let j = src.indexOf("{", i), d = 0;
  for(let k = j; k < src.length; k++){ if(src[k] === "{") d++; else if(src[k] === "}"){ d--; if(!d) return src.slice(i, k + 1); } }
}

// un contesto pulito con battito.js caricato e le funzioni del respiro che servono
function env(phases = [{k:"in",l:"Inspira",s:4},{k:"out",l:"Espira",s:6}]){
  const ctx = {console, Math, Float64Array, Object, String, Array, JSON, Number, isFinite,
    performance:{now:()=>0}, addEventListener(){}, navigator:{}, document:{}, setTimeout, clearTimeout};
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx);
  vm.runInContext(`
    var P={phases:${JSON.stringify(phases)}}; var S=null;
    var CYCLE_S = P.phases.reduce((a,p)=>a+p.s,0), F0 = 1/CYCLE_S;
    var SY_LEVELS=["bassa","media","alta"], SY_MIN={media:1, alta:3}, SY_WIN=32000;
    ${["hrWaves","syncCompute","syLevel"].map(n=>grab(RESP, n)).join("\n")}
  `, ctx);
  const run = code => vm.runInContext(code, ctx);
  // i valori creati nel contesto isolato si confrontano passando da JSON
  run.json = code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, ctx));
  return {ctx, run};
}

// numeri casuali ripetibili
function rng(seed){ let s = seed >>> 0; const u = () => { s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
  u.n = () => Math.sqrt(-2*Math.log(u()+1e-12))*Math.cos(2*Math.PI*u()); return u; }
// battiti da un battito istantaneo hr(t secondi): [{t ms, ibi ms, hr}]
function beatsFrom(hrFn, durS){
  const out = []; let ph = 0, last = null; const dt = 0.001;
  for(let t = 0; t < durS; t += dt){ ph += hrFn(t)/60*dt;
    if(ph >= 1){ ph -= 1; const tm = t*1000; if(last !== null) out.push({t:tm, ibi:tm-last, hr:60000/(tm-last)}); last = tm; } }
  return out;
}
// fotocamera sintetica: livello del rosso fotogramma per fotogramma (il dito si scurisce a ogni battito)
function ppgFrames(hrFn, durS, {fps=30, jitter=0.3, dicrotic=0.4, dpos=0.5, dw=0.07, wander=0, seed=1} = {}){
  const u = rng(seed), out = []; let t = 0, ph = 0;
  while(t < durS){ const dt = (1 + (u()-0.5)*jitter)/fps; t += dt; ph += hrFn(t)/60*dt; const p = ph % 1;
    const pulse = Math.exp(-(((p-0.15)/0.06)**2)) + dicrotic*Math.exp(-(((p-dpos)/dw)**2));
    out.push({t:t*1000, r:180 - 3*pulse + wander*3*Math.sin(2*Math.PI*0.1*t) + u.n()*0.3}); }
  return out;
}
function runPpg(e, frames){
  e.run(`HR.beats=[]; HR.rej=0; HR.rejIbi=0; HR.fps=30; HR.f={base:0, sm:0, prev:0, prev2:0, prevT:0, lastT:0, amp:0, lastPeak:0, ok:false, okSince:0};`);
  e.ctx.__frames = frames;
  e.run(`for(const f of __frames) ppgSample(f.t, f.r, 40, 30);`);
  return e.run(`HR.beats.slice()`);
}
const dv = bytes => { const b = new ArrayBuffer(bytes.length); const v = new DataView(b); bytes.forEach((x,i)=>v.setUint8(i,x)); return v; };

// ---------- fascia Bluetooth ----------
test("fascia: battito a 8 bit e due intervalli RR", () => {
  const e = env(); e.run(`HR.on=true; HR.beats=[]; performance.now=()=>100000;`);
  e.ctx.__v = dv([0x10, 72, 0x00,0x04, 0x00,0x03]);            // RR 1024/1024 s e 768/1024 s
  e.run(`onHrm(__v)`);
  const b = e.run.json(`HR.beats.map(x=>Math.round(x.ibi))`);
  assert.deepEqual(b, [1000, 750]);
  assert.equal(e.run(`HR.live`), 72);
});
test("fascia: battito a 16 bit ed energia spesa saltata", () => {
  const e = env(); e.run(`HR.on=true; HR.beats=[]; performance.now=()=>5000;`);
  e.ctx.__v = dv([0x19, 0x2c,0x01, 0x10,0x00, 0x00,0x04]);      // HR 300 (16 bit), energia, RR 1 s
  e.run(`onHrm(__v)`);
  assert.equal(e.run(`HR.live`), 300);
  assert.deepEqual(e.run.json(`HR.beats.map(x=>Math.round(x.ibi))`), [1000]);
});
test("fascia: notifica con campo RR vuoto non inventa battiti", () => {
  const e = env(); e.run(`HR.on=true; HR.beats=[]; performance.now=()=>1000;`);
  e.ctx.__v = dv([0x10, 55]);
  e.run(`onHrm(__v)`);
  assert.equal(e.run(`HR.beats.length`), 0);
});
test("fascia senza intervalli: un battito dal valore medio", () => {
  const e = env(); e.run(`HR.on=true; HR.beats=[]; performance.now=()=>1000;`);
  e.ctx.__v = dv([0x00, 60]);
  e.run(`onHrm(__v)`);
  assert.deepEqual(e.run.json(`HR.beats.map(x=>Math.round(x.ibi))`), [1000]);
});

// ---------- pulizia, media, variabilità ----------
test("pulizia: battito anticipato (corto + lungo) scartato, gli altri tenuti", () => {
  const e = env(); const b = beatsFrom(()=>65, 40); const sh=b[15].ibi*0.3;
  b[15] = {...b[15], t:b[15].t-sh, ibi:b[15].ibi-sh}; b[15].hr=60000/b[15].ibi; b[16] = {...b[16], ibi:b[16].ibi+sh, hr:60000/(b[16].ibi+sh)};
  e.ctx.__b = b;
  const n = e.run(`cleanBeats(__b).length`);
  assert.equal(n, b.length - 2);
});
test("pulizia: tiene un'onda del respiro molto ampia (60 ± 20)", () => {
  const e = env(); e.ctx.__b = beatsFrom(t=>60+20*Math.sin(2*Math.PI*0.1*t), 60);
  const kept = e.run(`cleanBeats(__b).length`), tot = e.ctx.__b.length;
  assert.equal(kept, tot, `tenuti ${kept} su ${tot}`);
});
test("battito medio dagli intervalli, corretto entro mezzo battito", () => {
  const e = env(); const b = beatsFrom(t=>65+12*Math.sin(2*Math.PI*0.1*t), 100); e.ctx.__b = b;
  const vero = 60000*b.length/(b[b.length-1].t - b[0].t + b[0].ibi);
  assert.ok(Math.abs(e.run(`hbMean(__b)`) - vero) < 0.5);
});
test("RMSSD su una serie nota: 800/840 ms alternati danno 40 ms", () => {
  const e = env(); let t = 0; const b = [];
  for(let i = 0; i < 40; i++){ const ibi = i%2 ? 840 : 800; t += ibi; b.push({t, ibi, hr:60000/ibi, rr:true}); }
  e.ctx.__b = b;
  assert.ok(Math.abs(e.run(`rmssd(__b)`) - 40) < 1e-9);
  e.ctx.__b = b.slice(0, 15);
  assert.equal(e.run(`rmssd(__b)`), null);               // troppo pochi battiti
});
test("RMSSD: niente variabilità se la fascia non manda gli intervalli veri", () => {
  const e = env(); let t = 0; const b = [];
  for(let i = 0; i < 40; i++){ const ibi = 60000/(61 + i%4); t += 1000; b.push({t, ibi, hr:60000/ibi, rr:false}); }
  e.ctx.__b = b; assert.equal(e.run(`rmssd(__b)`), null);
});

// ---------- sintonia respiro-battito ----------
test("sintonia: cuore che segue il respiro a 6 al minuto → alta", () => {
  const e = env(); const b = beatsFrom(t=>68+6*Math.sin(2*Math.PI*0.1*t), 40); e.ctx.__b = b;
  const r = e.run(`syncCompute(__b[__b.length-1].t, __b)`);
  assert.equal(e.run(`syLevel(${r.ratio})`), "alta");
});
test("sintonia: respiro normale (15 al minuto) → bassa", () => {
  const e = env(); const b = beatsFrom(t=>68+3*Math.sin(2*Math.PI*0.25*t), 40); e.ctx.__b = b;
  const r = e.run(`syncCompute(__b[__b.length-1].t, __b)`);
  assert.equal(e.run(`syLevel(${r.ratio})`), "bassa");
});
test("sintonia: battito irregolare non arriva mai ad alta", () => {
  const e = env(); let alta = 0;
  for(let s = 1; s <= 20; s++){ const u = rng(s); let w = 0;
    const b = beatsFrom(()=>{ w = 0.999*w + u.n()*0.05; return 68 + w; }, 40); e.ctx.__b = b;
    const r = e.run(`syncCompute(__b[__b.length-1].t, __b)`);
    if(r && !r.bad && e.run(`syLevel(${r.ratio})`) === "alta") alta++; }
  assert.equal(alta, 0);
});
test("sintonia: istanti doppi non danno NaN", () => {
  const e = env(); const b = beatsFrom(t=>68+6*Math.sin(2*Math.PI*0.1*t), 40); b.splice(1, 0, {...b[0]}); e.ctx.__b = b;
  const r = e.run(`syncCompute(__b[__b.length-1].t, __b)`);
  assert.ok(Number.isFinite(r.ratio) && r.ratio > 3);
});
test("sintonia: un buco vero di 4 s nel segnale → interrotto", () => {
  const e = env(); const b = beatsFrom(t=>68+6*Math.sin(2*Math.PI*0.1*t), 40).filter(x=>x.t<15000 || x.t>19000); e.ctx.__b = b;
  assert.deepEqual(e.run.json(`syncCompute(__b[__b.length-1].t, __b)`), {bad:true});
});
test("sospiro ciclico: frequenza della guida 1/9,5 s", () => {
  const e = env([{k:"in",s:2.5},{k:"in",s:1},{k:"out",s:6}]);
  assert.ok(Math.abs(e.run(`F0`) - 1/9.5) < 1e-12);
});

// ---------- onda del respiro nel battito ----------
test("onda: un respiro con la pausa non entra nel conto", () => {
  const e = env();
  e.ctx.__b = beatsFrom(t => (t>25 && t<45) ? 72+6*Math.sin(2*Math.PI*0.25*t)+0.4*(t-25) : 66+5*Math.sin(2*Math.PI*0.1*t), 100);
  e.run(`HR.src="ble"; HR.beats=__b; S={cyc:[0,10000,20000,50000,60000], pauses:[{a:25000,b:45000}]};`);
  const w = e.run(`hrWaves()`);
  assert.equal(w.length, 3);
  w.forEach(x => assert.ok(Math.abs(x - 9.8) < 0.5, `onda ${x}`));
});

// ---------- fotocamera ----------
test("fotocamera: battito costante a 72, letto entro 1 battito", () => {
  const e = env(); const b = runPpg(e, ppgFrames(()=>72, 60));
  e.ctx.__b = b; assert.ok(Math.abs(e.run(`hbMean(__b)`) - 72) < 1);
});
// onda dicrota realistica: sulla discesa del battito. Limite noto: con un picco secondario grande e separato,
// a 50–60 battiti, la fotocamera può contare il doppio; la misura da seduti lo scarta oltre 140.
test("fotocamera: onda dicrota forte (80%) a 55 battiti non raddoppia il conto", () => {
  const e = env(); const b = runPpg(e, ppgFrames(()=>55, 60, {dicrotic:0.8, dpos:0.35, dw:0.1}));
  e.ctx.__b = b; assert.ok(Math.abs(e.run(`hbMean(__b)`) - 55) < 2);
});
test("fotocamera: salto da 58 a 105 battiti, poi segue il ritmo nuovo", () => {
  const e = env(); const b = runPpg(e, ppgFrames(t => t<20 ? 58 : 105, 50));
  e.ctx.__b = b.filter(x => x.t > 35000); assert.ok(Math.abs(e.run(`hbMean(__b)`) - 105) < 3);
});
test("fotocamera: deriva del respiro una volta e mezza il battito, quasi tutti i battiti letti", () => {
  for(const seed of [1,2,3]){
    const e = env(); const b = runPpg(e, ppgFrames(t=>66+6*Math.sin(2*Math.PI*0.1*t), 62, {wander:1.5, seed}));
    assert.ok(b.length >= 62, `seme ${seed}: battiti letti ${b.length} su circa 65`); }
});
test("pulizia: battito saltato dalla fotocamera (intervallo doppio) scartato", () => {
  const e = env(); const b = beatsFrom(()=>65, 40); b[20] = {...b[21], ibi:b[20].ibi+b[21].ibi}; b[20].hr=60000/b[20].ibi; b.splice(21,1);
  e.ctx.__b = b; assert.equal(e.run(`cleanBeats(__b).length`), b.length - 1);
});

// ---------- esercizi intensi: picco e recupero con la fotocamera ----------
test("fotocamera, esercizio intenso da 170 a 110: picco e recupero vicini al vero", () => {
  const hrAt = t => 110 + 60*Math.exp(-t/40);                  // t in secondi
  const e = env(); const b = runPpg(e, ppgFrames(hrAt, 60));
  e.ctx.__b = b;
  const f = b[0].t;
  const pk = e.run(`hbWin(__b.filter(x=>x.t<${f}+10000), 6, 6000)`), end = e.run(`hbWin(__b.filter(x=>x.t>=50000), 6, 6000)`);
  const mean = (a, z) => { let s = 0, n = 0; for(let t = a; t < z; t += 0.1){ s += hrAt(t); n++; } return s/n; };
  const veroPk = mean(f/1000, f/1000 + 10), veroEnd = mean(50, 60);
  assert.ok(Math.abs(pk - veroPk) < 4, `picco ${pk} contro ${veroPk.toFixed(1)}`);
  assert.ok(Math.abs(end - veroEnd) < 2, `fine ${end} contro ${veroEnd.toFixed(1)}`);
});
test("fotocamera: 130 battiti costanti, nessun dimezzamento", () => {
  const e = env(); const b = runPpg(e, ppgFrames(()=>130, 45));
  e.ctx.__b = b; assert.ok(Math.abs(e.run(`hbMean(__b)`) - 130) < 2);
});
test("misura: finestra coperta solo in parte non vale", () => {
  const e = env(); e.ctx.__b = beatsFrom(()=>70, 12);             // 12 s su 45
  assert.equal(e.run(`hbWin(__b, 20, 30000)`), null);
});
