/* live.js — "since last build" deltas
   On FLX.ready, fetch the live official scratch feed in-browser, diff the
   top-tier "prizes remaining" against the baked snapshot, and drop a subtle
   LIVE line at the top of the Overview. Fetch runs once; the cached diff is
   re-rendered on every overview flx:view. Any failure degrades to nothing. */
(function(){
  "use strict";

  var ENDPOINT = "https://apim-website-prod-eastus.azure-api.net/scratchgamesapp/getscratchinfo";
  var TIMEOUT_MS = 6000;

  // diff state: null = not yet resolved / failed; object once computed.
  var diff = null;      // {total:Number, movers:[{id,name,d}]} or null
  var checkedAt = null; // Date the live pull succeeded

  FLX.css(
    ".livebar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;" +
      "margin:0 0 14px;padding:8px 12px;border:1px solid var(--border);" +
      "border-radius:12px;background:var(--panel2);font-size:13px;font-family:var(--sans)}" +
    ".livebar .pill.live{background:rgba(47,182,168,.16);color:var(--teal);" +
      "letter-spacing:.04em;display:inline-flex;align-items:center;gap:6px}" +
    ".livebar .pill.live .dot{width:6px;height:6px;border-radius:50%;" +
      "background:var(--teal);display:inline-block}" +
    ".livebar .lvtxt{color:var(--text)}" +
    ".livebar .lvsub{color:var(--dim);font-size:12px}" +
    ".livebar .lvchip{cursor:pointer;padding:1px 9px;border-radius:20px;font-size:12px;" +
      "font-weight:600;background:rgba(47,182,168,.12);color:var(--teal);" +
      "border:1px solid transparent}" +
    ".livebar .lvchip:hover{border-color:var(--teal)}"
  );

  // Parse a currency-ish string like "$5,000,000.00" -> 5000000 (Number).
  function amt(s){
    var n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
    return isFinite(n) ? n : -1;
  }

  // Given one live game object, return {id, topRemaining} or null.
  // Field names may drift, so probe defensively.
  function readLive(g){
    if(!g || typeof g !== "object") return null;
    var id = g.Id != null ? g.Id
           : g.id != null ? g.id
           : g.GameNumber != null ? g.GameNumber
           : g.gameNumber != null ? g.gameNumber : null;
    if(id == null) return null;
    id = String(id).trim();
    if(!id) return null;

    var tiers = g.OddsTiers || g.oddsTiers || g.Tiers || g.tiers;
    if(!Array.isArray(tiers) || !tiers.length) return null;

    // Top tier = highest prize amount (index 0 is NOT reliably the max).
    var best = null, bestV = -1;
    for(var i=0;i<tiers.length;i++){
      var t = tiers[i];
      if(!t || typeof t !== "object") continue;
      var v = amt(t.PrizeAmount != null ? t.PrizeAmount : t.prizeAmount);
      if(v > bestV){ bestV = v; best = t; }
    }
    if(!best) return null;

    var rem = best.PrizesRemaining != null ? best.PrizesRemaining
            : best.prizesRemaining != null ? best.prizesRemaining : null;
    rem = Number(rem);
    if(!isFinite(rem)) return null;

    return { id: id, topRemaining: rem };
  }

  // Build the diff object from a parsed live array. Returns null on shape mismatch.
  function computeDiff(arr){
    // Accept a bare array or an object wrapping one.
    if(!Array.isArray(arr) && arr && typeof arr === "object"){
      for(var k in arr){ if(Array.isArray(arr[k])){ arr = arr[k]; break; } }
    }
    if(!Array.isArray(arr) || !arr.length) return null;

    var total = 0, movers = [], matched = 0;
    for(var i=0;i<arr.length;i++){
      var r = readLive(arr[i]);
      if(!r) continue;
      var b = byNo[r.id];
      if(!b) continue;
      matched++;
      var baked = Number(b.top_prizes_remaining);
      if(!isFinite(baked)) continue;
      // Only count claims (live < baked). Ignore negatives (re-stock / noise).
      if(r.topRemaining < baked){
        var d = baked - r.topRemaining;
        total += d;
        movers.push({ id: r.id, name: b.game_name || GAME_NAME[r.id] || ("Game " + r.id), d: d });
      }
    }
    // If nothing matched at all, we almost certainly misread the shape -> bail.
    if(matched === 0) return null;

    movers.sort(function(a,b){ return b.d - a.d; });
    return { total: total, movers: movers };
  }

  // "just now" / "3 min ago" style stamp.
  function stamp(){
    if(!checkedAt) return "just now";
    var s = Math.max(0, Math.round((Date.now() - checkedAt.getTime())/1000));
    if(s < 45) return "just now";
    var m = Math.round(s/60);
    if(m < 60) return m + " min ago";
    var h = Math.round(m/60);
    return h + "h ago";
  }

  // Render the LIVE bar as first child of #main, only on overview.
  function render(){
    try{
      if(!diff) return;
      var main = document.querySelector("#main");
      if(!main) return;
      // avoid duplicates on re-render
      var old = main.querySelector(".livebar");
      if(old) old.remove();

      var html;
      if(diff.total <= 0){
        html = '<div class="livebar">' +
          '<span class="pill live"><span class="dot"></span>LIVE</span>' +
          '<span class="lvtxt">No new top-prize claims since last night’s build.</span>' +
          '<span class="lvsub">· checked ' + esc(stamp()) + '</span>' +
        '</div>';
      } else {
        var chips = "";
        var top = diff.movers.slice(0, 3);
        for(var i=0;i<top.length;i++){
          var mv = top[i];
          chips += '<span class="lvchip" data-id="' + esc(mv.id) + '">' +
                   esc(mv.name.length > 26 ? mv.name.slice(0,25) + "…" : mv.name) +
                   ' −' + num(mv.d) + '</span>';
        }
        var plural = diff.total === 1 ? "top prize" : "top prizes";
        html = '<div class="livebar">' +
          '<span class="pill live"><span class="dot"></span>LIVE</span>' +
          '<span class="lvtxt">' + num(diff.total) + ' ' + plural +
            ' claimed since last night’s build</span>' +
          chips +
          '<span class="lvsub">· checked ' + esc(stamp()) + '</span>' +
        '</div>';
      }

      main.insertAdjacentHTML("afterbegin", html);
      var bar = main.querySelector(".livebar");
      if(bar){
        bar.querySelectorAll(".lvchip").forEach(function(c){
          c.onclick = function(){ go("game", c.dataset.id); };
        });
      }
    }catch(e){ console.warn("live: render failed", e); }
  }

  // Fire the network pull exactly once.
  function pull(){
    var ctrl, timer;
    try{
      ctrl = new AbortController();
      timer = setTimeout(function(){ try{ ctrl.abort(); }catch(_){ } }, TIMEOUT_MS);
    }catch(e){
      console.warn("live: no AbortController", e);
      return;
    }

    fetch(ENDPOINT, { headers: { "x-partner": "web" }, signal: ctrl.signal })
      .then(function(res){
        if(!res || !res.ok) throw new Error("bad status " + (res && res.status));
        return res.json();
      })
      .then(function(json){
        clearTimeout(timer);
        var d = computeDiff(json);
        if(!d){ console.warn("live: could not map feed shape; skipping"); return; }
        diff = d;
        checkedAt = new Date();
        // Re-render only if we're currently on overview.
        var tab = (location.hash.replace(/^#/, "") || "overview").split("/")[0];
        if(tab === "overview") render();
      })
      .catch(function(err){
        clearTimeout(timer);
        console.warn("live: fetch/diff failed (degrading silently)", err);
      });
  }

  FLX.ready.push(function(){
    try{ pull(); }catch(e){ console.warn("live: pull threw", e); }
  });

  // Re-draw the cached badge whenever the overview renders.
  document.addEventListener("flx:view", function(e){
    try{
      var tab = e && e.detail && e.detail.tab;
      if(tab === "overview") render();
    }catch(err){ console.warn("live: view hook failed", err); }
  });

})();
