// ============================================================
// Front Security - Pagamentos
// Lançamento manual por posto e turno (QRA, valor, hora extra, atraso, dobra e 3/6),
// limpeza com salário fixo + coberturas, e fechamento mensal exportado para o WhatsApp.
// Dados em /pagamentos do mesmo Firebase do app Coberturas (que só é lido).
// ============================================================

// Bump together with version.json on every deploy: open apps reload themselves when it changes
const APP_VERSION = '2026-10-23.1';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB2XpLy5atMeLtc-XuOaAtY9m72mK9dZSY',
  authDomain: 'front-security-coberturas.firebaseapp.com',
  databaseURL: 'https://front-security-coberturas-default-rtdb.firebaseio.com',
  projectId: 'front-security-coberturas',
  storageBucket: 'front-security-coberturas.firebasestorage.app',
  messagingSenderId: '820793276708',
  appId: '1:820793276708:web:869d32754c6375cd139bb1'
};

// Limpeza: fixed salary + coberturas (Campo Belo = "Campos")
const LIMPEZA_POSTS = [
  { name: 'Bosque', escalaType: 'diurno' },
  { name: 'Marechal', escalaType: 'diurno' },
  { name: 'Ibirapuera', escalaType: 'diurno' },
  { name: 'Campo Belo', escalaType: 'diurno' },
];

const CATEGORY_ORDER = ['Segurança Econ', 'Segurança Nurban', 'Segurança Kallas', 'Segurança Cursino', 'Limpeza'];
const CATEGORY_ICONS = { 'Segurança Econ': '🛡️', 'Segurança Nurban': '🏢', 'Segurança Kallas': '🔐', 'Segurança Cursino': '📍', 'Limpeza': '🧹' };
const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SHIFT_LABEL = { diurno: '☀️ Diurno', noturno: '🌙 Noturno' };

