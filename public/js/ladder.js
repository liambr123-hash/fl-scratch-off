/* ladder module — prize-ladder lollipop chart on game detail */
(function(){
  "use strict";

  // scoped styles (theme-aware via CSS vars; never hardcode colors)
  try{
    FLX.css(`
    .ladderWrap{width:100%;overflow-x:auto}
    .ladderSvg{width:100%;height:auto;display:block;font-family:var(--sans)}
    .ladderSvg .stem{stroke:var(--border);stroke-width:2}
    .ladderSvg .ghost{fill:var(--dim);opacity:.28}
    .ladderSvg .live{fill:var(--teal);opacity:.9}
    .ladderSvg .live.gone{fill:var(--coral)}
    .ladderSvg .plab{fill:var(--text);font-size:12px;font-family:var(--serif)}
    .ladderSvg .clab{fill:var(--muted);font-size:11px}
    .ladderSvg .gline{stroke:var(--border);stroke-width:1;opacity:.35;stroke-dasharray:2 3}
    .ladderLegend{display:flex;gap:16px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:4px}
    .ladderLegend .lk{display:inline-flex;align-items:center;gap:6px}
    .ladderLegend .dot{border-radius:50%;display:inline-block}
    .ladderLegend .dot.g{width:13px;height:13px;background:var(--dim);opacity:.4}
    .ladderLegend .dot.l{width:11px;height:11px;background:var(--teal)}
    .ladderLegend .dot.d{width:11px;height:11px;background:var(--coral)}
    `);
  }catch(e){/* non-fatal */}

  FLX.gameExtras.push(function(g){
    try{
      if(!g||typeof d3==="undefined") return;
      const tiers=(typeof T!=="undefined"&&T[g.game_no])?T[g.game_no]:null;
      if(!tiers||tiers.length<2) return;

      // build clean rows: {val, disp, rem, orig}
      const rows=tiers.map(function(t){
        return {
          disp: t[0],
          val:  +t[1]||0,
          rem:  Math.max(0,+t[3]||0),
          orig: Math.max(0,+t[4]||0)
        };
      }).filter(function(r){ return r.val>0; })
        .sort(function(a,b){ return b.val-a.val; }); // highest prize at top

      if(rows.length<2) return;

      const maxOrig=d3.max(rows,function(r){return r.orig;})||1;
      const minVal=d3.min(rows,function(r){return r.val;});
      const maxVal=d3.max(rows,function(r){return r.val;});

      // ---- layout (SVG user units; responsive via viewBox) ----
      const W=760;
      const rowH=34;
      const mTop=18, mBottom=14;
      const labelLeftW=118;   // room for prize money label on the left
      const countRightW=104;  // room for "X of Y left" on the right
      const plotLeft=labelLeftW;
      const plotRight=W-countRightW;
      const H=mTop+mBottom+rows.length*rowH;

      // x scale = prize value, log (values span $1..$25M)
      const x=d3.scaleLog()
        .domain([Math.max(1,minVal), Math.max(2,maxVal)])
        .range([plotLeft, plotRight])
        .clamp(true);

      // dot radius so AREA is proportional to count. area ∝ count -> r ∝ sqrt(count)
      const rMax=Math.min(rowH*0.44, 13);
      const rMin=2.2;
      const rOf=function(c){
        if(c<=0) return 0;
        const rr=Math.sqrt(c/maxOrig)*rMax;
        return Math.max(rMin,rr);
      };

      // vertical gridlines at a few powers of ten within range
      const gridVals=[];
      for(var p=0;p<=8;p++){
        var gv=Math.pow(10,p);
        if(gv>=minVal&&gv<=maxVal) gridVals.push(gv);
      }

      const rowY=function(i){ return mTop+i*rowH+rowH/2; };

      // ---- build SVG string (no external deps beyond d3 scales) ----
      var parts=[];
      parts.push('<svg class="ladderSvg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMin meet" role="img" aria-label="Prize ladder lollipop chart">');

      // gridlines + faint value ticks along the top
      gridVals.forEach(function(gv){
        var gx=x(gv).toFixed(1);
        parts.push('<line class="gline" x1="'+gx+'" y1="'+(mTop-6)+'" x2="'+gx+'" y2="'+(H-mBottom+2)+'"></line>');
        parts.push('<text class="clab" x="'+gx+'" y="'+(mTop-9)+'" text-anchor="middle">'+esc(money(gv))+'</text>');
      });

      rows.forEach(function(r,i){
        var y=rowY(i).toFixed(1);
        var dx=x(r.val).toFixed(1);
        var rg=rOf(r.orig);
        var rl=rOf(r.rem);
        var gone=(r.rem<=0);

        // stem from left plot edge to the dot
        parts.push('<line class="stem" x1="'+plotLeft+'" y1="'+y+'" x2="'+dx+'" y2="'+y+'"></line>');
        // ghost dot (original count) behind
        if(rg>0) parts.push('<circle class="ghost" cx="'+dx+'" cy="'+y+'" r="'+rg.toFixed(2)+'"></circle>');
        // live dot (remaining count) — coral if depleted to zero
        if(rl>0) parts.push('<circle class="live'+(gone?' gone':'')+'" cx="'+dx+'" cy="'+y+'" r="'+rl.toFixed(2)+'"></circle>');
        else parts.push('<circle class="live gone" cx="'+dx+'" cy="'+y+'" r="'+rMin.toFixed(2)+'" opacity="0.55"></circle>');

        // prize label (left)
        parts.push('<text class="plab" x="'+(plotLeft-10)+'" y="'+(rowY(i)+4).toFixed(1)+'" text-anchor="end">'+esc(money(r.val))+'</text>');
        // count label (right)
        var cl=num(r.rem)+' of '+num(r.orig)+' left';
        parts.push('<text class="clab" x="'+(plotRight+10)+'" y="'+(rowY(i)+4).toFixed(1)+'" text-anchor="start">'+esc(cl)+'</text>');
      });

      parts.push('</svg>');

      var html=''+
        '<div class="panel">'+
          '<h2>Prize ladder <span class="hint">every prize tier: value vs how many are left</span></h2>'+
          '<div class="ladderWrap">'+parts.join('')+'</div>'+
          '<div class="ladderLegend">'+
            '<span class="lk"><span class="dot g"></span> original count</span>'+
            '<span class="lk"><span class="dot l"></span> remaining</span>'+
            '<span class="lk"><span class="dot d"></span> tier exhausted</span>'+
            '<span class="lk" style="color:var(--dim)">dot area &prop; count · prize value on a log axis</span>'+
          '</div>'+
        '</div>';

      var host=(typeof $==="function"&&$("#main"))?$("#main"):document.querySelector('#main');
      if(!host) return;
      host.insertAdjacentHTML('beforeend',html);
    }catch(e){
      // degrade silently — never throw during a route render
      try{console.warn("ladder gameExtra failed",e);}catch(_){}
    }
  });

})();
