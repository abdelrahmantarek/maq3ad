import { categoryById, venue, type Lang } from '../config/venue';
import { browserStore, LocalBookingRepository, SeatUnavailableError, type Booking } from '../data/bookingRepository';
import { ellipsePoint } from '../domain/geometry';
import {
  buildLayout,
  computeSold,
  findSeatIndex,
  freeSeatInNextRow,
  nextFreeSeat,
  SEAT_FREE,
  SEAT_MINE,
  SEAT_SOLD,
  seatId,
  type Block,
} from '../domain/layout';
import { basketTotals, canAddToBasket, seatFee, seatTotal } from '../domain/pricing';
import { viewScore } from '../domain/viewScore';
import { formatDateTime, formatMoney, formatNumber, getLang, initialLang, setLang, t } from '../i18n';
import { StadiumScene, type ViewMode } from '../scene/StadiumScene';
import { ticketPattern } from './ticket';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export async function startApp(): Promise<void> {
  setLang(initialLang());

  if (!webglAvailable()) {
    const scene = $('scene');
    scene.classList.add('fallback');
    scene.textContent = t('webglMissing');
    return;
  }

  const layout = buildLayout(venue);
  const status = computeSold(layout, venue.soldSeed);
  const repo = new LocalBookingRepository(browserStore());
  const fee = venue.serviceFeeRate;
  const money = (n: number) => formatMoney(n, venue.currency);

  for (const booking of await repo.list()) {
    for (const id of booking.seatIds) {
      const i = findSeatIndex(layout, id);
      if (i >= 0) status[i] = SEAT_MINE;
    }
  }

  const state = {
    mode: 'stadium' as ViewMode,
    block: -1,
    seat: -1,
    basket: [] as number[],
    filter: new Set(venue.categories.map((c) => c.id)),
    drawerOpen: false,
    autoRotate: false,
    payment: 'card',
  };

  const scene = new StadiumScene($('scene'), layout, venue, status, {
    onBlockHover: (b, x, y) => showTooltip(b === null ? null : blockTooltip(layout.blocks[b]), x, y),
    onBlockPick: (b) => enterBlock(b),
    onSeatHover: (s, x, y) => showTooltip(s === null ? null : seatTooltip(s), x, y),
    onSeatPick: (s) => pickSeat(s),
    onAutoRotateChange: (on) => {
      state.autoRotate = on;
      renderTools();
    },
  });
  scene.setAutoRotate(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // --------------------------------------------------------------- helpers

  const blockOf = (seat: number): Block => layout.blocks[layout.seatBlock[seat]];
  const priceOf = (seat: number) => categoryById(blockOf(seat).category).price;
  const scoreOf = (seat: number) =>
    viewScore(layout.pos[seat * 3], layout.pos[seat * 3 + 1], layout.pos[seat * 3 + 2]);
  const freeCount = (block: Block) => {
    let n = 0;
    for (let i = block.seatStart; i < block.seatStart + block.seatCount; i++) if (status[i] === SEAT_FREE) n++;
    return n;
  };
  const seatName = (seat: number) =>
    `${t('block')} ${blockOf(seat).label} · ${t('row')} ${formatNumber(layout.seatRow[seat])} · ${t('seat')} ${formatNumber(layout.seatNum[seat])}`;

  function bestFreeSeat(block: Block): number {
    let best = -1;
    let bestScore = -1;
    for (let i = block.seatStart; i < block.seatStart + block.seatCount; i++) {
      if (status[i] !== SEAT_FREE || state.basket.includes(i)) continue;
      const s = scoreOf(i);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return best;
  }

  let toastTimer = 0;
  function toast(message: string): void {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (el.hidden = true), 3200);
  }

  function showTooltip(html: string | null, x: number, y: number): void {
    const el = $('tooltip');
    if (html === null) {
      el.hidden = true;
      return;
    }
    el.innerHTML = html;
    el.hidden = false;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 14))}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, y + 16))}px`;
  }

  function blockTooltip(block: Block): string {
    const c = categoryById(block.category);
    return (
      `<b>${t('block')} ${block.label}</b>` +
      `<span><i class="dot" style="background:${c.color}"></i>${esc(c.name[getLang()])} · ${money(seatTotal(c.price, fee))}</span>` +
      `<span>${t('freeSeats', { n: formatNumber(freeCount(block)) })}</span>`
    );
  }

  function seatStateLabel(seat: number): string {
    if (status[seat] === SEAT_MINE) return t('yours');
    if (status[seat] === SEAT_SOLD) return t('sold');
    return state.basket.includes(seat) ? t('inBasket') : t('available');
  }

  function seatTooltip(seat: number): string {
    const free = status[seat] === SEAT_FREE;
    return (
      `<b>${t('row')} ${formatNumber(layout.seatRow[seat])} · ${t('seat')} ${formatNumber(layout.seatNum[seat])}</b>` +
      `<span>${seatStateLabel(seat)}${free ? ` · ${money(seatTotal(priceOf(seat), fee))}` : ''}</span>` +
      (free ? `<span>${t('viewScore')}: ${formatNumber(scoreOf(seat))}/100</span>` : '')
    );
  }

  // ------------------------------------------------------------ navigation

  function setMode(mode: ViewMode, block: number, seat: number): void {
    state.mode = mode;
    state.block = block;
    state.seat = seat;
    document.body.dataset.mode = mode;
    renderCrumbs();
    renderCard();
    renderMinimapState();
    $('hint').textContent = t(mode === 'stadium' ? 'hintStadium' : mode === 'block' ? 'hintBlock' : 'hintSeat');
  }

  function enterStadium(): void {
    scene.flyToStadium();
    setMode('stadium', -1, -1);
  }

  function enterBlock(block: number): void {
    scene.flyToBlock(block);
    setMode('block', block, -1);
  }

  function enterSeat(seat: number): void {
    scene.flyToSeat(seat);
    setMode('seat', layout.seatBlock[seat], seat);
  }

  function pickSeat(seat: number): void {
    if (status[seat] === SEAT_SOLD) toast(t('seatSold'));
    else enterSeat(seat);
  }

  function back(): void {
    if (state.drawerOpen) {
      state.drawerOpen = false;
      renderDrawer();
    } else if (state.mode === 'seat') enterBlock(state.block);
    else if (state.mode === 'block') enterStadium();
  }

  // ---------------------------------------------------------------- basket

  function syncBasket(): void {
    scene.setBasket(new Set(state.basket));
    $('basketCount').textContent = formatNumber(state.basket.length);
    $('basketBtn').setAttribute('aria-label', t('basketOpen', { n: formatNumber(state.basket.length) }));
    renderCard();
    renderDrawer();
  }

  function toggleBasket(seat: number): void {
    const at = state.basket.indexOf(seat);
    if (at >= 0) state.basket.splice(at, 1);
    else if (status[seat] !== SEAT_FREE) return;
    else if (!canAddToBasket(state.basket.length, venue.maxSeatsPerOrder)) {
      toast(t('basketFull', { n: formatNumber(venue.maxSeatsPerOrder) }));
      return;
    } else state.basket.push(seat);
    syncBasket();
  }

  // --------------------------------------------------------------- render

  function renderStatic(): void {
    const lang = getLang();
    const { home, away, competition, kickoff } = venue.fixture;
    document.title = t('appTitle');
    $('scene').setAttribute('aria-label', t('sceneLabel'));
    $('homeName').textContent = home.name[lang];
    $('awayName').textContent = away.name[lang];
    $('homeDot').style.background = home.colors[0];
    $('awayDot').style.background = away.colors[0];
    $('vs').textContent = t('vs');
    $('fixtureMeta').textContent = `${competition[lang]} · ${venue.name[lang]} · ${formatDateTime(kickoff)}`;
    $('langBtn').textContent = t('langSwitch');
    $('langBtn').setAttribute('aria-label', t('langSwitchLabel'));
    $('basketLabel').textContent = t('basket');
    $('legendTitle').textContent = t('legendTitle');
    $('legendHint').textContent = t('legendHint');
    $('minimapTitle').textContent = t('minimapTitle');
    $('crumbsNav').setAttribute('aria-label', t('stadium'));
    $('tourBtn').textContent = t('tour');
    $('resetBtn').textContent = t('reset');
    renderTools();
    renderLegend();
  }

  function renderTools(): void {
    const btn = $('rotateBtn');
    btn.textContent = t('autoRotate');
    btn.setAttribute('aria-pressed', String(state.autoRotate));
  }

  function renderLegend(): void {
    const lang = getLang();
    $('legend').innerHTML = venue.categories
      .map((c) => {
        const on = state.filter.has(c.id);
        return (
          `<li><button type="button" class="chip" data-action="filter" data-id="${c.id}" aria-pressed="${on}">` +
          `<i class="dot" style="background:${c.color}"></i><span>${esc(c.name[lang])}</span>` +
          `<b>${money(seatTotal(c.price, fee))}</b></button></li>`
        );
      })
      .join('');
  }

  function renderCrumbs(): void {
    const items: string[] = [];
    const link = (action: string, label: string, current: boolean) =>
      current
        ? `<li aria-current="page">${label}</li>`
        : `<li><button type="button" class="crumb" data-action="${action}">${label}</button></li>`;
    items.push(link('go-stadium', esc(venue.name[getLang()]), state.mode === 'stadium'));
    if (state.block >= 0) {
      items.push(link('go-block', `${t('block')} ${layout.blocks[state.block].label}`, state.mode === 'block'));
    }
    if (state.seat >= 0) {
      items.push(
        link(
          '',
          `${t('row')} ${formatNumber(layout.seatRow[state.seat])} · ${t('seat')} ${formatNumber(layout.seatNum[state.seat])}`,
          true,
        ),
      );
    }
    $('crumbs').innerHTML = items.join('');
  }

  function renderCard(): void {
    const el = $('card');
    if (state.mode === 'stadium') {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    const lang = getLang();

    if (state.mode === 'block') {
      const block = layout.blocks[state.block];
      const c = categoryById(block.category);
      const free = freeCount(block);
      el.innerHTML =
        `<h2>${t('block')} ${block.label}</h2>` +
        `<p class="sub"><i class="dot" style="background:${c.color}"></i>${esc(c.name[lang])} · ${t('tier')} ${formatNumber(block.tier)}</p>` +
        `<dl class="rows">` +
        `<div><dt>${t('totalPerSeat')}</dt><dd>${money(seatTotal(c.price, fee))}</dd></div>` +
        `<div><dt>${t('available')}</dt><dd>${t('freeSeats', { n: formatNumber(free) })}</dd></div>` +
        `</dl>` +
        `<div class="actions">` +
        `<button type="button" class="btn primary" data-action="best-seat" ${free === 0 ? 'disabled' : ''}>${t('bestSeat')}</button>` +
        `<button type="button" class="btn ghost" data-action="go-stadium">${t('backToStadium')}</button>` +
        `</div>`;
      return;
    }

    const seat = state.seat;
    const block = blockOf(seat);
    const c = categoryById(block.category);
    const score = scoreOf(seat);
    const inBasket = state.basket.includes(seat);
    const free = status[seat] === SEAT_FREE;
    const price = c.price;
    el.innerHTML =
      `<h2>${seatName(seat)}</h2>` +
      `<p class="sub"><i class="dot" style="background:${c.color}"></i>${esc(c.name[lang])} · ${t('tier')} ${formatNumber(block.tier)} · ${seatStateLabel(seat)}</p>` +
      `<div class="score" role="img" aria-label="${t('viewScore')}: ${score}/100">` +
      `<span>${t('viewScore')}</span><b>${formatNumber(score)}<small>/100</small></b>` +
      `<i class="bar"><i style="inline-size:${score}%"></i></i></div>` +
      `<dl class="rows">` +
      `<div><dt>${t('price')}</dt><dd>${money(price)}</dd></div>` +
      `<div><dt>${t('serviceFee')}</dt><dd>${money(seatFee(price, fee))}</dd></div>` +
      `<div class="strong"><dt>${t('total')}</dt><dd>${money(seatTotal(price, fee))}</dd></div>` +
      `</dl>` +
      `<div class="actions">` +
      (free
        ? `<button type="button" class="btn primary" data-action="toggle-seat">${t(inBasket ? 'removeFromBasket' : 'addToBasket')}</button>`
        : '') +
      `<button type="button" class="btn ghost" data-action="next-seat">${t('nextFreeSeat')}</button>` +
      `<button type="button" class="btn ghost" data-action="next-row">${t('nextRow')}</button>` +
      `<button type="button" class="btn ghost" data-action="go-block">${t('backToBlock')}</button>` +
      `</div>`;
  }

  function renderDrawer(): void {
    const el = $('drawer');
    el.hidden = !state.drawerOpen;
    $('basketBtn').setAttribute('aria-expanded', String(state.drawerOpen));
    if (!state.drawerOpen) {
      el.innerHTML = '';
      return;
    }
    const totals = basketTotals(state.basket.map((s) => ({ price: priceOf(s) })), fee);
    const items = state.basket
      .map(
        (s) =>
          `<li><button type="button" class="item" data-action="view-seat" data-seat="${s}">` +
          `<i class="dot" style="background:${categoryById(blockOf(s).category).color}"></i>` +
          `<span>${seatName(s)}</span><b>${money(seatTotal(priceOf(s), fee))}</b></button>` +
          `<button type="button" class="btn ghost small" data-action="remove-seat" data-seat="${s}" aria-label="${t('remove')}: ${seatName(s)}">${t('remove')}</button></li>`,
      )
      .join('');
    el.innerHTML =
      `<div class="drawer-head"><h2>${t('basket')}</h2>` +
      `<button type="button" class="btn ghost small" data-action="toggle-drawer">${t('close')}</button></div>` +
      (state.basket.length === 0
        ? `<p class="empty">${t('basketEmpty')}</p>`
        : `<ul class="items">${items}</ul>` +
          `<dl class="rows">` +
          `<div><dt>${t('subtotal')}</dt><dd>${money(totals.subtotal)}</dd></div>` +
          `<div><dt>${t('serviceFee')}</dt><dd>${money(totals.fees)}</dd></div>` +
          `<div class="strong"><dt>${t('total')}</dt><dd>${money(totals.total)}</dd></div>` +
          `</dl>` +
          `<button type="button" class="btn primary block" data-action="checkout">${t('checkout')}</button>`) +
      `<p class="note">${t('basketLimit', { n: formatNumber(venue.maxSeatsPerOrder) })}</p>`;
  }

  // -------------------------------------------------------------- minimap

  function buildMinimap(): void {
    const svg = $('minimap') as unknown as SVGSVGElement;
    const { a, b } = venue.bowl;
    const outer = Math.max(...layout.blocks.map((bl) => bl.outerOffset)) + 3;
    svg.setAttribute('viewBox', `${-(a + outer)} ${-(b + outer)} ${2 * (a + outer)} ${2 * (b + outer)}`);
    const steps = 6;
    const parts: string[] = [
      `<rect x="-52.5" y="-34" width="105" height="68" rx="2" class="map-pitch"/>`,
      `<line x1="0" y1="-34" x2="0" y2="34" class="map-line"/><circle r="9.15" class="map-line"/>`,
    ];
    for (const block of layout.blocks) {
      const pts: string[] = [];
      const pad = (block.t1 - block.t0) * 0.06;
      for (let i = 0; i <= steps; i++) {
        const p = ellipsePoint(a + block.innerOffset, b + block.innerOffset, block.t0 + pad + ((block.t1 - block.t0 - 2 * pad) * i) / steps);
        pts.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      }
      for (let i = steps; i >= 0; i--) {
        const p = ellipsePoint(a + block.outerOffset, b + block.outerOffset, block.t0 + pad + ((block.t1 - block.t0 - 2 * pad) * i) / steps);
        pts.push(`${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      }
      parts.push(
        `<polygon points="${pts.join(' ')}" class="map-block" data-action="map-block" data-block="${block.index}" ` +
          `data-category="${block.category}" tabindex="0" role="button" fill="${categoryById(block.category).color}"><title></title></polygon>`,
      );
    }
    svg.innerHTML = parts.join('');
    renderMinimapState();
  }

  function renderMinimapState(): void {
    document.querySelectorAll<SVGPolygonElement>('.map-block').forEach((el) => {
      const index = Number(el.dataset.block);
      const block = layout.blocks[index];
      el.classList.toggle('active', index === state.block);
      el.classList.toggle('dim', !state.filter.has(block.category));
      const label = `${t('block')} ${block.label}`;
      el.setAttribute('aria-label', label);
      const title = el.querySelector('title');
      if (title) title.textContent = label;
    });
  }

  // ------------------------------------------------------------- checkout

  const dialog = $<HTMLDialogElement>('dialog');

  function openCheckout(): void {
    if (state.basket.length === 0) return;
    const totals = basketTotals(state.basket.map((s) => ({ price: priceOf(s) })), fee);
    const methods: [string, string][] = [
      ['card', t('payCard')],
      ['wallet', t('payWallet')],
      ['transfer', t('payTransfer')],
    ];
    dialog.innerHTML =
      `<h2 id="dialogTitle">${t('checkout')}</h2>` +
      `<p class="demo">${t('demoNotice')}</p>` +
      `<ul class="items plain">${state.basket
        .map((s) => `<li><span>${seatName(s)}</span><b>${money(seatTotal(priceOf(s), fee))}</b></li>`)
        .join('')}</ul>` +
      `<dl class="rows">` +
      `<div><dt>${t('subtotal')}</dt><dd>${money(totals.subtotal)}</dd></div>` +
      `<div><dt>${t('serviceFee')}</dt><dd>${money(totals.fees)}</dd></div>` +
      `<div class="strong"><dt>${t('total')}</dt><dd>${money(totals.total)}</dd></div>` +
      `</dl>` +
      `<fieldset class="methods"><legend>${t('paymentMethod')}</legend>${methods
        .map(
          ([id, label]) =>
            `<label><input type="radio" name="payment" value="${id}" ${state.payment === id ? 'checked' : ''}/> ${label}</label>`,
        )
        .join('')}</fieldset>` +
      `<div class="actions">` +
      `<button type="button" class="btn primary" data-action="confirm">${t('confirmBooking')}</button>` +
      `<button type="button" class="btn ghost" data-action="close-dialog">${t('cancel')}</button>` +
      `</div>`;
    dialog.setAttribute('aria-labelledby', 'dialogTitle');
    if (!dialog.open) dialog.showModal();
  }

  function showConfirmation(booking: Booking, seats: number[]): void {
    dialog.innerHTML =
      `<h2 id="dialogTitle">${t('bookingConfirmed')}</h2>` +
      `<p class="ref">${t('reference')}: <b dir="ltr">${esc(booking.reference)}</b></p>` +
      `<p class="demo">${t('demoNotice')}</p>` +
      `<ul class="tickets">${seats
        .map((s) => {
          const id = seatId(layout, s);
          return (
            `<li class="ticket">${ticketPattern(`${booking.reference}:${id}`, t('ticketCode', { id }))}` +
            `<div><small>${t('demoTicket')}</small><b>${seatName(s)}</b>` +
            `<span>${esc(venue.fixture.home.name[getLang()])} ${t('vs')} ${esc(venue.fixture.away.name[getLang()])}</span>` +
            `<span>${formatDateTime(venue.fixture.kickoff)}</span></div></li>`
          );
        })
        .join('')}</ul>` +
      `<div class="actions"><button type="button" class="btn primary" data-action="close-dialog">${t('done')}</button></div>`;
  }

  async function confirmBooking(button: HTMLButtonElement): Promise<void> {
    const seats = [...state.basket];
    if (seats.length === 0) return;
    button.disabled = true;
    try {
      const booking = await repo.book(seats.map((s) => seatId(layout, s)));
      for (const s of seats) status[s] = SEAT_MINE;
      state.basket = [];
      state.drawerOpen = false;
      syncBasket();
      showConfirmation(booking, seats);
    } catch (err) {
      if (err instanceof SeatUnavailableError) {
        const taken = new Set(err.seatIds);
        state.basket = state.basket.filter((s) => !taken.has(seatId(layout, s)));
        for (const id of taken) {
          const i = findSeatIndex(layout, id);
          if (i >= 0) status[i] = SEAT_MINE;
        }
        syncBasket();
        dialog.close();
        toast(t('seatsTaken'));
      } else {
        button.disabled = false;
        toast(t('bookingFailed'));
      }
    }
  }

  async function resetBookings(): Promise<void> {
    if (!window.confirm(t('resetConfirm'))) return;
    await repo.reset();
    for (let i = 0; i < status.length; i++) if (status[i] === SEAT_MINE) status[i] = SEAT_FREE;
    scene.repaint();
    renderCard();
    toast(t('resetDone'));
  }

  // --------------------------------------------------------------- events

  function handle(action: string, el: HTMLElement): void {
    switch (action) {
      case 'lang': {
        const next: Lang = getLang() === 'ar' ? 'en' : 'ar';
        setLang(next);
        renderAll();
        break;
      }
      case 'toggle-drawer':
        state.drawerOpen = !state.drawerOpen;
        renderDrawer();
        break;
      case 'rotate':
        if (state.mode !== 'stadium') enterStadium();
        scene.setAutoRotate(!state.autoRotate);
        break;
      case 'tour':
        setMode('stadium', -1, -1);
        scene.startTour();
        break;
      case 'reset':
        void resetBookings();
        break;
      case 'filter': {
        const id = Number(el.dataset.id);
        if (state.filter.has(id)) state.filter.delete(id);
        else state.filter.add(id);
        scene.setFilter(state.filter);
        renderLegend();
        renderMinimapState();
        break;
      }
      case 'go-stadium':
        enterStadium();
        break;
      case 'go-block':
        if (state.block >= 0) enterBlock(state.block);
        break;
      case 'map-block':
        enterBlock(Number(el.dataset.block));
        break;
      case 'best-seat': {
        const seat = bestFreeSeat(layout.blocks[state.block]);
        if (seat >= 0) enterSeat(seat);
        else toast(t('noFreeSeats'));
        break;
      }
      case 'toggle-seat':
        toggleBasket(state.seat);
        break;
      case 'next-seat':
      case 'next-row': {
        const seat =
          action === 'next-seat'
            ? nextFreeSeat(layout, status, state.seat)
            : freeSeatInNextRow(layout, status, state.seat);
        if (seat >= 0) enterSeat(seat);
        else toast(t('noFreeSeats'));
        break;
      }
      case 'view-seat':
        state.drawerOpen = false;
        renderDrawer();
        enterSeat(Number(el.dataset.seat));
        break;
      case 'remove-seat':
        toggleBasket(Number(el.dataset.seat));
        break;
      case 'checkout':
        openCheckout();
        break;
      case 'confirm':
        void confirmBooking(el as HTMLButtonElement);
        break;
      case 'close-dialog':
        dialog.close();
        break;
    }
  }

  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-action]');
    if (el?.dataset.action) handle(el.dataset.action, el);
  });

  document.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name === 'payment') state.payment = input.value;
  });

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && target.classList?.contains('map-block')) {
      e.preventDefault();
      handle('map-block', target);
    } else if (e.key === 'Escape' && !dialog.open) back();
  });

  function renderAll(): void {
    renderStatic();
    renderCrumbs();
    renderCard();
    renderDrawer();
    renderMinimapState();
    $('basketCount').textContent = formatNumber(state.basket.length);
    $('basketBtn').setAttribute('aria-label', t('basketOpen', { n: formatNumber(state.basket.length) }));
    $('hint').textContent = t(
      state.mode === 'stadium' ? 'hintStadium' : state.mode === 'block' ? 'hintBlock' : 'hintSeat',
    );
    if (dialog.open) dialog.close();
  }

  buildMinimap();
  renderAll();
}
