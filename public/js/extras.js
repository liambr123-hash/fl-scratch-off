/* extras module — print cheat-sheet + history trend arrows + share button
   Three small, independent features. Each is wrapped in its own try/catch so a
   failure in one never disables the others and never throws during a route render. */
(function(){
  "use strict";

  /* ---------- scoped styles (never touch style.css; use CSS vars for light mode) ---------- */
  try{
    FLX.css(`
      .flx-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}
      .flx-btn{display:inline-flex;align-items:center;gap:6px;background:var(--panel2);
        color:var(--text);border:1px solid var(--border);border-radius:9px;
        padding:7px 13px;font:600 13px var(--sans);cursor:pointer;transition:border-color .12s,color .12s}
      .flx-btn:hover{border-color:var(--flamingo);color:var(--text)}
      .flx-btn:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
      .flx-btn .ok{color:var(--good)}
      .flx-btn.quiet{background:transparent;color:var(--muted);font-weight:500;font-size:12.5px;
        padding:5px 11px;border-color:var(--border);white-space:nowrap;flex:none}
      .flx-btn.quiet:hover{color:var(--text);border-color:var(--teal)}
      .flx-trend{color:var(--muted);font-size:13px;margin:-6px 0 14px;display:flex;gap:14px;flex-wrap:wrap;align-items:baseline}
      .flx-trend .lab{color:var(--dim)}
      .flx-trend .up{color:var(--good)}
      .flx-trend .down{color:var(--bad)}
      .flx-trend .flat{color:var(--dim)}

      /* the printable cheat-sheet lives hidden until we print it */
      #flx-cheat{display:none}
      #flx-cheat h1{font-family:var(--serif);font-size:22px;margin:0 0 2px}
      #flx-cheat .cs-sub{color:var(--muted);font-size:12px;margin:0 0 14px}
      #flx-cheat .cs-sec{margin:0 0 14px;break-inside:avoid}
      #flx-cheat h2{font-family:var(--serif);font-size:15px;margin:0 0 5px;border-bottom:1px solid var(--border);padding-bottom:3px}
      #flx-cheat table{width:100%;border-collapse:collapse;font-size:12px}
      #flx-cheat td,#flx-cheat th{text-align:left;padding:2px 8px 2px 0;vertical-align:top}
      #flx-cheat th{color:var(--dim);font-weight:600;font-size:11px}
      #flx-cheat td.r,#flx-cheat th.r{text-align:right}
      #flx-cheat .cs-foot{color:var(--dim);font-size:10.5px;margin-top:10px}
      #flx-cheat .cs-avoid{color:var(--bad)}

      @media print{
        /* hide the entire live app, show only the cheat-sheet */
        body>header,body>footer,#main,.ticker{display:none !important}
        #flx-cheat{display:block !important;color:#000;background:#fff;
          max-width:100%;margin:0;padding:0;font-family:var(--sans)}
        #flx-cheat h1,#flx-cheat h2{color:#000}
        #flx-cheat h2{border-bottom:1px solid #999}
        #flx-cheat .cs-sub,#flx-cheat th,#flx-cheat .cs-foot{color:#555}
        #flx-cheat .cs-avoid{color:#000;font-weight:600}
        #flx-cheat td,#flx-cheat th{border-bottom:.5px solid #ddd}
        @page{margin:14mm}
      }
    `);
  }catch(e){/* styles are best-effort */}

  /* ============================================================
     FEATURE 1 — printable cheat-sheet on the Overview
     ============================================================ */
  (function(){
    let mounted=false; // guard so re-entering overview doesn't stack buttons

    function esc2(s){ try{return esc(s);}catch(_){return String(s==null?"":s);} }

    function priceBand(p){
      p=Math.round(p||0);
      if(p<=2) return "$1–2";
      if(p<=5) return "$3–5";
      if(p<=9) return "$6–9";
      if(p<=10) return "$10";
      if(p<=25) return "$20–25";
      return "$30+";
    }
    // canonical tier order for the sheet
    const BAND_ORDER=["$1–2","$3–5","$6–9","$10","$20–25","$30+"];

    function buildSheet(){
      let host=document.getElementById("flx-cheat");
      if(host) host.remove();
      host=document.createElement("div");
      host.id="flx-cheat";

      const on=G.filter(g=>g&&g.on_sale);
      // group scored, non-dead on-sale games by price band, top 3 by score each
      const byBand={};
      for(const g of on){
        if(g.score==null||g.dead) continue;
        const b=priceBand(g.ticket_price);
        (byBand[b]=byBand[b]||[]).push(g);
      }
      let secHtml="";
      for(const b of BAND_ORDER){
        const list=(byBand[b]||[]).sort((a,c)=>c.score-a.score).slice(0,3);
        if(!list.length) continue;
        secHtml+=`<div class="cs-sec"><h2>Best ${b} tickets</h2>
          <table><thead><tr><th>Game</th><th class="r">Score</th><th class="r">EV/$</th><th class="r">Value left</th></tr></thead><tbody>`+
          list.map(g=>`<tr><td>${esc2(g.game_name)} <span style="color:#888">#${esc2(g.game_no)}</span></td>`+
            `<td class="r">${g.score}</td>`+
            `<td class="r">${f2(g.value_per_dollar_now)}</td>`+
            `<td class="r">${pct(g.pct_value_remaining)}</td></tr>`).join("")+
          `</tbody></table></div>`;
      }

      // full dead-money avoid list
      const dead=on.filter(g=>g.dead).sort((a,c)=>(c.ticket_price||0)-(a.ticket_price||0));
      let deadHtml="";
      if(dead.length){
        deadHtml=`<div class="cs-sec"><h2 class="cs-avoid">Dead money — avoid (${dead.length})</h2>
          <p style="font-size:11px;color:#666;margin:0 0 4px">On sale, but the advertised top prize is already gone.</p>
          <table><thead><tr><th>Game</th><th class="r">Price</th><th>Advertised top</th></tr></thead><tbody>`+
          dead.map(g=>`<tr><td class="cs-avoid">${esc2(g.game_name)} <span style="color:#888">#${esc2(g.game_no)}</span></td>`+
            `<td class="r">$${Math.round(g.ticket_price||0)}</td>`+
            `<td>${esc2(g.top_prize_display||money(g.top_prize_value_num))}</td></tr>`).join("")+
          `</tbody></table></div>`;
      }

      const built=(M&&M.built)||"?";
      host.innerHTML=`
        <h1>Florida Scratch-Off cheat-sheet</h1>
        <p class="cs-sub">Best on-sale tickets by price tier &amp; the dead-money avoid list · data as of ${esc2(built)} · flscratchstats.com</p>
        ${secHtml||'<p class="cs-sub">No scored on-sale games available.</p>'}
        ${deadHtml}
        <p class="cs-foot">Every scratch-off is negative expected value (best ~$0.80–0.92 back per $1). "Score" is an open Value-Score formula; higher is less-bad, not a good investment. Odds and prizes change constantly — verify with the Florida Lottery. Not affiliated with the Florida Lottery. Play responsibly · 1-888-ADMIT-IT.</p>`;
      document.body.appendChild(host);
      return host;
    }

    function doPrint(){
      let host=null;
      try{ host=buildSheet(); }catch(e){ return; }
      const cleanup=()=>{ try{ host&&host.remove(); }catch(_){}
        window.removeEventListener("afterprint",cleanup); };
      window.addEventListener("afterprint",cleanup);
      // belt-and-suspenders: remove even if afterprint never fires
      setTimeout(cleanup,60000);
      try{ window.print(); }
      catch(e){ cleanup(); }
    }

    function mount(){
      try{
        if(mounted && document.getElementById("flx-print-btn")) return;
        // insert a tools bar with the print button at the very top of #main
        const main=(typeof mainEl!=="undefined"&&mainEl)||document.querySelector("#main");
        if(!main) return;
        if(document.getElementById("flx-print-btn")) return; // already present this render
        const btn=document.createElement("button");
        btn.type="button"; btn.id="flx-print-btn"; btn.className="flx-btn quiet";
        btn.title="Open a printable one-page cheat-sheet"; btn.textContent="Print cheat-sheet";
        // preferred home: docked on the right of the statistical-anomaly bar
        const ab=main.querySelector(".alertbar");
        if(ab){
          btn.onclick=function(ev){ ev.stopPropagation(); doPrint(); }; // don't trigger the bar's game link
          ab.appendChild(btn);
        }else{
          // fallback: small tools row after the ticker
          const bar=document.createElement("div");
          bar.className="flx-tools";
          bar.appendChild(btn);
          btn.onclick=doPrint;
          const ticker=main.querySelector(".ticker");
          if(ticker&&ticker.parentNode===main) ticker.insertAdjacentElement("afterend",bar);
          else main.insertAdjacentElement("afterbegin",bar);
        }
        mounted=true;
      }catch(e){/* silent */}
    }

    try{
      document.addEventListener("flx:view",function(e){
        try{
          if(!e||!e.detail||e.detail.tab!=="overview") return;
          mount();
        }catch(_){}
      });
    }catch(e){/* silent */}
  })();

  /* ============================================================
     FEATURE 2 — history trend arrows on game detail
     ============================================================ */
  (function(){
    let DAYS=null;     // array of day snapshots, oldest->newest
    let loaded=false;

    // fetch history.json exactly once, after first route
    try{
      FLX.ready.push(function(){
        try{
          if(loaded) return; loaded=true;
          fetch("history.json").then(function(r){
            if(!r||!r.ok) throw new Error("bad response");
            return r.json();
          }).then(function(j){
            try{
              const days=(j&&Array.isArray(j.days))?j.days.slice():[];
              // sort oldest->newest by date string (sortable YYYY-MM-DD)
              days.sort(function(a,b){ return String(a&&a.d).localeCompare(String(b&&b.d)); });
              DAYS=days;
            }catch(_){ DAYS=null; }
          }).catch(function(){ DAYS=null; });
        }catch(_){ DAYS=null; }
      });
    }catch(e){/* silent */}

    function arrow(delta,invertGood){
      // invertGood=false -> up is good (EV/$); true is unused here but kept generic
      if(delta==null||isNaN(delta)||Math.abs(delta)<1e-9)
        return '<span class="flat">no change</span>';
      const up=delta>0;
      const good=invertGood?!up:up;
      const glyph=up?"▲":"▼"; // ▲ ▼ (typographic, not emoji)
      return `<span class="${good?"up":"down"}">${glyph}</span>`;
    }

    function fmtDelta(delta,digits){
      if(delta==null||isNaN(delta)) return "";
      const s=(delta>0?"+":"")+(+delta).toFixed(digits);
      return s;
    }

    function render(g){
      try{
        if(!g) return;
        const main=(typeof mainEl!=="undefined"&&mainEl)||document.querySelector("#main");
        if(!main) return;
        // avoid duplicates if gameExtras runs twice for the same view
        const old=main.querySelector(".flx-trend"); if(old) old.remove();

        const box=document.createElement("div");
        box.className="flx-trend";

        if(!Array.isArray(DAYS)||DAYS.length<2){
          box.innerHTML=`<span class="lab">Daily trend data starts accruing — check back in a few days.</span>`;
        }else{
          const latest=DAYS[DAYS.length-1];
          const prev=DAYS[DAYS.length-2];
          const cur=latest&&latest.g&&latest.g[g.game_no];
          const was=prev&&prev.g&&prev.g[g.game_no];
          if(!cur||!was){
            return; // no history for this game; render nothing
          }
          // snapshot shape: [top_prizes_remaining, pct_value_remaining, value_per_dollar_now]
          const tpNow=cur[0], tpWas=was[0];
          const evNow=cur[2], evWas=was[2];
          const parts=[];
          parts.push(`<span class="lab">since ${esc(String(prev.d))}:</span>`);
          if(tpNow!=null&&tpWas!=null){
            const d=tpNow-tpWas;
            parts.push(`<span>top prizes ${arrow(d,true)} ${d===0?"unchanged":fmtDelta(d,0)}</span>`);
          }
          if(evNow!=null&&evWas!=null){
            const d=evNow-evWas;
            parts.push(`<span>EV/$ ${arrow(d,false)} ${Math.abs(d)<1e-9?"unchanged":fmtDelta(d,3)}</span>`);
          }
          if(parts.length<=1) return; // nothing comparable
          box.innerHTML=parts.join("");
        }

        // insert near the top of #main, right after the subtitle block(s)
        const subs=main.querySelectorAll(".gsub");
        const anchor=subs.length?subs[subs.length-1]:main.querySelector(".gtitle");
        if(anchor&&anchor.parentNode) anchor.insertAdjacentElement("afterend",box);
        else main.insertAdjacentElement("afterbegin",box);
      }catch(e){/* silent */}
    }

    try{
      FLX.gameExtras.push(function(g){ render(g); });
    }catch(e){/* silent */}
  })();

  /* ============================================================
     FEATURE 3 — share button on game detail
     ============================================================ */
  (function(){
    function share(btn){
      try{
        const url=location.href;
        const title=(function(){
          const t=document.querySelector(".gtitle");
          return (t?t.textContent.trim():document.title)||"FL Scratch-Off";
        })();
        if(navigator.share){
          navigator.share({title:title,url:url}).catch(function(){/* user cancelled or failed; ignore */});
          return;
        }
        const flash=function(){
          try{
            const orig=btn.getAttribute("data-orig")||btn.textContent;
            btn.setAttribute("data-orig",orig);
            btn.innerHTML='<span class="ok">Link copied</span>';
            setTimeout(function(){ try{ btn.textContent=orig; }catch(_){}} ,1600);
          }catch(_){}
        };
        if(navigator.clipboard&&navigator.clipboard.writeText){
          navigator.clipboard.writeText(url).then(flash).catch(function(){/* clipboard blocked */});
        }else{
          // legacy fallback
          try{
            const ta=document.createElement("textarea");
            ta.value=url; ta.style.position="fixed"; ta.style.opacity="0";
            document.body.appendChild(ta); ta.select();
            document.execCommand("copy"); ta.remove(); flash();
          }catch(_){}
        }
      }catch(e){/* silent */}
    }

    function render(g){
      try{
        const main=(typeof mainEl!=="undefined"&&mainEl)||document.querySelector("#main");
        if(!main) return;
        if(main.querySelector("#flx-share-btn")) return; // avoid duplicates
        const bar=document.createElement("div");
        bar.className="flx-tools";
        bar.innerHTML=`<button type="button" id="flx-share-btn" class="flx-btn" title="Share this game">Share</button>`;
        // place near the top: right after the back link if present
        const back=main.querySelector(".back");
        if(back&&back.parentNode) back.insertAdjacentElement("afterend",bar);
        else main.insertAdjacentElement("afterbegin",bar);
        const btn=document.getElementById("flx-share-btn");
        if(btn) btn.onclick=function(){ share(btn); };
      }catch(e){/* silent */}
    }

    try{
      FLX.gameExtras.push(function(g){ render(g); });
    }catch(e){/* silent */}
  })();

})();
