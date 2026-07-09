/* sim module — Monte Carlo "scratch a stack" simulator, appended to each game-detail page.
   Registers via FLX.gameExtras. Draws N tickets against the LIVE remaining-prize
   distribution (with-replacement approximation), 20k trials, and reports the honest
   spread of outcomes: median net, % of stacks that lost money, best/worst, P(top prize). */
(function(){
  "use strict";

  FLX.css(`
    .sim-controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .sim-note{font-size:12.5px;color:var(--dim);line-height:1.5;margin-top:2px}
    .sim-btn{background:var(--accent);border:none;color:#fff;padding:8px 18px;border-radius:9px;
      font:600 13px var(--sans);cursor:pointer}
    .sim-btn:disabled{opacity:.5;cursor:default}
    .sim-verdict{font-family:var(--serif);font-size:15px;line-height:1.5;margin:10px 0 4px}
    .sim-cards .card .val{font-size:22px}
    .sim-hist{position:relative;height:220px;margin-top:14px}
    .sim-empty{color:var(--muted);font-size:13px;padding:6px 0}
  `);

  const TRIALS = 20000;

  // Build a cumulative distribution over prize outcomes for ONE ticket.
  // Returns { cum:[cumProbAfterTierI], vals:[prizeValueI], loseP, topVal, topP } or null.
  function buildDist(g){
    const N = g && g.est_tickets_remaining;
    if(!N || !isFinite(N) || N <= 0) return null;
    const tiers = (typeof T!=="undefined" && T[g.game_no]) || [];
    if(!tiers.length) return null;

    const vals=[], cum=[];
    let acc=0, topVal=0, topP=0;
    for(let i=0;i<tiers.length;i++){
      const t = tiers[i];
      const val = +t[1], rem = +t[3];
      if(!isFinite(val) || !isFinite(rem) || rem<=0) continue;
      const p = rem / N;
      if(p<=0) continue;
      acc += p;
      vals.push(val);
      cum.push(acc);
      if(val>topVal){ topVal=val; topP=p; }
    }
    if(!vals.length) return null;
    // Numerical guard: if listed tier mass slightly exceeds 1 (stale counts), clamp.
    const winMass = Math.min(acc, 1);
    return { cum, vals, winMass, loseP: Math.max(0, 1-winMass), topVal, topP };
  }

  // One ticket draw: uniform r in [0,1). If r < a winning cumulative bound, pay that
  // tier's value; otherwise it's a losing ticket ($0). Linear scan over ~<=20 tiers.
  function drawTicket(d, r){
    const cum = d.cum, vals = d.vals, n = cum.length;
    for(let i=0;i<n;i++){ if(r < cum[i]) return vals[i]; }
    return 0; // residual mass = loser
  }

  function median(sortedAsc){
    const n = sortedAsc.length;
    if(!n) return 0;
    const m = n>>1;
    return (n&1) ? sortedAsc[m] : (sortedAsc[m-1]+sortedAsc[m])/2;
  }

  function runSim(d, N, price){
    const cost = N * price;
    const nets = new Float64Array(TRIALS);
    let lost = 0;
    let sumWin = 0;
    let best = -Infinity, worst = Infinity;
    let anyTop = 0;
    for(let t=0;t<TRIALS;t++){
      let win = 0, hitTop = false;
      for(let k=0;k<N;k++){
        const prize = drawTicket(d, Math.random());
        win += prize;
        if(d.topVal>0 && prize===d.topVal) hitTop = true;
      }
      const net = win - cost;
      nets[t] = net;
      sumWin += win;
      if(net < 0) lost++;
      if(net > best) best = net;
      if(net < worst) worst = net;
      if(hitTop) anyTop++;
    }
    const sorted = Array.prototype.slice.call(nets).sort((a,b)=>a-b);
    return {
      cost,
      medianNet: median(sorted),
      lostPct: 100*lost/TRIALS,
      best, worst,
      meanWinPerTicket: sumWin/(TRIALS*N),
      // Analytic P(>=1 top prize) — exact for with-replacement, robust for rare events.
      pTopAtLeastOne: d.topVal>0 ? (1 - Math.pow(1-d.topP, N)) : 0,
      simTopPct: 100*anyTop/TRIALS,
      nets: sorted
    };
  }

  // Histogram bins of net outcomes -> {labels, counts, colors}
  function histogram(sortedNets, breakEvenAtZero){
    const n = sortedNets.length;
    const lo = sortedNets[0], hi = sortedNets[n-1];
    if(hi<=lo){ return { labels:[money(lo)], counts:[n], colors:[color(lo)] }; }
    const BINS = 24;
    const span = hi - lo, w = span/BINS;
    const counts = new Array(BINS).fill(0);
    for(let i=0;i<n;i++){
      let b = Math.floor((sortedNets[i]-lo)/w);
      if(b>=BINS) b = BINS-1; if(b<0) b=0;
      counts[b]++;
    }
    const labels=[], colors=[];
    for(let b=0;b<BINS;b++){
      const mid = lo + (b+0.5)*w;
      labels.push(money(mid));
      colors.push(color(mid));
    }
    return { labels, counts, colors };
    function color(v){ return v>=0 ? "#2FB6A8" : "#E24B5B"; }
  }

  FLX.gameExtras.push(function(g){
    try{
      const d = buildDist(g);
      if(!d) return; // no valid remaining distribution -> append nothing, silently
      const price = +g.ticket_price;
      if(!isFinite(price) || price<=0) return;

      const mainEl = document.querySelector("#main");
      if(!mainEl) return;

      const html = `
        <div class="panel" id="simPanel">
          <h2>What if you scratched a stack? <span class="hint">Monte Carlo simulation on the live remaining prizes</span></h2>
          <p class="sim-note">Pick how many of these tickets you'd buy, then simulate ${num(TRIALS)} shoppers each buying that stack.
          Each ticket is drawn against the prizes still unclaimed right now. The house edge is the whole point&nbsp;&mdash; watch where the outcomes actually land.</p>
          <div class="sim-controls">
            <div class="seg" id="simN" role="group" aria-label="stack size">
              <button data-n="10" class="active">10 tickets</button>
              <button data-n="25">25</button>
              <button data-n="100">100</button>
            </div>
            <button class="sim-btn" id="simRun">Simulate</button>
            <span class="dim" id="simCost"></span>
          </div>
          <div id="simOut"><div class="sim-empty">Press Simulate to run ${num(TRIALS)} trials on the current remaining prizes.</div></div>
        </div>`;
      mainEl.insertAdjacentHTML("beforeend", html);

      const panel = document.querySelector("#simPanel");
      if(!panel) return;
      const segWrap = panel.querySelector("#simN");
      const costEl  = panel.querySelector("#simCost");
      const outEl   = panel.querySelector("#simOut");
      const runBtn  = panel.querySelector("#simRun");
      let N = 10;

      function updateCost(){ costEl.textContent = "= " + moneyFull(N*price) + " spent"; }
      updateCost();

      segWrap.querySelectorAll("button").forEach(b=>{
        b.onclick = ()=>{
          N = +b.dataset.n || 10;
          segWrap.querySelectorAll("button").forEach(x=>x.classList.toggle("active", x===b));
          updateCost();
        };
      });

      runBtn.onclick = function(){
        try{
          runBtn.disabled = true;
          const res = runSim(d, N, price);
          render(res);
        }catch(e){
          console.warn("sim run failed", e);
          outEl.innerHTML = '<div class="sim-empty">Simulation unavailable for this game.</div>';
        }finally{
          runBtn.disabled = false;
        }
      };

      function render(res){
        const won = res.lostPct < 100;
        const lossClass = res.lostPct>=50 ? "bad" : (res.lostPct<=0 ? "good" : "");
        const medClass  = res.medianNet>=0 ? "good" : "bad";
        const evPerTicket = res.meanWinPerTicket; // avg prize value returned per $ ticket
        const topLine = d.topVal>0
          ? `Chance of hitting the biggest remaining prize (${money(d.topVal)}) at least once across your ${num(N)} tickets: <b>${fmtTiny(res.pTopAtLeastOne)}</b>.`
          : `There are no top prizes left in this game, so a stack this size can't hit one.`;

        outEl.innerHTML = `
          <div class="sim-verdict">
            You spend <b>${moneyFull(res.cost)}</b> on ${num(N)} tickets.
            In <b class="${lossClass}">${pct(res.lostPct)}</b> of ${num(TRIALS)} simulated stacks you came out <b class="${lossClass}">behind</b>.
          </div>
          <div class="cards sim-cards">
            <div class="card"><div class="lab">Median net result</div><div class="val ${medClass}">${signed(res.medianNet)}</div><div class="note">the typical stack</div></div>
            <div class="card"><div class="lab">Lost money</div><div class="val ${lossClass}">${pct(res.lostPct)}</div><div class="note">of ${num(TRIALS)} stacks</div></div>
            <div class="card"><div class="lab">Best stack</div><div class="val good">${signed(res.best)}</div><div class="note">luckiest of ${num(TRIALS)}</div></div>
            <div class="card"><div class="lab">Worst stack</div><div class="val bad">${signed(res.worst)}</div><div class="note">unluckiest of ${num(TRIALS)}</div></div>
          </div>
          <p class="sim-note">${topLine}</p>
          <p class="sim-note">On average each ${moneyFull(price)} ticket returned about <b>${moneyFull(evPerTicket)}</b> in prizes here&nbsp;&mdash; roughly <b>${f2(evPerTicket/price)}</b> back per dollar spent.
          Draws are sampled <b>with replacement</b> from the remaining prize pool (a fine approximation at this scale); the residual probability is a $0 loser.</p>
          <div class="sim-hist"><canvas id="simHist"></canvas></div>`;

        try{
          const h = histogram(res.nets, res.cost);
          const cv = document.querySelector("#simHist");
          if(cv){
            newChart(cv, {
              type:"bar",
              data:{ labels:h.labels, datasets:[{ label:"stacks", data:h.counts, backgroundColor:h.colors, borderWidth:0, categoryPercentage:1, barPercentage:1 }] },
              options:{
                responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{display:false},
                  title:{display:true, text:"Distribution of net outcomes ("+num(TRIALS)+" stacks) — red = you lost money"},
                  tooltip:{ callbacks:{ title:items=>"net ≈ "+(items[0]?items[0].label:""), label:it=>num(it.parsed.y)+" stacks" } } },
                scales:{ x:{ ticks:{ maxRotation:0, autoSkip:true, maxTicksLimit:7 }, grid:{display:false} },
                         y:{ ticks:{ callback:v=>num(v) }, title:{display:false} } }
              }
            });
          }
        }catch(e){ console.warn("sim histogram failed", e); }
      }
    }catch(e){
      console.warn("sim gameExtra failed", e);
    }
  });

  // net formatting with explicit sign, using the site's compact money() for magnitude
  function signed(v){
    if(v==null || !isFinite(v)) return "—";
    if(v===0) return "±$0";
    const s = v>0 ? "+" : "−";
    return s + moneyFull(Math.abs(v));
  }
  // tiny probabilities: percent when readable, else 1-in-X, else scientific
  function fmtTiny(p){
    if(!isFinite(p) || p<=0) return "0%";
    if(p>=0.01) return pct(100*p);
    const oneIn = 1/p;
    if(oneIn <= 1e7) return "about 1 in " + num(oneIn);
    return (100*p).toExponential(1) + "%";
  }

})();
