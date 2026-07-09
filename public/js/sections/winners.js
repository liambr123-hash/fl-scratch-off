/* winners.js — "Winners" tab redesign: payout truth (the shrinking million),
   jackpot survival by ticket price, the record book, and the full claim record.
   Registers FLX.routes.winners; app.js winners() remains the fallback. */
(function(){
"use strict";

FLX.css(`
  .whead{margin:4px 0 18px}
  .wtitle{font-family:var(--serif);font-size:24px;font-weight:600;letter-spacing:-.01em;margin-bottom:5px}
  .wtally{font-size:14.5px;color:var(--muted);margin-bottom:4px}
  .wtally b{font-family:var(--serif);color:var(--text);font-size:17px;font-weight:600}
  .wcave{font-size:12px;color:var(--dim);margin-top:10px;line-height:1.55}
  .whead .wcave{margin-top:2px}
  .wtake{font-size:13.5px;margin:0 0 10px;line-height:1.45}
  .wtake b{color:var(--flamingo)}
  .wchiprow{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}
  .wchip{border:1px solid var(--border);background:none;color:var(--muted);border-radius:20px;padding:4px 12px;font:600 12.5px var(--sans);cursor:pointer}
  .wchip.active{background:var(--panel2);color:var(--text);border-color:var(--teal)}
  .wrec{cursor:pointer;transition:border-color .12s}
  .wrec:hover{border-color:var(--flamingo)}
  #w-records .card .note{line-height:1.45}
  .wgame{color:var(--teal)}
  .wline{display:inline-block;width:16px;height:3px;background:var(--flamingo);border-radius:2px;margin-right:5px;vertical-align:2px}
  .wdiam{display:inline-block;width:9px;height:9px;background:var(--flamingo);border-radius:2px;transform:rotate(45deg);margin-right:6px;vertical-align:-1px}
  @media(max-width:640px){
    .wtitle{font-size:20px}
    .wtally{font-size:12.5px}
    .wtally b{font-size:14px}
    .wchip{padding:3px 9px;font-size:11.5px}
    .wtake{font-size:12.5px}
  }
`);

/* ---------- small local helpers (module-scoped, no globals) ---------- */
const payOf=w=>{
  if(w[8]==null)return null;
  const v=parseFloat(String(w[8]).replace(/[^\d.]/g,""));
  return isFinite(v)&&v>0?v:null;
};
const nameOf=w=>anon(w[2])?"anonymous (90-day exemption)":String(w[2]||"—");
const median=a=>{
  const s=[...a].sort((x,y)=>x-y),n=s.length;
  return n?(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;
};
const dfmt=s=>{try{return new Date(s+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});}catch(e){return String(s||"—");}};
const wday=s=>{try{return new Date(s+"T12:00:00").toLocaleDateString("en-US",{weekday:"long"});}catch(e){return "";}};

const PRICES=[1,2,3,5,10,20,30,50];
const BUCKET=[
  {label:"$1M",c:"#2FB6A8"},        /* teal      */
  {label:"$2M",c:"#8FD9D2"},        /* aqua      */
  {label:"$5–15M",c:"#FF9E4A"},     /* tangerine */
  {label:"$25M",c:"#E24B5B"},       /* coral     */
];
const bIdx=v=>v<2e6?0:v<5e6?1:v<25e6?2:3;
/* dot color teal→coral by advertised prize (log scale $500 → $25M) */
const prizeColor=v=>{
  const lo=Math.log10(500),hi=Math.log10(25e6);
  const t=Math.max(0,Math.min(1,(Math.log10(Math.max(+v||500,500))-lo)/(hi-lo)));
  const A=[47,182,168],B=[226,75,91];
  return `rgba(${Math.round(A[0]+(B[0]-A[0])*t)},${Math.round(A[1]+(B[1]-A[1])*t)},${Math.round(A[2]+(B[2]-A[2])*t)},.62)`;
};

FLX.routes.winners=function(){
  const isM=matchMedia("(max-width:640px)").matches;
  const fail=(sel,msg)=>{const el=$(sel);if(el)el.innerHTML=`<p class="mut">${msg}</p>`;};

  /* ================= shared filter state (feature 4) ================= */
  const F={q:"",min:0,anonF:"",year:"",jack:false,oos:false};
  let YEARS=[];
  try{YEARS=[...new Set(W.map(w=>(w[1]||"").slice(0,4)).filter(Boolean))].sort();}catch(e){YEARS=[];}

  /* ================= record book — one pass over W (feature 3) ================= */
  let rec=null;
  try{
    let bw=null,bp=0;const df={},nf={};
    for(const w of W){
      const p=payOf(w);
      if(p&&p>bp){bp=p;bw=w;}
      if(w[1])df[w[1]]=(df[w[1]]||0)+1;
      if(w[2]&&!anon(w[2]))nf[w[2]]=(nf[w[2]]||0)+1;
    }
    let busD=null,busN=0;
    for(const d in df)if(df[d]>busN||(df[d]===busN&&(busD===null||d<busD))){busN=df[d];busD=d;}
    const days=Object.keys(df).sort();
    let gap=0,g0="",g1="";
    for(let i=1;i<days.length;i++){
      const d=Math.round((Date.parse(days[i])-Date.parse(days[i-1]))/864e5);
      if(d>gap){gap=d;g0=days[i-1];g1=days[i];}
    }
    const repeats=Object.keys(nf).filter(n=>nf[n]>1).sort();
    const namedTotal=Object.values(nf).reduce((a,b)=>a+b,0);
    if(bw)rec={bw,bp,busD,busN,gap,g0,g1,repeats,namedTotal};
  }catch(e){rec=null;}

  /* payment-type chips for the hero (annuity punchline) */
  let cashN=0,annN=0;
  try{for(const w of W){if(/CASH/i.test(w[7]||""))cashN++;else if(/ANNUAL/i.test(w[7]||""))annN++;}}catch(e){}
  const recN=cashN+annN;
  const cashPct=recN?Math.round(100*cashN/recN):null;

  /* prize-size correction line (survivor of the cut ladder chart) */
  let sizeLine="";
  try{
    const under=W.filter(w=>(w[6]||0)<25e4).length;
    const minP=W.reduce((m,w)=>(w[6]&&w[6]<m?w[6]:m),Infinity);
    sizeLine=`And not every top prize is a million — ${Math.round(100*under/W.length)}% of these ${num(W.length)} wins are under $250k; the smallest is ${moneyFull(isFinite(minP)?minP:null)} (size reflects game design, not winner luck).`;
  }catch(e){sizeLine="";}

  /* ================= skeleton ================= */
  const recHTML=rec?`
    <div class="card wrec" id="wr-pay"><div class="lab">Biggest real payout</div>
      <div class="val flamc">${money(rec.bp)}</div>
      <div class="note">${esc(nameOf(rec.bw))} banked ${moneyFull(rec.bp)} cash on a ${money(rec.bw[6])} advertised prize — ${esc(GAME_NAME[rec.bw[0]]||"")}, ${dfmt(rec.bw[1])}. Click to find the claim ↓</div></div>
    <div class="card wrec" id="wr-day"><div class="lab">Busiest claim day</div>
      <div class="val">${rec.busN} winners</div>
      <div class="note">all walked in on ${dfmt(rec.busD)} — a ${wday(rec.busD)}. Click to see them ↓</div></div>
    <div class="card"><div class="lab">Longest statewide drought</div>
      <div class="val">${rec.gap} days</div>
      <div class="note">no top prize claimed anywhere in Florida, ${dfmt(rec.g0)} → ${dfmt(rec.g1)}</div></div>
    <div class="card wrec" id="wr-twice"><div class="lab">Lightning twice</div>
      <div class="val">${rec.repeats.length} players</div>
      <div class="note">named winners appearing twice among ${num(rec.namedTotal)} named claims — consistent with chance, and shared full names can't be ruled out; winning once does not improve your odds. Click to see them ↓</div></div>`
    :'<div class="card"><div class="lab">Record book</div><div class="val mut">—</div><div class="note">couldn\'t be computed from this build\'s data</div></div>';

  mainEl.innerHTML=`
  <div class="whead">
    <div class="wtitle">Top-prize winners</div>
    <div class="wtally" id="w-tally"></div>
    <div class="wcave"><span id="w-tallynote"></span> ${sizeLine}</div>
  </div>

  <div class="panel" id="w-hero">
    <h2>The shrinking million <span class="hint">what $1M+ winners actually banked, as a share of the advertised prize</span></h2>
    <div class="cards" style="margin-bottom:14px">
      <div class="card"><div class="lab">Take the cash</div><div class="val">${cashPct==null?"—":cashPct+"%"}</div><div class="note">${num(cashN)} of ${num(recN)} recorded payment choices</div></div>
      <div class="card"><div class="lab">A $1,000,000 win now pays</div><div class="val">≈ $620–640k</div><div class="note">cash option, before tax</div></div>
      <div class="card"><div class="lab">Ever chose the annuity</div><div class="val">${num(annN)}</div><div class="note">every other recorded winner took the discounted cash</div></div>
    </div>
    <div class="controls">
      <div class="seg" id="w-bseg"><button data-b="all" class="active">All</button>${BUCKET.map((b,i)=>`<button data-b="${i}">${b.label}</button>`).join("")}</div>
      <span class="legend" style="margin:0">${BUCKET.map(b=>`<span><span class="sw" style="background:${b.c}"></span>${b.label}</span>`).join("")}<span><span class="wline"></span>year mean</span></span>
    </div>
    <div class="chartbox" id="w-heroBox"><canvas id="w-heroC"></canvas></div>
    <p class="wcave">The cash option is the present value of a ~30-year annuity, so the falling line tracks interest rates and annuity design — not the Lottery getting stingier. Bigger prizes carry longer annuities ($25M claims average ≈61% of face vs ≈64% for $1M). Payouts have been published only since ~2022 (419 of 815 winners here have one on record), the 2022 mean rests on just 6 claims, and every figure is pre-tax. Click a dot for its game; picking a bucket also filters the table below.</p>
  </div>

  <div class="panel" id="w-strip">
    <h2>How long a jackpot survives <span class="hint">days from game launch to each top-prize claim, by ticket price</span></h2>
    <div class="controls">
      <div class="seg" id="w-jseg"><button data-j="all" class="active">All top prizes</button><button data-j="jack">True jackpots only</button></div>
      <span class="legend" style="margin:0"><span><span class="sw" style="background:#2FB6A8"></span>smaller prize</span><span><span class="sw" style="background:#E24B5B"></span>$25M</span><span><span class="wdiam"></span>band median</span></span>
    </div>
    <div class="wtake" id="w-take"></div>
    <div class="chartbox" id="w-stripBox"><canvas id="w-stripC"></canvas></div>
    <p class="wcave" id="w-stripcave"></p>
  </div>

  <div class="cards" id="w-records">${recHTML}</div>

  <div class="panel" id="w-full">
    <h2>The full record <span class="hint">every reported top-prize claim — search, filter, click a row for the game</span></h2>
    <div class="controls">
      <input type="text" id="wq" placeholder="Search name, city, retailer, game, date…">
      <select id="wmin"><option value="0">Any prize</option><option value="250000">$250k+</option><option value="1000000">$1M+</option><option value="2000000">$2M+</option><option value="5000000">$5M+</option><option value="25000000">$25M</option></select>
      <select id="wanon"><option value="">Named + anonymous</option><option value="named">Named only</option><option value="anon">Anonymous only</option></select>
    </div>
    <div class="wchiprow" id="w-chips">
      ${YEARS.map(y=>`<button class="wchip" data-y="${esc(y)}">${esc(y)}</button>`).join("")}
      <button class="wchip" data-k="jack">jackpots only</button>
      <button class="wchip" data-k="oos">out-of-state</button>
    </div>
    <div id="wtbl"></div>
    <div class="sortnote">Click any column to sort · click a row for full game detail</div>
  </div>`;

  /* ================= the full record — table + live tally (features 4a–4e) ================= */
  const COLS=[
    {k:"1",label:"Claimed",fmt:w=>esc(w[1]||"—"),sortVal:w=>w[1]||""},
    {k:"0",label:"Game",fmt:w=>`<span class="wgame">${esc(GAME_NAME[w[0]]||w[0])}</span> <span class="dim">#${esc(w[0])}</span>`,sortVal:w=>GAME_NAME[w[0]]||String(w[0])},
    {k:"2",label:"Winner",fmt:w=>anon(w[2])?'<span class="dim">anonymous</span>':esc(w[2]),sortVal:w=>w[2]||""},
    {k:"3",label:"City",fmt:w=>esc(w[3]||"—")+(w[4]&&w[4]!=="FL"?` <span class="dim">${esc(w[4])}</span>`:""),sortVal:w=>w[3]||""},
    {k:"6",label:"Prize",r:1,fmt:w=>esc(w[5]||money(w[6])),sortVal:w=>w[6]||0},
    {k:"8",label:"Payout",r:1,fmt:w=>w[8]?esc(w[8]):'<span class="dim">—</span>',sortVal:w=>payOf(w)},
    {k:"cash",label:"Cash %",r:1,hideM:1,fmt:w=>{const p=payOf(w);return p&&w[6]?((100*p/w[6]).toFixed(1)+"%"):'<span class="dim">—</span>';},sortVal:w=>{const p=payOf(w);return p&&w[6]?p/w[6]:null;}},
    {k:"10",label:"Sold at",hideM:1,fmt:w=>`<span title="${esc(w[11]||"")}">${esc(w[10]||"—")}</span>`,sortVal:w=>w[10]||""},
  ];

  function refresh(){
    const box=$("#wtbl");
    if(!box)return;
    let rows,failed=false;
    try{
      const terms=F.q.toLowerCase().split("|").map(t=>t.trim()).filter(Boolean);
      rows=W.filter(w=>
        (!terms.length||terms.some(t=>[w[2],w[3],w[10],GAME_NAME[w[0]],w[0],w[1]].some(x=>String(x||"").toLowerCase().includes(t))))&&
        ((w[6]||0)>=F.min)&&
        (F.anonF===""||(F.anonF==="named"?!anon(w[2]):anon(w[2])))&&
        (!F.year||(w[1]||"").slice(0,4)===F.year)&&
        (!F.jack||w[9]===1)&&
        (!F.oos||(w[4]&&w[4]!=="FL")));
    }catch(e){rows=W;failed=true;}
    /* live tally (feature 4c) */
    try{
      let adv=0,paid=0,k=0;
      for(const w of rows){adv+=w[6]||0;const p=payOf(w);if(p){paid+=p;k++;}}
      const t=$("#w-tally"),n=$("#w-tallynote");
      if(t)t.innerHTML=`<b>${num(rows.length)}</b> winners · <b>${money(adv)}</b> advertised · <b>${money(paid)}</b> actually paid`;
      if(n)n.textContent=`The "paid" sum covers only the ${num(k)} of ${num(rows.length)} rows with a recorded payout — a different population from the advertised sum.`;
    }catch(e){}
    box.innerHTML="";
    if(failed){
      const note=document.createElement("p");
      note.className="mut";
      note.textContent="Filters hit a snag — showing the full unfiltered record.";
      box.append(note);
    }
    try{
      box.append(makeTable(COLS,rows,{sort:"1",rowClick:w=>w[0]}));
      if(!rows.length){
        const note=document.createElement("p");
        note.className="mut";
        note.style.marginTop="8px";
        note.textContent="No winners match those filters.";
        box.append(note);
      }
    }catch(e){
      box.innerHTML='<p class="mut">The table couldn\'t render.</p>';
    }
  }

  function syncControls(){
    try{
      const q=$("#wq"),m=$("#wmin"),a=$("#wanon");
      if(q)q.value=F.q;
      if(m)m.value=String(F.min);
      if(a)a.value=F.anonF;
      document.querySelectorAll("#w-chips .wchip").forEach(b=>{
        if(b.dataset.y)b.classList.toggle("active",F.year===b.dataset.y);
        else if(b.dataset.k==="jack")b.classList.toggle("active",F.jack);
        else if(b.dataset.k==="oos")b.classList.toggle("active",F.oos);
      });
    }catch(e){}
  }
  function setFilters(patch,scroll){
    try{Object.assign(F,patch);syncControls();refresh();}catch(e){refresh();}
    if(scroll){const el=$("#w-full");if(el)el.scrollIntoView({behavior:"smooth",block:"start"});}
  }

  try{
    const q=$("#wq"),m=$("#wmin"),a=$("#wanon");
    if(q)q.oninput=e=>{F.q=e.target.value;refresh();};
    if(m)m.onchange=e=>{F.min=+e.target.value||0;refresh();};
    if(a)a.onchange=e=>{F.anonF=e.target.value;refresh();};
    document.querySelectorAll("#w-chips .wchip").forEach(b=>b.onclick=()=>{
      if(b.dataset.y)F.year=(F.year===b.dataset.y?"":b.dataset.y);
      else if(b.dataset.k==="jack")F.jack=!F.jack;
      else if(b.dataset.k==="oos")F.oos=!F.oos;
      syncControls();refresh();
    });
  }catch(e){}
  refresh();

  /* record-book cards drive the table (feature 3 + 4e) */
  const CLEAR={min:0,anonF:"",year:"",jack:false,oos:false};
  const wire=(id,fn)=>{const el=document.getElementById(id);if(el)el.onclick=()=>{try{fn();}catch(e){}};};
  if(rec){
    wire("wr-pay",()=>setFilters(Object.assign({q:anon(rec.bw[2])?(rec.bw[1]||""):String(rec.bw[2]||"")},CLEAR),true));
    wire("wr-day",()=>setFilters(Object.assign({q:rec.busD||""},CLEAR),true));
    wire("wr-twice",()=>setFilters(Object.assign({q:rec.repeats.join("|")},CLEAR),true));
  }

  /* ================= hero — the shrinking million (feature 1) ================= */
  let heroChart=null;
  try{
    const pts=[];const yr={};
    for(const w of W){
      if(!/CASH/.test(w[7]||""))continue;
      const p=payOf(w);
      if(!p||!(w[6]>=1e6)||!w[1])continue;
      const r=p/w[6];
      if(r>1.2)continue;                       /* guards "…A YEAR FOR LIFE"-style artifacts */
      const t=Date.parse(w[1]);
      if(!isFinite(t))continue;
      pts.push({t,r,w,b:bIdx(w[6])});
      const y=w[1].slice(0,4);
      (yr[y]=yr[y]||[]).push(r);
    }
    if(!pts.length)throw new Error("no payout rows");
    const years=Object.keys(yr).sort();
    const maxT=pts.reduce((m,p)=>Math.max(m,p.t),0);
    const step=years.map(y=>({x:Date.parse(y+"-01-01"),y:+(yr[y].reduce((a,b)=>a+b,0)/yr[y].length).toFixed(4)}));
    step.push({x:maxT,y:step[step.length-1].y});
    const xMin=Date.parse(years[0]+"-01-01"),xMax=maxT+40*864e5;
    const yearTicks=[];
    for(let y=+years[0];y<=+years[years.length-1]+1;y++)yearTicks.push(Date.parse(y+"-01-01"));
    heroChart=newChart($("#w-heroC"),{type:"scatter",data:{datasets:[
      {type:"line",data:step,stepped:"after",borderColor:"#FF6F91",borderWidth:2.5,pointRadius:0,pointHitRadius:0,fill:false},
      ...BUCKET.map((b,i)=>({
        data:pts.filter(p=>p.b===i).map(p=>({x:p.t,y:p.r,w:p.w})),
        backgroundColor:b.c+"B3",pointRadius:isM?2.5:3.5,pointHoverRadius:6,borderWidth:0})),
    ]},options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},
        tooltip:{filter:i=>i.datasetIndex>0,callbacks:{
          /* Chart.js tooltips draw to canvas (plain text, not HTML) — esc() here
             would display "&amp;" for names/games containing "&". */
          title:items=>items.length?nameOf(items[0].raw.w):"",
          label:c=>{
            const w=c.raw.w;
            return [` ${GAME_NAME[w[0]]||""}`,` advertised ${moneyFull(w[6])} → paid ${moneyFull(payOf(w))}`,` (${(100*c.raw.y).toFixed(1)}% of face)`];
          }}}},
      scales:{
        x:{type:"linear",min:xMin,max:xMax,grid:{display:false},
          afterBuildTicks:ax=>{ax.ticks=yearTicks.filter(v=>v>=ax.min&&v<=ax.max).map(v=>({value:v}));},
          ticks:{callback:v=>String(new Date(v).getUTCFullYear()),font:{size:isM?10:11},maxRotation:0}},
        y:{min:.5,max:1.02,title:{display:!isM,text:"cash paid as % of advertised"},
          ticks:{callback:v=>Math.round(100*v)+"%",font:{size:isM?10:11}}}},
      onClick:(ev,els,ch)=>{
        const el=(els||[]).find(x=>x.datasetIndex>0);
        if(el){const d=ch.data.datasets[el.datasetIndex].data[el.index];if(d&&d.w)go("game",d.w[0]);}
      }}});
    /* bucket seg: isolates a bucket AND drives the table's min-prize filter (4e) */
    const floors=[1e6,2e6,5e6,25e6];
    document.querySelectorAll("#w-bseg button").forEach(bt=>bt.onclick=()=>{
      try{
        document.querySelectorAll("#w-bseg button").forEach(x=>x.classList.toggle("active",x===bt));
        const b=bt.dataset.b;
        if(heroChart){
          for(let i=1;i<=4;i++)heroChart.setDatasetVisibility(i,b==="all"||+b===i-1);
          heroChart.update();
        }
        setFilters({min:b==="all"?0:floors[+b]});
      }catch(e){}
    });
  }catch(e){
    fail("#w-heroBox","The payout scatter couldn't render — the table below still carries every advertised-vs-paid pair.");
  }

  /* ================= strip plot — how long a jackpot survives (feature 2) ================= */
  try{
    function stripData(jackOnly){
      const spts=[];const bands=PRICES.map(()=>[]);
      let i=0;
      for(const w of W){
        if(jackOnly&&w[9]!==1)continue;
        const g=byNo[w[0]];
        if(!g||!g.launch_date||!w[1])continue;
        const d=(Date.parse(w[1])-Date.parse(g.launch_date))/864e5;
        if(!isFinite(d)||d<0)continue;
        const bi=PRICES.indexOf(Math.round(g.ticket_price));
        if(bi<0)continue;
        const j=((i*0.618034)%1)*0.7-0.35;   /* deterministic jitter, stable across renders */
        i++;
        spts.push({x:Math.sqrt(d),y:bi+j,w,d});
        bands[bi].push(d);
      }
      const meds=[];
      bands.forEach((a,bi)=>{
        const m=median(a);
        if(m!=null)meds.push({x:Math.sqrt(m),y:bi,price:PRICES[bi],med:m,n:a.length});
      });
      const m1=median(bands[0]);
      const mHi=median(bands[6].concat(bands[7]));
      return {spts,meds,m1,mHi,n3:bands[2].length};
    }
    const takeaway=d=>{
      const el=$("#w-take");
      if(!el)return;
      if(d.m1&&d.mHi){
        const x=Math.max(1,Math.round(d.mHi/d.m1));
        el.innerHTML=`<b>$1 games burn through their top prizes ~${x}× faster than $30–$50 games</b> — median ${Math.round(d.m1)} days from launch to claim, vs ${Math.round(d.mHi)}.`;
      }else el.innerHTML="";
    };
    const d0=stripData(false);
    if(!d0.spts.length)throw new Error("no rows");
    takeaway(d0);
    const cave=$("#w-stripcave");
    if(cave)cave.textContent=`Survivorship censoring: only claimed prizes can plot here — jackpots still unclaimed in live games don't appear, so true survival runs longer than these dots suggest. The claim date can lag the actual scratch by up to 90+ days. The $3 band is small (n=${d0.n3}) and skewed by its launch calendar.`;
    const dayTicks=isM?[0,90,365,730,1460]:[0,30,90,180,365,730,1095,1460,1825];
    const stripChart=newChart($("#w-stripC"),{type:"scatter",data:{datasets:[
      {data:d0.meds,pointStyle:"rectRot",pointRadius:isM?6:7.5,pointHoverRadius:9,
        backgroundColor:"#FF6F91",borderColor:"rgba(0,0,0,.35)",borderWidth:1},
      {data:d0.spts,pointRadius:isM?2:3,pointHoverRadius:6,borderWidth:0,
        pointBackgroundColor:d0.spts.map(p=>prizeColor(p.w[6]))},
    ]},options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},
        tooltip:{callbacks:{
          /* canvas-rendered tooltip: plain text, no esc() (see hero note) */
          title:items=>{
            if(!items.length)return "";
            const it=items[0];
            return it.datasetIndex===0?`$${it.raw.price} band median`:nameOf(it.raw.w);
          },
          label:c=>{
            if(c.datasetIndex===0)return ` typical claim ${Math.round(c.raw.med)} days after launch (n=${c.raw.n})`;
            const w=c.raw.w;
            return [` ${GAME_NAME[w[0]]||""} — ${w[5]||money(w[6])}`,` claimed ${Math.round(c.raw.d)} days after launch`];
          }}}},
      scales:{
        x:{type:"linear",min:0,max:Math.sqrt(1830),title:{display:!isM,text:"days from launch to claim (√ scale)"},
          afterBuildTicks:ax=>{ax.ticks=dayTicks.map(v=>({value:Math.sqrt(v)}));},
          ticks:{callback:v=>{const d=Math.round(v*v);return d===0?"launch":d>=365?Math.round(d/365)+"y":d+"d";},font:{size:isM?10:11},maxRotation:0}},
        y:{min:-0.7,max:7.7,grid:{display:false},
          afterBuildTicks:ax=>{ax.ticks=PRICES.map((p,i)=>({value:i}));},
          ticks:{callback:v=>(PRICES[v]!=null?"$"+PRICES[v]:""),font:{size:isM?10:11}}}},
      onClick:(ev,els,ch)=>{
        const el=(els||[]).find(x=>x.datasetIndex===1);
        if(el){const d=ch.data.datasets[1].data[el.index];if(d&&d.w)go("game",d.w[0]);}
      }}});
    document.querySelectorAll("#w-jseg button").forEach(bt=>bt.onclick=()=>{
      try{
        document.querySelectorAll("#w-jseg button").forEach(x=>x.classList.toggle("active",x===bt));
        const d=stripData(bt.dataset.j==="jack");
        if(stripChart){
          stripChart.data.datasets[0].data=d.meds;
          stripChart.data.datasets[1].data=d.spts;
          stripChart.data.datasets[1].pointBackgroundColor=d.spts.map(p=>prizeColor(p.w[6]));
          stripChart.update();
        }
        takeaway(d);
      }catch(e){}
    });
  }catch(e){
    fail("#w-stripBox","The survival strip couldn't render — launch dates are still on each game's page.");
  }
};

})();
