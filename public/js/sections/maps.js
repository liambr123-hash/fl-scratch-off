/* maps section module — winner geography: 3-mode dot/flow map, county luck funnel, the Alabama line */
(function(){
"use strict";

FLX.css(`
.mx-flt{margin-top:-4px}
.mx-flt .flab{font-size:10.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
.mx-flt .seg button{padding:5px 10px;font-size:12px}
.mx-samecity{position:absolute;left:10px;bottom:12px;background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:6px 11px;font-size:12px;color:var(--muted);pointer-events:none;max-width:78%}
.mx-samecity i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--teal);margin-right:7px;font-style:normal;animation:mxpulse 1.7s ease-in-out infinite}
@keyframes mxpulse{0%,100%{opacity:.3}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){.mx-samecity i{animation:none}}
.mx-tip{position:absolute;pointer-events:none;opacity:0;background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:7px 11px;font-size:12.5px;line-height:1.5;transition:opacity .08s;white-space:nowrap;z-index:5;box-shadow:0 4px 18px rgba(0,0,0,.25)}
.mx-fwrap{position:relative}
.mx-dbar{display:flex;height:38px;border-radius:9px;overflow:hidden;border:1px solid var(--border);margin:4px 0 10px}
.mx-dbar span{display:flex;align-items:center;justify-content:center;gap:4px;font-size:11.5px;font-weight:600;color:var(--bg);min-width:4px;overflow:hidden;white-space:nowrap}
.mx-cityhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.mx-cityhead h2{margin:0}
.mx-xbtn{cursor:pointer;background:none;border:1px solid var(--border);color:var(--muted);border-radius:7px;padding:4px 11px;font:600 12px var(--sans)}
.mx-xbtn:hover{color:var(--text)}
.mx-note{font-size:12px;color:var(--dim);margin-top:10px;line-height:1.55}
.mx-big{font-family:var(--serif);font-size:36px;font-weight:600;color:var(--flamingo);line-height:1.05}
@media(max-width:640px){.mx-dbar b{display:none}.mx-dbar span{font-size:10.5px}.mx-big{font-size:28px}}
`);

/* tier palette (same scale as build): <$1M, $1M, $2M, $5M+, $25M */
const COLT=[null,"#7d8f87","#2FB6A8","#FF6F91","#FF9E4A","#E24B5B"];
const up=s=>String(s||"").trim().toUpperCase();
const saleCity=w=>{ if(!w||!w[11])return null; const p=String(w[11]).split(","); return p.length>1?up(p[p.length-1]):null; };
const tierOf=v=>v>=25e6?5:v>=5e6?4:v>=2e6?3:v>=1e6?2:1;
const hav=(a,b)=>{ // miles between [lng,lat] pairs
  const R=3958.8,rad=x=>x*Math.PI/180;
  const dLa=rad(b[1]-a[1]),dLo=rad(b[0]-a[0]);
  const s=Math.sin(dLa/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(Math.min(1,s)));
};
const fmtZ=z=>(z>=0?"+":"−")+Math.abs(z).toFixed(1)+"σ";

FLX.routes.maps=function(){
  try{ render(); }
  catch(e){
    console.warn("maps section failed",e);
    try{ mainEl.innerHTML='<div class="panel"><h2>Winner geography</h2><p class="mut">This section hit an error while rendering ('+esc(e&&e.message||e)+'). Reload to retry.</p></div>'; }catch(_){/* keep page alive */}
  }
};

function render(){
  /* ---------- data prep (all client-side, from verified arrays) ---------- */
  const mapHome=DATA.map_home||[], mapRet=DATA.map_ret||[], counties=DATA.counties||[];
  const homeC={},retC={};
  mapHome.forEach(r=>{homeC[up(r[4])]=r;});
  mapRet.forEach(r=>{retC[up(r[4])]=r;});
  const flRows=W.filter(w=>w[4]==="FL");
  const outState=W.length-flRows.length;

  // home->store pairs: both endpoints resolved to known city centroids
  const flowAll=[];
  for(const w of flRows){
    const hc=up(w[3]), sc=saleCity(w);
    const h=hc?homeC[hc]:null, s=sc?retC[sc]:null;
    if(!h||!s)continue;
    const same=hc===sc;
    flowAll.push({w,h,s,hc,sc,same,d:same?0:hav(h,s)});
  }
  const mapped=flowAll.length, unmappedFL=flRows.length-mapped;
  const bSame=flowAll.filter(f=>f.same).length;
  const b10=flowAll.filter(f=>!f.same&&f.d<10).length;
  const b50=flowAll.filter(f=>f.d>=10&&f.d<50).length;
  const b100=flowAll.filter(f=>f.d>=50&&f.d<100).length;
  const bFar=flowAll.filter(f=>f.d>=100).length;
  const dsorted=flowAll.map(f=>f.d).sort((a,b)=>a-b);
  const medD=mapped?dsorted[Math.floor(mapped/2)]:0;

  // sold-city vs home-city symmetry (FL rows only)
  const hcnt={},scnt={};
  for(const w of flRows){
    const c=up(w[3]); if(c)hcnt[c]=(hcnt[c]||0)+1;
    const s=saleCity(w); if(s)scnt[s]=(scnt[s]||0)+1;
  }
  let dMax=0,dCity="";
  new Set([...Object.keys(hcnt),...Object.keys(scnt)]).forEach(c=>{
    const d=Math.abs((hcnt[c]||0)-(scnt[c]||0));
    if(d>dMax){dMax=d;dCity=c;}
  });

  // county Poisson z (shared by funnel + table markers)
  const CZ={};
  for(const c of counties)CZ[c.county]=(c.expected>0)?(c.winners-c.expected)/Math.sqrt(c.expected):0;
  const insideN=counties.filter(c=>Math.abs(CZ[c.county])<=1.96).length;

  const years=[...new Set(W.map(w=>(w[1]||"").slice(0,4)).filter(y=>/^\d{4}$/.test(y)))].sort();
  const st={mode:"home",floor:0,year:"",sel:null};
  let redrawMap=()=>{};

  /* ---------- skeleton ---------- */
  mainEl.innerHTML=`
  <div class="panel">
    <h2>Winner geography <span class="hint">every top-prize claim, mapped three ways</span></h2>
    <div class="controls">
      <div class="seg" id="mmode">
        <button data-m="home" class="active">Winner homes</button>
        <button data-m="ret">Where sold</button>
        <button data-m="flow">Home &rarr; store</button>
      </div>
      <span class="mut" id="mcap" style="font-size:12.5px"></span>
    </div>
    <div class="controls mx-flt">
      <span class="flab">prize</span>
      <div class="seg" id="mprize"><button data-v="0" class="active">All</button><button data-v="1000000">$1M+</button><button data-v="5000000">$5M+</button></div>
      <span class="flab">year</span>
      <div class="seg" id="myear"><button data-v="" class="active">All</button>${years.map(y=>`<button data-v="${y}">${y}</button>`).join("")}</div>
    </div>
    <div class="legend">
      <span class="mut">biggest prize:</span>
      <span><span class="sw" style="background:#E24B5B"></span>$25M</span>
      <span><span class="sw" style="background:#FF9E4A"></span>$5M+</span>
      <span><span class="sw" style="background:#FF6F91"></span>$2M</span>
      <span><span class="sw" style="background:#2FB6A8"></span>$1M</span>
      <span><span class="sw" style="background:#7d8f87"></span>&lt;$1M</span>
      <span class="mut" id="mlegnote"></span>
    </div>
    <div id="map-wrap"><div id="map"></div><div id="tip"></div><div class="mx-samecity" id="mxsame" style="display:none"></div></div>
    <p class="mx-note">Dots are claims to date, not odds — a city lighting up reflects population and sales volume, and filtered counts are small enough that most patterns are noise. "Unmapped" rows lack a recorded city, or carry a store address that doesn't match a known city.</p>
  </div>
  <div class="panel" id="mxcity" style="display:none"></div>
  <div class="panel">
    <h2>How far do winners travel? <span class="hint">home city &rarr; store city, straight-line</span></h2>
    <div id="mxdist"><p class="mut">Distance data unavailable in this build.</p></div>
  </div>
  <div class="panel">
    <h2>County luck, tested <span class="hint">winners vs population share, with honest error bars</span></h2>
    <div id="mxfunwrap"><p class="mut">County data unavailable in this build.</p></div>
  </div>
  <div class="panel">
    <h2>The Alabama line <span class="hint">out-of-state winners — geography's only souvenir</span></h2>
    <div id="mxala"><p class="mut">Winner data unavailable.</p></div>
  </div>`;

  /* ---------- shared filter ---------- */
  const filteredW=()=>W.filter(w=>
    (!st.floor||(w[6]||0)>=st.floor)&&
    (!st.year||(w[1]||"").slice(0,4)===st.year));

  /* ---------- feature 3: city drill-down ---------- */
  function renderCity(scrollTo){
    const p=document.getElementById("mxcity");
    if(!p)return;
    if(!st.sel||st.mode==="flow"){p.style.display="none";p.innerHTML="";return;}
    const match=st.mode==="home"?(w=>up(w[3])===st.sel):(w=>saleCity(w)===st.sel);
    const rows=filteredW().filter(match);
    const fdesc=(st.floor?` · ${st.floor>=5e6?"$5M+":"$1M+"} only`:"")+(st.year?` · ${st.year}`:"");
    p.style.display="";
    p.innerHTML=`<div class="mx-cityhead"><h2>${esc(st.sel)} <span class="hint">${rows.length} winner${rows.length===1?"":"s"} ${st.mode==="home"?"live here":"bought their ticket here"}${fdesc}</span></h2><button class="mx-xbtn" id="mxclear">&times; clear</button></div><div id="mxcityT"></div>${st.mode==="ret"?'<p class="mx-note">Store-city matching is by claim-record address text — a handful of nonstandard rows may be missing from this list.</p>':""}`;
    const cb=document.getElementById("mxclear");
    if(cb)cb.onclick=()=>{st.sel=null;renderCity(false);redrawMap();};
    const host=document.getElementById("mxcityT");
    if(!rows.length){host.innerHTML='<p class="mut">No winners here match the current filters.</p>';}
    else{
      host.append(makeTable([
        {k:"1",label:"Claimed",fmt:w=>esc(w[1]||"—"),sortVal:w=>w[1]||""},
        {k:"2",label:"Winner",fmt:w=>anon(w[2])?'<span class="dim">anonymous</span>':esc(w[2]),sortVal:w=>w[2]||""},
        {k:"0",label:"Game",fmt:w=>esc(GAME_NAME[w[0]]||("#"+w[0])),sortVal:w=>GAME_NAME[w[0]]||""},
        {k:"6",label:"Prize",r:1,fmt:w=>money(w[6]),sortVal:w=>w[6]||0},
        {k:"10",label:"Sold at",hideM:1,fmt:w=>esc(w[10]||"—"),sortVal:w=>w[10]||""},
      ],rows,{sort:"1",rowClick:w=>w[0]}));
    }
    if(scrollTo)p.scrollIntoView({behavior:"smooth",block:"nearest"});
  }

  /* ---------- segs (wired even if the map itself fails) ---------- */
  const setActive=(sel,b)=>document.querySelectorAll(sel+" button").forEach(x=>x.classList.toggle("active",x===b));
  document.querySelectorAll("#mmode button").forEach(b=>b.onclick=()=>{st.mode=b.dataset.m;st.sel=null;setActive("#mmode",b);redrawMap();renderCity(false);});
  document.querySelectorAll("#mprize button").forEach(b=>b.onclick=()=>{st.floor=+b.dataset.v;setActive("#mprize",b);redrawMap();renderCity(false);});
  document.querySelectorAll("#myear button").forEach(b=>b.onclick=()=>{st.year=b.dataset.v;setActive("#myear",b);redrawMap();renderCity(false);});

  /* ---------- features 1+4: the map (dots, flows, filters) ---------- */
  function buildMap(){
    if(!DATA.fl||!window.d3){document.getElementById("map").innerHTML='<p class="mut">Map data unavailable — the county and distance analyses below still work.</p>';return;}
    const wrapEl=document.getElementById("map-wrap"), tip=document.getElementById("tip");
    const Wd=760,Hd=620;
    const svg=d3.select("#map").append("svg").attr("viewBox",`0 0 ${Wd} ${Hd}`).attr("width","100%");
    const proj=d3.geoMercator().fitExtent([[14,14],[Wd-14,Hd-14]],DATA.fl);
    const dark=matchMedia("(prefers-color-scheme: dark)").matches;
    svg.append("path").datum(DATA.fl).attr("d",d3.geoPath(proj))
       .attr("fill",dark?"#183029":"#ece2cf").attr("stroke",dark?"#2b433c":"#d7cbb3");
    const arcL=svg.append("g"), dotL=svg.append("g");
    const touch=matchMedia("(hover:none)").matches;
    let lastTap=null;
    const showTip=(ev,html)=>{
      const b=wrapEl.getBoundingClientRect();
      tip.innerHTML=html;tip.style.opacity=1;
      let x=ev.clientX-b.left+14,y=ev.clientY-b.top+12;
      if(x>b.width-190)x-=210; if(x<0)x=4;
      tip.style.left=x+"px";tip.style.top=y+"px";
    };
    const hideTip=()=>{tip.style.opacity=0;};

    function dotRows(){
      if(!st.floor&&!st.year){ // verified static arrays are the 'All' default
        const rows=(st.mode==="home"?mapHome:mapRet).slice();
        const tot=rows.reduce((s,r)=>s+r[2],0);
        return {rows,tot,unmapped:W.length-tot};
      }
      const fw=filteredW();
      const cen=st.mode==="home"?homeC:retC;
      const key=st.mode==="home"?(w=>up(w[3])||null):saleCity;
      const m=new Map(); let unmapped=0;
      for(const w of fw){
        const c=key(w); const r=c?cen[c]:null;
        if(!r){unmapped++;continue;}
        let e=m.get(c);
        if(!e){e={lng:r[0],lat:r[1],n:0,mx:0,c};m.set(c,e);}
        e.n++; if((w[6]||0)>e.mx)e.mx=w[6]||0;
      }
      const rows=[...m.values()].map(e=>[e.lng,e.lat,e.n,tierOf(e.mx),e.c,e.mx]);
      return {rows,tot:fw.length-unmapped,unmapped};
    }

    function drawDots(){
      const {rows,tot,unmapped}=dotRows();
      rows.sort((a,b)=>b[2]-a[2]);
      document.getElementById("mcap").textContent=
        (st.mode==="home"?`${tot} winners across ${rows.length} home cities`:`${tot} winning tickets across ${rows.length} store cities`)
        +(unmapped>0?` · ${unmapped} unmapped`:"");
      document.getElementById("mlegnote").textContent="· circle size = winners in that city · click a dot for that city's list";
      dotL.selectAll("circle").data(rows,r=>r[4]).join("circle")
        .attr("cx",r=>{const p=proj([r[0],r[1]]);return p?p[0]:-99;})
        .attr("cy",r=>{const p=proj([r[0],r[1]]);return p?p[1]:-99;})
        .attr("r",r=>3+Math.sqrt(r[2])*2)
        .attr("fill",r=>COLT[r[3]]||COLT[1])
        .attr("fill-opacity",.72)
        .attr("stroke",r=>st.sel===up(r[4])?(dark?"#fff":"#111"):(dark?"#111":"#fff"))
        .attr("stroke-width",r=>st.sel===up(r[4])?2.4:.6)
        .style("cursor","pointer")
        .on("mousemove",(ev,r)=>showTip(ev,
          `<b>${esc(r[4])}</b><br>${r[2]} ${st.mode==="home"?(r[2]===1?"winner lives here":"winners live here"):(r[2]===1?"winning ticket sold here":"winning tickets sold here")}<br>biggest: ${money(r[5])}<br><span class="dim">${touch?"tap":"click"} for the list</span>`))
        .on("mouseleave",hideTip)
        .on("click",(ev,r)=>{
          const c=up(r[4]);
          st.sel=(st.sel===c)?null:c;
          hideTip();drawDots();renderCity(!!st.sel);
        });
    }

    const arcTip=f=>`<b>${anon(f.w[2])?'<span class="dim">anonymous winner</span>':esc(f.w[2])}</b><br>${money(f.w[6])} · ${esc(GAME_NAME[f.w[0]]||("game #"+f.w[0]))}<br>${esc(f.hc)} &rarr; ${esc(f.sc)}${f.w[10]?`<br><span class="dim">${esc(f.w[10])}</span>`:""}<br><span class="dim">${touch?"tap again":"click"} to open the game</span>`;

    function drawFlow(){
      const fwArr=filteredW(), fwSet=new Set(fwArr);
      const flows=flowAll.filter(f=>fwSet.has(f.w));
      const cross=flows.filter(f=>!f.same);
      const same=flows.length-cross.length;
      const flTot=fwArr.filter(w=>w[4]==="FL").length;
      const excl=flTot-flows.length;
      document.getElementById("mcap").textContent=`${cross.length} home → store routes · ${same} bought in their own city`+(excl>0?` · ${excl} FL winners unmappable`:"");
      document.getElementById("mlegnote").textContent="· each arc = one winner's home → store trip, colored by prize · click an arc for the game";
      const note=document.getElementById("mxsame");
      note.style.display=flows.length?"":"none";
      note.innerHTML=`<i></i>+ ${same} winner${same===1?"":"s"} bought in their own home city — no route to draw`;
      for(const f of cross){
        const p1=proj([f.h[0],f.h[1]]), p2=proj([f.s[0],f.s[1]]);
        if(!p1||!p2)continue;
        const dx=p2[0]-p1[0],dy=p2[1]-p1[1],len=Math.hypot(dx,dy)||1;
        let nx=-dy/len,ny=dx/len;
        if(ny>0){nx=-nx;ny=-ny;}                    // arcs bow upward, consistently
        const k=Math.min(46,8+len*.22);
        const cx=(p1[0]+p2[0])/2+nx*k, cy=(p1[1]+p2[1])/2+ny*k;
        const d=`M${p1[0].toFixed(1)},${p1[1].toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
        const col=COLT[tierOf(f.w[6]||0)];
        const vis=arcL.append("path").attr("d",d).attr("fill","none")
          .attr("stroke",col).attr("stroke-opacity",.3).attr("stroke-width",1.2);
        arcL.append("path").attr("d",d).attr("fill","none")   // fat invisible hit target (mouse + tap)
          .attr("stroke",col).attr("stroke-opacity",0).attr("stroke-width",9)
          .style("cursor","pointer").style("pointer-events","stroke")
          .on("mousemove",ev=>{vis.attr("stroke-opacity",.95).attr("stroke-width",2.2);showTip(ev,arcTip(f));})
          .on("mouseleave",()=>{vis.attr("stroke-opacity",.3).attr("stroke-width",1.2);hideTip();})
          .on("click",ev=>{
            if(touch&&lastTap!==f){lastTap=f;vis.attr("stroke-opacity",.95).attr("stroke-width",2.2);showTip(ev,arcTip(f));return;}
            go("game",f.w[0]);
          });
      }
    }

    function draw(){
      arcL.selectAll("*").remove();
      lastTap=null;
      if(st.mode==="flow"){dotL.selectAll("*").remove();hideTip();drawFlow();}
      else{document.getElementById("mxsame").style.display="none";drawDots();}
    }
    redrawMap=draw;
    draw();
  }
  try{buildMap();}
  catch(e){console.warn("map failed",e);const m=document.getElementById("map");if(m)m.innerHTML='<p class="mut">The map failed to render — the analyses below still work.</p>';}

  /* ---------- feature 1 (below map): distance breakdown ---------- */
  function buildDistance(){
    const host=document.getElementById("mxdist");
    if(!mapped){host.innerHTML='<p class="mut">No home → store pairs could be mapped in this build.</p>';return;}
    const segsD=[
      ["same city",bSame,"var(--teal)"],
      ["under 10 mi",b10,"var(--aqua)"],
      ["10–50 mi",b50,"var(--tangerine)"],
      ["50–100 mi",b100,"var(--flamingo)"],
      ["100 mi +",bFar,"var(--coral)"],
    ];
    host.innerHTML=`
    <div class="cards" style="margin-bottom:12px">
      <div class="card"><div class="lab">Bought in their home city</div><div class="val good">${Math.round(100*bSame/mapped)}%</div><div class="note">of ${mapped} mappable winners</div></div>
      <div class="card"><div class="lab">Median home &rarr; store distance</div><div class="val">${medD<0.5?"0 miles":Math.round(medD)+" mi"}</div><div class="note">${medD<0.5?"the corner store, not a destination":"still barely a drive"}</div></div>
    </div>
    <div class="mx-dbar">${segsD.filter(s=>s[1]>0).map(([lab,n,col])=>{
      const p=100*n/mapped;
      return `<span style="flex:${n} ${n} 0px;background:${col}" title="${lab}: ${n} winners (${p.toFixed(1)}%)">${p>=8?`<b>${lab} </b>${Math.round(p)}%`:""}</span>`;
    }).join("")}</div>
    <div class="legend">${segsD.map(([lab,n,col])=>`<span><span class="sw" style="background:${col};border-radius:3px"></span>${lab} · ${n}</span>`).join("")}</div>
    <p class="mut" style="font-size:13px;margin-top:10px">Sold-city and home-city winner counts differ by at most &plusmn;${dMax} anywhere in the state (${esc(dCity)}: ${scnt[dCity]||0} tickets sold vs ${hcnt[dCity]||0} resident winners). There is no lucky destination — the map of where winners live and the map of where they buy are the same map.</p>
    <p class="mx-note">Distances are city-centroid to city-centroid, not address-level — "under 10 mi" mostly means the next town over. Excluded: ${unmappedFL} Florida winners whose store city doesn't match a known city, and all ${outState} out-of-state homes (${mapped} of ${W.length} claims map end-to-end). "Home" is the city on the claim form, which can postdate the purchase.</p>`;
  }
  try{buildDistance();}
  catch(e){console.warn("distance failed",e);const h=document.getElementById("mxdist");if(h)h.innerHTML='<p class="mut">Distance breakdown unavailable.</p>';}

  /* ---------- feature 2: county luck funnel + demoted table ---------- */
  function drawFunnel(host){
    const FW=680,FH=400,mL=44,mR=16,mT=20,mB=42;
    const svg=d3.select(host).append("svg").attr("viewBox",`0 0 ${FW} ${FH}`).attr("width","100%");
    const eMin=Math.max(.22,Math.min(...counties.map(c=>c.expected||.3))*.8);
    const eMax=Math.max(...counties.map(c=>c.expected||1))*1.18;
    const x=d3.scaleLog().domain([eMin,eMax]).range([mL,FW-mR]);
    const iMax=Math.max(2.5,...counties.map(c=>c.index||0));
    const yMax=Math.min(7,iMax+.5);
    const y=d3.scaleLinear().domain([0,yMax]).range([FH-mB,mT]);
    // Poisson control bands: index = 1 ± m/sqrt(E)
    const Es=d3.range(0,121).map(i=>eMin*Math.pow(eMax/eMin,i/120));
    const bandPath=m=>d3.area()
      .x(E=>x(E))
      .y0(E=>y(Math.max(0,1-m/Math.sqrt(E))))
      .y1(E=>y(Math.min(yMax,1+m/Math.sqrt(E))))(Es);
    svg.append("path").attr("d",bandPath(3)).attr("fill","var(--border)").attr("fill-opacity",.2);
    svg.append("path").attr("d",bandPath(1.96)).attr("fill","var(--border)").attr("fill-opacity",.38);
    for(let v=0;v<=Math.floor(yMax);v++){
      if(v!==1)svg.append("line").attr("x1",mL).attr("x2",FW-mR).attr("y1",y(v)).attr("y2",y(v)).attr("stroke","var(--border)").attr("stroke-opacity",.35);
      svg.append("text").attr("x",mL-7).attr("y",y(v)+4).attr("text-anchor","end").attr("font-size",11.5).attr("fill","var(--muted)").text(v+"×");
    }
    svg.append("line").attr("x1",mL).attr("x2",FW-mR).attr("y1",y(1)).attr("y2",y(1)).attr("stroke","var(--dim)").attr("stroke-dasharray","4 4");
    [0.5,1,2,5,10,20,50,90].filter(v=>v>=eMin&&v<=eMax).forEach(v=>{
      svg.append("line").attr("x1",x(v)).attr("x2",x(v)).attr("y1",FH-mB).attr("y2",FH-mB+5).attr("stroke","var(--border)");
      svg.append("text").attr("x",x(v)).attr("y",FH-mB+18).attr("text-anchor","middle").attr("font-size",11.5).attr("fill","var(--muted)").text(v);
    });
    svg.append("text").attr("x",(mL+FW-mR)/2).attr("y",FH-6).attr("text-anchor","middle").attr("font-size",11.5).attr("fill","var(--dim)").text("expected winners = county share of "+W.length+" by population (log scale)");
    svg.append("text").attr("x",mL).attr("y",mT-8).attr("font-size",11.5).attr("fill","var(--dim)").text("luck index = winners ÷ expected");

    const tip=document.createElement("div");tip.className="mx-tip";host.appendChild(tip);
    const show=(ev,c)=>{
      const b=host.getBoundingClientRect();
      tip.innerHTML=`<b>${esc(c.county)}</b><br>${c.winners} winner${c.winners===1?"":"s"} · ${(+c.expected).toFixed(1)} expected<br>index ${(+c.index||0).toFixed(2)}× · ${fmtZ(CZ[c.county]||0)}`;
      tip.style.opacity=1;
      let px=ev.clientX-b.left+12,py=ev.clientY-b.top+10;
      if(px>b.width-180)px-=200; if(px<0)px=4;
      tip.style.left=px+"px";tip.style.top=py+"px";
    };
    const placed=[];
    for(const c of [...counties].sort((a,b)=>(a.expected||0)-(b.expected||0))){
      const z=CZ[c.county]||0, out=Math.abs(z)>1.96;
      const cx=x(Math.max(eMin,Math.min(eMax,c.expected||eMin)));
      const cy=y(Math.min(yMax,c.index||0));
      const col=out?(z<0?"var(--coral)":"var(--teal)"):"var(--dim)";
      svg.append("circle").attr("cx",cx).attr("cy",cy).attr("r",out?5:3.8)
        .attr("fill",col).attr("fill-opacity",out?.95:.6)
        .attr("stroke","var(--panel)").attr("stroke-width",.8)
        .on("mousemove",ev=>show(ev,c))
        .on("mouseleave",()=>{tip.style.opacity=0;})
        .on("click",ev=>show(ev,c));
      if(out&&(c.expected||0)>=5){   // label only the outliers big enough to mean something
        const anchor=cx>FW-150?"end":"start";
        const lx=cx+(anchor==="start"?8:-8);
        let ly=z<0?cy+16:cy-9;
        ly=Math.max(mT+12,Math.min(FH-mB-8,ly));
        let guard=0;
        while(guard++<10&&placed.some(b=>Math.abs(b.y-ly)<13&&Math.abs(b.x-lx)<120))ly-=13;
        placed.push({x:lx,y:ly});
        svg.append("text").attr("x",lx).attr("y",ly).attr("text-anchor",anchor)
          .attr("font-size",12).attr("font-weight",600).attr("fill",col)
          .text(`${c.county} ${fmtZ(z)}`);
      }
    }
  }

  function buildCountyPanel(){
    const wrapH=document.getElementById("mxfunwrap");
    if(!counties.length)return; // keep the 'unavailable' note
    const brw=counties.find(c=>c.county==="Broward");
    const dade=counties.find(c=>c.county==="Miami-Dade");
    const stj=counties.find(c=>c.county==="St. Johns");
    let deficit="";
    if(brw)deficit=` The only pattern worth naming is the South-Florida deficit: Broward runs ${fmtZ(CZ["Broward"])} (${brw.winners} winners vs ${(+brw.expected).toFixed(0)} expected)${dade&&dade.index<1?`, with Miami-Dade also under its share at ${(+dade.index).toFixed(2)}×`:""}.${stj&&stj.winners===0?` St. Johns — zero winners against ${(+stj.expected).toFixed(0)} expected — is the other genuine outlier.`:""}`;
    wrapH.innerHTML=`
    <div class="mx-fwrap" id="mxfun"></div>
    <div class="legend" style="margin-top:4px">
      <span><span class="sw" style="background:var(--border);border-radius:3px"></span>shaded = pure-chance range (inner 95%, outer 99.7%)</span>
      <span><span class="sw" style="background:var(--coral)"></span>fewer winners than population predicts</span>
      <span><span class="sw" style="background:var(--teal)"></span>more</span>
      <span class="mut">dashed = exactly proportional (1.0&times;)</span>
    </div>
    <p class="mut" style="font-size:13px;margin-top:10px">${insideN} of ${counties.length} counties sit inside pure noise — and with ${counties.length} counties, roughly ${Math.round(counties.length*.05)} would fall outside the 95% band by chance alone.${deficit}</p>
    <p class="mx-note">"Expected" assumes tickets are bought in proportion to population. Per-county sales are unknown — a deficit can reflect where people shop or claim rather than misfortune. And tiny counties swing wildly: a 0.5&times; index on 2 expected winners is noise, not bad luck.</p>
    <div class="mx-cityhead" style="margin-top:16px">
      <div style="font-weight:600">County table <span class="hint" id="mxchint">top 10 by winners</span></div>
      <button class="mx-xbtn" id="mxcshow">show all ${counties.length} counties</button>
    </div>
    <div id="mxcT"></div>
    <p class="mx-note">&#9670; = outside the 95% band in the funnel above (teal = more winners than its population share, coral = fewer). Everything unmarked is statistically indistinguishable from proportional.</p>`;
    try{drawFunnel(document.getElementById("mxfun"));}
    catch(e){console.warn("funnel failed",e);document.getElementById("mxfun").innerHTML='<p class="mut">Funnel plot failed to render — the table below has the same numbers.</p>';}
    const cols=[
      {k:"county",label:"County"},
      {k:"pop",label:"Population",r:1,fmt:r=>num(r.pop)},
      {k:"winners",label:"Winners",r:1},
      {k:"per100k",label:"Per 100k",r:1,hideM:1,fmt:r=>(+r.per100k).toFixed(1)},
      {k:"expected",label:"Expected",r:1,hideM:1,fmt:r=>(+r.expected).toFixed(1)},
      {k:"index",label:"Index",r:1,sortVal:r=>r.index,fmt:r=>{
        const z=CZ[r.county]||0;
        return Math.abs(z)>1.96
          ?`<span class="${z>0?"good":"bad"}">&#9670; ${(+r.index||0).toFixed(2)}×</span>`
          :`<span class="mut">${(+r.index||0).toFixed(2)}×</span>`;
      }},
    ];
    let showAll=false;
    const byWin=[...counties].sort((a,b)=>b.winners-a.winners);
    function renderTable(){
      const host=document.getElementById("mxcT");
      host.innerHTML="";
      host.append(makeTable(cols,showAll?byWin:byWin.slice(0,10),{sort:"winners"}));
      document.getElementById("mxcshow").textContent=showAll?"show top 10 only":`show all ${counties.length} counties`;
      document.getElementById("mxchint").textContent=showAll?`all ${counties.length}, sortable`:"top 10 by winners";
    }
    document.getElementById("mxcshow").onclick=()=>{showAll=!showAll;renderTable();};
    renderTable();
  }
  try{buildCountyPanel();}
  catch(e){console.warn("county panel failed",e);const h=document.getElementById("mxfunwrap");if(h)h.innerHTML='<p class="mut">County analysis unavailable.</p>';}

  /* ---------- feature 5: the Alabama line ---------- */
  function buildAlabama(){
    const host=document.getElementById("mxala");
    const os=W.filter(w=>w[4]!=="FL");           // non-FL, incl. rows with no recorded state
    if(!os.length){host.innerHTML='<p class="mut">Every recorded winner lists a Florida home.</p>';return;}
    const noState=os.filter(w=>!w[4]).length;
    const stCnt={};
    os.forEach(w=>{if(w[4])stCnt[w[4]]=(stCnt[w[4]]||0)+1;});
    const stList=Object.entries(stCnt).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    const alN=stCnt["AL"]||0;
    const shr=(100*os.length/W.length).toFixed(0);
    host.innerHTML=`
    <div class="grid2">
      <div>
        <div class="mx-big">${os.length} winners</div>
        <p style="font-size:13.5px;margin-top:8px">— ${shr}% of all ${W.length} top-prize claims — didn't list a Florida home. Alabama has no state lottery, so the Panhandle border does exactly what you'd expect: ${alN} of them live there, the largest block by far. And every one of these tickets was still bought at a Florida store — which is precisely what <b>Where sold</b> mode shows above.</p>
        <p class="mx-note">State is residence at claim time — snowbirds and movers blur it — and ${noState} older rows record no home state at all (counted in the ${os.length}, absent from the bars). ${os.length} of ${W.length} (&asymp;${shr}%) is roughly what tourist volume predicts, not evidence of anything.</p>
      </div>
      <div class="chartbox"><canvas id="mxal"></canvas></div>
    </div>`;
    newChart(document.getElementById("mxal"),{
      type:"bar",
      data:{labels:stList.map(s=>s[0]),datasets:[{data:stList.map(s=>s[1]),backgroundColor:"#E24B5B"}]},
      options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${c.raw} winner${c.raw===1?"":"s"} list a ${c.label} home`}}},
        scales:{x:{ticks:{precision:0}},y:{ticks:{font:{size:10.5},autoSkip:false}}}}});
  }
  try{buildAlabama();}
  catch(e){console.warn("alabama failed",e);const h=document.getElementById("mxala");if(h)h.innerHTML='<p class="mut">Out-of-state breakdown unavailable.</p>';}

  renderCity(false);
}

})();