// ===== helpers =====

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
function monthOf(date) { return date.slice(0, 7); }
function currentMonth() { return toDateStr(new Date()).slice(0, 7); }
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]}/${y}`;
}
function monthDates(ym) {
  const [y, m] = ym.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}
function dayLabel(date) {
  const d = parseDate(date);
  return `${DAY_NAMES[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function normalizeText(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function makeId(name) {
  return normalizeText(name).replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30) + '_' + Date.now() + Math.floor(Math.random() * 1000);
}
// "1.234,56" / "150" / "150.5" → number
function parseMoney(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function brl(n) {
  return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function moneyInput(n) {
  return n ? n.toFixed(2).replace('.', ',') : '';
}
// prev/next shift (night belongs to the date it starts)
function prevSlot(date, shift) { return shift === 'noturno' ? { date, shift: 'diurno' } : { date: addDays(date, -1), shift: 'noturno' }; }
function nextSlot(date, shift) { return shift === 'diurno' ? { date, shift: 'noturno' } : { date: addDays(date, 1), shift: 'diurno' }; }

// Shifts a post normally has on a date (same escala model as the Coberturas app)
function postShifts(post, date) {
  const dow = parseDate(date).getDay();
  let type = post.escalaType;
  if (type === 'hibrido') type = (post.hibridoSchedule && post.hibridoSchedule[dow]) || 'folga';
  else if (Array.isArray(post.days) && !post.days.includes(dow)) type = 'folga';
  if (type === '24h') return ['diurno', 'noturno'];
  if (type === 'diurno' || type === 'noturno') return [type];
  return [];
}

function entryTotal(e) {
  return parseMoney(e.valor) + parseMoney(e.extra) - parseMoney(e.desconto) + (e.dobra ? parseMoney(e.tresSeis) : 0);
}

// ============================================================
// Totals (pure, no DOM)
// ============================================================

class Ledger {
  constructor() { this.posts = {}; this.entries = {}; }

  entriesOf(postId, ym) {
    return Object.values(this.entries).filter(e => e.postId === postId && monthOf(e.date) === ym)
      .sort((a, b) => (a.date + a.turno).localeCompare(b.date + b.turno));
  }

  // Month summary of a post (+ per QRA)
  postSummary(post, ym) {
    const list = this.entriesOf(post.id, ym);
    const sum = { turnos: list.length, dias: new Set(list.map(e => e.date)).size, valor: 0, extra: 0, desconto: 0, tresSeis: 0, dobras: 0, total: 0, fixos: 0, qras: {} };
    list.forEach(e => {
      const v = parseMoney(e.valor), x = parseMoney(e.extra), d = parseMoney(e.desconto), t = e.dobra ? parseMoney(e.tresSeis) : 0;
      sum.valor += v; sum.extra += x; sum.desconto += d; sum.tresSeis += t; if (e.dobra) sum.dobras++;
      const key = normalizeText(e.qra) || '?';
      const q = sum.qras[key] = sum.qras[key] || { nome: e.qra || '(sem nome)', turnos: 0, dias: new Set(), valor: 0, extra: 0, desconto: 0, tresSeis: 0, dobras: 0, total: 0 };
      q.turnos++; q.dias.add(e.date); q.valor += v; q.extra += x; q.desconto += d; q.tresSeis += t; if (e.dobra) q.dobras++;
      q.total += v + x - d + t;
    });
    if (post.tipo === 'fixo') sum.fixos = (post.fixos || []).reduce((a, f) => a + parseMoney(f.salario), 0);
    sum.total = sum.valor + sum.extra - sum.desconto + sum.tresSeis + sum.fixos;
    return sum;
  }

  // All QRAs in a month across posts
  qraSummary(ym) {
    const out = {};
    Object.values(this.entries).filter(e => monthOf(e.date) === ym).forEach(e => {
      const key = normalizeText(e.qra) || '?';
      const q = out[key] = out[key] || { nome: e.qra || '(sem nome)', turnos: 0, dias: new Set(), valor: 0, extra: 0, desconto: 0, tresSeis: 0, dobras: 0, total: 0, postos: new Set() };
      const v = parseMoney(e.valor), x = parseMoney(e.extra), d = parseMoney(e.desconto), t = e.dobra ? parseMoney(e.tresSeis) : 0;
      q.turnos++; q.dias.add(e.date); q.valor += v; q.extra += x; q.desconto += d; q.tresSeis += t; if (e.dobra) q.dobras++;
      q.total += v + x - d + t;
      if (this.posts[e.postId]) q.postos.add(this.posts[e.postId].name);
    });
    return out;
  }

  // Same QRA in the shift right before/after (any post) → it is a dobra
  adjacentSameQra(qraName, date, turno, excludeId) {
    const n = normalizeText(qraName);
    if (!n) return [];
    const near = [prevSlot(date, turno), nextSlot(date, turno)];
    return Object.values(this.entries).filter(e => e.id !== excludeId && normalizeText(e.qra) === n
      && near.some(s => s.date === e.date && s.shift === e.turno));
  }
}

// ============================================================
// App
// ============================================================

class PagamentosApp {
  constructor() {
    this.ledger = new Ledger();
    this.qraNames = [];
    this.loaded = { posts: false, entries: false };
    this.month = currentMonth();
    this.openPostId = null;
    this.renderQueued = false;
  }

  init() {
    if (this.started) return; // never wire listeners twice
    this.started = true;
    this.setupEventListeners();
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      this.db = firebase.database();
    } catch (e) {
      this.showToast('Erro ao iniciar o Firebase', 'error');
      return;
    }
    this.db.ref('.info/connected').on('value', snap => {
      const on = snap.val() === true;
      document.getElementById('connection-status').className = on ? 'conn-dot connected' : 'conn-dot disconnected';
      document.getElementById('connection-text').textContent = on ? 'Online' : 'Offline';
      this.isConnected = on;
    });
    const listen = (path, cb) => this.db.ref(path).on('value', s => cb(s.val() || {}), err => {
      this.showToast(`⚠️ Sem permissão para ler ${path}`, 'error');
      console.error(path, err);
    });
    listen('pagamentos/posts', data => { this.ledger.posts = data; this.loaded.posts = true; this.queueRender(); });
    listen('pagamentos/lancamentos', data => { this.ledger.entries = data; this.loaded.entries = true; this.queueRender(); });
    // QRA names from the Coberturas app (read only) to suggest who worked
    listen('qras', data => {
      this.qraNames = [...new Set(Object.values(data).map(q => q.name).filter(Boolean))];
      this.fillQraDatalist();
    });
    this.seedPostsIfEmpty();
    this.checkForUpdate();
    setInterval(() => this.checkForUpdate(), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.checkForUpdate(); });
    this.renderMonthBar();
  }

  // First run: security posts from the Coberturas app + the 4 limpeza posts
  async seedPostsIfEmpty() {
    try {
      const mine = await this.db.ref('pagamentos/posts').once('value');
      if (mine.exists()) return;
      const src = (await this.db.ref('posts').once('value')).val() || {};
      const data = {};
      Object.values(src).filter(p => /^Seguran/i.test(p.category || '')).forEach(p => {
        data[p.id] = { id: p.id, name: p.name, category: p.category, escalaType: p.escalaType, days: p.days || null, hibridoSchedule: p.hibridoSchedule || null, tipo: 'diaria', valorTurno: 0 };
      });
      LIMPEZA_POSTS.forEach(l => {
        const id = makeId(`limpeza_${l.name}`);
        data[id] = { id, name: l.name, category: 'Limpeza', escalaType: l.escalaType, tipo: 'fixo', valorTurno: 0, fixos: [] };
      });
      await this.db.ref('pagamentos/posts').set(data);
      this.showToast('🏢 Postos criados a partir do app Coberturas', 'success');
    } catch (e) {
      console.warn('seed', e);
    }
  }

  async write(promise, msg) {
    if (!this.isConnected) this.showToast('⚠️ Sem conexão: será enviado quando a internet voltar. Não feche o app.', 'error');
    try { await promise; if (msg) this.showToast(msg, 'success'); return true; } catch (e) {
      console.error(e); this.showToast('❌ Falha ao salvar. Verifique a conexão/permissões.', 'error'); return false;
    }
  }

  queueRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    setTimeout(() => {
      this.renderQueued = false;
      if (!this.loaded.posts || !this.loaded.entries) return;
      this.renderPosts();
      this.renderQras();
      this.renderMonthTotal();
      if (this.openPostId) this.renderPostModal();
    });
  }

  // ===== month =====

  renderMonthBar() {
    document.getElementById('month-label').textContent = monthLabel(this.month);
    document.getElementById('month-current').classList.toggle('active', this.month === currentMonth());
  }

  setMonth(ym) {
    this.month = ym;
    this.renderMonthBar();
    this.queueRender();
  }

  renderMonthTotal() {
    const total = Object.values(this.ledger.posts).reduce((a, p) => a + this.ledger.postSummary(p, this.month).total, 0);
    document.getElementById('month-total').textContent = brl(total);
  }

  postsByCategory() {
    const cats = {};
    Object.values(this.ledger.posts).forEach(p => { (cats[p.category || 'Outros'] = cats[p.category || 'Outros'] || []).push(p); });
    const order = [...CATEGORY_ORDER, ...Object.keys(cats).filter(c => !CATEGORY_ORDER.includes(c)).sort()];
    return order.filter(c => cats[c]).map(c => [c, cats[c].sort((a, b) => a.name.localeCompare(b.name))]);
  }

  // ===== Postos view =====

  renderPosts() {
    const container = document.getElementById('posts-container');
    const query = normalizeText(document.getElementById('post-search').value);
    let groups = this.postsByCategory();
    if (query) {
      groups = groups.map(([cat, posts]) => [cat, posts.filter(p => {
        const names = this.ledger.entriesOf(p.id, this.month).map(e => e.qra).concat((p.fixos || []).map(f => f.nome));
        return normalizeText([p.name, cat, ...names].join(' ')).includes(query);
      })]).filter(([, posts]) => posts.length);
    }
    if (!groups.length) {
      container.innerHTML = `<div class="empty-state">${query ? 'Nenhum posto encontrado.' : 'Nenhum posto cadastrado.'}</div>`;
      return;
    }
    container.innerHTML = groups.map(([cat, posts]) => {
      const catTotal = posts.reduce((a, p) => a + this.ledger.postSummary(p, this.month).total, 0);
      return `
      <div class="category-section">
        <div class="category-header">
          <div class="category-icon">${CATEGORY_ICONS[cat] || '📌'}</div>
          <h2 class="category-title">${esc(cat)}</h2>
          <span class="category-count">${brl(catTotal)}</span>
        </div>
        <div class="posts-grid">${posts.map(p => this.postCardHtml(p)).join('')}</div>
      </div>`;
    }).join('');
  }

  postCardHtml(p) {
    const sum = this.ledger.postSummary(p, this.month);
    const fixo = p.tipo === 'fixo';
    const top = Object.values(sum.qras).sort((a, b) => b.total - a.total).slice(0, 4);
    return `
      <div class="post-card pay-card" onclick="app.openPost('${p.id}')">
        <div class="post-header">
          <span class="post-name">${esc(p.name)}</span>
          <span class="post-type-badge ${fixo ? 'limpeza' : 'badge-24h'}">${fixo ? 'Salário fixo' : `Turno ${p.valorTurno ? brl(p.valorTurno) : '—'}`}</span>
        </div>
        <div class="pay-lines">
          ${fixo ? `<div class="pay-line"><span>🧾 Fixos (${(p.fixos || []).length})</span><strong>${brl(sum.fixos)}</strong></div>` : ''}
          <div class="pay-line"><span>${fixo ? '🔁 Coberturas' : '📅 Turnos'}: ${sum.turnos} · ${sum.dias} dia(s)</span><strong>${brl(sum.valor)}</strong></div>
          ${sum.extra ? `<div class="pay-line"><span>⏱️ Hora extra</span><strong class="plus">+ ${brl(sum.extra)}</strong></div>` : ''}
          ${sum.desconto ? `<div class="pay-line"><span>⚠️ Descontos</span><strong class="minus">− ${brl(sum.desconto)}</strong></div>` : ''}
          ${sum.tresSeis ? `<div class="pay-line"><span>🔁 3/6 (${sum.dobras})</span><strong class="plus">+ ${brl(sum.tresSeis)}</strong></div>` : ''}
          <div class="pay-line total"><span>Total</span><strong>${brl(sum.total)}</strong></div>
        </div>
        ${top.length ? `<div class="pay-qras">${top.map(q => `<span class="pay-qra">${esc(q.nome)} <b>${q.turnos}</b></span>`).join('')}</div>` : '<div class="muted-text">Nenhum lançamento neste mês</div>'}
        <div class="card-actions">
          <button class="btn-mini btn-mini-cover" onclick="event.stopPropagation(); app.openPost('${p.id}')">📋 Lançar</button>
          <button class="btn-mini" onclick="event.stopPropagation(); app.exportPost('${p.id}')">📱 Exportar</button>
        </div>
      </div>`;
  }

  // ===== Month sheet of a post =====

  openPost(postId) {
    this.openPostId = postId;
    this.renderPostModal();
    this.showModal('post-modal');
  }

  renderPostModal() {
    const p = this.ledger.posts[this.openPostId];
    if (!p) { this.hideModal('post-modal'); this.openPostId = null; return; }
    const sum = this.ledger.postSummary(p, this.month);
    document.getElementById('post-modal-title').textContent = `${p.name} · ${monthLabel(this.month)}`;
    document.getElementById('post-modal-summary').innerHTML = `
      ${p.tipo === 'fixo' ? `<div><span>🧾 Fixos</span><b>${brl(sum.fixos)}</b></div>` : ''}
      <div><span>${p.tipo === 'fixo' ? '🔁 Coberturas' : '📅 Turnos'}</span><b>${sum.turnos} · ${brl(sum.valor)}</b></div>
      <div><span>⏱️ Extra</span><b class="plus">${brl(sum.extra)}</b></div>
      <div><span>⚠️ Desc.</span><b class="minus">${brl(sum.desconto)}</b></div>
      <div><span>🔁 3/6</span><b class="plus">${brl(sum.tresSeis)}</b></div>
      <div class="total"><span>Total</span><b>${brl(sum.total)}</b></div>`;
    const body = document.getElementById('post-modal-body');
    const entries = this.ledger.entriesOf(p.id, this.month);
    const cell = e => `<button class="pay-cell filled${e.dobra ? ' dobra' : ''}" onclick="app.showEntryModal({ id: '${e.id}' })">
        <span class="pay-cell-name">${esc(e.qra || '(sem nome)')}</span>
        <span class="pay-cell-val">${brl(entryTotal(e))}${parseMoney(e.extra) ? ` <i class="plus">+${moneyInput(parseMoney(e.extra))}</i>` : ''}${parseMoney(e.desconto) ? ` <i class="minus">−${moneyInput(parseMoney(e.desconto))}</i>` : ''}${e.dobra ? ' <i class="tag36">3/6</i>' : ''}</span>
      </button>`;

    if (p.tipo === 'fixo') {
      const fixos = (p.fixos || []);
      body.innerHTML = `
        <h3 class="pay-section">🧾 Salário fixo</h3>
        ${fixos.length ? `<div class="pay-fixos">${fixos.map(f => `<div class="pay-line"><span class="pay-name">${esc(f.nome)}</span><strong>${brl(parseMoney(f.salario))}</strong></div>`).join('')}</div>`
          : '<div class="muted-text">Nenhum funcionário fixo cadastrado. Use "✏️ Editar posto".</div>'}
        <h3 class="pay-section">🔁 Coberturas no mês</h3>
        <button class="slot-add slot-add-custom" onclick="app.showEntryModal({ postId: '${p.id}', date: '${this.defaultDate()}', turno: 'diurno' })">+ lançar cobertura</button>
        <div class="pay-cob-list">${entries.length ? entries.map(e => `<div class="pay-day"><span class="pay-day-label">${dayLabel(e.date)} ${SHIFT_LABEL[e.turno].split(' ')[0]}</span>${cell(e)}</div>`).join('') : '<div class="muted-text">Nenhuma cobertura lançada.</div>'}</div>`;
      return;
    }

    // Per-post per-day grid: shifts the post normally has + any shift with a launch
    const rows = monthDates(this.month).map(date => {
      const shifts = new Set(postShifts(p, date));
      entries.filter(e => e.date === date).forEach(e => shifts.add(e.turno));
      const cells = ['diurno', 'noturno'].filter(s => shifts.has(s)).map(shift => {
        const list = entries.filter(e => e.date === date && e.turno === shift);
        return `<div class="pay-slot"><span class="pay-slot-tag">${SHIFT_LABEL[shift].split(' ')[0]}</span>
          ${list.map(cell).join('')}
          ${list.length ? '' : `<button class="pay-cell empty" onclick="app.showEntryModal({ postId: '${p.id}', date: '${date}', turno: '${shift}' })">+ lançar</button>`}
        </div>`;
      }).join('');
      const extra = `<button class="pay-more" title="Lançamento extra neste dia" onclick="app.showEntryModal({ postId: '${p.id}', date: '${date}', turno: 'diurno' })">＋</button>`;
      return `<div class="pay-day${cells ? '' : ' closed'}"><span class="pay-day-label">${dayLabel(date)}</span><div class="pay-slots">${cells || '<span class="muted-text">posto fechado</span>'}</div>${extra}</div>`;
    }).join('');
    body.innerHTML = `<div class="pay-days">${rows}</div>`;
  }

  defaultDate() {
    const today = toDateStr(new Date());
    return monthOf(today) === this.month ? today : `${this.month}-01`;
  }

  // ===== Lançamento =====

  fillQraDatalist() {
    const used = Object.values(this.ledger.entries).map(e => e.qra);
    const names = [...new Set([...this.qraNames, ...used].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    document.getElementById('qra-names').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
  }

  showEntryModal({ id, postId, date, turno } = {}) {
    const e = id ? this.ledger.entries[id] : null;
    const p = this.ledger.posts[e ? e.postId : postId];
    if (!p) return;
    this.fillQraDatalist();
    const fixo = p.tipo === 'fixo';
    document.getElementById('entry-modal-title').textContent = `${e ? '✏️ Editar' : (fixo ? '🔁 Cobertura' : '💵 Lançamento')} · ${p.name}`;
    document.getElementById('entry-id').value = e ? e.id : '';
    document.getElementById('entry-post').value = p.id;
    document.getElementById('entry-date').value = e ? e.date : date;
    document.getElementById('entry-turno').value = e ? e.turno : (turno || 'diurno');
    document.getElementById('entry-qra').value = e ? e.qra : '';
    document.getElementById('entry-valor').value = moneyInput(e ? parseMoney(e.valor) : parseMoney(p.valorTurno));
    document.getElementById('entry-extra').value = moneyInput(e ? parseMoney(e.extra) : 0);
    document.getElementById('entry-desconto').value = moneyInput(e ? parseMoney(e.desconto) : 0);
    document.getElementById('entry-obs').value = e ? (e.obs || '') : '';
    document.getElementById('entry-dobra').checked = !!(e && e.dobra);
    document.getElementById('entry-36').value = moneyInput(e ? parseMoney(e.tresSeis) : 0);
    document.getElementById('entry-delete').style.display = e ? '' : 'none';
    this.updateEntryForm(true);
    this.showModal('entry-modal');
    if (!e) setTimeout(() => document.getElementById('entry-qra').focus(), 60);
  }

  // Dobra detection + live total
  updateEntryForm(skipAutoCheck) {
    const id = document.getElementById('entry-id').value;
    const qra = document.getElementById('entry-qra').value.trim();
    const date = document.getElementById('entry-date').value;
    const turno = document.getElementById('entry-turno').value;
    const near = date ? this.ledger.adjacentSameQra(qra, date, turno, id) : [];
    const dobraBox = document.getElementById('entry-dobra');
    if (near.length && !skipAutoCheck) dobraBox.checked = true;
    const hint = document.getElementById('entry-dobra-hint');
    if (near.length) {
      hint.className = 'info-box visible';
      hint.innerHTML = `<div class="check-warn">🔁 ${esc(qra)} também trabalhou ${near.map(n => `${dayLabel(n.date)} ${SHIFT_LABEL[n.turno]} em ${esc((this.ledger.posts[n.postId] || { name: '?' }).name)}`).join(' e ')} — é dobra.</div>`;
    } else {
      hint.className = 'info-box';
      hint.innerHTML = '';
    }
    document.getElementById('entry-36-group').style.display = dobraBox.checked ? '' : 'none';
    const e = {
      valor: document.getElementById('entry-valor').value, extra: document.getElementById('entry-extra').value,
      desconto: document.getElementById('entry-desconto').value, dobra: dobraBox.checked, tresSeis: document.getElementById('entry-36').value,
    };
    document.getElementById('entry-total').textContent = `Total: ${brl(entryTotal(e))}`;
  }

  async saveEntry() {
    const id = document.getElementById('entry-id').value || makeId('lanc');
    const postId = document.getElementById('entry-post').value;
    const date = document.getElementById('entry-date').value;
    const qra = document.getElementById('entry-qra').value.trim();
    if (!date) return this.showToast('Informe o dia', 'error');
    if (!qra) return this.showToast('Informe o QRA que trabalhou', 'error');
    const dobra = document.getElementById('entry-dobra').checked;
    const entry = {
      id, postId, date, turno: document.getElementById('entry-turno').value, qra,
      valor: parseMoney(document.getElementById('entry-valor').value),
      extra: parseMoney(document.getElementById('entry-extra').value),
      desconto: parseMoney(document.getElementById('entry-desconto').value),
      dobra, tresSeis: dobra ? parseMoney(document.getElementById('entry-36').value) : 0,
      obs: document.getElementById('entry-obs').value.trim(),
      updatedAt: new Date().toISOString(),
    };
    this.hideModal('entry-modal');
    await this.write(this.db.ref(`pagamentos/lancamentos/${id}`).set(entry), `✅ ${qra} · ${dayLabel(date)} · ${brl(entryTotal(entry))}`);
  }

  deleteEntry() {
    const id = document.getElementById('entry-id').value;
    const e = this.ledger.entries[id];
    if (!e) return;
    this.confirm(`Excluir o lançamento de ${e.qra} em ${dayLabel(e.date)}?`, () => {
      this.hideModal('entry-modal');
      this.write(this.db.ref(`pagamentos/lancamentos/${id}`).remove(), 'Lançamento excluído');
    });
  }

  // ===== Posto add / edit =====

  showEditPost(postId) {
    const p = postId ? this.ledger.posts[postId] : null;
    document.getElementById('edit-post-title').textContent = p ? '✏️ Editar posto' : '➕ Novo posto';
    document.getElementById('ep-id').value = p ? p.id : '';
    document.getElementById('ep-name').value = p ? p.name : '';
    document.getElementById('ep-category').value = p ? p.category : '';
    document.getElementById('ep-escala').value = p ? (p.escalaType || '24h') : '24h';
    document.getElementById('ep-tipo').value = p ? (p.tipo || 'diaria') : 'diaria';
    document.getElementById('ep-valor').value = moneyInput(p ? parseMoney(p.valorTurno) : 0);
    document.getElementById('ep-fixos').value = p && p.fixos ? p.fixos.map(f => `${f.nome} ; ${moneyInput(parseMoney(f.salario))}`).join('\n') : '';
    document.getElementById('category-names').innerHTML = [...new Set([...CATEGORY_ORDER, ...Object.values(this.ledger.posts).map(x => x.category)])]
      .map(c => `<option value="${esc(c)}"></option>`).join('');
    document.getElementById('ep-delete').style.display = p ? '' : 'none';
    this.updateEditPostForm();
    this.showModal('edit-post-modal');
  }

  updateEditPostForm() {
    document.getElementById('ep-fixos-group').style.display = document.getElementById('ep-tipo').value === 'fixo' ? '' : 'none';
  }

  async savePost() {
    const name = document.getElementById('ep-name').value.trim();
    if (!name) return this.showToast('Informe o nome do posto', 'error');
    const editId = document.getElementById('ep-id').value;
    const old = editId ? this.ledger.posts[editId] : null;
    const id = editId || makeId(name);
    const tipo = document.getElementById('ep-tipo').value;
    const fixos = document.getElementById('ep-fixos').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [nome, sal] = l.split(';');
      return { nome: (nome || '').trim(), salario: parseMoney(sal) };
    }).filter(f => f.nome);
    const post = {
      ...(old || {}), id, name,
      category: document.getElementById('ep-category').value.trim() || (tipo === 'fixo' ? 'Limpeza' : 'Outros'),
      escalaType: document.getElementById('ep-escala').value,
      tipo, valorTurno: parseMoney(document.getElementById('ep-valor').value),
      fixos: tipo === 'fixo' ? fixos : null,
    };
    this.hideModal('edit-post-modal');
    await this.write(this.db.ref(`pagamentos/posts/${id}`).set(post), `Posto ${name} salvo`);
  }

  deletePost() {
    const id = document.getElementById('ep-id').value;
    const p = this.ledger.posts[id];
    if (!p) return;
    const n = Object.values(this.ledger.entries).filter(e => e.postId === id).length;
    this.confirm(`Excluir o posto "${p.name}"?${n ? ` Os ${n} lançamento(s) dele também serão apagados.` : ''}`, () => {
      const updates = { [`pagamentos/posts/${id}`]: null };
      Object.values(this.ledger.entries).filter(e => e.postId === id).forEach(e => { updates[`pagamentos/lancamentos/${e.id}`] = null; });
      this.hideModal('edit-post-modal');
      this.hideModal('post-modal');
      this.openPostId = null;
      this.write(this.db.ref('/').update(updates), `Posto ${p.name} excluído`);
    });
  }

  // ===== QRAs view =====

  renderQras() {
    const all = Object.values(this.ledger.qraSummary(this.month)).sort((a, b) => a.nome.localeCompare(b.nome));
    document.getElementById('qra-count').textContent = all.length || '';
    const query = normalizeText(document.getElementById('qra-search').value);
    const list = all.filter(q => !query || normalizeText(q.nome).includes(query) || normalizeText([...q.postos].join(' ')).includes(query));
    const el = document.getElementById('qra-list');
    if (!list.length) { el.innerHTML = `<div class="empty-state">${query ? 'Nenhum QRA encontrado.' : `Nenhum lançamento em ${monthLabel(this.month)}.`}</div>`; return; }
    el.innerHTML = list.map(q => `
      <div class="qra-row">
        <div class="qra-main">
          <div class="qra-name">${esc(q.nome)}</div>
          <div class="qra-meta">🏢 ${esc([...q.postos].join(' · '))}</div>
          <div class="qra-next">📅 ${q.turnos} turno(s) · ${q.dias.size} dia(s) · 💵 ${brl(q.valor)}${q.extra ? ` · ⏱️ +${brl(q.extra)}` : ''}${q.desconto ? ` · ⚠️ −${brl(q.desconto)}` : ''}${q.tresSeis ? ` · 🔁 3/6 +${brl(q.tresSeis)}` : ''}</div>
        </div>
        <div class="qra-total">${brl(q.total)}</div>
      </div>`).join('');
  }

  // ===== WhatsApp exports =====

  postBlock(p, ym) {
    const s = this.ledger.postSummary(p, ym);
    const lines = [];
    lines.push(`🏢 *${p.name}* (${p.category})`);
    if (p.tipo === 'fixo') {
      lines.push(`🧾 Salário fixo: ${brl(s.fixos)}`);
      (p.fixos || []).forEach(f => lines.push(`   • ${f.nome}: ${brl(parseMoney(f.salario))}`));
      lines.push(`🔁 Coberturas: ${s.turnos} (${s.dias} dia(s)) · ${brl(s.valor)}`);
    } else {
      lines.push(`📅 Dias do posto: ${s.dias} · Turnos: ${s.turnos} · Valor: ${brl(s.valor)}`);
    }
    lines.push(`⏱️ Hora extra: ${brl(s.extra)}`);
    lines.push(`⚠️ Descontos: ${brl(s.desconto)}`);
    lines.push(`🔁 3/6: ${brl(s.tresSeis)} (${s.dobras} dobra(s))`);
    lines.push(`✅ *Total do posto: ${brl(s.total)}*`);
    const qras = Object.values(s.qras).sort((a, b) => b.total - a.total);
    if (qras.length) {
      lines.push(`👥 *QRAs (${qras.length}):*`);
      qras.forEach(q => {
        const det = [q.extra ? `extra +${brl(q.extra)}` : '', q.desconto ? `desc −${brl(q.desconto)}` : '', q.tresSeis ? `3/6 +${brl(q.tresSeis)}` : ''].filter(Boolean).join(' · ');
        lines.push(`   • ${q.nome}: ${q.dias.size} dia(s), ${q.turnos} turno(s) → ${brl(q.total)}${det ? ` (${det})` : ''}`);
      });
    }
    return lines.join('\n');
  }

  header(title, ym) {
    return `💰 *FRONT SECURITY — ${title}*\n📅 ${monthLabel(ym)}\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  buildPostMessage(postId, ym) {
    return this.header('PAGAMENTO', ym) + this.postBlock(this.ledger.posts[postId], ym);
  }

  buildGeneralMessage(ym) {
    const posts = this.postsByCategory().flatMap(([, ps]) => ps);
    let msg = this.header('PAGAMENTOS (GERAL)', ym);
    msg += posts.map(p => this.postBlock(p, ym)).join('\n\n') + '\n\n━━━━━━━━━━━━━━━━━━━━━\n';
    const tot = posts.reduce((a, p) => {
      const s = this.ledger.postSummary(p, ym);
      ['turnos', 'valor', 'extra', 'desconto', 'tresSeis', 'fixos', 'total', 'dobras'].forEach(k => { a[k] += s[k]; });
      return a;
    }, { turnos: 0, valor: 0, extra: 0, desconto: 0, tresSeis: 0, fixos: 0, total: 0, dobras: 0 });
    const qras = Object.values(this.ledger.qraSummary(ym)).sort((a, b) => b.total - a.total);
    msg += `📊 *TOTAL GERAL — ${monthLabel(ym)}*\n`;
    msg += `📅 Turnos: ${tot.turnos} · Valor: ${brl(tot.valor)}\n`;
    if (tot.fixos) msg += `🧾 Salários fixos: ${brl(tot.fixos)}\n`;
    msg += `⏱️ Hora extra: ${brl(tot.extra)}\n⚠️ Descontos: ${brl(tot.desconto)}\n🔁 3/6: ${brl(tot.tresSeis)} (${tot.dobras} dobra(s))\n`;
    msg += `👥 QRAs: ${qras.length}\n✅ *TOTAL: ${brl(tot.total)}*`;
    if (qras.length) {
      msg += `\n\n👥 *POR QRA (todos os postos):*\n` + qras.map(q => `   • ${q.nome}: ${q.dias.size} dia(s), ${q.turnos} turno(s) → ${brl(q.total)}`).join('\n');
    }
    return msg;
  }

  sendWhatsApp(text) {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  exportPost(postId) {
    if (!this.ledger.posts[postId]) return;
    this.sendWhatsApp(this.buildPostMessage(postId, this.month));
  }

  exportAll() {
    this.sendWhatsApp(this.buildGeneralMessage(this.month));
  }

  // ===== auto update =====

  async checkForUpdate() {
    try {
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { v } = await res.json();
      if (!v || v === APP_VERSION || this.updating || document.querySelector('.modal-overlay.active')) return;
      this.updating = true;
      this.showToast('⬆️ Nova versão do app — atualizando…', 'info');
      await Promise.all(['index.html', 'app.js', 'style.css', 'pagamentos.css'].map(f => fetch(f, { cache: 'reload' }).catch(() => null)));
      setTimeout(() => location.reload(), 800);
    } catch (e) { /* offline */ }
  }

  // ===== UI utilities =====

  showModal(id) { document.getElementById(id).classList.add('active'); }
  hideModal(id) {
    document.getElementById(id).classList.remove('active');
    if (id === 'post-modal') this.openPostId = null;
  }

  confirm(message, onYes) {
    document.getElementById('confirm-message').textContent = message;
    this.showModal('confirm-overlay');
    document.getElementById('confirm-yes').onclick = () => { this.hideModal('confirm-overlay'); onYes(); };
    document.getElementById('confirm-no').onclick = () => this.hideModal('confirm-overlay');
  }

  showToast(message, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4000);
  }

  setupEventListeners() {
    const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
    document.querySelectorAll('.view-tab').forEach(t => t.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(x => x.classList.toggle('active', x === t));
      document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${t.dataset.view}`));
    }));
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.hideModal(b.dataset.close)));
    document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) this.hideModal(o.id); }));
    on('month-prev', 'click', () => this.setMonth(shiftMonth(this.month, -1)));
    on('month-next', 'click', () => this.setMonth(shiftMonth(this.month, 1)));
    on('month-current', 'click', () => this.setMonth(currentMonth()));
    on('post-search', 'input', () => this.renderPosts());
    on('qra-search', 'input', () => this.renderQras());
    on('add-post-btn', 'click', () => this.showEditPost(null));
    on('export-all-btn', 'click', () => this.exportAll());
    on('post-export-btn', 'click', () => this.exportPost(this.openPostId));
    on('post-edit-btn', 'click', () => this.showEditPost(this.openPostId));
    on('ep-tipo', 'change', () => this.updateEditPostForm());
    on('ep-save', 'click', () => this.savePost());
    on('ep-delete', 'click', () => this.deletePost());
    on('entry-save', 'click', () => this.saveEntry());
    on('entry-delete', 'click', () => this.deleteEntry());
    ['entry-qra', 'entry-date', 'entry-turno'].forEach(id => on(id, 'change', () => this.updateEntryForm(false)));
    ['entry-valor', 'entry-extra', 'entry-desconto', 'entry-36'].forEach(id => on(id, 'input', () => this.updateEntryForm(true)));
    on('entry-dobra', 'change', () => this.updateEntryForm(true));
  }
}

if (typeof module !== 'undefined') {
  module.exports = { Ledger, parseMoney, brl, entryTotal, monthDates, shiftMonth, postShifts };
} else {
  const app = new PagamentosApp();
  window.app = app;
  document.addEventListener('DOMContentLoaded', () => app.init());
}
