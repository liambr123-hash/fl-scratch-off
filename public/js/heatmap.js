/* heatmap module — Heat-map toggle on the All Tickets table.
   Colorizes chosen numeric columns (Score, EV/$ now, Value left, Profit odds)
   along a coral(bad) -> tangerine -> teal(good) ramp, normalized across the
   currently visible rows. Re-applies after every makeTable re-render (sort /
   filter) via a MutationObserver on #tbl. Robust to column re-ordering because
   columns are located by their header label text. Degrades silently. */
(function(){
  "use strict";

  try{
    FLX.css(`
      .hm-toggle{display:inline-flex;align-items:center;gap:7px;cursor:pointer;
        user-select:none;font-size:13px;color:var(--muted);
        padding:6px 11px;border:1px solid var(--border);border-radius:8px;
        background:var(--panel2);line-height:1;white-space:nowrap;}
      .hm-toggle:hover{border-color:var(--teal);color:var(--text);}
      .hm-toggle.on{border-color:var(--teal);color:var(--text);
        box-shadow:inset 0 0 0 1px var(--teal);}
      .hm-toggle input{position:absolute;opacity:0;width:0;height:0;pointer-events:none;}
      .hm-toggle .hm-dot{width:9px;height:9px;border-radius:50%;
        background:linear-gradient(90deg,var(--coral),var(--tangerine),var(--teal));
        display:inline-block;flex:0 0 auto;opacity:.45;transition:opacity .15s;}
      .hm-toggle.on .hm-dot{opacity:1;}
      #tbl td.hm-cell{transition:background-color .12s ease;}
    `);
  }catch(e){/* css injection is best-effort */}

  // Columns we colorize, keyed by their exact header label text.
  // dir: +1 => higher value is better (teal), -1 => lower value is better (teal).
  const HEAT = {
    "Score":       { dir: +1 },
    "EV/$ now":    { dir: +1 },
    "Value left":  { dir: +1 },
    "Profit odds": { dir: -1 },  // "1 in X" — lower X is better
  };

  // Ramp stops: bad -> mid -> good, using the theme accent hues.
  // t in [0,1] where 0 = worst, 1 = best. Alpha kept low for dark-panel contrast.
  const STOPS = [
    { rgb:[226, 75, 91],  t:0   },  // --coral     (bad)
    { rgb:[255,158, 74],  t:0.5 },  // --tangerine (mid)
    { rgb:[ 47,182,168],  t:1   },  // --teal      (good)
  ];
  const ALPHA = 0.30;

  function lerp(a,b,u){ return a+(b-a)*u; }
  function rampColor(t){
    if(t<=0) return STOPS[0].rgb;
    if(t>=1) return STOPS[STOPS.length-1].rgb;
    for(let i=0;i<STOPS.length-1;i++){
      const s0=STOPS[i], s1=STOPS[i+1];
      if(t>=s0.t && t<=s1.t){
        const u=(s1.t===s0.t)?0:(t-s0.t)/(s1.t-s0.t);
        return [
          Math.round(lerp(s0.rgb[0],s1.rgb[0],u)),
          Math.round(lerp(s0.rgb[1],s1.rgb[1],u)),
          Math.round(lerp(s0.rgb[2],s1.rgb[2],u)),
        ];
      }
    }
    return STOPS[STOPS.length-1].rgb;
  }

  // Pull a comparable number out of a cell's text.
  // Strips $, %, commas, the multiply glyph; understands "1 in X" and "1:X".
  // Returns null for the em-dash / no-value / unparseable.
  function parseNum(text){
    if(text==null) return null;
    let s=String(text).trim();
    if(!s || s==="—" || s==="-") return null;
    // "1 in 3.4" -> 3.4 ; "1:3.39" -> 3.39
    let m=s.match(/1\s*(?:in|:)\s*([\d,.]+)/i);
    if(m){ const v=parseFloat(m[1].replace(/,/g,"")); return isFinite(v)?v:null; }
    // otherwise strip currency / percent / separators and read first number
    s=s.replace(/[$,%×xX]/g,"").replace(/[^\d.\-]/g," ").trim();
    m=s.match(/-?\d*\.?\d+/);
    if(!m) return null;
    const v=parseFloat(m[0]);
    return isFinite(v)?v:null;
  }

  // ---- per-view state (reset on each tickets view) ----
  let state=null;

  function clearCells(tbl){
    if(!tbl) return;
    tbl.querySelectorAll("td.hm-cell").forEach(td=>{
      td.style.backgroundColor="";
      td.classList.remove("hm-cell");
    });
  }

  function teardown(){
    if(!state) return;
    try{ if(state.obs) state.obs.disconnect(); }catch(e){}
    try{ clearCells(state.tbl); }catch(e){}
    state=null;
  }

  // Locate the target column indices from the current header row.
  function columnMap(table){
    const map={}; // label -> colIndex
    const ths=table.querySelectorAll("thead th");
    ths.forEach((th,i)=>{
      // header may contain a sort-arrow span; use the label text only
      const label=(th.textContent||"").replace(/[▼▲]/g,"").trim();
      if(HEAT[label] && !(label in map)) map[label]=i;
    });
    return map;
  }

  function apply(tbl){
    if(!tbl || !state || !state.on) return;
    const table=tbl.querySelector("table");
    if(!table) return;

    // Clear any previous tinting first (row set / order may have changed).
    clearCells(tbl);

    const map=columnMap(table);
    const bodyRows=Array.from(table.querySelectorAll("tbody tr"));
    if(!bodyRows.length) return;

    for(const label in map){
      const ci=map[label], spec=HEAT[label];
      // gather values for this column across visible rows
      const cells=[];
      let min=Infinity, max=-Infinity;
      for(const tr of bodyRows){
        const td=tr.children[ci];
        if(!td) continue;
        const v=parseNum(td.textContent);
        if(v==null){ cells.push({td,v:null}); continue; }
        cells.push({td,v});
        if(v<min) min=v;
        if(v>max) max=v;
      }
      if(!(max>min)) continue; // no spread (all equal / single value) -> skip
      const span=max-min;
      for(const c of cells){
        if(c.v==null) continue;
        let norm=(c.v-min)/span;      // 0..1, higher raw value = 1
        if(spec.dir<0) norm=1-norm;   // invert when lower is better
        const rgb=rampColor(norm);
        c.td.classList.add("hm-cell");
        c.td.style.backgroundColor=`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${ALPHA})`;
      }
    }
  }

  function setOn(on){
    if(!state) return;
    state.on=!!on;
    if(state.btn) state.btn.classList.toggle("on",state.on);
    if(state.chk) state.chk.checked=state.on;
    if(state.on) apply(state.tbl);
    else clearCells(state.tbl);
  }

  function initTicketsView(){
    // fresh view => drop any previous observer/state
    teardown();

    const panel=document.querySelector("#tbl");
    if(!panel) return; // table container not present -> degrade silently
    // The .controls bar lives as a sibling above #tbl in the same panel.
    const panelBox=panel.closest(".panel")||document;
    const controls=panelBox.querySelector(".controls");
    if(!controls) return;
    if(controls.querySelector(".hm-toggle")) return; // already wired (defensive)

    // Build the toggle control.
    const label=document.createElement("label");
    label.className="hm-toggle";
    label.title="Colorize Score, EV/$, Value left and Profit odds by rank";
    const chk=document.createElement("input");
    chk.type="checkbox";
    const dot=document.createElement("span");
    dot.className="hm-dot";
    const txt=document.createTextNode("Heat-map");
    label.append(chk,dot,txt);
    controls.appendChild(label);

    state={ on:false, tbl:panel, btn:label, chk:chk, obs:null };

    // The label wraps the checkbox, so a click toggles chk natively; sync after.
    label.addEventListener("click",function(){
      setTimeout(function(){ setOn(chk.checked); },0);
    });

    // Watch the table body for makeTable re-renders (sort / filter rebuild the
    // whole table via innerHTML), and re-tint whenever it changes.
    try{
      const obs=new MutationObserver(function(){
        if(state && state.on){
          // re-tint on next tick so the new DOM is fully in place
          // (setTimeout, not rAF: rAF never fires in hidden/background tabs)
          setTimeout(function(){ try{ apply(state.tbl); }catch(e){} },0);
        }
      });
      obs.observe(panel,{childList:true,subtree:true});
      state.obs=obs;
    }catch(e){/* observer unsupported -> toggle still works on first render */}
  }

  document.addEventListener("flx:view",function(e){
    try{
      const tab=e && e.detail && e.detail.tab;
      if(tab==="tickets"){
        // #main has just been rebuilt; wait a tick for #tbl to be populated.
        // (setTimeout, not rAF: rAF never fires in hidden/background tabs)
        setTimeout(function(){ try{ initTicketsView(); }catch(err2){/* degrade silently */} },0);
      }else{
        teardown();
      }
    }catch(err){/* never throw out of a route render */}
  });

})();
