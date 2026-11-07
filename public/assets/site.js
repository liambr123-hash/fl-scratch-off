/* HTML-first ticket explorer. No third-party runtime dependency or ad scripts. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const status = message => { if ($('#site-status')) $('#site-status').textContent = message; };
  if (typeof DATA === 'undefined') {
    if ($('#results-count')) $('#results-count').textContent = 'Filters unavailable. Use the game or price links.';
    return;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const available = value => typeof value === 'number' && Number.isFinite(value);
  const money = value => available(value) ? '$' + Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  const number = value => available(value) ? Number(value).toLocaleString('en-US') : '—';
  const payout = game => game.eligible && available(game.value_per_dollar_now) ? '$' + Number(game.value_per_dollar_now).toFixed(2) : 'Not ranked';
  const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const listen = (selector, type, handler) => $(selector)?.addEventListener(type, handler);
  let artwork = {};
  try { artwork = JSON.parse($('#game-artwork')?.textContent || '{}'); } catch { /* Text links remain usable without artwork. */ }
  const games = DATA.games.map(game => {
    const eligible = Boolean(game.on_sale && game.source_status !== 'quarantined' && game.recommendation_eligible !== false && available(game.value_per_dollar_now));
    const profit = (DATA.tiers[game.game_no] || []).reduce((sum, tier) => sum + (tier[1] > game.ticket_price && tier[2] > 0 ? 1 / tier[2] : 0), 0);
    return { ...game, eligible, profitOdds: eligible && profit > 0 ? 1 / profit : null };
  });
  const byId = new Map(games.map(game => [String(game.game_no), game]));
  const prices = ['all', '1', '2', '3', '5', '10', '20', '30', '50'];
  const sorts = ['ev', 'jackpot', 'profit', 'new'];
  const sortText = { ev: 'Highest estimated return', jackpot: 'Largest top prize', profit: 'Best published profit odds', new: 'Newest games' };
  function readLocation() {
    const params = new URLSearchParams(location.search);
    return {
      price: prices.includes(params.get('price')) ? params.get('price') : 'all',
      sort: sorts.includes(params.get('sort')) ? params.get('sort') : 'new',
      q: params.get('q') || '', top: params.get('top') === '1', limit: 6,
      game: byId.has(params.get('game')) ? params.get('game') : null,
      compare: [...new Set((params.get('compare') || '').split(',').filter(id => byId.get(id)?.eligible))].slice(0, 3),
    };
  }
  const state = readLocation();
  if (state.q || state.sort !== 'new' || state.top) {
    const filterOptions = $('#filter-options');
    if (filterOptions) filterOptions.open = true;
  }
  function saveUrl() {
    const url = new URL(location.href);
    for (const key of ['price', 'sort', 'q', 'top', 'game', 'compare']) url.searchParams.delete(key);
    if (state.price !== 'all') url.searchParams.set('price', state.price);
    if (state.sort !== 'new') url.searchParams.set('sort', state.sort);
    if (state.q) url.searchParams.set('q', state.q);
    if (state.top) url.searchParams.set('top', '1');
    if (state.game) url.searchParams.set('game', state.game);
    if (state.compare.length) url.searchParams.set('compare', state.compare.join(','));
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  function selection() {
    const query = state.q.trim().replace(/^#/, '').toLowerCase();
    return games.filter(game => game.eligible &&
      (state.price === 'all' || game.ticket_price === Number(state.price)) &&
      (!query || game.game_name.toLowerCase().includes(query) || String(game.game_no).includes(query)) &&
      (!state.top || game.top_prizes_remaining > 0))
      .sort((a, b) => {
        let difference;
        if (state.sort === 'jackpot') difference = (b.top_prizes_remaining > 0 ? b.top_prize_value_num || 0 : -1) - (a.top_prizes_remaining > 0 ? a.top_prize_value_num || 0 : -1);
        else if (state.sort === 'profit') difference = (a.profitOdds ?? Infinity) - (b.profitOdds ?? Infinity);
        else if (state.sort === 'new') difference = (b.launch_date || '').localeCompare(a.launch_date || '');
        else difference = (b.value_per_dollar_now ?? -1) - (a.value_per_dollar_now ?? -1);
        return difference || (state.sort === 'new' ? Number(b.game_no) - Number(a.game_no) : Number(a.game_no) - Number(b.game_no));
      });
  }
  function art(game, loading = 'lazy') {
    const source = artwork[String(game.game_no)]?.thumb;
    return typeof source === 'string' && source
      ? `<img src="${esc(source)}" alt="" loading="${loading}" width="640" height="480" decoding="async">`
      : '<span class="art-fallback" aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h18v4a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7Z"/><path d="M8 7v11"/></svg></span>';
  }
  function remaining(game) {
    if (game.source_status === 'quarantined') return 'Unverified';
    return available(game.top_prizes_remaining) && available(game.top_prizes_total)
      ? number(game.top_prizes_remaining) + ' of ' + number(game.top_prizes_total) : 'Not available';
  }
  function card(game) {
    const id = esc(game.game_no);
    const known = available(game.top_prizes_remaining) && available(game.top_prizes_total) && game.top_prizes_total > 0;
    const percent = known ? Math.max(0, Math.min(100, game.top_prizes_remaining / game.top_prizes_total * 100)) : 0;
    return `<article class="ticket-card" data-game="${id}">
      <div class="ticket-art"><a href="/g/${id}" data-open-game="${id}" aria-label="Details for ${esc(game.game_name)}">${art(game)}</a><span class="ticket-price ticket-pricebadge ticket-price-badge">${money(game.ticket_price)}</span></div>
      <div class="ticket-body"><h3><a href="/g/${id}" data-open-game="${id}">${esc(game.game_name)}</a></h3><span class="game-number">#${id}</span>
      <div class="prize-main"><span>Top prize</span><strong>${money(game.top_prize_value_num)}</strong></div>
      <div class="prize-left${game.top_prizes_remaining === 0 ? ' depleted' : ''}"><span>Top prizes left</span><strong>${remaining(game)}</strong></div>
      <div class="prize-meter" aria-hidden="true"${known ? '' : ' hidden'}><i style="width:${percent.toFixed(1)}%"></i></div>
      <div class="ticket-actions"><button type="button" class="button primary detail-button" data-open-game="${id}" aria-label="Details for ${esc(game.game_name)}">Details <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button><label class="compare-check"><input type="checkbox" value="${id}" data-compare aria-label="Compare ${esc(game.game_name)}"${state.compare.includes(String(game.game_no)) ? ' checked' : ''}><span>Compare</span></label></div></div>
    </article>`;
  }
  function renderResults() {
    const list = selection();
    $('#ticket-results').innerHTML = list.slice(0, state.limit).map(card).join('');
    $('#results-count').textContent = `${Math.min(state.limit, list.length)} of ${list.length}`;
    $('#sort-description').textContent = sortText[state.sort];
    $('#no-results').textContent = 'Try another price or name.';
    $('#no-results').hidden = list.length > 0;
    $('#ticket-table').hidden = list.length === 0;
    $('#show-more').textContent = 'More games';
    $('#show-more').hidden = list.length <= state.limit;
    document.querySelectorAll('[data-price]').forEach(link => {
      const active = link.dataset.price === state.price;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
    });
    $('#game-search').value = state.q;
    $('#game-sort').value = state.sort;
    $('#top-prize-only').checked = state.top;
    saveUrl();
  }
  const detailDialog = $('#game-detail');
  const compareDialog = $('#compare-panel');
  function closeDetails() {
    state.game = null;
    saveUrl();
    if (detailDialog.open) detailDialog.close();
  }
  function showDialog(dialog) {
    // Let the browser restore focus before opening a different modal.
    if (dialog === detailDialog && compareDialog.open) compareDialog.close();
    if (dialog === compareDialog && detailDialog.open) closeDetails();
    if (!dialog.open) dialog.showModal();
  }
  function renderDetail(id) {
    const game = byId.get(String(id));
    if (!game) return;
    state.game = String(id);
    const tiers = DATA.tiers[id] || [];
    const claims = (DATA.winners || []).filter(winner => String(winner[0]) === String(id))
      .sort((a, b) => (b[1] || '').localeCompare(a[1] || '')).slice(0, 3);
    const official = `https://floridalottery.com/games/scratch-offs/view?id=${encodeURIComponent(id)}`;
    const quarantined = game.source_status === 'quarantined';
    detailDialog.setAttribute('aria-labelledby', 'game-detail-title');
    detailDialog.innerHTML = `<div class="dialog-heading"><span class="game-number">Game #${esc(id)}</span><button type="button" class="dialog-close" data-close-detail autofocus>Close</button></div>
      <div class="detail-overview"><div class="detail-art">${art(game, 'eager')}</div><div class="detail-summary"><h2 id="game-detail-title">${esc(game.game_name)}</h2><p class="detail-price">${money(game.ticket_price)} ticket</p>
      ${quarantined ? '<p class="quality-note" role="note">Unverified data. Not included in comparisons.</p>' : !game.on_sale ? '<p class="quality-note">Sales ended.</p>' : ''}
      <div class="detail-facts"><div class="detail-fact"><span>Top prize</span><strong>${quarantined ? 'Unverified' : money(game.top_prize_value_num)}</strong></div><div class="detail-fact"><span>Top prizes left</span><strong>${remaining(game)}</strong></div></div>
      <p class="detail-source">Source date: ${esc(game.source_report_date || game.last_queried || 'Not available')}</p></div></div>
      <details class="detail-more"><summary>Odds &amp; details</summary><div class="detail-extra">
      ${game.data_quality ? `<p class="quality-note">${esc(quarantined ? 'Data cannot be verified. Check the official source.' : game.data_quality)}</p>` : ''}
      <dl class="detail-kpis"><div><dt>Est. return / $1</dt><dd>${payout(game)}</dd></div><div><dt>Published overall odds</dt><dd>${game.eligible && available(game.overall_odds_1_in) ? '1 in ' + Number(game.overall_odds_1_in).toFixed(2) : 'Not available'}</dd></div><div><dt>Published profit odds</dt><dd>${game.profitOdds ? '1 in ' + game.profitOdds.toFixed(1) : 'Not available'}</dd></div><div><dt>Release date</dt><dd>${esc(game.launch_date || 'Not available')}</dd></div></dl>
      <p class="detail-notes">Estimated return uses advertised prize values and an estimated ticket pool. Unsold ticket counts are not public. Claims may lag sales, and cash-option payouts can be lower. This is not a prediction or a promise of profit.</p>
      <h3>${quarantined ? 'Unverified prize report' : 'All prizes'}</h3><div class="tier-table-wrap"><table class="tier-table"><thead><tr><th scope="col">Prize</th><th scope="col">Published odds</th><th scope="col">Left</th><th scope="col">Original</th></tr></thead><tbody>${tiers.map(tier => `<tr><td>${esc(tier[0])}</td><td>${tier[2] ? '1 in ' + number(tier[2]) : '—'}</td><td>${number(tier[3])}</td><td>${number(tier[4])}</td></tr>`).join('')}</tbody></table></div>
      <h3>Recent claims</h3>${claims.length ? `<ul class="detail-notes">${claims.map(winner => `<li>${esc(winner[1])}: ${esc(winner[5])} · ${esc(winner[3] || 'Florida')} · ${esc(winner[10] || 'Retailer not listed')}</li>`).join('')}</ul>` : '<p class="detail-notes">None listed in this source report.</p>'}
      <p class="detail-notes">Snapshot: ${esc(DATA.meta.built)}. Each game number is a separate release.</p></div></details>
      <div class="detail-links"><a href="${official}" target="_blank" rel="noopener">Official source ↗</a><a href="/g/${esc(id)}">Game page ↗</a><button type="button" class="utility-link" data-share-game="${esc(id)}">Copy link</button>${game.eligible ? `<button type="button" class="utility-link" data-add-compare="${esc(id)}">${state.compare.includes(String(id)) ? 'Added ✓' : 'Compare +'}</button>` : ''}</div>`;
    saveUrl();
    showDialog(detailDialog);
  }
  detailDialog.addEventListener('close', () => { if (!detailDialog.open) { state.game = null; saveUrl(); } });
  function updateCompare() {
    $('#compare-tray').hidden = !state.compare.length;
    $('#compare-count').textContent = `${state.compare.length} / 3 selected`;
    document.querySelectorAll('[data-compare]').forEach(input => { input.checked = state.compare.includes(input.value); });
    saveUrl();
  }
  function toggleCompare(id, checked = true) {
    id = String(id);
    if (!byId.get(id)?.eligible) { status('Unverified games are not compared.'); return; }
    if (checked && !state.compare.includes(id)) {
      if (state.compare.length >= 3) { status('Choose up to 3 games. Remove one to add another.'); updateCompare(); return; }
      state.compare.push(id);
    } else if (!checked) state.compare = state.compare.filter(selected => selected !== id);
    updateCompare();
    if (compareDialog.open) renderCompare();
  }
  function renderCompare() {
    const selected = state.compare.map(id => byId.get(id)).filter(game => game?.eligible);
    if (!selected.length) { if (compareDialog.open) compareDialog.close(); return; }
    const wasOpen = compareDialog.open;
    compareDialog.setAttribute('aria-labelledby', 'compare-title');
    compareDialog.innerHTML = `<div class="dialog-heading"><h2 id="compare-title">Compare tickets</h2><button type="button" class="dialog-close" data-close-compare autofocus>Close</button></div>
      <div class="compare-grid">${selected.map(game => `<article class="compare-card"><div class="compare-art">${art(game, 'eager')}</div><h3><a href="/g/${esc(game.game_no)}" data-open-game="${esc(game.game_no)}">${esc(game.game_name)}</a></h3><p class="game-number">#${esc(game.game_no)}</p><dl class="compare-stats"><div><dt>Price</dt><dd>${money(game.ticket_price)}</dd></div><div><dt>Top prize</dt><dd>${money(game.top_prize_value_num)}</dd></div><div><dt>Top prizes left</dt><dd>${remaining(game)}</dd></div><div><dt>Est. return / $1</dt><dd>${payout(game)}</dd></div><div><dt>Published profit odds</dt><dd>${game.profitOdds ? '1 in ' + game.profitOdds.toFixed(1) : 'Not available'}</dd></div></dl><button class="button secondary compare-remove" type="button" data-remove-compare="${esc(game.game_no)}" aria-label="Remove ${esc(game.game_name)} from comparison">Remove</button></article>`).join('')}</div>
      <p class="compare-note">Returns are estimates, not winning promises. Cash-option payouts may be lower.</p>`;
    showDialog(compareDialog);
    if (wasOpen) compareDialog.querySelector('[data-close-compare]').focus();
  }
  function openSection(id, scroll = true) {
    const target = document.getElementById(String(id).replace(/^#/, ''));
    if (!target) return false;
    for (let element = target; element; element = element.parentElement) {
      if (element.tagName === 'DETAILS') element.open = true;
    }
    if (scroll) target.scrollIntoView({ behavior: motion(), block: 'start' });
    return true;
  }
  function newGames(scroll = true) {
    state.sort = 'new'; state.q = ''; state.limit = 6;
    renderResults();
    const url = new URL(location.href); url.hash = 'tickets';
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (scroll) $('#tickets').scrollIntoView({ behavior: motion(), block: 'start' });
  }
  document.addEventListener('click', async event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const newLink = event.target.closest('[data-sort-filter="new"]');
    if (newLink) { event.preventDefault(); newGames(); return; }
    const sectionLink = event.target.closest('[data-open-section]');
    if (sectionLink) {
      const id = sectionLink.dataset.openSection || sectionLink.getAttribute('href')?.split('#')[1];
      if (id && openSection(id)) {
        event.preventDefault();
        const url = new URL(location.href); url.hash = String(id).replace(/^#/, '');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      return;
    }
    const price = event.target.closest('[data-price]');
    if (price) { event.preventDefault(); state.price = price.dataset.price; state.limit = 6; renderResults(); return; }
    const game = event.target.closest('[data-open-game]');
    if (game) { event.preventDefault(); renderDetail(game.dataset.openGame); return; }
    if (event.target.closest('[data-close-detail]')) { closeDetails(); return; }
    if (event.target.closest('[data-close-compare]')) { compareDialog.close(); return; }
    const remove = event.target.closest('[data-remove-compare]');
    if (remove) { toggleCompare(remove.dataset.removeCompare, false); return; }
    const add = event.target.closest('[data-add-compare]');
    if (add) { toggleCompare(add.dataset.addCompare); add.textContent = state.compare.includes(add.dataset.addCompare) ? 'Added ✓' : 'Choose up to 3'; return; }
    const share = event.target.closest('[data-share-game]');
    if (share) {
      const url = new URL('/', location.origin); url.searchParams.set('game', share.dataset.shareGame); url.hash = 'tickets';
      try { await navigator.clipboard.writeText(url.href); share.textContent = 'Link copied ✓'; }
      catch { share.outerHTML = `<a href="${esc(url.href)}">Open link to share</a>`; }
    }
  });
  document.addEventListener('change', event => { if (event.target.matches('[data-compare]')) toggleCompare(event.target.value, event.target.checked); });
  listen('#ticket-filters', 'submit', event => event.preventDefault());
  listen('#game-search', 'input', event => { state.q = event.target.value; state.limit = 6; renderResults(); });
  listen('#game-sort', 'change', event => { state.sort = event.target.value; state.limit = 6; renderResults(); });
  listen('#top-prize-only', 'change', event => { state.top = event.target.checked; state.limit = 6; renderResults(); });
  listen('#show-more', 'click', () => {
    const previousLimit = state.limit; state.limit += 6; renderResults();
    const nextCard = $('#ticket-results').children[previousLimit];
    nextCard?.querySelector('h3 a')?.focus({ preventScroll: true });
    nextCard?.scrollIntoView({ behavior: motion(), block: 'nearest' });
  });
  listen('#compare-open', 'click', () => renderCompare());
  listen('#compare-clear', 'click', () => { state.compare = []; updateCompare(); if (compareDialog.open) compareDialog.close(); });
  listen('#print-guide', 'click', () => window.print());
  $('#results-count').setAttribute('role', 'status');
  function applyHash(scroll = true) {
    const oldGame = location.hash.match(/^#game\/(\d+)$/);
    const oldCompare = location.hash.match(/^#compare\/([\d,]+)$/);
    if (oldGame && byId.has(oldGame[1])) { renderDetail(oldGame[1]); history.replaceState(null, '', location.pathname + location.search + '#tickets'); }
    else if (oldCompare) {
      state.compare = [...new Set(oldCompare[1].split(',').filter(id => byId.get(id)?.eligible))].slice(0, 3);
      updateCompare(); renderCompare();
    } else if (location.hash === '#new-games') newGames(scroll);
    else if (location.hash) {
      try { openSection(decodeURIComponent(location.hash.slice(1)), scroll); } catch { /* Ignore malformed shared fragments. */ }
    }
  }
  renderResults();
  updateCompare();
  if (state.game) renderDetail(state.game);
  else if (state.compare.length) renderCompare();
  applyHash(false);
  window.addEventListener('hashchange', () => applyHash());
  window.addEventListener('popstate', () => {
    Object.assign(state, readLocation());
    renderResults(); updateCompare();
    if (state.game) renderDetail(state.game);
    else { if (detailDialog.open) detailDialog.close(); if (state.compare.length) renderCompare(); else if (compareDialog.open) compareDialog.close(); }
    applyHash(false);
  });
  const built = new Date(DATA.meta.built_at || DATA.meta.built + 'T12:00:00Z');
  if (Number.isFinite(built.getTime())) {
    $('#data-date').textContent = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).format(built);
    $('#freshness-note').textContent = (Date.now() - built.getTime()) / 864e5 > 2 ? 'Older data — check source' : 'Updated';
  }
  let formStartedAt = Date.now();
  listen('#sponsor-form-details', 'toggle', () => { if ($('#sponsor-form-details').open) formStartedAt = Date.now(); });
  listen('#sponsor-form', 'submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button[type=submit]'), formStatus = $('#sponsor-status');
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = { name: data.get('name'), company: data.get('company'), email: data.get('email'), message: data.get('message'), budget: data.get('budget'), website: data.get('website'), consent: data.get('consent') === 'on', formStartedAt };
    button.disabled = true; formStatus.className = ''; formStatus.textContent = 'Sending…';
    let userMessage = '';
    try {
      const response = await fetch('/api/sponsorship', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (response.status !== 201 || result.ok !== true) {
        const messages = { duplicate_inquiry: 'Already received. Please allow time for a reply.', invalid_submission: 'Please check the form and try again.', inquiries_unavailable: 'Not sent. Please try again later.' };
        userMessage = messages[result.error] || 'Not sent. Your details are still here. Please try again.';
        throw new Error('not_received');
      }
      formStatus.className = 'success'; formStatus.textContent = 'Received. Thank you.';
      form.reset(); formStartedAt = Date.now();
    } catch { formStatus.className = 'error'; formStatus.textContent = userMessage || 'Connection problem. Please try again.'; }
    finally { button.disabled = false; }
  });
  if ($('#sponsor-fields')) $('#sponsor-fields').disabled = false;
})();
