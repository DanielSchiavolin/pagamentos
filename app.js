// ============================================================
// Front Security - Pagamentos
// Lançamento manual por posto e turno (QRA, valor, hora extra, atraso, dobra e 3/6),
// limpeza com salário fixo + coberturas, e fechamento mensal exportado para o WhatsApp.
// Dados em /pagamentos do mesmo Firebase do app Coberturas (que só é lido).
// ============================================================

// Bump together with version.json on every deploy: open apps reload themselves when it changes
const APP_VERSION = '2026-10-26.3';

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
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// Firebase key of a person: the same for "João", "joao" and "JOÃO " → nobody is registered twice
function pessoaKey(name) {
  return normalizeText(name).replace(/[.#$\[\]\/]/g, '_') || '_';
}
const TIPO_LABEL = { seguranca: '🛡️ Segurança', fx: '🧹 FX' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function makeId(name) {
  return normalizeText(name).replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30) + '_' + Date.now() + Math.floor(Math.random() * 1000);
}
// Brazilian money input → number: "1.500" = 1500, "1.800,50" = 1800.5, "150,5" = 150.5,
// "150.50" = 150.5, "1,500.00" = 1500. The LAST separator followed by 1–2 digits is the decimal one.
function parseMoney(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  let s = String(v).replace(/[R$\s]/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return 0;
  const m = s.match(/^(.*)[.,](\d{1,2})$/);
  const intPart = (m ? m[1] : s).replace(/[.,]/g, '');
  const n = Number(`${intPart || '0'}.${m ? m[2] : '0'}`);
  if (!Number.isFinite(n)) return 0;
  return (neg ? -1 : 1) * Math.round(n * 100) / 100;
}

// Sums in integer cents (no floating point residue like 299,9999…)
function cents(v) { return Math.round(parseMoney(v) * 100); }
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

// What leaves the salary of who missed (in cents). It is its own value because the
// cobertura may be paid more (urgent day); old launches without it use the cobertura value.
function faltaCents(e) {
  return cents(e.descontoFalta !== undefined && e.descontoFalta !== null ? e.descontoFalta : e.valor);
}

function entryTotal(e) {
  return (cents(e.valor) + cents(e.extra) - cents(e.desconto) + (e.dobra ? cents(e.tresSeis) : 0)) / 100;
}

// Fixed salaries in force in a month: the latest list saved for that month or before
// (editing in a month applies from that month on and never rewrites past months)
function fixosOf(post, ym) {
  const hist = post.fixosHist || {};
  const key = Object.keys(hist).filter(k => k <= ym).sort().pop();
  return key ? (hist[key] || []) : [];
}

// ============================================================
// Totals (pure, no DOM)
// ============================================================

class Ledger {
  constructor() { this.posts = {}; this.entries = {}; this.vales = {}; }

  valesOf(ym) {
    return Object.values(this.vales).filter(v => v && v.date && monthOf(v.date) === ym)
      .sort((a, b) => (a.date + (a.createdAt || '')).localeCompare(b.date + (b.createdAt || '')));
  }

  entriesOf(postId, ym) {
    return Object.values(this.entries).filter(e => e.postId === postId && monthOf(e.date) === ym)
      .sort((a, b) => (a.date + a.turno).localeCompare(b.date + b.turno));
  }

  // Month summary of a post (+ per QRA)
  // Accumulate one entry into a totals bucket (all money kept in integer cents)
  static add(b, e) {
    const v = cents(e.valor), x = cents(e.extra), d = cents(e.desconto), t = e.dobra ? cents(e.tresSeis) : 0;
    b.turnos++; b.dias.add(e.date); b.valor += v; b.extra += x; b.desconto += d; b.tresSeis += t; if (e.dobra) b.dobras++;
    b.total += v + x - d + t;
  }

  static bucket(nome) {
    return { nome, turnos: 0, dias: new Set(), valor: 0, extra: 0, desconto: 0, tresSeis: 0, dobras: 0, total: 0, postos: new Set(), fixo: 0, vales: 0, nVales: 0, liquido: 0 };
  }

  static toReais(b) {
    ['valor', 'extra', 'desconto', 'tresSeis', 'total', 'fixo', 'fixos', 'faltas', 'vales', 'liquido'].forEach(k => { if (typeof b[k] === 'number') b[k] /= 100; });
    return b;
  }

  // Month summary of a post (+ per QRA)
  postSummary(post, ym) {
    const all = this.entriesOf(post.id, ym);
    const isDia = e => post.tipo === 'fixo' && post.dividido && e.dia;
    const list = all.filter(e => !isDia(e)); // turnos / coberturas
    const dias = all.filter(isDia);           // days of the people who share the salary
    const sum = Ledger.bucket(post.name);
    sum.fixos = 0;
    sum.qras = {};
    list.forEach(e => {
      Ledger.add(sum, e);
      const key = normalizeText(e.qra) || '?';
      Ledger.add(sum.qras[key] = sum.qras[key] || Ledger.bucket(e.qra || '(sem nome)'), e);
    });
    // Limpeza: salary of the month minus the diárias of the coberturas of each one's absences
    sum.faltas = 0;
    sum.fixosDet = [];
    sum.diasTrab = 0;
    if (post.tipo === 'fixo') {
      const coveredOf = nome => list.filter(e => e.cobre && normalizeText(e.cobre) === normalizeText(nome));
      const pool = fixosOf(post, ym).reduce((a, f) => a + cents(f.salario), 0);
      sum.fixos = pool;
      // shared salary: each one gets salary × her days ÷ all days (equal value per day)
      const people = {};
      dias.forEach(e => {
        const key = normalizeText(e.qra) || '?';
        const pp = people[key] = people[key] || { nome: e.qra || '(sem nome)', dates: new Set(), extra: 0, desconto: 0, tresSeis: 0 };
        pp.dates.add(e.date);
        pp.extra += cents(e.extra); pp.desconto += cents(e.desconto); pp.tresSeis += e.dobra ? cents(e.tresSeis) : 0;
      });
      const shares = Object.values(people);
      const totalDias = shares.reduce((a, pp) => a + pp.dates.size, 0);
      if (post.dividido && totalDias) {
        sum.diasTrab = totalDias;
        sum.valorDia = pool / totalDias / 100;
        // split in cents, leftover cents go to the largest remainders so the parts add up to the salary
        shares.forEach(pp => { const raw = pool * pp.dates.size / totalDias; pp.parte = Math.floor(raw); pp.rest = raw - pp.parte; });
        let left = pool - shares.reduce((a, pp) => a + pp.parte, 0);
        [...shares].sort((a, b) => b.rest - a.rest).forEach(pp => { if (left > 0) { pp.parte++; left--; } });
        shares.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(pp => {
          const covered = coveredOf(pp.nome);
          const desc = covered.reduce((a, e) => a + faltaCents(e), 0);
          const extras = pp.extra - pp.desconto + pp.tresSeis;
          sum.fixosDet.push({ nome: pp.nome, dias: pp.dates.size, salario: pp.parte / 100, faltas: covered.length, desconto: desc / 100,
            extra: pp.extra / 100, descAtraso: pp.desconto / 100, tresSeis: pp.tresSeis / 100, liquido: (pp.parte - desc + extras) / 100 });
          sum.faltas += desc;
          sum.extra += pp.extra; sum.desconto += pp.desconto; sum.tresSeis += pp.tresSeis; sum.total += extras;
        });
      } else {
        fixosOf(post, ym).forEach(f => {
          const covered = coveredOf(f.nome);
          const desc = covered.reduce((a, e) => a + faltaCents(e), 0);
          sum.fixosDet.push({ nome: f.nome, salario: cents(f.salario) / 100, faltas: covered.length, desconto: desc / 100, liquido: (cents(f.salario) - desc) / 100 });
          sum.faltas += desc;
        });
      }
    }
    sum.total += sum.fixos - sum.faltas;
    sum.dias = sum.dias.size;
    Object.values(sum.qras).forEach(Ledger.toReais);
    return Ledger.toReais(sum);
  }

  // Everyone paid in a month across posts (QRAs by shift + fixed limpeza staff).
  // Launches of posts that no longer exist are ignored, so this always matches the posts' totals.
  qraSummary(ym) {
    const out = {};
    Object.values(this.entries).filter(e => monthOf(e.date) === ym && this.posts[e.postId]).forEach(e => {
      const p = this.posts[e.postId];
      if (p.tipo === 'fixo' && p.dividido && e.dia) return; // counted below, inside her part of the salary
      const key = normalizeText(e.qra) || '?';
      const q = out[key] = out[key] || Ledger.bucket(e.qra || '(sem nome)');
      Ledger.add(q, e);
      q.postos.add(p.name);
    });
    // fixed staff: net salary (or part of the shared salary) exactly as the post shows it
    Object.values(this.posts).filter(p => p.tipo === 'fixo').forEach(p => this.postSummary(p, ym).fixosDet.forEach(f => {
      const key = normalizeText(f.nome) || '?';
      const q = out[key] = out[key] || Ledger.bucket(f.nome);
      const parte = cents(f.salario) - cents(f.desconto);
      q.fixo += parte; q.extra += cents(f.extra); q.desconto += cents(f.descAtraso); q.tresSeis += cents(f.tresSeis);
      q.total += cents(f.liquido);
      if (f.dias) q.diasFixo = (q.diasFixo || 0) + f.dias;
      q.postos.add(p.name);
    }));
    // vales of the month: total stays what the person earned, liquido is what is still to pay
    this.valesOf(ym).forEach(v => {
      const key = normalizeText(v.qra) || '?';
      const q = out[key] = out[key] || Ledger.bucket(v.qra || '(sem nome)');
      q.vales += cents(v.valor); q.nVales++;
    });
    Object.values(out).forEach(q => { q.liquido = q.total - q.vales; });
    Object.values(out).forEach(Ledger.toReais);
    return out;
  }

  // Same QRA already working the SAME shift in another launch (two places at once)
  sameShiftElsewhere(qraName, date, turno, excludeId) {
    const n = normalizeText(qraName);
    if (!n) return [];
    return Object.values(this.entries).filter(e => e.id !== excludeId && normalizeText(e.qra) === n && e.date === date && e.turno === turno && this.posts[e.postId]);
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
    this.pessoas = {};
    this.loaded = { posts: false, entries: false, vales: false };
    this.month = currentMonth();
    this.openPostId = null;
    this.renderQueued = false;
  }

  init() {
    if (this.started) return; // never wire listeners twice
    this.started = true;
    this.setupEventListeners();
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
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
    listen('pagamentos/vales', data => { this.ledger.vales = data; this.loaded.vales = true; this.queueRender(); });
    // registered QRAs (Segurança / FX); key = name without case/accents, so no duplicates
    listen('pagamentos/pessoas', data => { this.pessoas = data; this.fillQraDatalist(); this.queueRender(); });
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
        // fixed ids: two phones opening the app for the first time create the SAME posts
        const id = `limpeza_${normalizeText(l.name).replace(/[^a-z0-9]/g, '_')}`;
        data[id] = { id, name: l.name, category: 'Limpeza', escalaType: l.escalaType, tipo: 'fixo', valorTurno: 0 };
      });
      // only fill what is missing (a transaction would also work; update never deletes)
      await this.db.ref('pagamentos/posts').update(data);
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
      if (!this.loaded.posts || !this.loaded.entries || !this.loaded.vales) return;
      this.renderPosts();
      this.renderQras();
      this.renderVales();
      if (document.getElementById('people-modal').classList.contains('active')) this.renderPeople();
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
        const names = this.ledger.entriesOf(p.id, this.month).map(e => e.qra).concat(fixosOf(p, this.month).map(f => f.nome));
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
    const top = sum.fixosDet.filter(f => f.dias).map(f => ({ nome: f.nome, turnos: f.dias }))
      .concat(Object.values(sum.qras).sort((a, b) => b.total - a.total)).slice(0, 4);
    return `
      <div class="post-card pay-card" onclick="app.openPost('${p.id}')">
        <div class="post-header">
          <span class="post-name">${esc(p.name)}</span>
          <span class="post-type-badge ${fixo ? 'limpeza' : 'badge-24h'}">${fixo ? 'Salário fixo' : `Turno ${p.valorTurno ? brl(p.valorTurno) : '—'}`}</span>
        </div>
        <div class="pay-lines">
          ${fixo ? (p.dividido
            ? `<div class="pay-line"><span>🧾 Salário dividido · ${sum.diasTrab} dia(s)${sum.diasTrab ? ` · ${brl(sum.valorDia)}/dia` : ''}</span><strong>${brl(sum.fixos)}</strong></div>`
            : `<div class="pay-line"><span>🧾 Fixos (${fixosOf(p, this.month).length})</span><strong>${brl(sum.fixos)}</strong></div>`) : ''}
          ${fixo && sum.faltas ? `<div class="pay-line"><span>🚫 Faltas descontadas</span><strong class="minus">− ${brl(sum.faltas)}</strong></div>` : ''}
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
      ${p.tipo === 'fixo' ? `<div><span>🧾 Fixos</span><b>${brl(sum.fixos)}</b></div><div><span>🚫 Faltas</span><b class="minus">${brl(sum.faltas)}</b></div>` : ''}
      <div><span>${p.tipo === 'fixo' ? '🔁 Coberturas' : '📅 Turnos'}</span><b>${sum.turnos} · ${brl(sum.valor)}</b></div>
      <div><span>⏱️ Extra</span><b class="plus">${brl(sum.extra)}</b></div>
      <div><span>⚠️ Desc.</span><b class="minus">${brl(sum.desconto)}</b></div>
      <div><span>🔁 3/6</span><b class="plus">${brl(sum.tresSeis)}</b></div>
      <div class="total"><span>Total</span><b>${brl(sum.total)}</b></div>`;
    const body = document.getElementById('post-modal-body');
    const entries = this.ledger.entriesOf(p.id, this.month);
    const isDia = e => p.tipo === 'fixo' && p.dividido && e.dia;
    const cell = e => `<button class="pay-cell filled${e.dobra ? ' dobra' : ''}" onclick="app.showEntryModal({ id: '${e.id}' })">
        <span class="pay-cell-name">${esc(e.qra || '(sem nome)')}</span>
        <span class="pay-cell-val">${isDia(e) ? (sum.valorDia ? brl(sum.valorDia) : 'dia') : brl(entryTotal(e))}${parseMoney(e.extra) ? ` <i class="plus">+${moneyInput(parseMoney(e.extra))}</i>` : ''}${parseMoney(e.desconto) ? ` <i class="minus">−${moneyInput(parseMoney(e.desconto))}</i>` : ''}${e.dobra ? ' <i class="tag36">3/6</i>' : ''}</span>
      </button>`;

    if (p.tipo === 'fixo') {
      const extrasOf = f => [f.extra ? `<span class="plus">+ ${brl(f.extra)}</span>` : '', f.descAtraso ? `<span class="minus">− ${brl(f.descAtraso)} atraso</span>` : '',
        f.tresSeis ? `<span class="plus">+ ${brl(f.tresSeis)} 3/6</span>` : ''].filter(Boolean).join(' ');
      const fixoLine = f => `<div class="pay-line"><span class="pay-name">${esc(f.nome)}${f.dias ? ` · ${f.dias} dia(s)` : ''}</span><strong>${f.faltas || extrasOf(f) ? `${brl(f.salario)} ${f.faltas ? `<span class="minus">− ${brl(f.desconto)} (${f.faltas} falta${f.faltas > 1 ? 's' : ''})</span> ` : ''}${extrasOf(f)} = ` : ''}${brl(f.liquido)}</strong></div>`;
      const cobs = entries.filter(e => !isDia(e));
      const dividido = p.dividido ? `
        <h3 class="pay-section">📅 Dias trabalhados${sum.diasTrab ? ` · ${brl(sum.fixos)} ÷ ${sum.diasTrab} dia(s) = ${brl(sum.valorDia)}/dia` : ''}</h3>
        ${this.dayGridHtml(p, entries.filter(isDia), cell, true)}` : '';
      body.innerHTML = `
        <h3 class="pay-section">🧾 Salário ${p.dividido ? `dividido · ${brl(sum.fixos)}` : 'fixo'}</h3>
        ${p.dividido && !sum.diasTrab ? `<div class="muted-text">Anote abaixo os dias de cada uma; o salário é dividido pelos dias trabalhados.</div>` : ''}
        ${sum.fixosDet.length ? `<div class="pay-fixos">${sum.fixosDet.map(fixoLine).join('')}</div>`
          : `<div class="muted-text">Nenhum funcionário fixo em ${monthLabel(this.month)}. Use "✏️ Editar posto".</div>`}
        ${dividido}
        <h3 class="pay-section">🔁 Coberturas no mês</h3>
        <button class="slot-add slot-add-custom" onclick="app.showEntryModal({ postId: '${p.id}', date: '${this.defaultDate()}', turno: 'diurno' })">+ lançar cobertura</button>
        <div class="pay-cob-list">${cobs.length ? cobs.map(e => `<div class="pay-day"><span class="pay-day-label">${dayLabel(e.date)} ${SHIFT_LABEL[e.turno].split(' ')[0]}${e.cobre ? `<br><small class="minus">falta: ${esc(e.cobre)} −${moneyInput(faltaCents(e) / 100)}</small>` : ''}</span>${cell(e)}</div>`).join('') : '<div class="muted-text">Nenhuma cobertura lançada.</div>'}</div>`;
      return;
    }
    body.innerHTML = this.dayGridHtml(p, entries, cell, false);
  }

  // Per-post per-day grid: shifts the post normally has + any shift with a launch
  dayGridHtml(p, entries, cell, dia) {
    const open = (date, shift) => `app.showEntryModal({ postId: '${p.id}', date: '${date}', turno: '${shift}'${dia ? ', dia: true' : ''} })`;
    const rows = monthDates(this.month).map(date => {
      const shifts = new Set(postShifts(p, date));
      entries.filter(e => e.date === date).forEach(e => shifts.add(e.turno));
      const cells = ['diurno', 'noturno'].filter(s => shifts.has(s)).map(shift => {
        const list = entries.filter(e => e.date === date && e.turno === shift);
        return `<div class="pay-slot"><span class="pay-slot-tag">${SHIFT_LABEL[shift].split(' ')[0]}</span>
          ${list.map(cell).join('')}
          ${list.length ? '' : `<button class="pay-cell empty" onclick="${open(date, shift)}">+ ${dia ? 'anotar dia' : 'lançar'}</button>`}
        </div>`;
      }).join('');
      const firstShift = postShifts(p, date)[0] || (p.escalaType === 'noturno' ? 'noturno' : 'diurno');
      const extra = `<button class="pay-more" title="${dia ? 'Anotar outra pessoa neste dia' : 'Lançamento extra neste dia'}" onclick="${open(date, firstShift)}">＋</button>`;
      return `<div class="pay-day${cells ? '' : ' closed'}"><span class="pay-day-label">${dayLabel(date)}</span><div class="pay-slots">${cells || '<span class="muted-text">posto fechado</span>'}</div>${extra}</div>`;
    }).join('');
    return `<div class="pay-days">${rows}</div>`;
  }

  defaultDate() {
    const today = toDateStr(new Date());
    return monthOf(today) === this.month ? today : `${this.month}-01`;
  }

  // ===== Lançamento =====

  fillQraDatalist() {
    const names = [...this.knownPeople().values()].map(x => x.nome).sort((a, b) => a.localeCompare(b));
    document.getElementById('qra-names').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
  }

  // Everyone the app knows, one per name (ignoring case/accents/spaces). The registry wins;
  // names only used in launches / Coberturas get the type of where they worked.
  knownPeople() {
    const map = new Map();
    const put = (nome, tipo, cadastrado) => { const k = normalizeText(nome); if (k) map.set(k, { key: pessoaKey(nome), nome: nome.trim(), tipo, cadastrado }); };
    Object.values(this.ledger.entries).forEach(e => { const p = this.ledger.posts[e.postId]; if (e.qra) put(e.qra, p && p.tipo === 'fixo' ? 'fx' : 'seguranca', false); });
    Object.values(this.ledger.vales).forEach(v => { if (v && v.qra && !map.has(normalizeText(v.qra))) put(v.qra, 'seguranca', false); });
    this.qraNames.forEach(n => put(n, 'seguranca', false));
    Object.values(this.ledger.posts).filter(p => p.tipo === 'fixo').forEach(p => Object.values(p.fixosHist || {}).forEach(l => (l || []).forEach(f => f.nome && put(f.nome, 'fx', false))));
    Object.values(this.pessoas).forEach(x => { if (x && x.nome) put(x.nome, x.tipo === 'fx' ? 'fx' : 'seguranca', true); });
    return map;
  }

  findPerson(name) { return this.knownPeople().get(normalizeText(name)) || null; }

  // Under the QRA field: who it is, or "new QRA → register as Segurança / FX"
  renderQraInfo(prefix, defaultTipo) {
    const name = document.getElementById(`${prefix}-qra`).value;
    const el = document.getElementById(`${prefix}-qra-info`);
    const old = document.getElementById(`${prefix}-qra-tipo`);
    const chosen = old ? old.value : defaultTipo;
    if (!normalizeText(name)) { el.innerHTML = ''; return; }
    const k = this.findPerson(name);
    if (k) {
      el.innerHTML = `<span class="tipo-badge ${k.tipo}">${TIPO_LABEL[k.tipo]}</span>${k.nome !== name.trim() ? ` será salvo como <b>${esc(k.nome)}</b> (já existe)` : ''}`;
      return;
    }
    el.innerHTML = `🆕 QRA novo — será cadastrado como <select id="${prefix}-qra-tipo" class="form-select tipo-select">
      <option value="seguranca"${chosen === 'seguranca' ? ' selected' : ''}>🛡️ Segurança</option><option value="fx"${chosen === 'fx' ? ' selected' : ''}>🧹 FX</option></select>`;
  }

  // Returns the name as already known (same spelling everywhere) and registers it if needed.
  // The transaction only creates: two phones adding the same new name end up with one.
  ensurePerson(name, tipo) {
    const k = this.findPerson(name);
    const nome = k ? k.nome : name.trim().replace(/\s+/g, ' ');
    if (!k || !k.cadastrado) {
      const data = { nome, tipo: k ? k.tipo : (tipo === 'fx' ? 'fx' : 'seguranca'), createdAt: new Date().toISOString() };
      this.pessoas[pessoaKey(nome)] = data; // known at once, before the server answers
      this.db.ref(`pagamentos/pessoas/${pessoaKey(nome)}`).transaction(cur => cur || data).catch(e => console.warn('pessoa', e));
    }
    return nome;
  }

  showPeople() {
    document.getElementById('people-new-name').value = '';
    document.getElementById('people-new-info').innerHTML = '';
    document.getElementById('people-search').value = '';
    this.renderPeople();
    this.showModal('people-modal');
  }

  renderPeople() {
    const q = normalizeText(document.getElementById('people-search').value);
    const all = [...this.knownPeople().values()].filter(x => !q || normalizeText(x.nome).includes(q))
      .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome));
    const count = t => all.filter(x => x.tipo === t).length;
    document.getElementById('people-list').innerHTML = all.length ? `
      <div class="muted-text">🛡️ ${count('seguranca')} segurança · 🧹 ${count('fx')} FX</div>` + all.map(x => `
      <div class="people-row">
        <span class="pay-name">${esc(x.nome)}${x.cadastrado ? '' : ' <small class="muted-text">(sem cadastro)</small>'}</span>
        <select class="form-select tipo-select" onchange="app.setPersonTipo('${esc(x.nome).replace(/'/g, '&#39;')}', this.value)">
          <option value="seguranca"${x.tipo === 'seguranca' ? ' selected' : ''}>🛡️ Segurança</option>
          <option value="fx"${x.tipo === 'fx' ? ' selected' : ''}>🧹 FX</option>
        </select>
      </div>`).join('') : '<div class="empty-state">Ninguém cadastrado.</div>';
  }

  setPersonTipo(nome, tipo) {
    const key = pessoaKey(nome);
    const cur = this.pessoas[key] || { nome, createdAt: new Date().toISOString() };
    this.write(this.db.ref(`pagamentos/pessoas/${key}`).set({ ...cur, nome: cur.nome || nome, tipo }), `${nome}: ${TIPO_LABEL[tipo]}`);
  }

  addPerson() {
    const name = document.getElementById('people-new-name').value.trim();
    if (!name) return this.showToast('Informe o nome', 'error');
    const k = this.findPerson(name);
    if (k) return this.showToast(`⚠️ ${k.nome} já existe (${TIPO_LABEL[k.tipo]}). Não foi duplicado.`, 'error');
    const nome = this.ensurePerson(name, document.getElementById('people-new-tipo').value);
    document.getElementById('people-new-name').value = '';
    document.getElementById('people-new-info').innerHTML = '';
    this.renderPeople();
    this.fillQraDatalist();
    this.showToast(`✅ ${nome} cadastrado`, 'success');
  }

  // ===== Vales =====

  renderVales() {
    const vales = this.ledger.valesOf(this.month);
    document.getElementById('vale-count').textContent = vales.length || '';
    const ppl = this.ledger.qraSummary(this.month);
    const totV = vales.reduce((a, v) => a + cents(v.valor), 0);
    document.getElementById('vale-summary').innerHTML = `
      <div><span>💸 Vales</span><b class="minus">${brl(totV / 100)}</b></div>
      <div><span>🧾 Quantidade</span><b>${vales.length}</b></div>
      <div><span>👥 Pessoas</span><b>${new Set(vales.map(v => normalizeText(v.qra))).size}</b></div>`;
    const query = normalizeText(document.getElementById('vale-search').value);
    const groups = {};
    vales.filter(v => !query || normalizeText(v.qra).includes(query)).forEach(v => { (groups[normalizeText(v.qra)] = groups[normalizeText(v.qra)] || []).push(v); });
    const el = document.getElementById('vale-list');
    const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    if (!keys.length) { el.innerHTML = `<div class="empty-state">${query ? 'Nenhum vale para esse QRA.' : `Nenhum vale em ${monthLabel(this.month)}.`}</div>`; return; }
    el.innerHTML = keys.map(k => {
      const q = ppl[k]; const list = groups[k]; const person = this.findPerson(list[0].qra);
      return `<div class="qra-row vale-card">
        <div class="qra-main">
          <div class="qra-name">${esc(q ? q.nome : list[0].qra)} ${person ? `<span class="tipo-badge ${person.tipo}">${TIPO_LABEL[person.tipo]}</span>` : ''}</div>
          <div class="vale-items">${list.map(v => `<button class="vale-item" onclick="app.showValeModal({ id: '${v.id}' })">${dayLabel(v.date)} · <b>${brl(parseMoney(v.valor))}</b>${v.obs ? ` · ${esc(v.obs)}` : ''}</button>`).join('')}</div>
          <div class="qra-meta">Ganhou ${brl(q ? q.total : 0)} − vales ${brl(q ? q.vales : 0)}</div>
          <button class="btn-mini" onclick="app.showValeModal({ qra: '${esc(list[0].qra).replace(/'/g, '&#39;')}' })">＋ outro vale</button>
        </div>
        <div class="qra-total${q && q.liquido < 0 ? ' negative' : ''}">${brl(q ? q.liquido : 0)}<small>a receber</small></div>
      </div>`;
    }).join('');
  }

  showValeModal({ id, qra } = {}) {
    const v = id ? this.ledger.vales[id] : null;
    document.getElementById('vale-modal-title').textContent = v ? '✏️ Editar vale' : '💸 Novo vale';
    document.getElementById('vale-id').value = v ? v.id : '';
    document.getElementById('vale-qra').value = v ? v.qra : (qra || '');
    document.getElementById('vale-date').value = v ? v.date : this.defaultDate();
    document.getElementById('vale-valor').value = v ? moneyInput(parseMoney(v.valor)) : '';
    document.getElementById('vale-obs').value = v ? (v.obs || '') : '';
    document.getElementById('vale-delete').style.display = v ? '' : 'none';
    document.getElementById('vale-qra-info').innerHTML = '';
    this.fillQraDatalist();
    this.renderQraInfo('vale', 'seguranca');
    this.showModal('vale-modal');
    if (!v) setTimeout(() => document.getElementById(qra ? 'vale-valor' : 'vale-qra').focus(), 60);
  }

  async saveVale() {
    const raw = document.getElementById('vale-qra').value.trim();
    const date = document.getElementById('vale-date').value;
    const valor = parseMoney(document.getElementById('vale-valor').value);
    if (!raw) return this.showToast('Informe o QRA que recebeu', 'error');
    if (!date) return this.showToast('Informe o dia do vale', 'error');
    if (!(valor > 0)) return this.showToast('Informe o valor do vale', 'error');
    const tipoSel = document.getElementById('vale-qra-tipo');
    const qra = this.ensurePerson(raw, tipoSel ? tipoSel.value : 'seguranca');
    const old = this.ledger.vales[document.getElementById('vale-id').value];
    const id = old ? old.id : makeId('vale');
    const vale = { id, qra, date, valor, obs: document.getElementById('vale-obs').value.trim(), createdAt: old ? (old.createdAt || null) : new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.hideModal('vale-modal');
    if (monthOf(date) !== this.month) this.showToast(`O vale é de ${monthLabel(monthOf(date))} e entra na conta daquele mês`, 'info');
    await this.write(this.db.ref(`pagamentos/vales/${id}`).set(vale), `💸 Vale de ${brl(valor)} para ${qra}`);
  }

  deleteVale() {
    const v = this.ledger.vales[document.getElementById('vale-id').value];
    if (!v) return;
    this.confirm(`Excluir o vale de ${brl(parseMoney(v.valor))} de ${v.qra} (${dayLabel(v.date)})?`, () => {
      this.hideModal('vale-modal');
      this.write(this.db.ref(`pagamentos/vales/${v.id}`).remove(), 'Vale excluído');
    });
  }

  showEntryModal({ id, postId, date, turno, dia } = {}) {
    const e = id ? this.ledger.entries[id] : null;
    const p = this.ledger.posts[e ? e.postId : postId];
    if (!p) return;
    this.fillQraDatalist();
    const fixo = p.tipo === 'fixo';
    const isDia = fixo && !!p.dividido && (e ? !!e.dia : !!dia);
    const ym = monthOf(e ? e.date : date);
    document.getElementById('entry-dia').value = isDia ? '1' : '';
    document.getElementById('entry-modal-title').textContent = `${e ? '✏️ Editar' : (isDia ? '📅 Dia trabalhado' : fixo ? '🔁 Cobertura' : '💵 Lançamento')} · ${p.name}`;
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
    // limpeza: which fixed employee missed (her salary loses the diária of this cobertura)
    // shared salary: anyone who worked days this month can be the one who missed
    const fixosMes = !fixo ? [] : !p.dividido ? fixosOf(p, ym)
      : (() => {
        const people = [...new Map(this.ledger.entriesOf(p.id, ym).filter(x => x.dia && x.qra).map(x => [normalizeText(x.qra), x.qra])).values()];
        return people.length ? people.map(nome => ({ nome, salario: 0 })) : fixosOf(p, ym);
      })();
    document.getElementById('entry-cobre-group').style.display = fixo && !isDia ? '' : 'none';
    document.getElementById('entry-valor-group').style.display = isDia ? 'none' : '';
    const sumDia = isDia ? this.ledger.postSummary(p, ym) : null;
    const diaInfo = document.getElementById('entry-dia-info');
    diaInfo.className = isDia ? 'info-box visible' : 'info-box';
    diaInfo.innerHTML = isDia ? `📅 O valor do dia sai da divisão do salário (${brl(sumDia.fixos)} ÷ dias trabalhados no mês${sumDia.diasTrab ? `, agora ${brl(sumDia.valorDia)}/dia` : ''}). Aqui só hora extra, atraso e 3/6.` : '';
    document.getElementById('entry-cobre').innerHTML = '<option value="">— ninguém (não descontar) —</option>' +
      fixosMes.map(f => `<option value="${esc(f.nome)}">${esc(f.nome)}${parseMoney(f.salario) ? ` (salário ${brl(parseMoney(f.salario))})` : ''}</option>`).join('');
    document.getElementById('entry-cobre').value = e ? (e.cobre || '') : (fixosMes.length === 1 ? fixosMes[0].nome : '');
    document.getElementById('entry-falta-valor').value = e && e.cobre ? moneyInput(faltaCents(e) / 100)
      : (parseMoney(p.valorTurno) ? moneyInput(parseMoney(p.valorTurno)) : '');
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
    const postE = this.ledger.posts[document.getElementById('entry-post').value];
    this.renderQraInfo('entry', postE && postE.tipo === 'fixo' ? 'fx' : 'seguranca');
    const near = date ? this.ledger.adjacentSameQra(qra, date, turno, id) : [];
    const dobraBox = document.getElementById('entry-dobra'); // the 3/6 option (manual)
    const hint = document.getElementById('entry-dobra-hint');
    const clash = date ? this.ledger.sameShiftElsewhere(qra, date, turno, id) : [];
    const postName = x => esc((this.ledger.posts[x.postId] || { name: '?' }).name);
    const lines = [];
    if (clash.length) lines.push(`<div class="check-conflict">⛔ ${esc(qra)} já está lançado no MESMO turno (${dayLabel(date)} ${SHIFT_LABEL[turno]}) em ${clash.map(postName).join(', ')}.</div>`);
    if (near.length) lines.push(`<div class="check-warn">🔁 ${esc(qra)} também trabalhou ${near.map(n => `${dayLabel(n.date)} ${SHIFT_LABEL[n.turno]} em ${postName(n)}`).join(' e ')} — é dobra. Se tiver 3/6, marque abaixo.</div>`);
    hint.className = lines.length ? 'info-box visible' : 'info-box';
    hint.innerHTML = lines.join('');
    document.getElementById('entry-36-group').style.display = dobraBox.checked ? '' : 'none';
    document.getElementById('entry-falta-group').style.display =
      document.getElementById('entry-cobre-group').style.display !== 'none' && document.getElementById('entry-cobre').value ? '' : 'none';
    const e = {
      valor: document.getElementById('entry-dia').value ? 0 : document.getElementById('entry-valor').value, extra: document.getElementById('entry-extra').value,
      desconto: document.getElementById('entry-desconto').value, dobra: dobraBox.checked, tresSeis: document.getElementById('entry-36').value,
    };
    document.getElementById('entry-total').textContent = `Total: ${brl(entryTotal(e))}`;
  }

  async saveEntry(confirmed) {
    const id = document.getElementById('entry-id').value || makeId('lanc');
    const postId = document.getElementById('entry-post').value;
    const date = document.getElementById('entry-date').value;
    const rawQra = document.getElementById('entry-qra').value.trim();
    if (!date) return this.showToast('Informe o dia', 'error');
    if (!rawQra) return this.showToast('Informe o QRA que trabalhou', 'error');
    const known = this.findPerson(rawQra);
    const qra = known ? known.nome : rawQra.replace(/\s+/g, ' ');
    const dia = !!document.getElementById('entry-dia').value;
    const money = ['entry-valor', 'entry-extra', 'entry-desconto', 'entry-36'].map(f => parseMoney(document.getElementById(f).value));
    if (dia) money[0] = 0;
    const cobre = document.getElementById('entry-cobre-group').style.display === 'none' ? null : (document.getElementById('entry-cobre').value || null);
    const faltaTxt = document.getElementById('entry-falta-valor').value.trim();
    const descontoFalta = cobre ? (faltaTxt ? parseMoney(faltaTxt) : money[0]) : null;
    if (descontoFalta !== null && descontoFalta < 0) return this.showToast('O desconto da falta não pode ser negativo', 'error');
    if (money.some(v => v < 0)) return this.showToast('Os valores não podem ser negativos (o atraso já entra como desconto)', 'error');
    const dobra = document.getElementById('entry-dobra').checked;
    const preview = { valor: money[0], extra: money[1], desconto: money[2], dobra, tresSeis: money[3] };
    if (!confirmed) {
      const clash = this.ledger.sameShiftElsewhere(qra, date, document.getElementById('entry-turno').value, document.getElementById('entry-id').value);
      const problems = [];
      if (clash.length) problems.push(`${qra} já está lançado no mesmo turno em ${clash.map(c => (this.ledger.posts[c.postId] || { name: '?' }).name).join(', ')}`);
      if (!dia && entryTotal(preview) < 0) problems.push(`o total do lançamento fica negativo (${brl(entryTotal(preview))})`);
      if (problems.length) return this.confirm(`Atenção: ${problems.join(' e ')}. Salvar mesmo assim?`, () => this.saveEntry(true));
    }
    const tipoSel = document.getElementById('entry-qra-tipo');
    const postS = this.ledger.posts[postId];
    this.ensurePerson(qra, tipoSel ? tipoSel.value : (postS && postS.tipo === 'fixo' ? 'fx' : 'seguranca'));
    const entry = {
      id, postId, date, turno: document.getElementById('entry-turno').value, qra,
      valor: money[0], dia: dia || null,
      extra: parseMoney(document.getElementById('entry-extra').value),
      desconto: parseMoney(document.getElementById('entry-desconto').value),
      dobra, tresSeis: dobra ? parseMoney(document.getElementById('entry-36').value) : 0,
      obs: document.getElementById('entry-obs').value.trim(),
      cobre, descontoFalta,
      updatedAt: new Date().toISOString(),
    };
    this.hideModal('entry-modal');
    await this.write(this.db.ref(`pagamentos/lancamentos/${id}`).set(entry), `✅ ${qra} · ${dayLabel(date)}${dia ? ' · dia anotado' : ` · ${brl(entryTotal(entry))}`}`);
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
    document.getElementById('ep-dividido').checked = !!(p && p.dividido);
    document.getElementById('ep-fixos').value = p ? fixosOf(p, this.month).map(f => `${f.nome} ; ${moneyInput(parseMoney(f.salario))}`).join('\n') : '';
    document.getElementById('ep-fixos-label').textContent = `Funcionários fixos — valem a partir de ${monthLabel(this.month)} (um por linha: Nome ; salário)`;
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
      const k = this.findPerson(nome || '');
      return { nome: k ? k.nome : (nome || '').trim().replace(/\s+/g, ' '), salario: parseMoney(sal) };
    }).filter(f => f.nome);
    if (fixos.some(f => f.salario < 0)) return this.showToast('Salário não pode ser negativo', 'error');
    const hist = { ...((old && old.fixosHist) || {}) };
    if (tipo === 'fixo') {
      // saved for the selected month; later months keep their own list if they already have one
      const before = old ? JSON.stringify(fixosOf(old, this.month)) : '[]';
      if (JSON.stringify(fixos) !== before) hist[this.month] = fixos;
    }
    const post = {
      ...(old || {}), id, name,
      category: document.getElementById('ep-category').value.trim() || (tipo === 'fixo' ? 'Limpeza' : 'Outros'),
      escalaType: document.getElementById('ep-escala').value,
      tipo, valorTurno: parseMoney(document.getElementById('ep-valor').value),
      fixos: null,
      fixosHist: tipo === 'fixo' ? hist : null,
      dividido: tipo === 'fixo' && document.getElementById('ep-dividido').checked ? true : null,
    };
    if (tipo === 'fixo') fixos.forEach(f => this.ensurePerson(f.nome, 'fx'));
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
          <div class="qra-name">${esc(q.nome)} ${(k => k ? `<span class="tipo-badge ${k.tipo}">${TIPO_LABEL[k.tipo]}</span>` : '')(this.findPerson(q.nome))}</div>
          <div class="qra-meta">🏢 ${esc([...q.postos].join(' · ') || '—')}</div>
          <div class="qra-next">${q.turnos ? `📅 ${q.turnos} turno(s) · ${q.dias.size} dia(s) · 💵 ${brl(q.valor)}` : ''}${q.fixo ? `${q.turnos ? ' · ' : ''}🧾 ${q.diasFixo ? `${q.diasFixo} dia(s) · ` : ''}fixo ${brl(q.fixo)}` : ''}${q.extra ? ` · ⏱️ +${brl(q.extra)}` : ''}${q.desconto ? ` · ⚠️ −${brl(q.desconto)}` : ''}${q.tresSeis ? ` · 🔁 3/6 +${brl(q.tresSeis)}` : ''}</div>
          ${q.vales ? `<div class="qra-folgas">💸 ${q.nVales} vale(s) −${brl(q.vales)} · ganhou ${brl(q.total)}</div>` : ''}
        </div>
        <div class="qra-total${q.liquido < 0 ? ' negative' : ''}">${brl(q.liquido)}${q.vales ? '<small>a receber</small>' : ''}</div>
      </div>`).join('');
  }

  // ===== WhatsApp exports =====

  postBlock(p, ym) {
    const s = this.ledger.postSummary(p, ym);
    const lines = [];
    lines.push(`🏢 *${p.name}* (${p.category})`);
    if (p.tipo === 'fixo') {
      lines.push(p.dividido && s.diasTrab
        ? `🧾 Salário dividido: ${brl(s.fixos)} ÷ ${s.diasTrab} dia(s) = ${brl(s.valorDia)}/dia${s.faltas ? ` · 🚫 faltas descontadas: ${brl(s.faltas)}` : ''}`
        : `🧾 Salário fixo: ${brl(s.fixos)}${s.faltas ? ` · 🚫 faltas descontadas: ${brl(s.faltas)}` : ''}`);
      s.fixosDet.forEach(f => {
        const adj = [f.faltas ? `− ${brl(f.desconto)} (${f.faltas} falta(s))` : '', f.extra ? `+ ${brl(f.extra)} extra` : '',
          f.descAtraso ? `− ${brl(f.descAtraso)} atraso` : '', f.tresSeis ? `+ ${brl(f.tresSeis)} 3/6` : ''].filter(Boolean).join(' ');
        lines.push(`   • ${f.nome}: ${f.dias ? `${f.dias} dia(s) = ` : ''}${brl(f.salario)}${adj ? ` ${adj} = ${brl(f.liquido)}` : ''}`);
      });
      lines.push(`🔁 Coberturas: ${s.turnos} (${s.dias} dia(s)) · ${brl(s.valor)}`);
    } else {
      lines.push(`📅 Dias do posto: ${s.dias} · Turnos: ${s.turnos} · Valor: ${brl(s.valor)}`);
    }
    lines.push(`⏱️ Hora extra: ${brl(s.extra)}`);
    lines.push(`⚠️ Descontos: ${brl(s.desconto)}`);
    lines.push(`🔁 3/6: ${brl(s.tresSeis)} (${s.dobras}x)`);
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
      ['turnos', 'dobras'].forEach(k => { a[k] += s[k]; });
      ['valor', 'extra', 'desconto', 'tresSeis', 'fixos', 'faltas', 'total'].forEach(k => { a[k] = (cents(a[k]) + cents(s[k])) / 100; });
      return a;
    }, { turnos: 0, valor: 0, extra: 0, desconto: 0, tresSeis: 0, fixos: 0, faltas: 0, total: 0, dobras: 0 });
    const qras = Object.values(this.ledger.qraSummary(ym)).sort((a, b) => b.total - a.total);
    msg += `📊 *TOTAL GERAL — ${monthLabel(ym)}*\n`;
    msg += `📅 Turnos: ${tot.turnos} · Valor: ${brl(tot.valor)}\n`;
    if (tot.fixos) msg += `🧾 Salários fixos: ${brl(tot.fixos)}${tot.faltas ? ` · 🚫 faltas descontadas: ${brl(tot.faltas)}` : ''}\n`;
    msg += `⏱️ Hora extra: ${brl(tot.extra)}\n⚠️ Descontos: ${brl(tot.desconto)}\n🔁 3/6: ${brl(tot.tresSeis)} (${tot.dobras}x)\n`;
    const vales = qras.reduce((a, q) => a + cents(q.vales), 0), nVales = qras.reduce((a, q) => a + q.nVales, 0);
    msg += `👥 Pessoas: ${qras.length}\n✅ *TOTAL: ${brl(tot.total)}*`;
    if (vales) msg += `\n💸 Vales: −${brl(vales / 100)} (${nVales})\n💵 *A PAGAR (total − vales): ${brl((cents(tot.total) - vales) / 100)}*`;
    if (qras.length) {
      const line = q => {
        const parts = [];
        if (q.turnos) parts.push(`${q.dias.size} dia(s), ${q.turnos} turno(s)`);
        if (q.fixo) parts.push(`fixo${q.diasFixo ? ` (${q.diasFixo} dia(s))` : ''} ${brl(q.fixo)}`); // already minus covered absences
        return `   • ${q.nome}: ${parts.join(' + ') || 'sem lançamentos'} → ${brl(q.total)}${q.vales ? ` − vale(s) ${brl(q.vales)} = *${brl(q.liquido)}*` : ''}`;
      };
      const tipoOf = q => (this.findPerson(q.nome) || { tipo: 'seguranca' }).tipo;
      msg += `\n\n👥 *POR PESSOA (todos os postos):*`;
      ['seguranca', 'fx'].forEach(t => {
        const g = qras.filter(q => tipoOf(q) === t);
        if (g.length) msg += `\n${TIPO_LABEL[t]} (${g.length}):\n` + g.map(line).join('\n');
      });
    }
    return msg;
  }

  // Long reports do not fit in a WhatsApp link: show the text with Copiar / Compartilhar and, when
  // needed, split it into parts (each one opens WhatsApp with a message of a safe size)
  sendWhatsApp(text, title) {
    const MAX = 3000; // characters per WhatsApp message
    const parts = [];
    let cur = '';
    // blocks bigger than one message are cut by lines
    const blocks = text.split('\n\n').flatMap(block => {
      if (block.length <= MAX) return [block];
      const out = [];
      let piece = '';
      block.split('\n').forEach(line => {
        if (piece && piece.length + line.length + 1 > MAX) { out.push(piece); piece = ''; }
        piece = piece ? `${piece}\n${line}` : line;
      });
      if (piece) out.push(piece);
      return out;
    });
    blocks.forEach(block => {
      if (cur && (cur.length + block.length + 2) > MAX) { parts.push(cur); cur = ''; }
      cur = cur ? `${cur}\n\n${block}` : block;
    });
    if (cur) parts.push(cur);
    this.exportText = text;
    this.exportParts = parts.length > 1 ? parts.map((t, i) => `(${i + 1}/${parts.length})\n${t}`) : parts;
    document.getElementById('export-title').textContent = title || '📱 Exportar';
    document.getElementById('export-preview').value = text;
    document.getElementById('export-info').textContent = this.exportParts.length > 1
      ? `Relatório grande: vai em ${this.exportParts.length} mensagens no WhatsApp (ou copie/compartilhe tudo de uma vez).`
      : `${text.length} caracteres.`;
    document.getElementById('export-parts').innerHTML = this.exportParts.map((_, i) =>
      `<button class="btn-primary btn-inline btn-whatsapp" onclick="app.openWhatsAppPart(${i})">📱 WhatsApp${this.exportParts.length > 1 ? ` — parte ${i + 1}/${this.exportParts.length}` : ''}</button>`).join('');
    document.getElementById('export-share').style.display = navigator.share ? '' : 'none';
    this.showModal('export-modal');
  }

  openWhatsAppPart(i) {
    window.open(`https://wa.me/?text=${encodeURIComponent(this.exportParts[i])}`, '_blank');
  }

  async copyExport() {
    try {
      await navigator.clipboard.writeText(this.exportText);
      this.showToast('📋 Texto copiado — cole no WhatsApp', 'success');
    } catch (e) {
      const ta = document.getElementById('export-preview');
      ta.select();
      document.execCommand('copy');
      this.showToast('📋 Texto copiado', 'success');
    }
  }

  async shareExport() {
    try { await navigator.share({ text: this.exportText }); } catch (e) { /* cancelled */ }
  }

  exportPost(postId) {
    if (!this.ledger.posts[postId]) return;
    this.sendWhatsApp(this.buildPostMessage(postId, this.month), `📱 ${this.ledger.posts[postId].name} · ${monthLabel(this.month)}`);
  }

  exportAll() {
    this.sendWhatsApp(this.buildGeneralMessage(this.month), `📱 Geral · ${monthLabel(this.month)}`);
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
    on('vale-search', 'input', () => this.renderVales());
    on('add-vale-btn', 'click', () => this.showValeModal({}));
    on('vale-save', 'click', () => this.saveVale());
    on('vale-delete', 'click', () => this.deleteVale());
    on('vale-qra', 'input', () => this.renderQraInfo('vale', 'seguranca'));
    on('people-btn', 'click', () => this.showPeople());
    on('people-add', 'click', () => this.addPerson());
    on('people-search', 'input', () => this.renderPeople());
    on('people-new-name', 'input', () => {
      const k = this.findPerson(document.getElementById('people-new-name').value);
      document.getElementById('people-new-info').innerHTML = k ? `⚠️ Já existe: <b>${esc(k.nome)}</b> (${TIPO_LABEL[k.tipo]})` : '';
    });
    on('entry-qra', 'input', () => this.updateEntryForm(true));
    on('add-post-btn', 'click', () => this.showEditPost(null));
    on('export-all-btn', 'click', () => this.exportAll());
    on('post-export-btn', 'click', () => this.exportPost(this.openPostId));
    on('post-edit-btn', 'click', () => this.showEditPost(this.openPostId));
    on('ep-tipo', 'change', () => this.updateEditPostForm());
    on('ep-save', 'click', () => this.savePost());
    on('ep-delete', 'click', () => this.deletePost());
    on('entry-save', 'click', () => this.saveEntry());
    on('export-copy', 'click', () => this.copyExport());
    on('export-share', 'click', () => this.shareExport());
    on('entry-delete', 'click', () => this.deleteEntry());
    ['entry-qra', 'entry-date', 'entry-turno'].forEach(id => on(id, 'change', () => this.updateEntryForm(false)));
    ['entry-valor', 'entry-extra', 'entry-desconto', 'entry-36'].forEach(id => on(id, 'input', () => this.updateEntryForm(true)));
    on('entry-dobra', 'change', () => this.updateEntryForm(true));
    on('entry-cobre', 'change', () => this.updateEntryForm(true));
  }
}

if (typeof module !== 'undefined') {
  module.exports = { Ledger, parseMoney, brl, entryTotal, monthDates, shiftMonth, postShifts, fixosOf };
} else {
  const app = new PagamentosApp();
  window.app = app;
  // The app starts only after the team password is accepted (auth-gate.js)
  document.addEventListener('DOMContentLoaded', () => {
    AuthGate.start(FIREBASE_CONFIG).then(() => app.init());
  });
}
