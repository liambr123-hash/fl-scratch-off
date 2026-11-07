/* HTML-first explorer. No third-party runtime dependency, cookies or ad scripts. */
(() => {
  'use strict';
  if (typeof DATA === 'undefined') {
    document.querySelector('#results-count').textContent = 'Interactive filters are unavailable. Use the game and price links to explore the snapshot.';
    return;
  }
  const $ = s => document.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => n == null ? 'Not available' : '$' + Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
  const compact = n => n == null ? '—' : n >= 1e6 ? '$' + (n/1e6).toLocaleString('en-US',{maximumFractionDigits:1}) + 'M' : n >= 1e3 ? '$' + Math.round(n/1e3).toLocaleString('en-US') + 'k' : money(n);
  const number = n => n == null ? '—' : Number(n).toLocaleString('en-US');
  const games = DATA.games.map(g => {
    const eligible = g.recommendation_eligible ?? Boolean(g.on_sale && g.value_per_dollar_now != null);
    const p = (DATA.tiers[g.game_no] || []).reduce((sum,t) => sum + (t[1] > g.ticket_price && t[2] > 0 ? 1/t[2] : 0),0);
    return {...g, eligible, profitOdds: eligible && p > 0 ? 1/p : null};
  });
  const byId = new Map(games.map(g => [String(g.game_no),g]));
  const params = new URLSearchParams(location.search);
  const validPrices = ['all','1','2','3','5','10','20','30','50'];
  const validSorts = ['ev','jackpot','profit','new'];
  const state = {
    price: validPrices.includes(params.get('price')) ? params.get('price') : 'all',
    sort: validSorts.includes(params.get('sort')) ? params.get('sort') : 'ev',
    q: params.get('q') || '', top: params.get('top') === '1', limit:12,
    game:byId.has(params.get('game')) ? params.get('game') : null,
    compare: [...new Set((params.get('compare') || '').split(',').filter(id => byId.get(id)?.eligible))].slice(0,3)
  };
  const sortText = {ev:'Sorted by estimated payout per $1',jackpot:'Sorted by largest available top prize',profit:'Sorted by best published profit odds',new:'Sorted by newest release'};
  function saveUrl() {
    const u = new URL(location.href);
    for (const key of ['price','sort','q','top','game','compare']) u.searchParams.delete(key);
    if (state.price !== 'all') u.searchParams.set('price',state.price);
    if (state.sort !== 'ev') u.searchParams.set('sort',state.sort);
    if (state.q) u.searchParams.set('q',state.q);
    if (state.top) u.searchParams.set('top','1');
    if (state.game) u.searchParams.set('game',state.game);
    if (state.compare.length) u.searchParams.set('compare',state.compare.join(','));
    history.replaceState(null,'',u.pathname + u.search + u.hash);
  }
  function selection() {
    const q = state.q.trim().replace(/^#/,'').toLowerCase();
    return games.filter(g => g.eligible && (state.price === 'all' || g.ticket_price === Number(state.price)) && (!q || g.game_name.toLowerCase().includes(q) || String(g.game_no).includes(q)) && (!state.top || g.top_prizes_remaining > 0))
      .sort((a,b) => {
        let diff = 0;
        if (state.sort === 'jackpot') diff = ((b.top_prizes_remaining > 0 ? b.top_prize_value_num : -1) || 0) - ((a.top_prizes_remaining > 0 ? a.top_prize_value_num : -1) || 0);
        else if (state.sort === 'profit') diff = (a.profitOdds ?? Infinity) - (b.profitOdds ?? Infinity);
        else if (state.sort === 'new') diff = (b.launch_date || '').localeCompare(a.launch_date || '');
        else diff = (b.value_per_dollar_now ?? -1) - (a.value_per_dollar_now ?? -1);
        return diff || Number(a.game_no)-Number(b.game_no);
      });
  }
  function row(g,index) {
    const id = esc(g.game_no), dead = g.top_prizes_remaining === 0 && g.top_prizes_total;
    return `<tr data-game="${id}"><td class="game-cell" data-label="Game"><span class="row-rank">${String(index+1).padStart(2,'0')}</span><div><a href="/g/${id}" data-open-game="${id}">${esc(g.game_name)}</a><span class="game-id">#${id} · <span class="status-badge ${dead ? 'depleted' : ''}">${dead ? 'Top prize gone' : 'Top prize available'}</span></span></div></td><td data-label="Ticket price"><strong>${money(g.ticket_price)}</strong></td><td data-label="Est. payout / $1"><strong class="ev-number">$${g.value_per_dollar_now.toFixed(2)}</strong></td><td data-label="Profit odds">${g.profitOdds ? '1 in ' + g.profitOdds.toFixed(1) : 'Not available'}</td><td data-label="Top prizes left"><strong>${number(g.top_prizes_remaining)}</strong><span class="secondary"> of ${number(g.top_prizes_total)}</span></td><td data-label="Top prize">${compact(g.top_prize_value_num)}</td><td class="row-actions"><button type="button" class="detail-button" data-open-game="${id}" aria-label="Details for ${esc(g.game_name)}">Details <span aria-hidden="true">↗</span></button><label class="compare-check"><input type="checkbox" value="${id}" data-compare aria-label="Compare ${esc(g.game_name)}" ${state.compare.includes(String(g.game_no)) ? 'checked' : ''}><span>Compare</span></label></td></tr>`;
  }
  function renderResults() {
    const list = selection();
    $('#ticket-results').innerHTML = list.slice(0,state.limit).map(row).join('');
    $('#results-count').textContent = list.length ? `Showing ${Math.min(state.limit,list.length)} of ${list.length} matching games` : 'No matching games';
    $('#sort-description').textContent = sortText[state.sort];
    $('#no-results').hidden = list.length > 0;
    $('#ticket-table').hidden = list.length === 0;
    $('#show-more').hidden = list.length <= state.limit;
    document.querySelectorAll('[data-price]').forEach(a => {
      const active = a.dataset.price === state.price;
      a.classList.toggle('active',active);
      if (active) a.setAttribute('aria-current','true'); else a.removeAttribute('aria-current');
    });
    $('#game-search').value = state.q;
    $('#game-sort').value = state.sort;
    $('#top-prize-only').checked = state.top;
    saveUrl();
  }
  function renderDetail(id,scroll = true) {
    const g = byId.get(String(id));
    if (!g) return;
    state.game = String(id); saveUrl();
    const tiers = DATA.tiers[id] || [];
    const claims = (DATA.winners || []).filter(w => String(w[0]) === String(id)).sort((a,b) => (b[1] || '').localeCompare(a[1] || '')).slice(0,3);
    const official = `https://floridalottery.com/games/scratch-offs/view?id=${encodeURIComponent(id)}`;
    $('#game-detail').innerHTML = `<div class="detail-heading"><div><p class="eyebrow">The full picture · Game #${esc(id)}</p><h3>${esc(g.game_name)}</h3><p>${money(g.ticket_price)} ticket · Released ${esc(g.launch_date || 'date not available')} · ${g.source_status === 'quarantined' ? 'Source limited — excluded from comparisons' : g.on_sale ? 'Listed on sale' : 'Sales ended'}</p></div><button class="icon-button" type="button" data-close-detail aria-label="Close game details">×</button></div>${g.data_quality ? `<p class="quality-note">${esc(g.source_status === 'quarantined' ? 'We cannot verify this game’s prize counts. The available winner report predates this release, so it is excluded from comparisons. Check the official source before relying on the records below.' : g.data_quality)}</p>` : ''}<div class="detail-kpis"><div><strong>${g.eligible ? '$'+g.value_per_dollar_now.toFixed(2) : 'Not ranked'}</strong><span>estimated payout per $1</span></div><div><strong>${g.source_status === 'quarantined' ? 'Unverified' : number(g.top_prizes_remaining)+' / '+number(g.top_prizes_total)}</strong><span>advertised top prizes left</span></div><div><strong>${g.eligible && g.overall_odds_1_in ? '1 in '+Number(g.overall_odds_1_in).toFixed(2) : '—'}</strong><span>published overall odds</span></div><div><strong>${g.profitOdds ? '1 in '+g.profitOdds.toFixed(1) : '—'}</strong><span>published profit odds</span></div></div><p class="detail-notes">Advertised top prize: <strong>${esc(g.top_prize_display)}</strong>. Prize values may be annuities; actual cash-option payouts can be lower. Winner report: ${esc(g.source_report_date || g.last_queried || 'not available')}. Model snapshot: ${esc(DATA.meta.built)}.</p><h4>${g.eligible ? 'Prize tiers & published odds' : 'Source-limited prize report — verify with the official source'}</h4><div class="tier-table-wrap"><table class="tier-table"><thead><tr><th scope="col">Advertised prize</th><th scope="col">Published odds</th><th scope="col">Remaining</th><th scope="col">Original</th></tr></thead><tbody>${tiers.map(t => `<tr><td>${esc(t[0])}</td><td>${t[2] ? '1 in '+number(t[2]) : '—'}</td><td>${number(t[3])}</td><td>${number(t[4])}</td></tr>`).join('')}</tbody></table></div>${claims.length ? `<h4>Latest reported claims</h4><ul class="detail-notes">${claims.map(w => `<li>${esc(w[1])}: ${esc(w[5])} · ${esc(w[3] || 'Florida')} · ${esc(w[10] || 'Retailer not listed')}</li>`).join('')}</ul>` : '<p class="detail-notes">No claims were listed in the available winner report.</p>'}<div class="detail-links"><a href="${official}" target="_blank" rel="noopener">Official game & source ↗</a><a href="/g/${esc(id)}">Permanent game page ↗</a><button type="button" class="utility-link" data-share-game="${esc(id)}">Copy comparison link ↗</button>${g.eligible ? `<button type="button" class="utility-link" data-add-compare="${esc(id)}">Add to comparison +</button>` : ''}</div>`;
    $('#game-detail').hidden = false;
    if (scroll) $('#game-detail').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto':'smooth',block:'start'});
  }
  function updateCompare() {
    $('#compare-tray').hidden = !state.compare.length;
    $('#compare-count').textContent = `${state.compare.length} of 3 games selected`;
    document.querySelectorAll('[data-compare]').forEach(input => input.checked = state.compare.includes(input.value));
    saveUrl();
  }
  function toggleCompare(id,checked = true) {
    if (!byId.get(String(id))?.eligible) { $('#site-status').textContent = 'This source-limited game is excluded from comparisons.'; return; }
    if (checked && !state.compare.includes(id)) {
      if (state.compare.length >= 3) { $('#site-status').textContent = 'Choose up to three games. Clear one before adding another.'; updateCompare(); return; }
      state.compare.push(id);
    } else if (!checked) state.compare = state.compare.filter(g => g !== id);
    updateCompare();
    if (!$('#compare-panel').hidden) renderCompare(false);
  }
  function renderCompare(scroll = true) {
    const selected = state.compare.map(id => byId.get(id)).filter(Boolean);
    if (!selected.length) { $('#compare-panel').hidden = true; return; }
    const rows = [
      ['Ticket price',g => money(g.ticket_price)],
      ['Est. payout per $1',g => g.eligible ? '$'+g.value_per_dollar_now.toFixed(2) : 'Not ranked'],
      ['Published profit odds',g => g.profitOdds ? '1 in '+g.profitOdds.toFixed(1) : 'Not available'],
      ['Advertised top prize',g => esc(g.top_prize_display)],
      ['Top prizes remaining',g => number(g.top_prizes_remaining)+' of '+number(g.top_prizes_total)],
      ['Published overall odds',g => g.eligible && g.overall_odds_1_in ? '1 in '+Number(g.overall_odds_1_in).toFixed(2) : 'Not available'],
      ['Release date',g => esc(g.launch_date || 'Not available')]
    ];
    $('#compare-panel').innerHTML = `<h3>A closer comparison.</h3><p>Same measurements. No single score to hide the tradeoffs.</p><div class="tier-table-wrap"><table class="compare-table"><thead><tr><th scope="col">Measurement</th>${selected.map(g => `<th scope="col"><a href="/g/${esc(g.game_no)}" data-open-game="${esc(g.game_no)}">${esc(g.game_name)}</a><small class="game-id">#${esc(g.game_no)}</small></th>`).join('')}</tr></thead><tbody>${rows.map(([title,format]) => `<tr><th scope="row">${title}</th>${selected.map(g => `<td>${format(g)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small-note">Estimated payout uses advertised prize values and a modeled inventory, not known unsold tickets.</p>`;
    $('#compare-panel').hidden = false;
    if (scroll) $('#compare-panel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  document.addEventListener('click',async event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const price = event.target.closest('[data-price]');
    if (price) { event.preventDefault(); state.price = price.dataset.price; state.limit=12; renderResults(); return; }
    const game = event.target.closest('[data-open-game]');
    if (game) { event.preventDefault(); renderDetail(game.dataset.openGame); return; }
    if (event.target.closest('[data-close-detail]')) { $('#game-detail').hidden=true; state.game=null; saveUrl(); return; }
    const add = event.target.closest('[data-add-compare]');
    if (add) { toggleCompare(add.dataset.addCompare); add.textContent = state.compare.includes(add.dataset.addCompare) ? 'Added to comparison ✓' : 'Choose up to 3 games'; return; }
    const share = event.target.closest('[data-share-game]');
    if (share) {
      const url = new URL('/',location.origin); url.searchParams.set('game',share.dataset.shareGame); url.hash='tickets';
      try { await navigator.clipboard.writeText(url.href); share.textContent='Link copied ✓'; }
      catch (_) { share.outerHTML=`<a href="${esc(url.href)}">Open this link to share ↗</a>`; }
    }
  });
  document.addEventListener('change',event => { if (event.target.matches('[data-compare]')) toggleCompare(event.target.value,event.target.checked); });
  $('#ticket-filters').addEventListener('submit',event => event.preventDefault());
  $('#game-search').addEventListener('input',event => { state.q=event.target.value; state.limit=12; renderResults(); });
  $('#game-sort').addEventListener('change',event => { state.sort=event.target.value; state.limit=12; renderResults(); });
  $('#top-prize-only').addEventListener('change',event => { state.top=event.target.checked; state.limit=12; renderResults(); });
  $('#show-more').addEventListener('click',() => { state.limit+=12; renderResults(); });
  $('#compare-open').addEventListener('click',() => renderCompare());
  $('#compare-clear').addEventListener('click',() => { state.compare=[]; updateCompare(); $('#compare-panel').hidden=true; });
  $('#print-guide').addEventListener('click',() => window.print());
  const initialFilter = state.price !== 'all' || state.sort !== 'ev' || state.q || state.top;
  if (initialFilter) renderResults();
  updateCompare();
  if (state.game) renderDetail(state.game,false);
  if (state.compare.length) renderCompare(false);
  // Keep old shared #game/N and #compare/N,N links useful without restoring tab pages.
  const oldGame = location.hash.match(/^#game\/(\d+)$/);
  if (oldGame && byId.has(oldGame[1])) { renderDetail(oldGame[1],false); history.replaceState(null,'',location.pathname+location.search+'#tickets'); }
  const oldCompare = location.hash.match(/^#compare\/([\d,]+)$/);
  if (oldCompare) { state.compare=[...new Set(oldCompare[1].split(',').filter(id => byId.get(id)?.eligible))].slice(0,3); updateCompare(); renderCompare(false); }
  const built = new Date(DATA.meta.built_at || DATA.meta.built+'T12:00:00Z');
  if (Number.isFinite(built.getTime())) {
    $('#data-date').textContent = new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/New_York'}).format(built);
    const age=(Date.now()-built.getTime())/864e5;
    $('#freshness-note').textContent = age > 2 ? 'Older snapshot — verify source' : 'Source snapshot';
  }
  let formStartedAt = Date.now();
  $('#sponsor-form-details').addEventListener('toggle',() => { if ($('#sponsor-form-details').open) formStartedAt=Date.now(); });
  $('#sponsor-form').addEventListener('submit',async event => {
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('button[type=submit]'), status=$('#sponsor-status');
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload={name:data.get('name'),company:data.get('company'),email:data.get('email'),message:data.get('message'),budget:data.get('budget'),website:data.get('website'),consent:data.get('consent')==='on',formStartedAt};
    button.disabled=true; status.className=''; status.textContent='Sending your inquiry…';
    try {
      const response=await fetch('/api/sponsorship',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json();
      if (response.status !== 201 || result.ok !== true) {
        const messages={duplicate_inquiry:'An inquiry from this email was received in the last 24 hours. Please allow time for a reply.',invalid_submission:'Please review your details and try again in a moment.',inquiries_unavailable:'The inquiry form is temporarily unavailable. Your information has not been submitted. Please try again later.'};
        throw new Error(messages[result.error] || 'Your inquiry could not be received. Your details are still here; please try again.');
      }
      status.className='success'; status.textContent=`Inquiry received. Thank you — it is stored privately for review. Reference: ${result.id}`;
      form.reset(); formStartedAt=Date.now();
    } catch (error) { status.className='error'; status.textContent=error.message || 'Connection unavailable. Your inquiry was not confirmed. Please try again.'; }
    finally { button.disabled=false; }
  });
  $('#sponsor-fields').disabled=false;
})();
