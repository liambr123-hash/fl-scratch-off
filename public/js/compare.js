/* compare module — side-by-side comparison of up to 3 games (#compare/<no,no,no>) */
(function(){
  "use strict";

  var MAX=3;
  var LS_KEY="flx_compare_set";

  /* ---- persistent compare set (survives navigation + reloads, defensively) ---- */
  function loadSet(){
    try{
      var raw=localStorage.getItem(LS_KEY);
      if(!raw)return [];
      return String(raw).split(",").map(function(s){return s.trim();}).filter(function(s){return s&&byNo[s];}).slice(0,MAX);
    }catch(e){ return []; }
  }
  function saveSet(arr){
    try{ localStorage.setItem(LS_KEY,arr.join(",")); }catch(e){}
  }
  var compareSet=loadSet();

  function addToSet(no){
    if(!byNo[no])return compareSet;
    // toggle-in: move to front, dedupe, clamp to MAX
    compareSet=[no].concat(compareSet.filter(function(x){return x!==no;})).slice(0,MAX);
    saveSet(compareSet);
    return compareSet;
  }
  function removeFromSet(no){
    compareSet=compareSet.filter(function(x){return x!==no;});
    saveSet(compareSet);
    return compareSet;
  }

  /* ---- scoped styles (variables only, so light-mode still works) ---- */
  try{
    FLX.css(
      ".cmp-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:20px}"+
      ".cmp-col{background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}"+
      ".cmp-col .chead{padding:13px 14px 11px;border-bottom:1px solid var(--border);background:var(--panel2)}"+
      ".cmp-col .cname{font-family:var(--serif);font-size:16px;font-weight:600;line-height:1.15;letter-spacing:-.01em}"+
      ".cmp-col .cno{color:var(--dim);font-weight:400;font-size:13px}"+
      ".cmp-col .cmeta{margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}"+
      ".cmp-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:8px 14px;border-top:1px solid var(--border);font-size:14px}"+
      ".cmp-row:first-child{border-top:none}"+
      ".cmp-row .rlab{color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em}"+
      ".cmp-row .rval{text-align:right;font-variant-numeric:tabular-nums}"+
      ".cmp-row .rval .sub{display:block;color:var(--dim);font-size:11px;font-weight:400}"+
      ".cmp-row.best .rval{color:var(--good)}"+
      ".cmp-row.best .rlab::after{content:' \\2605';color:var(--good);font-size:10px}"+
      ".cmp-remove{margin-left:auto;color:var(--dim);cursor:pointer;font-size:12px;text-decoration:none;border:1px solid var(--border);border-radius:7px;padding:1px 7px}"+
      ".cmp-remove:hover{color:var(--bad);border-color:var(--bad)}"+
      ".cmp-pick{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}"+
      ".cmp-pick select{width:100%}"+
      ".cmp-cta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}"+
      ".cmp-cta button{background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:8px 14px;font:600 13px var(--sans);cursor:pointer}"+
      ".cmp-cta button:hover{border-color:var(--flamingo)}"+
      ".cmp-cta button.in{border-color:var(--teal);color:var(--teal)}"+
      ".cmp-cta a{color:var(--teal);font-size:13px;font-weight:600;text-decoration:none}"+
      ".cmp-slots{color:var(--dim);font-size:12.5px}"
    );
  }catch(e){}

  /* ---- helpers ---- */
  function evNow(g){ return (g&&g.value_per_dollar_now!=null)?g.value_per_dollar_now:null; }
  function evDes(g){ return (g&&g.value_per_dollar_original!=null)?g.value_per_dollar_original:null; }

  // which columns win a given numeric metric (bigger=better unless invert)
  function winnerFlags(games,getter,invert){
    var vals=games.map(getter);
    var have=vals.filter(function(v){return v!=null&&!isNaN(v);});
    if(have.length<2)return games.map(function(){return false;});
    var best=invert?Math.min.apply(null,have):Math.max.apply(null,have);
    // only highlight if there's a genuine spread
    var worst=invert?Math.max.apply(null,have):Math.min.apply(null,have);
    if(best===worst)return games.map(function(){return false;});
    return vals.map(function(v){return v!=null&&!isNaN(v)&&v===best;});
  }

  // a stat row: label + one value per game; `best` array flags winning cells
  function statRow(games,label,fmt,best){
    var cells=games.map(function(g,i){
      var isBest=best&&best[i];
      return '<div class="cmp-row'+(isBest?' best':'')+'">'+
        '<span class="rlab">'+esc(label)+'</span>'+
        '<span class="rval">'+fmt(g)+'</span></div>';
    });
    return cells;
  }

  function renderColumns(games){
    // precompute winner flags per metric
    var wEV   = winnerFlags(games,evNow,false);
    var wScore= winnerFlags(games,function(g){return g.score;},false);
    var wPrice= winnerFlags(games,function(g){return g.ticket_price;},true);   // cheaper wins
    var wTop  = winnerFlags(games,function(g){return g.top_prize_value_num;},false);
    var wProf = winnerFlags(games,function(g){return g.profit_odds;},true);    // lower 1-in-X wins
    var wLeft = winnerFlags(games,function(g){return g.pct_value_remaining;},false);
    var wOdds = winnerFlags(games,function(g){return g.overall_odds_1_in;},true); // shorter odds wins

    // build each row across all games, then transpose into columns
    var rows=[
      statRow(games,"Value Score",function(g){return scoreBadge(g);},wScore),
      statRow(games,"Price",function(g){return "$"+Math.round(g.ticket_price);},wPrice),
      statRow(games,"EV / $1 now",function(g){
        return evCell(g)+'<span class="sub">design '+f2(evDes(g))+'</span>';
      },wEV),
      statRow(games,"Top prize",function(g){
        return esc(g.top_prize_display||money(g.top_prize_value_num))+
          '<span class="sub">'+(g.top_prizes_remaining==null?"—":g.top_prizes_remaining)+
          ' of '+(g.top_prizes_total==null?"—":g.top_prizes_total)+' left</span>';
      },wTop),
      statRow(games,"Profit odds",function(g){
        return g.profit_odds?("1 in "+g.profit_odds.toFixed(1)):"—";
      },wProf),
      statRow(games,"Value left",function(g){return leftBar(g);},wLeft),
      statRow(games,"Overall odds",function(g){
        return g.overall_odds_1_in?("1 in "+g.overall_odds_1_in):"—";
      },wOdds),
      statRow(games,"Launched",function(g){return esc(g.launch_date||"—");},null),
      statRow(games,"Status",function(g){return salePill(g)+deadBadge(g);},null)
    ];

    var cols=games.map(function(g,i){
      var body=rows.map(function(r){return r[i];}).join("");
      return '<div class="cmp-col">'+
        '<div class="chead">'+
          '<div class="cname">'+esc(g.game_name)+' <span class="cno">#'+esc(g.game_no)+'</span></div>'+
          '<div class="cmeta">'+
            '<a class="cmp-remove" href="#" data-rm="'+esc(g.game_no)+'">remove</a>'+
          '</div>'+
        '</div>'+ body +'</div>';
    }).join("");

    return '<div class="cmp-grid">'+cols+'</div>';
  }

  function renderPicker(selected){
    // on-sale games, sorted by name; three dropdowns pre-set to the current selection
    var pool=G.filter(function(g){return g.on_sale;})
      .slice().sort(function(a,b){return (a.game_name||"").localeCompare(b.game_name||"");});
    function opts(sel){
      var o='<option value="">— none —</option>';
      for(var i=0;i<pool.length;i++){
        var g=pool[i];
        o+='<option value="'+esc(g.game_no)+'"'+(g.game_no===sel?" selected":"")+'>'+
           esc(g.game_name)+' (#'+esc(g.game_no)+' · $'+Math.round(g.ticket_price)+')</option>';
      }
      return o;
    }
    var sels="";
    for(var s=0;s<MAX;s++){
      sels+='<select class="cmp-sel" data-slot="'+s+'">'+opts(selected[s]||"")+'</select>';
    }
    return '<div class="panel"><h2>Choose games <span class="hint">pick up to '+MAX+' on-sale games to line up side by side</span></h2>'+
      '<div class="cmp-pick">'+sels+'</div></div>';
  }

  function wirePicker(){
    var sels=mainEl.querySelectorAll(".cmp-sel");
    function apply(){
      var ids=[];
      sels.forEach(function(sel){ if(sel.value&&ids.indexOf(sel.value)<0)ids.push(sel.value); });
      go("compare",ids.join(","));
    }
    sels.forEach(function(sel){ sel.onchange=apply; });
  }

  /* ---- the route ---- */
  FLX.routes.compare=function(arg){
    try{
      var ids=[];
      if(arg){
        ids=String(arg).split(",").map(function(s){return s.trim();})
          .filter(function(s){return s&&byNo[s];});
        // dedupe, clamp
        var seen={},clean=[];
        for(var i=0;i<ids.length&&clean.length<MAX;i++){ if(!seen[ids[i]]){seen[ids[i]]=1;clean.push(ids[i]);} }
        ids=clean;
        // reflect the viewed selection into the persistent set (front-loaded)
        if(ids.length){ compareSet=ids.slice(0,MAX); saveSet(compareSet); }
      } else if(compareSet.length){
        ids=compareSet.slice(0,MAX);
      }

      var games=ids.map(function(n){return byNo[n];}).filter(Boolean);

      var head='<div class="gtitle">Compare games'+
        (games.length?' <span class="dim">'+games.length+' of '+MAX+'</span>':'')+'</div>'+
        '<div class="gsub">Line up to '+MAX+' games on the same rows. The best value on each metric is marked with a star. Every scratch-off is negative expected value — this only shows which is least-bad.</div>';

      if(!games.length){
        mainEl.innerHTML=head+
          renderPicker([])+
          '<div class="panel"><p class="mut">No games selected yet. Use the dropdowns above, or open any game and hit "Compare this game".</p></div>';
        wirePicker();
        return;
      }

      mainEl.innerHTML=head+
        renderColumns(games)+
        '<div class="panel"><h2>Head to head <span class="hint">expected payout per $1 (now) vs the design payout</span></h2>'+
          '<div class="chartbox" style="height:280px"><canvas id="cmpC"></canvas></div></div>'+
        renderPicker(ids);

      // grouped bar: EV/$ now vs design, one bar-group per game
      try{
        var labels=games.map(function(g){return (g.game_name||"").slice(0,26)+" #"+g.game_no;});
        var haveEV=games.some(function(g){return evNow(g)!=null;});
        if(haveEV){
          newChart($("#cmpC"),{
            type:"bar",
            data:{labels:labels,datasets:[
              {label:"EV/$ now",data:games.map(function(g){var v=evNow(g);return v==null?null:+v.toFixed(3);}),backgroundColor:"#2FB6A8"},
              {label:"EV/$ design",data:games.map(function(g){var v=evDes(g);return v==null?null:+v.toFixed(3);}),backgroundColor:"#FF9E4A"}
            ]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{position:"bottom"},tooltip:{callbacks:{label:function(c){return c.dataset.label+": "+f2(c.raw)+" per $1";}}}},
              scales:{y:{beginAtZero:true,suggestedMax:1,title:{display:true,text:"payout per $1"}}},
              onClick:function(e,els){ if(els.length)go("game",games[els[0].index].game_no); }}
          });
        } else {
          var cx=$("#cmpC"); if(cx&&cx.parentNode){cx.parentNode.innerHTML='<p class="mut">No EV data available for these games to chart.</p>';}
        }
      }catch(e){ /* chart optional */ }

      // wire remove links + picker
      mainEl.querySelectorAll("[data-rm]").forEach(function(a){
        a.onclick=function(ev){ ev.preventDefault(); var next=removeFromSet(a.getAttribute("data-rm")); go("compare",next.join(",")); };
      });
      wirePicker();
    }catch(err){
      try{ mainEl.innerHTML='<div class="panel"><p class="mut">Compare view is unavailable right now.</p></div>'; }catch(e){}
    }
  };

  /* ---- entry point on every game-detail page ---- */
  FLX.gameExtras.push(function(g){
    try{
      if(!g||!g.game_no)return;
      var inSet=compareSet.indexOf(g.game_no)>=0;
      var count=compareSet.length;
      var html='<div class="panel"><h2>Compare <span class="hint">line this game up against others side by side</span></h2>'+
        '<div class="cmp-cta">'+
          '<button id="cmpAdd" class="'+(inSet?"in":"")+'">'+(inSet?"In compare set — remove":"+ Compare this game")+'</button>'+
          '<a id="cmpOpen" href="#">open compare view →</a>'+
          '<span class="cmp-slots" id="cmpSlots"></span>'+
        '</div></div>';
      mainEl.insertAdjacentHTML("beforeend",html);

      function slotText(){
        var names=compareSet.map(function(n){return esc((byNo[n]&&byNo[n].game_name)||n);});
        var el=document.getElementById("cmpSlots");
        if(el)el.innerHTML=names.length?("set: "+names.join(", ")):"nothing in the compare set yet";
      }
      slotText();

      var addBtn=document.getElementById("cmpAdd");
      if(addBtn)addBtn.onclick=function(){
        if(compareSet.indexOf(g.game_no)>=0){
          removeFromSet(g.game_no);
          addBtn.className="";
          addBtn.textContent="+ Compare this game";
        } else {
          addToSet(g.game_no);
          addBtn.className="in";
          addBtn.textContent="In compare set — remove";
        }
        slotText();
      };
      var openBtn=document.getElementById("cmpOpen");
      if(openBtn)openBtn.onclick=function(ev){
        ev.preventDefault();
        // ensure the current game is included when opening
        var ids=compareSet.slice();
        if(ids.indexOf(g.game_no)<0){ ids=addToSet(g.game_no); }
        go("compare",ids.join(","));
      };
    }catch(e){ /* degrade silently */ }
  });

})();
