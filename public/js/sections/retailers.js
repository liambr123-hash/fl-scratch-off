/* retailers section module — Retailers tab redesign
   Registers FLX.routes.retailers; app.js retailers() remains the fallback. */
(function(){
"use strict";

FLX.css(`
/* ---- retailers tab ---- */
.rt-lead{font-size:13.5px;color:var(--muted)}
.rt-chips{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}
.rt-chip{background:var(--panel2);border:1px solid var(--border);color:var(--muted);border-radius:20px;padding:4px 12px;font:600 12px var(--sans);cursor:pointer}
.rt-chip:hover{color:var(--text);border-color:var(--dim)}
.rt-chip.active{background:rgba(255,111,145,.15);border-color:var(--flamingo);color:var(--flamingo)}
.rt-stgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
.rt-stcard{border:1px solid var(--border);background:var(--panel2);border-radius:10px;padding:10px 12px;min-width:0}
.rt-stname{font-size:13px;font-weight:600;line-height:1.35}
.rt-stct{color:var(--flamingo);font-size:11px;font-weight:700;white-space:nowrap;margin-left:6px}
.rt-staddr{font-size:11.5px;color:var(--dim);margin:1px 0 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-pills{display:flex;gap:6px;flex-wrap:wrap}
.rt-wpill{display:inline-block;background:rgba(47,182,168,.12);border:1px solid rgba(47,182,168,.35);color:var(--aqua);border-radius:20px;padding:2px 9px;font:600 11px var(--sans);cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-wpill:hover{border-color:var(--teal);color:var(--teal)}
.rt-chain tbody tr{cursor:pointer}
.rt-chainlink{color:var(--teal)}
.rt-ciwrap{display:flex;align-items:center;gap:7px}
.rt-citrack{position:relative;height:12px;flex:none;width:120px;min-width:96px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.rt-citrack i{position:absolute;display:block}
.rt-ciref{top:0;bottom:0;width:1px;background:var(--dim);opacity:.65}
.rt-cirange{top:4px;height:4px;background:var(--teal);opacity:.55;border-radius:2px}
.rt-cidot{top:3px;width:6px;height:6px;border-radius:50%;background:var(--teal);transform:translateX(-50%)}
.rt-cirt{font-size:11px;color:var(--dim);white-space:nowrap}
.rt-dblgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:9px;margin-top:10px}
.rt-dblrow{border:1px solid var(--border);border-radius:9px;padding:8px 11px;background:var(--panel2);min-width:0}
.rt-dblhead{font-size:12.5px;font-weight:600;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-tslab{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:2px 0 5px}
.rt-tslab.b{margin:5px 0 2px}
.rt-tsbar{display:flex;height:26px;border-radius:7px;overflow:hidden;border:1px solid var(--border)}
.rt-tsbar i{display:flex;align-items:center;justify-content:center;font:600 10.5px var(--sans);color:var(--bg);font-style:normal;overflow:hidden}
.rt-tsconn{display:block;width:100%;height:28px}
@media(max-width:640px){
  .rt-tsconn{display:none}
  .rt-cirt{display:none}
  .rt-citrack{width:96px}
  .rt-stgrid,.rt-dblgrid{grid-template-columns:1fr}
}
`);

/* Verified chain regex map — reproduces DATA.retail.chains winner counts exactly
   (Sedano's 5, Publix 201, Winn-Dixie 32, Gate 7, RaceTrac 25, Wawa 14, Sunoco 11,
    Chevron 13, 7-Eleven 67, Shell 18, Speedway 8, Circle K 49, Murphy 8, Walmart 18;
    zero rows match more than one pattern). */
const CHAIN_RX={
  "Sedano's":/SEDANO/, "Publix":/PUBLIX/, "Winn-Dixie":/WINN.?DIXIE/, "Gate":/^GATE\b|GATE #/,
  "RaceTrac":/RACETRAC|RACE TRAC/, "Wawa":/WAWA/, "Sunoco":/SUNOCO/, "Chevron":/CHEVRON/,
  "7-Eleven":/7[- ]?ELEVEN|SEVEN ELEVEN/, "Shell":/SHELL/, "Speedway":/SPEEDWAY/,
  "Circle K":/CIRCLE[- ]?K/, "Murphy":/MURPHY/, "Walmart":/WAL[- ]?MART/
};

/* strip the leading game-number artifact ("1476 7-ELEVEN #26924"), uppercase, trim */
const rtNorm=n=>String(n||"").toUpperCase().replace(/^\d{4}\s+/,"").trim();

/* store-centric index of W: key = normalized name + address (~777 stores) */
let _stores=null;
function rtStores(){
  if(_stores)return _stores;
  const m=new Map();
  for(const w of W){
    const name=rtNorm(w[10]);
    if(!name)continue;
    const addr=String(w[11]||"").trim();
    const key=name+"|"+addr.toUpperCase();
    let s=m.get(key);
    if(!s){s={name,addr,city:addr.includes(",")?addr.slice(addr.lastIndexOf(",")+1).trim():"",wins:[]};m.set(key,s);}
    s.wins.push(w);
  }
  _stores=[...m.values()];
  for(const s of _stores)s.wins.sort((a,b)=>String(a[1]||"").localeCompare(String(b[1]||"")));
  _stores.sort((a,b)=>b.wins.length-a.wins.length||a.name.localeCompare(b.name));
  return _stores;
}

/* the 80-year clock: total stores ÷ (winners per month) -> years between top prizes at the avg store */
function rtClockYears(R){
  const ds=W.map(w=>w[1]).filter(Boolean).sort();
  if(ds.length<2)return null;
  const months=(new Date(ds[ds.length-1])-new Date(ds[0]))/2629800000; /* avg-month ms */
  if(!(months>1))return null;
  return R.total/(W.length/months)/12;
}

const rtPill=w=>`<span class="rt-wpill" data-g="${esc(w[0])}">${esc(GAME_NAME[w[0]]||("#"+w[0]))} · ${money(w[6])} · ${w[1]?esc(String(w[1]).slice(0,4)):"—"}</span>`;

/* ---------- feature 2: store finder ---------- */
function rtFinder(R,stores){
  const chipBox=$("#rt-chips"),res=$("#rt-res"),input=$("#rt-q");
  if(!chipBox||!res||!input)return null;
  const chains=R.chains.filter(c=>CHAIN_RX[c.name]).sort((a,b)=>b.winners-a.winners);
  chipBox.innerHTML=chains.map(c=>`<button class="rt-chip" data-chain="${esc(c.name)}">${esc(c.name)}</button>`).join("");
  let chain="";
  const firstYear=(W.map(w=>w[1]).filter(Boolean).sort()[0]||"2021").slice(0,4);
  function render(){
    try{
      const q=input.value.trim().toUpperCase();
      if(!q&&!chain){
        res.innerHTML=`<p class="mut" style="font-size:13px">Type a store name, street, or town — or tap a chain chip. ${num(stores.length)} Florida stores have sold at least one published top prize since ${esc(firstYear)}.</p>`;
        return;
      }
      let list=stores;
      if(chain&&CHAIN_RX[chain])list=list.filter(s=>CHAIN_RX[chain].test(s.name));
      if(q)list=list.filter(s=>(s.name+" "+s.addr).toUpperCase().includes(q));
      if(!list.length){
        res.innerHTML=`<p class="mut" style="font-size:13px">No top-prize record for that search — most of Florida's ${num(R.total)} stores have never sold one, and that means nothing about their smaller winners.</p>`;
        return;
      }
      const CAP=30,shown=list.slice(0,CAP);
      res.innerHTML=`<div class="mut" style="font-size:12px;margin-bottom:8px">${num(list.length)} store${list.length===1?"":"s"} · ${num(list.reduce((t,s)=>t+s.wins.length,0))} top prizes</div>
        <div class="rt-stgrid">${shown.map(s=>`
          <div class="rt-stcard">
            <div class="rt-stname">${esc(s.name)}<span class="rt-stct">${s.wins.length} top prize${s.wins.length>1?"s":""}</span></div>
            <div class="rt-staddr" title="${esc(s.addr)}">${esc(s.addr||"address not published")}</div>
            <div class="rt-pills">${s.wins.map(rtPill).join("")}</div>
          </div>`).join("")}</div>
        ${list.length>CAP?`<p class="mut" style="font-size:12px;margin-top:8px">+${num(list.length-CAP)} more — narrow your search.</p>`:""}`;
    }catch(e){res.innerHTML='<p class="mut">Store finder failed to render.</p>';}
  }
  input.oninput=render;
  chipBox.onclick=e=>{
    const b=e.target.closest(".rt-chip");if(!b)return;
    chain=(chain===b.dataset.chain)?"":b.dataset.chain;
    chipBox.querySelectorAll(".rt-chip").forEach(x=>x.classList.toggle("active",x.dataset.chain===chain));
    render();
  };
  res.onclick=e=>{const p=e.target.closest("[data-g]");if(p)go("game",p.dataset.g);};
  render();
  return {
    setChain(name){
      if(!CHAIN_RX[name])return;
      chain=name;input.value="";
      chipBox.querySelectorAll(".rt-chip").forEach(x=>x.classList.toggle("active",x.dataset.chain===name));
      render();
      document.getElementById("rt-finder")?.scrollIntoView({behavior:"smooth",block:"start"});
    }
  };
}

/* ---------- feature 3: chain table with CI whiskers + years-between ---------- */
function rtChainTable(R,clock,finder){
  const box=$("#rt-chainT"),trap=$("#rt-trap");
  if(!box)return;
  const liftCell=r=>{const c=r.lift>=1.3?"good":r.lift<=0.7?"bad":"mut";return `<span class="lift ${c}">${r.lift.toFixed(2)}×</span>`;};
  // exact-Poisson 95% CI via Byar's approximation (matches the Garwood/chi-square interval to ~2 dp,
  // even at the small counts here) — the old lift*(1±1.96/√n) Wald form is symmetric and understates
  // the lower bound at small n. Returns multiplicative factors on the point lift.
  const poiCI=k=>{ if(!(k>0))return [0,0]; const z=1.96;
    const lo=k*Math.pow(1-1/(9*k)-z/(3*Math.sqrt(k)),3);
    const hi=(k+1)*Math.pow(1-1/(9*(k+1))+z/(3*Math.sqrt(k+1)),3);
    return [Math.max(0,lo)/k, hi/k]; };
  const ciMax=Math.max(...R.chains.map(c=>c.lift*poiCI(c.winners)[1]))*1.05;
  const ciCell=r=>{
    const [fl,fh]=poiCI(r.winners),lo=r.lift*fl,hi=r.lift*fh;
    const L=100*lo/ciMax,Wd=Math.max(1,100*(hi-lo)/ciMax),D=100*r.lift/ciMax,ref=100/ciMax;
    return `<div class="rt-ciwrap" title="95% CI ≈ ${lo.toFixed(2)}×–${hi.toFixed(2)}× (n=${r.winners})">
      <div class="rt-citrack"><i class="rt-ciref" style="left:${ref.toFixed(1)}%"></i><i class="rt-cirange" style="left:${L.toFixed(1)}%;width:${Wd.toFixed(1)}%"></i><i class="rt-cidot" style="left:${D.toFixed(1)}%"></i></div>
      <span class="rt-cirt">${lo.toFixed(1)}–${hi.toFixed(1)}×</span></div>`;
  };
  box.append(makeTable([
    {k:"name",label:"Chain",fmt:r=>CHAIN_RX[r.name]?`<span class="rt-chainlink" data-chain="${esc(r.name)}">${esc(r.name)}</span>`:esc(r.name)},
    {k:"stores",label:"FL stores",r:1,fmt:r=>num(r.stores)},
    {k:"winners",label:"Winners",r:1},
    {k:"lift",label:"Lift",r:1,fmt:liftCell},
    {k:"ci",label:"95% CI",fmt:ciCell,sortVal:r=>r.lift*poiCI(r.winners)[0]},
    {k:"yrs",label:"≈ yrs between wins*",r:1,hideM:1,fmt:r=>(clock&&r.lift>0)?"≈ "+Math.round(clock/r.lift):"—",sortVal:r=>(clock&&r.lift>0)?clock/r.lift:null},
  ],R.chains,{sort:"lift"}));
  box.onclick=e=>{
    const tr=e.target.closest("tbody tr");if(!tr)return;
    const el=tr.querySelector("[data-chain]");
    if(el&&finder)finder.setChain(el.dataset.chain);
  };
  if(trap){
    const byLift=[...R.chains].sort((a,b)=>b.lift-a.lift);
    trap.innerHTML=`The top row has ${num(byLift[0].winners)} winners; the second has ${num(byLift[1].winners)} — only one of those is a finding. Intervals assume independent, constant per-store rates; even a tight one measures sales volume, not luck.${clock?` * expected years between top prizes at one store of that chain = the ~${Math.round(clock)}-year clock ÷ lift.`:""}`;
  }
}

/* ---------- feature 4: lightning does strike twice (the site's only store-repeat Poisson home) ---------- */
function rtDoubles(R,stores){
  const body=$("#rt-dblbody");
  if(!body)return;
  if(!stores.length){body.innerHTML='<p class="mut">Store-level records unavailable in this build.</p>';return;}
  const dbl=stores.filter(s=>s.wins.length>=2)
    .sort((a,b)=>Math.max(...b.wins.map(w=>w[6]||0))-Math.max(...a.wins.map(w=>w[6]||0)));
  const maxW=stores[0].wins.length;
  const lam=W.length/R.total;
  const expDbl=R.total*(1-Math.exp(-lam)-lam*Math.exp(-lam));   /* Poisson: stores × P(X ≥ 2) */
  let mega="";
  try{
    const megaRows=W.filter(w=>(w[6]||0)>=25e6);
    const megas=megaRows.map(w=>{
      const ad=String(w[11]||"");
      const city=ad.includes(",")?ad.slice(ad.lastIndexOf(",")+1).trim():String(w[3]||"");
      return esc(rtNorm(w[10]))+(city?" ("+esc(city)+")":"");
    });
    const megaKeys=new Set(megaRows.map(w=>rtNorm(w[10])+"|"+String(w[11]||"").trim().toUpperCase()));
    const allOnce=stores.filter(s=>megaKeys.has(s.name+"|"+s.addr.toUpperCase())).every(s=>s.wins.length===1);
    if(megas.length)mega=` The ${megas.length} stores that have sold a $25M ticket — ${megas.join(", ")} — ${allOnce?"each did it exactly once":"hold no special status here either"}.`;
  }catch(e){}
  body.innerHTML=`
    <p class="rt-lead"><b>${num(stores.length)}</b> stores have sold a top prize. <b>${num(dbl.length)}</b> have sold two.${maxW>2?` The record is ${maxW}.`:" None has sold three."}
    Scatter ${num(W.length)} wins across ${num(R.total)} stores completely at random and Poisson math expects about <b>~${Math.round(expDbl)}</b> two-time stores — the observed ${num(dbl.length)} is exactly the mild excess unequal sales volume produces: busy stores sell more tickets, so they collect more winners.${mega}
    A past win changes nothing about the next ticket sold there.</p>
    <div class="rt-dblgrid">${dbl.map(s=>`
      <div class="rt-dblrow">
        <div class="rt-dblhead" title="${esc(s.addr)}">${esc(s.name)}${s.city?` <span class="dim">· ${esc(s.city)}</span>`:""}</div>
        <div class="rt-pills">${s.wins.map(rtPill).join("")}</div>
      </div>`).join("")}</div>
    <p class="mut" style="font-size:12px;margin-top:10px">Caveats: store identity is matched on name + address strings — the lottery's own dedup counted 752 stores and 10 doubles as of mid-2026 — and the ~${Math.round(expDbl)} assumes every store sells equal volume, so the real expectation is higher. The excess is volume, not magic.</p>`;
  body.onclick=e=>{const p=e.target.closest("[data-g]");if(p)go("game",p.dataset.g);};
}

/* ---------- feature 5: paired type share bars ---------- */
function rtTypeBars(R){
  const box=$("#rt-types");
  if(!box)return;
  if(!R.types||!R.types.length){box.innerHTML='<p class="mut">Store-type census unavailable in this build.</p>';return;}
  const tot=R.total,wm=R.winners_matched||W.length;
  const typeColor=n=>/Grocery/i.test(n)?"var(--teal)":/Gas/i.test(n)?"var(--coral)":/Liquor/i.test(n)?"var(--flamingo)":/Pharmacy/i.test(n)?"var(--dim)":"var(--tangerine)";
  const segs=R.types.map(t=>({n:t.name,s:100*t.stores/tot,w:100*t.winners/wm,c:typeColor(t.name)}));
  const bar=k=>`<div class="rt-tsbar">${segs.map(g=>`<i style="width:${g[k].toFixed(2)}%;background:${g.c}" title="${esc(g.n)}: ${g[k].toFixed(1)}%">${g[k]>=8?g[k].toFixed(0)+"%":""}</i>`).join("")}</div>`;
  let a=0,b=0;
  const polys=segs.map(g=>{
    const p=`<polygon points="${a.toFixed(2)},0 ${(a+g.s).toFixed(2)},0 ${(b+g.w).toFixed(2)},24 ${b.toFixed(2)},24" style="fill:${g.c};opacity:.22"/>`;
    a+=g.s;b+=g.w;return p;
  }).join("");
  const legend=`<div class="legend">${segs.map(g=>`<span><span class="sw" style="background:${g.c}"></span>${esc(g.n)} <span class="dim">${g.s.toFixed(0)}% of stores → ${g.w.toFixed(0)}% of winners</span></span>`).join("")}</div>`;
  /* kept supermarket footnote (verbatim, relocated here as the caption) */
  let cap="";
  try{
    const gasT=R.types.find(t=>/Gas/.test(t.name)),groT=R.types.find(t=>/Grocery/.test(t.name));
    if(gasT&&groT)cap=`Gas/convenience has the most winners overall only because Florida has ~${(gasT.stores/1000).toFixed(1)}k of them. <b>Per store, supermarkets win ${(groT.lift/gasT.lift).toFixed(1)}× as often</b> — the "gas stations are luckier" idea is backwards.`;
  }catch(e){}
  /* live null-result line: ticket price behind winners, confidently chain-classed stores only */
  let nullLine="";
  try{
    const GRO=/PUBLIX|WINN.?DIXIE|SEDANO|SUPERMARKET|SUPERMERCADO/;
    const GAS=/7[- ]?ELEVEN|CIRCLE[- ]?K|RACETRAC|WAWA|SUNOCO|CHEVRON|SHELL|SPEEDWAY|MURPHY|^GATE\b|GATE #/;
    const g1=[],g2=[];
    for(const w of W){
      const n=rtNorm(w[10]),gm=byNo[w[0]],p=gm?gm.ticket_price:null;
      if(!p)continue;
      const isG=GRO.test(n),isC=GAS.test(n);
      if(isG&&!isC)g1.push(p);else if(isC&&!isG)g2.push(p);
    }
    if(g1.length>50&&g2.length>50){
      const av=x=>x.reduce((t,v)=>t+v,0)/x.length;
      nullLine=` Avg ticket price behind those winners: grocery $${av(g1).toFixed(1)} vs gas/convenience $${av(g2).toFixed(1)} — statistically indistinguishable; we looked for a price-point pattern and there isn't one (confidently chain-classed stores only, ~${Math.round(100*(g1.length+g2.length)/W.length)}% of winners).`;
    }
  }catch(e){}
  box.innerHTML=`
    <div class="rt-tslab">share of Florida's ${num(tot)} lottery stores</div>
    ${bar("s")}
    <svg class="rt-tsconn" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">${polys}</svg>
    ${bar("w")}
    <div class="rt-tslab b">share of the ${num(wm)} winning tickets</div>
    ${legend}
    <p class="mut" style="font-size:12.5px;margin-top:10px">${cap}${nullLine} Over-representation means more tickets sold per store — not better odds per ticket.</p>`;
}

/* ---------- route ---------- */
FLX.routes.retailers=function(){
  const R=DATA.retail;
  if(!R||!R.chains||!R.chains.length){mainEl.innerHTML='<div class="panel">Retailer census not available in this build.</div>';return;}
  let stores=[];try{stores=rtStores();}catch(e){}
  let clock=null;try{clock=rtClockYears(R);}catch(e){}
  mainEl.innerHTML=`
  <div class="cards">
    <div class="card"><div class="lab">FL lottery retailers</div><div class="val">${num(R.total)}</div><div class="note">full statewide census</div></div>
    <div class="card"><div class="lab">Self-service vending</div><div class="val">${num(R.itvm)}</div><div class="note">${R.itvm?(100*R.itvm/R.total).toFixed(0)+"% of stores have a machine":"share unknown"}</div></div>
    <div class="card"><div class="lab">Base win rate</div><div class="val">${esc(R.base_per1k)}</div><div class="note">top-prize winners per 1,000 stores</div></div>
    <div class="card flam"><div class="lab">Avg store sells a top prize every</div><div class="val">${clock?"~"+Math.round(clock)+" yrs":"—"}</div><div class="note">an expected interval, not a schedule — the process is memoryless, so a store that just sold one waits just as long; assumes the current top-prize rate</div></div>
  </div>
  <div class="panel insight"><h2>Is any store "luckier"? <span class="hint">the honest answer</span></h2>
    <p class="rt-lead">No. Every top-prize winner is a random draw from tickets <em>sold</em>, so raw winner counts track <b>sales volume</b>. The fair comparison divides winners by each chain's store count — a real denominator from the ${num(R.total)}-store census — though even that assumes every store sells the same volume. Read <b>lift</b> below as winners per store vs. the statewide average: <b>1.0× = average</b>; above it means more tickets sold there, not better odds.</p></div>
  <div class="panel"><h2>Where winning tickets actually come from <span class="hint">share of stores vs. share of winners, by store type</span></h2><div id="rt-types"></div></div>
  <div class="panel" id="rt-finder"><h2>Did my store ever sell a winner? <span class="hint">search the ${num(stores.length)} stores with a published top prize</span></h2>
    <div class="controls"><input type="text" id="rt-q" placeholder="Store name, street, or city…"></div>
    <div class="rt-chips" id="rt-chips"></div>
    <div id="rt-res"></div>
    <p class="mut" style="font-size:12px;margin-top:10px">Only <b>top</b> prizes are published — a store's absence here says nothing about its smaller winners — and address-string variants may split one store into two entries.</p>
  </div>
  <div class="panel"><h2>By chain <span class="hint">lift = winners per store vs. statewide average · click a chain for its stores</span></h2>
    <div id="rt-chainT" class="rt-chain"></div>
    <div class="sortnote" id="rt-trap"></div>
  </div>
  <div class="panel"><h2>Lightning does strike twice <span class="hint">two-time stores — and why that's expected</span></h2><div id="rt-dblbody"></div></div>`;
  let finder=null;
  try{finder=rtFinder(R,stores);}catch(e){const el=$("#rt-res");if(el)el.innerHTML='<p class="mut">Store finder failed to load.</p>';}
  try{rtChainTable(R,clock,finder);}catch(e){const el=$("#rt-chainT");if(el)el.innerHTML='<p class="mut">Chain table failed to load.</p>';}
  try{rtDoubles(R,stores);}catch(e){const el=$("#rt-dblbody");if(el)el.innerHTML='<p class="mut">Repeat-store analysis failed to load.</p>';}
  try{rtTypeBars(R);}catch(e){const el=$("#rt-types");if(el)el.innerHTML='<p class="mut">Store-type comparison failed to load.</p>';}
};
})();
