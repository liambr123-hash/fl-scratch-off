/* insights section module — flscratchstats.com
   Registers FLX.routes.insights (router prefers this over the app.js built-in).
   Layout: intro TOC → breakage ladder → price-tier reality strip (+ shared filter)
   → buy-zone quadrant → jackpot dream tracker → EV drift → claims clock → anonymity era. */
(function(){
"use strict";

/* ---------- styles ---------- */
FLX.css(`
#ins-root .ins-lede{color:var(--muted);font-size:13.5px;line-height:1.55;margin:0 0 10px;max-width:78ch}
#ins-root .ins-lede b{color:var(--text)}
#ins-root .ins-cav{color:var(--dim);font-size:12px;line-height:1.55;margin:10px 0 0;max-width:84ch}
#ins-root .ins-h3{font:600 12.5px var(--sans);color:var(--muted);margin:0 0 6px;letter-spacing:.02em}
#ins-root .ins-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
#ins-root .ins-chip{background:var(--panel2);border:1px solid var(--border);border-radius:8px;color:var(--muted);font:600 12px var(--sans);padding:4px 10px;cursor:pointer}
#ins-root .ins-chip b{color:var(--text);font-weight:700}
#ins-root .ins-chip.active{border-color:var(--flamingo);color:var(--text)}
#ins-root .ins-games{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
#ins-root .ins-games .ins-h3{flex:1 1 100%;margin:0}
#ins-root .ins-game{background:none;border:1px solid var(--border);border-radius:8px;color:var(--text);font:500 12.5px var(--sans);padding:5px 10px;cursor:pointer;text-align:left}
#ins-root .ins-game:hover{border-color:var(--teal)}
#ins-root .ins-game .ev{color:var(--muted);margin-left:7px}
#ins-root .ins-anchor{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
#ins-root .ins-xlink{color:var(--dim)}
#ins-root .ins-xlink .ins-anchor{color:var(--flamingo)}
#ins-root .ins-short{height:250px}
#ins-root .ins-segnote{color:var(--dim);font-size:12px}
@media(max-width:640px){
  #ins-root .ins-short{height:210px}
  #ins-root .ins-lede{font-size:12.5px}
  #ins-root .ins-chip{font-size:11px;padding:3px 8px}
  #ins-root .ins-game{font-size:11.5px;padding:4px 8px}
}
`);

/* ---------- module-scope state & helpers ---------- */
let tierSel="all";                                 // shared price-tier filter (strip + buy zone)
const TIER_BTNS=[["all","all"],["1-2","$1–2"],["3-5","$3–5"],["10","$10"],["20+","$20+"]];
const tierTest={"all":()=>true,"1-2":p=>p<=2,"3-5":p=>p>=3&&p<=5,"10":p=>p===10,"20+":p=>p>=20};
const inTier=g=>{try{return tierTest[tierSel](Math.round(g.ticket_price));}catch(e){return true;}};
const FADE="rgba(125,143,135,.15)";
const jit=n=>{const s=Math.sin(((+n)||1)*12.9898)*43758.5453;return s-Math.floor(s);};   // deterministic per game
const bandHex=g=>{const b=band(g.score);return b?({good:"#2FB6A8",teal2:"#8FD9D2",warn:"#FF9E4A",bad:"#E24B5B"})[b[1]]||"#7d8f87":"#7d8f87";};
const shortOdds=v=>v>=1e6?"1 in "+(v/1e6).toFixed(v>=3e6?0:1)+"M":v>=1e3?"1 in "+Math.round(v/1e3)+"k":"1 in "+Math.round(v);
const fam=()=>Chart.defaults.font.family;

function chartNote(sel,msg){
  const el=mainEl.querySelector(sel);
  if(el)el.innerHTML=`<p class="mut" style="padding:24px 8px;font-size:13px">${msg||"This chart could not be drawn from the current data."}</p>`;
}
function safe(label,boxSel,fn){
  try{return fn();}
  catch(e){console.warn("insights: "+label+" failed",e);chartNote(boxSel);return null;}
}
function segWire(id,cb){
  document.querySelectorAll("#"+id+" button").forEach(b=>b.onclick=()=>{
    document.querySelectorAll("#"+id+" button").forEach(x=>x.classList.toggle("active",x===b));
    cb(b.dataset.v);
  });
}

/* ---------- data passes ---------- */
function ladderRows(on){
  // per price tier: unweighted avg of P(money-back / modest / real) from each game's printed odds table
  const prices=[...new Set(on.map(g=>Math.round(g.ticket_price)))].sort((a,b)=>a-b);
  const rows=[];
  for(const p of prices){
    const gs=[];let mb=0,mo=0,re=0,po=0,poN=0;
    for(const g of on){
      if(Math.round(g.ticket_price)!==p)continue;
      const tiers=T[g.game_no]||[];
      let a=0,b=0,c=0;
      for(const t of tiers){
        if(t[2]>0){const pr=1/t[2];
          if(t[1]<=g.ticket_price)a+=pr;
          else if(t[1]<=5*g.ticket_price)b+=pr;
          else c+=pr;}
      }
      const any=a+b+c;
      if(!(any>0)||any>0.5)continue;               // no odds table, or degenerate one (flagged data_quality)
      gs.push(g);mb+=a;mo+=b;re+=c;
      if(g.profit_odds){po+=g.profit_odds;poN++;}
    }
    if(!gs.length)continue;
    const n=gs.length;
    rows.push({p,n,games:gs,mb:100*mb/n,mo:100*mo/n,re:100*re/n,any:100*(mb+mo+re)/n,profit:poN?po/poN:null});
  }
  return rows;
}

/* ================= route ================= */
FLX.routes.insights=function(){
  try{render();}
  catch(e){
    console.warn("insights render failed",e);
    mainEl.innerHTML='<div class="panel"><h2>Insights</h2><p class="mut">This section could not be rendered from the current data build.</p></div>';
  }
};

function render(){
  /* ----- data (computed up front so ledes can quote it) ----- */
  const on=G.filter(g=>g.on_sale);
  const evOn=on.filter(g=>g.value_per_dollar_now!=null);
  const lad=ladderRows(on);
  const prices=[...new Set(evOn.map(g=>Math.round(g.ticket_price)))].sort((a,b)=>a-b);
  const designAvg={};
  for(const p of prices){
    const s=on.filter(g=>Math.round(g.ticket_price)===p&&g.value_per_dollar_original!=null);
    if(s.length)designAvg[p]=s.reduce((t,g)=>t+g.value_per_dollar_original,0)/s.length;
  }
  const qd=evOn.filter(g=>g.pct_value_remaining!=null).map(g=>({x:g.pct_value_remaining,y:g.value_per_dollar_now,g}));
  const dd=on.filter(g=>g.top_prizes_remaining>0&&g.top_prizes_total>0&&g.est_tickets_printed>0&&g.est_tickets_remaining>0)
             .map(g=>({x:g.est_tickets_printed/g.top_prizes_total,y:g.est_tickets_remaining/g.top_prizes_remaining,g}));
  const ddMil=dd.filter(d=>(d.g.top_prize_value_num||0)>=1e6);
  const minLiveMil=ddMil.length?Math.min(...ddMil.map(d=>d.y)):null;
  const dr=[...evOn].filter(g=>g.drift!=null).sort((a,b)=>b.drift-a.drift);

  /* ----- shell ----- */
  mainEl.innerHTML=`<div id="ins-root">

  <div class="panel insight"><h2>How to read this</h2>
    <p class="mut" style="font-size:13.5px;line-height:1.6">
      Every scratch-off is negative-EV — the best return ≈ $0.80–0.92 per $1 — and price tiers average out the same,
      so <b class="ins-anchor" data-anchor="ins-strip">which game you pick matters far more than what it costs</b>.
      Even a "win" usually isn't one: at most prices, a third to half of winning tickets pay back
      <b class="ins-anchor" data-anchor="ins-ladder">the ticket price or less</b>.
      And the jackpot is marketing — it holds only 4–8% of a game's prize value, though
      <b class="ins-anchor" data-anchor="ins-dream">your live odds on it drift far from the printed odds</b>.
      <span class="ins-xlink">The advertised million isn't the check, either — the cash-option haircut is measured
      winner-by-winner on the <b class="ins-anchor" data-golink="winners">Winners tab →</b></span>
    </p>
  </div>

  <div class="panel" id="ins-ladder"><h2>What a "win" actually is <span class="hint">design odds decomposed — money-back is not a win</span></h2>
    <p class="ins-lede">The chance of winning <b>anything</b> climbs from ~21% on a $1 ticket to ~36% at $30 — but a big slice of
      those "wins" only hands back your ticket price. Each bar averages the printed odds tables of every on-sale game at that price.</p>
    <div class="controls">
      <div class="seg" id="ins-ladderSeg"><button data-v="all" class="active">of all tickets</button><button data-v="wins">of winning tickets</button></div>
      <span class="ins-segnote">click a row (or a chip below) to list that tier's games</span>
    </div>
    <div class="chartbox"><canvas id="ins-ladderC"></canvas></div>
    <div class="ins-chips" id="ins-ladderChips"></div>
    <div class="ins-games" id="ins-ladderGames"></div>
    <p class="ins-cav">Design odds from the printed prize tables, not live counts; per-game averages are unweighted by sales volume.
      "Money-back" = prize ≤ ticket price · "modest" = ≤ 5× price · "real win" = &gt; 5× price.</p>
  </div>

  <div class="panel" id="ins-strip"><h2>The price-tier reality strip <span class="hint">every on-sale game's EV now, by price</span></h2>
    <p class="ins-lede">Tier averages are flat — the horizontal ticks (average <b>design</b> payout) sit near $0.70–0.75 at every price.
      <b>The spread within a tier is the whole game:</b> pick the dot, not the price point.</p>
    <div class="controls">
      <div class="seg" id="ins-tierSeg">${TIER_BTNS.map(([v,l])=>`<button data-v="${v}"${v===tierSel?' class="active"':""}>${l}</button>`).join("")}</div>
      <span class="ins-segnote">filter highlights this strip <b>and</b> the buy zone below</span>
    </div>
    <div class="legend">
      <span><span class="sw" style="background:var(--teal)"></span>Excellent</span>
      <span><span class="sw" style="background:var(--aqua)"></span>Good</span>
      <span><span class="sw" style="background:var(--tangerine)"></span>Fair</span>
      <span><span class="sw" style="background:var(--coral)"></span>Avoid</span>
      <span class="mut">· dot = one game (Value Score band) · — = tier's avg design payout · click a dot for detail</span>
    </div>
    <div class="chartbox"><canvas id="ins-stripC"></canvas></div>
    <p class="ins-cav">Design-payout ticks are per-game averages, unweighted by print run — a tier's flagship game can dominate actual sales.</p>
  </div>

  <div class="panel" id="ins-quad"><h2>The buy zone <span class="hint">value now vs freshness — top-right is where you want to shop</span></h2>
    <div class="chartbox"><canvas id="ins-quadC"></canvas></div>
    <p class="ins-cav">Reference lines mark 0.78 EV/$ and 40% of prize value remaining. Dot size = ticket price; teal clears both bars,
      coral = dead money (top prize already gone). Responds to the price filter above; click a dot for the game page.</p>
  </div>

  <div class="panel" id="ins-dream"><h2>The jackpot dream tracker <span class="hint">live top-prize odds vs how the game was designed</span></h2>
    <p class="ins-lede"><b>Below the dashed line, your shot at the jackpot is now better than the printed odds</b> — fewer tickets stand
      between the remaining top prizes. Worth knowing, and worth deflating: the jackpot tier holds only 4–8% of a game's prize pool.
      It is the marketing, not the product.</p>
    <div class="legend">
      <span><span class="sw" style="background:var(--teal)"></span>≥1.15× better than design</span>
      <span><span class="sw" style="background:var(--coral)"></span>≥1.15× worse</span>
      <span><span class="sw" style="background:var(--dim)"></span>about as designed</span>
    </div>
    <div class="chartbox"><canvas id="ins-dreamC"></canvas></div>
    <p class="ins-cav">Tickets-remaining are estimates derived from prize-count math, so both axes inherit that noise.
      A better jackpot shot does <b>not</b> mean better EV — and no odds on this chart are good: the friendliest board odds
      belong to small top prizes, and the best live shot at a $1M+ jackpot is still ${minLiveMil?esc(shortOdds(minLiveMil)):"—"}.
      Dot size = ticket price.</p>
  </div>

  <div class="panel" id="ins-drift"><h2>EV drift <span class="hint">how each game's value moved since it was designed</span></h2>
    <div class="controls">
      <div class="seg" id="ins-driftSeg"><button data-v="top" class="active">top &amp; bottom 7</button><button data-v="all">show all ${dr.length}</button></div>
    </div>
    <div class="chartbox" id="ins-driftBox"><canvas id="ins-driftC"></canvas></div>
    <p class="ins-cav">EV per $1 now minus design. Positive = prize money has outlasted ticket sales; negative = the value was already
      claimed out. Click a bar for the game.</p>
  </div>

  <div class="panel" id="ins-clock"><h2>The claims clock <span class="hint">when top prizes get claimed — and why the pattern means nothing</span></h2>
    <p class="ins-lede"><b>Nobody wins on a Saturday.</b> Claiming a top prize is paperwork at a Lottery district office, and the office
      is closed on weekends. Claim dates are bureaucratic events — don't read meaning into dates anywhere on this site.</p>
    <div class="grid2">
      <div><div class="ins-h3">by day of week</div><div class="chartbox ins-short"><canvas id="ins-dowC"></canvas></div></div>
      <div><div class="ins-h3">by calendar month, all years pooled</div><div class="chartbox ins-short"><canvas id="ins-monC"></canvas></div></div>
    </div>
    <p class="ins-cav">Claim date ≠ scratch date — winners can sit on a ticket for 90+ days. The January peak (the two busiest days on
      record are Jan 20 and Jan 2) partly reflects the launch calendar — flagship $50 games launch in late winter — plus holiday
      backlogs; and ~57 uneven months are pooled here.</p>
  </div>

  <div class="panel" id="ins-anon"><h2>The anonymity era <span class="hint">F.S. 24.1051 — 90-day identity shield for $250k+ winners, from Apr 2026</span></h2>
    <p class="ins-lede">Give Floridians the option and the millionaires vanish: since the shield took effect, nearly every $1M+ claim
      has been anonymous — while smaller winners stay named.</p>
    <div class="grid2">
      <div><div class="ins-h3">% of each month's claims anonymous</div><div class="chartbox ins-short"><canvas id="ins-anonC"></canvas></div></div>
      <div><div class="ins-h3">% anonymous by prize size — claims since Apr 2026</div><div class="chartbox ins-short"><canvas id="ins-anonSzC"></canvas></div></div>
    </div>
    <p class="ins-cav">The shield is temporary — it lasts 90 days, so the newest anonymous winners may become named later
      (recent bars are right-censored, and the latest month is partial). Eligibility starts at $250k, so much of the under-$1M bucket
      simply can't opt in. And the $5M+ bar is a sample of 8 — read it loosely.</p>
  </div>

  </div>`;

  /* ----- intro anchors ----- */
  mainEl.querySelectorAll(".ins-anchor").forEach(a=>a.onclick=()=>{
    if(a.dataset.golink){go(a.dataset.golink);return;}
    const t=document.getElementById(a.dataset.anchor);
    if(t)t.scrollIntoView({behavior:"smooth",block:"start"});
  });

  const mob=matchMedia("(max-width:640px)").matches;

  /* ================= [2] breakage ladder ================= */
  let ladderChart=null,ladderMode="all";
  function buildLadder(){
    const wins=ladderMode==="wins";
    const val=(r,k)=>wins?(r.any?100*(r[k]/r.any)*1:0):r[k];   // share of wins vs share of tickets
    const KEY=["mb","mo","re"];
    const ds=(k,label,color)=>({label,data:lad.map(r=>+val(r,k).toFixed(1)),backgroundColor:color,stack:"s"});
    return newChart(document.getElementById("ins-ladderC"),{type:"bar",
      data:{labels:lad.map(r=>"$"+r.p),
        datasets:[ds("mb","money-back (≤ ticket)","#7d8f87"),ds("mo","modest (≤ 5×)","#8FD9D2"),ds("re","real win (> 5×)","#2FB6A8")]},
      options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,
        scales:{x:{stacked:true,max:wins?100:Math.min(100,Math.ceil(Math.max(...lad.map(r=>r.any))/10)*10+5),
                   ticks:{callback:v=>v+"%",font:{size:10.5}},
                   title:{display:true,text:wins?"% of winning tickets":"% of all tickets",font:{size:11}}},
                y:{stacked:true,ticks:{font:{size:11.5}}}},
        plugins:{legend:{position:"bottom",labels:{boxWidth:10,font:{size:mob?10:11}}},
          tooltip:{callbacks:{
            title:it=>`$${lad[it[0].dataIndex].p} tickets — ${lad[it[0].dataIndex].n} on-sale games, design avg`,
            label:c=>{const r=lad[c.dataIndex],raw=r[KEY[c.datasetIndex]];
              return `${c.dataset.label}: ${c.raw}% ${wins?"of wins":"of tickets"}${wins?` (${raw.toFixed(1)}% of all tickets)`:""}`;},
            footer:it=>{const r=lad[it[0].dataIndex];
              return `any win: ${r.any.toFixed(1)}% of tickets${r.profit?` · ${oddsF(r.profit)} turns a profit`:""}`;}}}},
        onClick:(e,els)=>{if(els.length)showLadderGames(lad[els[0].index]);}}});
  }
  function showLadderGames(r){
    const box=document.getElementById("ins-ladderGames");
    if(!box||!r)return;
    const gs=[...r.games].sort((a,b)=>(b.value_per_dollar_now||0)-(a.value_per_dollar_now||0));
    box.innerHTML=`<div class="ins-h3">${r.n} on-sale $${r.p} game${r.n>1?"s":""}, best EV first — click one for full detail</div>`+
      gs.map(g=>`<button class="ins-game" data-g="${esc(g.game_no)}">${esc(g.game_name)}<span class="ev">${g.value_per_dollar_now!=null?f2(g.value_per_dollar_now)+"/$":"—"}</span></button>`).join("");
    box.querySelectorAll(".ins-game").forEach(b=>b.onclick=()=>go("game",b.dataset.g));
    document.querySelectorAll("#ins-ladderChips .ins-chip").forEach(c=>c.classList.toggle("active",c.dataset.p===String(r.p)));
  }
  safe("breakage ladder","#ins-ladder .chartbox",()=>{
    if(!lad.length)throw new Error("no ladder rows");
    ladderChart=buildLadder();
    const chips=document.getElementById("ins-ladderChips");
    chips.innerHTML=lad.map(r=>`<button class="ins-chip" data-p="${r.p}"><b>$${r.p}</b> · ${r.profit?esc(oddsF(r.profit))+" turns a profit":"profit odds n/a"}</button>`).join("");
    chips.querySelectorAll(".ins-chip").forEach(c=>c.onclick=()=>{
      const r=lad.find(x=>String(x.p)===c.dataset.p);
      if(r)showLadderGames(r);
    });
    segWire("ins-ladderSeg",v=>{
      ladderMode=v;
      try{if(ladderChart)ladderChart.destroy();ladderChart=buildLadder();}
      catch(e){console.warn("insights: ladder toggle failed",e);chartNote("#ins-ladder .chartbox");}
    });
  });

  /* ================= [3] price-tier reality strip ================= */
  let stripChart=null;
  function buildStrip(){
    const dots=evOn.map(g=>({x:prices.indexOf(Math.round(g.ticket_price))+(jit(g.game_no)-0.5)*0.56,y:g.value_per_dollar_now,g}))
                   .filter(d=>d.x>=-0.5);
    const ticks=prices.map((p,i)=>designAvg[p]!=null?{x:i,y:designAvg[p],p}:null).filter(Boolean);
    return newChart(document.getElementById("ins-stripC"),{type:"scatter",
      data:{datasets:[
        {data:dots,pointRadius:mob?3:4.5,pointHoverRadius:mob?5:7,
         pointBackgroundColor:dots.map(d=>inTier(d.g)?bandHex(d.g):FADE)},
        {data:ticks,pointStyle:"line",pointRadius:mob?9:13,pointHoverRadius:mob?9:13,borderColor:tickC,borderWidth:2.5}]},
      options:{responsive:true,maintainAspectRatio:false,
        scales:{x:{type:"linear",min:-0.6,max:prices.length-0.4,grid:{display:false},
                   afterBuildTicks:ax=>{ax.ticks=prices.map((p,i)=>({value:i}));},
                   ticks:{autoSkip:false,font:{size:mob?9:11},callback:v=>prices[v]!=null?"$"+prices[v]:""}},
                y:{title:{display:true,text:"payout per $1",font:{size:11}},ticks:{font:{size:10.5}}}},
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.datasetIndex===0
          ?`${c.raw.g.game_name} (#${c.raw.g.game_no}): ${f2(c.raw.y)}/$ now · design ${f2(c.raw.g.value_per_dollar_original)} · $${Math.round(c.raw.g.ticket_price)} ticket`
          :`avg design payout at $${c.raw.p}: ${f2(c.raw.y)}/$ (unweighted)`}}},
        onClick:(e,els,ch)=>{const el=els.find(x=>x.datasetIndex===0);
          if(el)go("game",ch.data.datasets[0].data[el.index].g.game_no);}}});
  }

  /* ================= [4] buy-zone quadrant ================= */
  let quadChart=null;
  function buildQuad(){
    const ys=qd.map(d=>d.y);
    const yLo=Math.floor((Math.min(...ys)-0.03)*100)/100, yHi=Math.ceil((Math.max(...ys)+0.03)*100)/100;
    return newChart(document.getElementById("ins-quadC"),{type:"scatter",
      data:{datasets:[
        {data:qd,pointHoverRadius:9,
         pointRadius:qd.map(d=>(mob?2.4:3)+Math.sqrt(d.g.ticket_price||1)*(mob?1.1:1.4)),
         pointBackgroundColor:qd.map(d=>{
           const g=d.g,base=(g.value_per_dollar_now>=0.78&&g.pct_value_remaining>=40)?"#2FB6A8":g.dead?"#E24B5B":"#7d8f87";
           return inTier(g)?base:FADE;})},
        {type:"line",data:[{x:0,y:0.78},{x:100,y:0.78}],borderColor:"rgba(125,143,135,.55)",borderWidth:1,borderDash:[5,4],pointRadius:0,pointHoverRadius:0,fill:false},
        {type:"line",data:[{x:40,y:yLo},{x:40,y:yHi}],borderColor:"rgba(125,143,135,.55)",borderWidth:1,borderDash:[5,4],pointRadius:0,pointHoverRadius:0,fill:false}]},
      options:{responsive:true,maintainAspectRatio:false,
        scales:{x:{min:0,max:100,title:{display:true,text:"% of prize value remaining",font:{size:11}},ticks:{font:{size:10.5},callback:v=>v+"%"}},
                y:{min:yLo,max:yHi,title:{display:true,text:"EV per $1 now",font:{size:11}},ticks:{font:{size:10.5}}}},
        plugins:{legend:{display:false},
          tooltip:{filter:i=>i.datasetIndex===0,callbacks:{label:c=>
            `${c.raw.g.game_name}: ${f2(c.raw.y)}/$ · ${pct(c.raw.x)} left · $${Math.round(c.raw.g.ticket_price)} ticket`}}},
        onClick:(e,els)=>{const el=els.find(x=>x.datasetIndex===0);if(el)go("game",qd[el.index].g.game_no);}},
      plugins:[{id:"insQuadLabels",afterDatasetsDraw(ch){try{
        const x=ch.scales.x,y=ch.scales.y,ctx=ch.ctx;
        ctx.save();ctx.font="600 11px "+fam();
        ctx.fillStyle="#2FB6A8";ctx.textAlign="right";
        ctx.fillText("fresh & rich",x.getPixelForValue(99),y.getPixelForValue(yHi)+14);
        ctx.fillStyle="#7d8f87";ctx.textAlign="left";
        ctx.fillText("drained",x.getPixelForValue(2)+4,y.getPixelForValue(yLo)-10);
        ctx.restore();}catch(err){}}}]});
  }

  safe("reality strip","#ins-strip .chartbox",()=>{
    if(!evOn.length)throw new Error("no EV data");
    stripChart=buildStrip();
  });
  safe("buy zone","#ins-quad .chartbox",()=>{
    if(!qd.length)throw new Error("no quadrant data");
    quadChart=buildQuad();
  });
  segWire("ins-tierSeg",v=>{
    tierSel=v;
    try{if(stripChart)stripChart.destroy();stripChart=buildStrip();}
    catch(e){console.warn("insights: strip filter failed",e);chartNote("#ins-strip .chartbox");}
    try{if(quadChart)quadChart.destroy();quadChart=buildQuad();}
    catch(e){console.warn("insights: quad filter failed",e);chartNote("#ins-quad .chartbox");}
  });

  /* ================= [5] jackpot dream tracker ================= */
  safe("dream tracker","#ins-dream .chartbox",()=>{
    if(dd.length<5)throw new Error("too few eligible games");
    const all=dd.flatMap(d=>[d.x,d.y]);
    const lo=Math.min(...all)*0.8, hi=Math.max(...all)*1.25;
    newChart(document.getElementById("ins-dreamC"),{type:"scatter",
      data:{datasets:[
        {data:dd,pointHoverRadius:9,
         pointRadius:dd.map(d=>(mob?1.8:2.2)+Math.sqrt(d.g.ticket_price||1)*(mob?0.9:1.15)),
         pointBackgroundColor:dd.map(d=>{const r=d.x/d.y;return r>=1.15?"#2FB6A8":r<=1/1.15?"#E24B5B":"#7d8f87";})},
        {type:"line",data:[{x:lo,y:lo},{x:hi,y:hi}],borderColor:"rgba(125,143,135,.6)",borderWidth:1.2,borderDash:[6,4],pointRadius:0,pointHoverRadius:0,fill:false}]},
      options:{responsive:true,maintainAspectRatio:false,
        scales:{x:{type:"logarithmic",min:lo,max:hi,title:{display:true,text:"designed top-prize odds",font:{size:11}},
                   ticks:{maxTicksLimit:mob?4:6,font:{size:mob?9:10},callback:v=>shortOdds(v)}},
                y:{type:"logarithmic",min:lo,max:hi,title:{display:true,text:"live top-prize odds (est.)",font:{size:11}},
                   ticks:{maxTicksLimit:6,font:{size:mob?9:10},callback:v=>shortOdds(v)}}},
        plugins:{legend:{display:false},
          tooltip:{filter:i=>i.datasetIndex===0,callbacks:{label:c=>{
            const d=c.raw,r=d.x/d.y;
            return `${d.g.game_name} ($${Math.round(d.g.ticket_price)}): designed ${oddsF(Math.round(d.x))} → now ${oddsF(Math.round(d.y))} (${r>=1?r.toFixed(1)+"× better":(1/r).toFixed(1)+"× worse"})`;}}}},
        onClick:(e,els)=>{const el=els.find(x=>x.datasetIndex===0);if(el)go("game",dd[el.index].g.game_no);}},
      plugins:[{id:"insDreamLabels",afterDatasetsDraw(ch){try{
        const a=ch.chartArea,ctx=ch.ctx;
        ctx.save();ctx.font="600 10.5px "+fam();
        ctx.fillStyle="#2FB6A8";ctx.textAlign="right";
        ctx.fillText("better than designed",a.right-6,a.bottom-10);
        ctx.fillStyle="#E24B5B";ctx.textAlign="left";
        ctx.fillText("worse than designed",a.left+6,a.top+12);
        ctx.restore();}catch(err){}}}]});
  });

  /* ================= [6] EV drift ================= */
  let driftChart=null,driftMode="top";
  function buildDrift(){
    const rows=driftMode==="all"?dr:[...dr.slice(0,7),...dr.slice(-7)];
    const box=document.getElementById("ins-driftBox");
    box.style.height=driftMode==="all"?Math.max(340,rows.length*14+70)+"px":"";
    return newChart(document.getElementById("ins-driftC"),{type:"bar",
      data:{labels:rows.map(g=>g.game_name.slice(0,mob?18:24)),
        datasets:[{data:rows.map(g=>+g.drift.toFixed(3)),
          backgroundColor:rows.map(g=>g.drift>=0?"#2FB6A8":"#E24B5B")}]},
      options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{
          title:it=>rows[it[0].dataIndex].game_name,
          label:c=>`${c.raw>=0?"+":""}${c.raw} EV/$ vs design`}}},
        scales:{x:{title:{display:true,text:"EV per $1: now − design",font:{size:11}},ticks:{font:{size:10}}},
                y:{ticks:{font:{size:driftMode==="all"?9.5:10.5},autoSkip:false}}},
        onClick:(e,els)=>{if(els.length)go("game",rows[els[0].index].game_no);}}});
  }
  safe("EV drift","#ins-drift .chartbox",()=>{
    if(!dr.length)throw new Error("no drift data");
    driftChart=buildDrift();
    segWire("ins-driftSeg",v=>{
      driftMode=v;
      try{if(driftChart)driftChart.destroy();driftChart=buildDrift();}
      catch(e){console.warn("insights: drift toggle failed",e);chartNote("#ins-drift .chartbox");}
    });
  });

  /* ================= [7] claims clock ================= */
  safe("claims clock (weekday)","#ins-clock .grid2 > div:first-child .chartbox",()=>{
    const dow=[0,0,0,0,0,0,0];
    for(const w of W){
      if(!w[1])continue;
      const dt=new Date(w[1]+"T12:00:00");
      if(!isNaN(dt))dow[(dt.getDay()+6)%7]++;
    }
    const labels=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    newChart(document.getElementById("ins-dowC"),{type:"bar",
      data:{labels,datasets:[{data:dow,minBarLength:5,
        backgroundColor:dow.map((v,i)=>i<5?"#7d8f87":"rgba(226,75,91,.12)"),
        borderColor:dow.map((v,i)=>i<5?"rgba(0,0,0,0)":"#E24B5B"),
        borderWidth:dow.map((v,i)=>i<5?0:1.5)}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{
          label:c=>`${dow[c.dataIndex]} claims${dow[c.dataIndex]===0?" — district offices closed":""}`}}},
        scales:{x:{ticks:{font:{size:10.5}}},y:{ticks:{font:{size:10}}}}}});
  });
  safe("claims clock (month)","#ins-clock .grid2 > div:last-child .chartbox",()=>{
    const mon=new Array(12).fill(0);
    for(const w of W){
      if(!w[1])continue;
      const m=+w[1].slice(5,7);
      if(m>=1&&m<=12)mon[m-1]++;
    }
    const labels=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    newChart(document.getElementById("ins-monC"),{type:"bar",
      data:{labels,datasets:[{data:mon,backgroundColor:mon.map((v,i)=>i===0?"#FF9E4A":"#7d8f87")}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{
          label:c=>`${mon[c.dataIndex]} claims, all years pooled`}}},
        scales:{x:{ticks:{font:{size:mob?9:10.5}}},y:{ticks:{font:{size:10}}}}}});
  });

  /* ================= [8] anonymity era ================= */
  safe("anonymity trend","#ins-anon .grid2 > div:first-child .chartbox",()=>{
    const am={};
    for(const w of W){
      if(w[1]&&w[1]>="2025-07"){
        const m=w[1].slice(0,7);
        (am[m]=am[m]||[0,0])[0]++;
        if(anon(w[2]))am[m][1]++;
      }
    }
    const ams=Object.keys(am).sort();
    if(!ams.length)throw new Error("no monthly rows");
    newChart(document.getElementById("ins-anonC"),{type:"bar",
      data:{labels:ams,datasets:[{data:ams.map(m=>+(100*am[m][1]/am[m][0]).toFixed(0)),
        backgroundColor:ams.map(m=>m>="2026-04"?"#FF6F91":"#7d8f87")}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{
          const d=am[ams[c.dataIndex]];
          return `${c.raw}% anonymous (${d[1]} of ${d[0]} claims)`;}}}},
        scales:{y:{min:0,max:100,ticks:{callback:v=>v+"%",font:{size:10}}},
                x:{ticks:{maxRotation:60,font:{size:mob?8.5:9.5}}}}},
      plugins:[{id:"insShieldLine",afterDraw(ch){try{
        const i=ch.data.labels.findIndex(l=>l>="2026-04");
        if(i<0)return;
        const xs=ch.scales.x,ys=ch.scales.y,ctx=ch.ctx;
        const px=i>0?(xs.getPixelForValue(i-1)+xs.getPixelForValue(i))/2:xs.getPixelForValue(i)-12;
        ctx.save();ctx.strokeStyle="#FF6F91";ctx.setLineDash([4,4]);ctx.lineWidth=1.2;
        ctx.beginPath();ctx.moveTo(px,ys.top);ctx.lineTo(px,ys.bottom);ctx.stroke();
        ctx.setLineDash([]);ctx.fillStyle="#FF6F91";ctx.font="600 10px "+fam();ctx.textAlign="left";
        ctx.fillText("F.S. 24.1051",px+4,ys.top+10);
        ctx.restore();}catch(err){}}}]});
  });
  safe("anonymity by prize size","#ins-anon .grid2 > div:last-child .chartbox",()=>{
    const since=W.filter(w=>w[1]&&w[1]>="2026-04");
    if(!since.length)throw new Error("no post-shield rows");
    const bks=[["under $1M",0,1e6],["$1M–5M",1e6,5e6],["$5M+",5e6,Infinity]].map(([lab,lo,hi])=>{
      const rows=since.filter(w=>(w[6]||0)>=lo&&(w[6]||0)<hi);
      const a=rows.filter(w=>anon(w[2])).length;
      return {lab,n:rows.length,a,pct:rows.length?100*a/rows.length:0};
    });
    newChart(document.getElementById("ins-anonSzC"),{type:"bar",
      data:{labels:bks.map(b=>[b.lab,`${b.a} of ${b.n} anon`]),
        datasets:[{data:bks.map(b=>+b.pct.toFixed(0)),backgroundColor:"#FF6F91",maxBarThickness:90}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{
          const b=bks[c.dataIndex];
          return `${c.raw}% anonymous — ${b.a} of ${b.n} claims (n=${b.n})`;}}}},
        scales:{y:{min:0,max:100,ticks:{callback:v=>v+"%",font:{size:10}}},
                x:{ticks:{font:{size:mob?9.5:11}}}}},
      plugins:[{id:"insAnonVals",afterDatasetsDraw(ch){try{
        const meta=ch.getDatasetMeta(0),ctx=ch.ctx;
        ctx.save();ctx.font="700 11px "+fam();ctx.fillStyle="#FF6F91";ctx.textAlign="center";
        meta.data.forEach((el,i)=>ctx.fillText(ch.data.datasets[0].data[i]+"%",el.x,el.y-6));
        ctx.restore();}catch(err){}}}]});
  });
}

})();
