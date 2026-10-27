'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const state = {user: null, csrf: '', data: null, page: 'dashboard', query: '', category: 'all',
  stockFilter: 'all', movementFilter: 'all', showcaseCategory: 'all', chartRange: 7, rankRange: 30,
  detailId: null, photoIndex: 0, editImages: [], mobile: false};
const titles = {dashboard: '工作台', products: '商品管理', inventory: '库存总览', locations: '仓储位置',
  movements: '出入库明细', analytics: '经营分析', users: '用户与权限'};
const reasonNames = {purchase: '采购入库', return: '退货入库', sale: '销售出库', consume: '领用出库', damage: '报损出库'};
const paths = {
  box: '<path d="M21 8l-9-5-9 5v9l9 5 9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shelves: '<path d="M4 3v18M20 3v18M4 11h16M4 20h16"/><rect x="7" y="5" width="5" height="6" rx="1"/><path d="M14 7h3v4M7 15h4v5M13 14h4v6"/>',
  layers: '<path d="M12 3L2 8l10 5 10-5-10-5zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  transfer: '<path d="M4 7h16m-4-4l4 4-4 4M20 17H4m4-4l-4 4 4 4"/>',
  chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
  users: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M22 21v-2a4 4 0 00-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 010 7.75"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M16 16l5 5"/>',
  bell: '<path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12m-5-5l5 5 5-5M4 16v5h16v-5"/>',
  arrow: '<path d="M5 12h14m-5-5l5 5-5 5"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M12 4v16m-6-6l6 6 6-6"/>',
  up: '<path d="M12 20V4m-6 6l6-6 6 6"/>',
  close: '<path d="M6 6l12 12M6 18L18 6"/>',
  logout: '<path d="M9 4H4v16h5M9 12h12m-5-5l5 5-5 5"/>',
  alert: '<path d="M10 4L2 18a2 2 0 002 3h16a2 2 0 002-3L14 4a2.3 2.3 0 00-4 0zM12 9v4M12 17h.01"/>',
  check: '<path d="M5 12l4 4L19 6"/>',
  scan: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 8v8M10 8v8M14 8v8M17 8v8M2 12h20"/>',
  leaf: '<path d="M20 3C8 1 2 9 6 16s16 2 14-13zM4 21L17 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zM8 12l3 3 5-6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M8 7l4 5 4-5M8 12h8M8 16h8M12 12v7"/>',
};
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function money(cents) { return (Number(cents || 0) / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
function num(value) { return Number(value || 0).toLocaleString('zh-CN'); }
function image(product) { return product?.images?.[0] || '/static/images/shelf.svg'; }
function can(permission) { return state.user?.role === 'admin' || state.user?.permissions.includes(permission); }
function empty(message = '暂无符合条件的数据') { return `<div class="empty">${icon('box')}${esc(message)}</div>`; }
function activeProducts() { return state.data.products.filter(p => p.active); }
function productById(id) { return state.data.products.find(p => p.id === Number(id)); }
function dateOffset(day, offset) { const date = new Date(`${day}T12:00:00+08:00`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
function matches(product) { const q = state.query.trim().toLowerCase(); return (!q || `${product.name} ${product.sku} ${product.batch_no || ''} ${product.location || ''}`.toLowerCase().includes(q)) && (state.category === 'all' || product.category === state.category); }
function stockStatus(stock) {
  if (stock.days_left === null) return '<span class="badge neutral">无保质期</span>';
  if (stock.days_left < 0) return '<span class="badge danger">已过期</span>';
  if (stock.days_left <= 30) return `<span class="badge warning">${stock.days_left === 0 ? '今日到期' : `${stock.days_left} 天后到期`}</span>`;
  return '<span class="badge">正常</span>';
}
function categoryOptions() { return `<option value="all">全部分类</option>${state.data.categories.map(c => `<option value="${esc(c.name)}" ${state.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`; }
function badge(text, style = '') { return `<span class="badge ${style}">${esc(text)}</span>`; }
function button(label, action, symbol = 'plus', extra = '', classes = 'primary') { return `<button type="button" class="button ${classes}" data-action="${action}" ${extra}>${icon(symbol)}${label}</button>`; }
function stat(label, value, unit, foot, symbol, attention = false) { return `<div class="stat ${attention ? 'attention' : ''}"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon(symbol)}</span></div><div class="stat-number">${value}<small>${unit}</small></div><div class="stat-foot"><span class="dot"></span>${foot}</div></div>`; }

async function api(path, options = {}) {
  const headers = {'X-CSRF-Token': state.csrf, ...options.headers};
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, {...options, headers});
  const result = await response.json().catch(() => ({error: '服务器响应异常，请重试'}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login' && state.user) {
      state.user = null; closeModal(); render();
    }
    throw new Error(result.error || '操作失败，请稍后重试');
  }
  return result;
}
async function refresh() { state.data = await api('/api/data'); }
let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast-root').innerHTML = `<div class="toast ${error ? 'error' : ''}">${esc(message)}</div>`;
  toastTimer = setTimeout(() => { $('#toast-root').innerHTML = ''; }, 4500);
}

function renderLogin() {
  return `<main class="login-layout"><section class="login-art"><div class="brand"><span class="brand-mark">${icon('box')}</span><div><strong>青禾仓储</strong><small>QINGHE WAREHOUSE</small></div></div><div class="login-copy"><div class="eyebrow">A LITTLE ORDER. A BETTER EVERYDAY.</div><h1>每一件好物，<br>都有自己的位置。</h1><p>为校园便利店打造的轻量仓储工作台。<br>从一件商品，到一整间仓库，让日常管理井然有序。</p><div class="login-shelf"><img src="/static/images/oat.svg" alt="燕麦奶"><img src="/static/images/notebook.svg" alt="笔记本"><img src="/static/images/tea.svg" alt="茉莉绿茶"></div></div><div class="login-bottom">校园便利店仓储管理系统 &nbsp; / &nbsp; 课程设计作品</div></section><section class="login-form-area"><div class="login-form-card"><div class="eyebrow">WELCOME TO QINGHE</div><h2>欢迎回到青禾</h2><p class="subtitle">登录你的工作台，开启有条理的一天。</p><form data-form="login"><div class="form-error" role="alert"></div><label class="field">用户名<input name="username" autocomplete="username" placeholder="请输入用户名" required maxlength="30"></label><label class="field">密码<input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required maxlength="128"></label><button class="button primary wide" type="submit">登录工作台 ${icon('arrow')}</button></form><div class="demo-accounts"><p>课堂演示账号</p><div class="demo-account"><span>管理员</span><code>admin / Admin123!</code><button type="button" data-action="demo" data-role="admin">填入 ${icon('right')}</button></div><div class="demo-account"><span>仓储人员</span><code>staff / Staff123!</code><button type="button" data-action="demo" data-role="staff">填入 ${icon('right')}</button></div></div><p class="demo-hint">首次运行自动生成演示数据。管理员可在用户与权限中维护账号；登录后可通过头像修改自己的密码。</p></div></section></main>`;
}

function render() {
  if (!state.user) { $('#root').innerHTML = renderLogin(); return; }
  const riskCount = state.data.stock.filter(s => s.days_left !== null && s.days_left <= 30).length;
  const nav = [['dashboard','grid'],['products','box'],['inventory','layers'],['locations','shelves'],['movements','transfer'],['analytics','chart']];
  $('#root').innerHTML = `<div class="app-shell">${state.mobile ? '<div class="sidebar-shade" data-action="mobile-close"></div>' : ''}<aside class="sidebar ${state.mobile ? 'open' : ''}"><a class="brand" href="#dashboard" aria-label="青禾仓储首页"><span class="brand-mark">${icon('box')}</span><div><strong>青禾仓储</strong><small>QINGHE WAREHOUSE</small></div></a><div class="sidebar-section">WORKSPACE / 工作空间</div><nav class="nav" aria-label="主要导航">${nav.map(([page, symbol]) => `<button class="nav-button ${state.page === page ? 'active' : ''}" data-action="navigate" data-page="${page}">${icon(symbol)}<span>${titles[page]}</span>${page === 'inventory' && riskCount ? `<span class="nav-count">${riskCount.toString().padStart(2, '0')}</span>` : ''}</button>`).join('')}${state.user.role === 'admin' ? `<div class="sidebar-section" style="margin-top:30px">MANAGEMENT / 系统管理</div><button class="nav-button ${state.page === 'users' ? 'active' : ''}" data-action="navigate" data-page="users">${icon('users')}用户与权限</button>` : ''}</nav><div class="sidebar-bottom"><div class="workspace-note"><div class="tiny-label">A LITTLE GREEN NOTE</div><p>物有所归，<br>让管理回归简单。</p><span>${icon('leaf')} 青禾 · 校园便利店</span></div><div class="profile"><button class="avatar" data-action="password" style="border:0" aria-label="修改个人密码">${esc(state.user.display_name.slice(-2))}</button><div class="profile-info"><strong>${esc(state.user.display_name)}</strong><small>${state.user.role === 'admin' ? '系统管理员' : '仓储操作员'}</small></div><button class="icon-button" data-action="logout" aria-label="退出登录" title="退出登录">${icon('logout')}</button></div></div></aside><main class="app-main"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-toggle" data-action="mobile" aria-label="展开导航">${icon('menu')}</button><span>青禾仓储 &nbsp; /</span><strong>${titles[state.page]}</strong></div><div class="top-actions"><label class="global-search">${icon('search')}<input id="global-search" aria-label="全局搜索商品" placeholder="搜索商品名称或编码…" value="${esc(state.query)}"></label><span class="top-date">${esc(state.data.today.replaceAll('-', '.'))} &nbsp; ${['周日','周一','周二','周三','周四','周五','周六'][new Date(`${state.data.today}T12:00:00`).getDay()]}</span><button class="icon-button notification" data-action="risk" aria-label="查看库存预警" title="查看库存预警">${icon('bell')}</button></div></header><div class="page-content">${renderPage()}</div></main></div>`;
  setupCarousel();
}
function footer() { return '<footer class="app-footer"><span>青禾仓储 &nbsp; · &nbsp; 让每一份库存，都心中有数。</span><span>CAMPUS STORE MANAGEMENT &nbsp; / &nbsp; V1.0</span></footer>'; }
function renderPage() {
  const pages = {dashboard: renderDashboard, products: renderProducts, inventory: renderInventory,
    locations: renderLocations, movements: renderMovements, analytics: renderAnalytics, users: renderUsers};
  return (pages[state.page] || renderDashboard)() + footer();
}
function renderContent() { const content = $('.page-content'); if (content) { content.innerHTML = renderPage(); setupCarousel(); } }
function navigate(page) {
  if (page === 'users' && state.user.role !== 'admin') return;
  state.page = titles[page] ? page : 'dashboard'; state.query = ''; state.category = 'all'; state.mobile = false;
  history.replaceState(null, '', `#${state.page}`); render(); window.scrollTo({top: 0});
}

function chartMarkup() {
  const days = Array.from({length: state.chartRange}, (_, i) => dateOffset(state.data.today, i - state.chartRange + 1));
  const totals = days.map(day => ({day, incoming: 0, outgoing: 0}));
  for (const m of state.data.movements) {
    const index = days.indexOf(m.created_at.slice(0, 10));
    if (index >= 0) totals[index][m.direction === 'in' ? 'incoming' : 'outgoing'] += m.quantity;
  }
  const max = Math.max(4, ...totals.flatMap(t => [t.incoming, t.outgoing]));
  const ceiling = Math.ceil(max / 4) * 4;
  const gap = 580 / totals.length;
  const bar = Math.min(17, gap * 0.26);
  const lines = Array.from({length: 5}, (_, i) => `<line x1="38" y1="${175-i*37}" x2="630" y2="${175-i*37}" stroke="#edf0e7" stroke-dasharray="3 4"/><text x="26" y="${179-i*37}" text-anchor="end">${ceiling*i/4}</text>`).join('');
  const bars = totals.map((t,i) => {
    const x = 45 + gap * i + gap / 2;
    return `<rect x="${x-bar-2}" y="${175-t.incoming/ceiling*148}" width="${bar}" height="${t.incoming/ceiling*148}" rx="3" fill="#70947c"><title>${t.day} 入库 ${t.incoming}</title></rect><rect x="${x+2}" y="${175-t.outgoing/ceiling*148}" width="${bar}" height="${t.outgoing/ceiling*148}" rx="3" fill="#dce8ba"><title>${t.day} 出库 ${t.outgoing}</title></rect>${(totals.length <= 7 || i % Math.ceil(totals.length / 7) === 0) ? `<text x="${x}" y="198" text-anchor="middle">${t.day.slice(5).replace('-', '/')}</text>` : ''}`;
  }).join('');
  return `<div class="chart-container"><svg viewBox="0 0 650 213" role="img" aria-label="最近${state.chartRange}天出入库数量柱状图">${lines}${bars}</svg></div><div class="chart-footer"><span>累计入库<strong>${num(totals.reduce((n,t)=>n+t.incoming,0))} 件</strong></span><span>累计出库<strong>${num(totals.reduce((n,t)=>n+t.outgoing,0))} 件</strong></span></div>`;
}
function productTile(p) {
  return `<article class="product-tile" tabindex="0" role="button" aria-label="查看${esc(p.name)}详情" data-action="detail" data-id="${p.id}"><div class="product-image"><img src="${esc(image(p))}" alt="${esc(p.name)}" loading="lazy"><span class="image-tag">${esc(p.category)}</span><span class="stock-tag">${p.active ? `库存 ${num(p.quantity)} ${esc(p.unit)}` : '已停用'}</span></div><div class="product-info"><h3>${esc(p.name)}<span>${esc(p.unit)}</span></h3><p>${esc(p.sku)}</p><div class="product-price"><strong>¥ ${money(p.price_cents)}</strong>${icon('arrow')}</div></div></article>`;
}

function renderDashboard() {
  const d = state.data;
  const total = d.stock.reduce((n,s)=>n+s.quantity,0);
  const risk = d.stock.filter(s=>s.days_left !== null && s.days_left<=30);
  const todayMoves = d.movements.filter(m=>m.created_at.startsWith(d.today));
  const capacity = d.locations.filter(l=>l.active).reduce((n,l)=>n+l.capacity_cm3,0);
  const used = d.locations.reduce((n,l)=>n+l.used_cm3,0);
  const showcase = activeProducts().filter(p=>state.showcaseCategory==='all'||p.category===state.showcaseCategory);
  return `<section class="page-heading"><div><div class="eyebrow">YOUR WAREHOUSE, AT A GLANCE</div><h1>让每一件好物，都井然有序。</h1><p class="subtitle">${esc(state.user.display_name)}，欢迎回来。这里是校园便利店的今日仓储概况。</p></div><div class="heading-actions">${button('导出库存','export','download','','')}${can('stock.write') ? button('快速入库','inbound','plus') : ''}</div></section><section class="stats">${stat('当前库存总量', num(total), '件', `${activeProducts().length} 种在用商品 · 按批次追踪`, 'box')}${stat('临期 / 过期库存', num(risk.reduce((n,s)=>n+s.quantity,0)), '件', `${risk.length} 条库存记录需要关注`, 'clock', true)}${stat('今日出入库', num(todayMoves.length), '笔', `入库 ${todayMoves.filter(m=>m.direction==='in').length} 笔 · 出库 ${todayMoves.filter(m=>m.direction==='out').length} 笔`, 'transfer')}${stat('仓储空间使用率', capacity ? (used/capacity*100).toFixed(1) : '0', '%', `${(used/1000).toFixed(0)} / ${(capacity/1000).toFixed(0)} 升 · ${d.locations.filter(l=>l.active).length} 个位置`, 'shelves')}</section><section class="dashboard-grid"><div class="panel"><div class="panel-head"><div><h2 class="panel-title">出入库趋势</h2><p class="panel-sub">每一次流转，都有迹可循</p></div><div class="legend"><span><i></i>入库</span><span><i class="out"></i>出库</span><select class="chart-range" id="chart-range" aria-label="趋势时间范围">${[7,14,30].map(n=>`<option value="${n}" ${state.chartRange===n?'selected':''}>近 ${n} 天</option>`).join('')}</select></div></div>${chartMarkup()}</div><div class="panel"><div class="panel-head"><div><h2 class="panel-title">库存小提醒 ${badge(`${risk.length} 项`, 'warning')}</h2><p class="panel-sub">提前一步，让好物不过期</p></div><button class="icon-button" data-action="risk" aria-label="查看全部预警">${icon('arrow')}</button></div><div class="alert-list">${risk.slice(0,4).map(s=>`<div class="alert-item" data-action="detail" data-id="${s.product_id}"><img class="alert-thumb" src="${esc(image(productById(s.product_id)))}" alt=""><div class="alert-info"><strong>${esc(s.name)}</strong><p>${esc(s.location)} · ${s.days_left < 0 ? '已过期' : `${s.days_left}天后到期`}</p></div><div class="alert-number"><strong>${s.quantity} ${esc(s.unit)}</strong><p>建议优先处理</p></div></div>`).join('') || empty('库存状态良好，暂无临期商品')}</div><div class="risk-footer"><span>${icon('alert')} 到期前 30 天自动进入临期清单</span><button class="button quiet" data-action="risk" style="font-size:9px">查看清单 ${icon('right')}</button></div></div></section><section><div class="section-heading"><div><h2>货架上的小美好</h2><p>滑动浏览，找到每一件商品的位置</p></div><div class="section-actions"><div class="pills">${['all',...d.categories.map(c=>c.name)].map(c=>`<button class="pill ${state.showcaseCategory===c?'active':''}" data-action="showcase-category" data-value="${esc(c)}">${c==='all'?'全部商品':esc(c)}</button>`).join('')}</div><div class="carousel-arrows"><button data-action="slide-left" aria-label="上一组商品">${icon('left')}</button><button data-action="slide-right" aria-label="下一组商品">${icon('right')}</button></div></div></div><div class="showcase-track" aria-label="可滑动商品陈列">${showcase.map(productTile).join('') || empty('此分类暂无商品')}</div></section><section class="bottom-grid"><div class="panel"><div class="panel-head"><h2 class="panel-title">最近流转</h2><button class="button quiet small" data-action="navigate" data-page="movements">全部记录 ${icon('right')}</button></div><div class="compact-movements">${d.movements.slice(0,4).map(m=>`<div class="compact-row"><span class="direction-icon ${m.direction}">${icon(m.direction==='in'?'down':'up')}</span><p>${esc(m.name)}<small>${reasonNames[m.reason]} · ${esc(m.actor)} · ${esc(m.created_at.slice(5,16).replace('T',' '))}</small></p><strong>${m.direction==='in'?'+':'−'}${num(m.quantity)} <span style="font-size:9px">${esc(m.unit)}</span></strong></div>`).join('') || empty('暂无出入库记录')}</div></div><div class="panel"><div class="panel-head"><h2 class="panel-title">仓储空间</h2><button class="button quiet small" data-action="navigate" data-page="locations">位置管理 ${icon('right')}</button></div><div class="shelf-list">${d.locations.filter(l=>l.active).slice(0,4).map(l=>`<div class="shelf-row"><span>${esc(l.code)}</span><div class="progress"><i class="${l.used_cm3/l.capacity_cm3>.8?'high':''}" style="width:${l.used_cm3/l.capacity_cm3*100}%"></i></div><span>${Math.round(l.used_cm3/l.capacity_cm3*100)}%</span></div>`).join('') || empty('暂无仓储位置')}</div></div></section>`;
}

function searchToolbar(pills = '') {
  return `<div class="toolbar">${pills}<div class="filters"><label class="search-input">${icon('search')}<input id="page-search" placeholder="搜索名称、编码、批次…" aria-label="筛选列表" value="${esc(state.query)}"></label><select id="category-filter" aria-label="筛选商品分类">${categoryOptions()}</select></div></div>`;
}
function heading(eyebrow, title, subtitle, actions = '') { return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="heading-actions">${actions}</div></section>`; }

function renderProducts() {
  const products = state.data.products.filter(matches);
  return heading('PRODUCT COLLECTION', '每一件商品，都有迹可查。', '分类维护商品档案，包装尺寸用于计算新批次的存放空间。', state.user.role==='admin' ? button('管理分类','category','layers','','') + button('新增商品','product-new','plus') : '') +
    `<section class="panel">${searchToolbar(`<span class="panel-title">商品档案 <span class="badge neutral">${products.length} 种</span></span>`)}<div class="catalog-grid">${products.map(productTile).join('') || empty('没有找到商品，试试其他关键词')}</div><div class="table-bottom"><span>点击商品查看详情、多张照片与批次分布</span><span>商品图片支持上传 JPG / PNG / WebP</span></div></section>`;
}
function inventoryRows() {
  return state.data.stock.filter(s => matches(s) && (state.stockFilter === 'all' ||
    (state.stockFilter === 'near' && s.days_left !== null && s.days_left >= 0 && s.days_left <= 30) ||
    (state.stockFilter === 'expired' && s.days_left !== null && s.days_left < 0) ||
    (state.stockFilter === 'low' && productById(s.product_id).quantity <= productById(s.product_id).reorder_point)));
}
function renderInventory() {
  const stock = inventoryRows();
  const low = activeProducts().filter(p=>p.quantity<=p.reorder_point);
  return heading('INVENTORY & EXPIRY', '库存有数，补货有方。', '按批次追踪库存；临期默认 30 天，过期商品仅允许报损出库。', button('导出库存','export','download','','') + (can('stock.write') ? button('登记出库','outbound','up','','') + button('登记入库','inbound','plus') : '')) +
    (low.length ? `<div class="notice warning">${icon('alert')}<span>${low.length} 种商品已达到补货预警线：${low.map(p=>`${esc(p.name)}（${p.quantity}${esc(p.unit)}）`).join('、')}。零库存商品可在商品管理中直接入库。</span></div>` : '') +
    `<section class="panel">${searchToolbar(`<div class="pills">${[['all','全部库存'],['near','临期库存'],['expired','已过期'],['low','低库存']].map(([value,label])=>`<button class="pill ${state.stockFilter===value?'active':''}" data-action="stock-filter" data-value="${value}">${label}</button>`).join('')}</div>`)}<div class="table-wrap"><table><thead><tr><th>商品信息</th><th>批次 / 位置</th><th>当前库存</th><th>生产日期</th><th>到期日期</th><th>状态</th>${can('stock.write')?'<th>操作</th>':''}</tr></thead><tbody>${stock.map(s=>`<tr><td><div class="table-product"><img src="${esc(image(productById(s.product_id)))}" alt=""><div>${esc(s.name)}<span class="cell-sub">${esc(s.sku)}</span></div></div></td><td>${esc(s.batch_no)}<span class="cell-sub">${esc(s.location)} · ${esc(s.zone)}</span></td><td><strong class="number">${num(s.quantity)}</strong> ${esc(s.unit)}</td><td class="number">${s.production_date}</td><td class="number">${s.expiry_date || '—'}</td><td>${stockStatus(s)}</td>${can('stock.write')?`<td><div class="table-actions"><button data-action="outbound" data-id="${s.product_id}" data-stock="${s.id}">${s.days_left!==null&&s.days_left<0?'报损':'出库'}</button><button data-action="detail" data-id="${s.product_id}">详情</button></div></td>`:''}</tr>`).join('')}</tbody></table>${stock.length?'':empty()}</div><div class="table-bottom"><span>共 ${stock.length} 条库存记录 · ${num(stock.reduce((n,s)=>n+s.quantity,0))} 件</span><span>入库日期和操作人详见出入库流水</span></div></section>`;
}

function renderLocations() {
  return heading('A PLACE FOR EVERYTHING', '物有所归，空间有序。', '按区域与货架管理位置，容量按包装体积估算，不模拟实际三维装箱。', can('locations.write') ? button('新增仓储位置','location-new','plus') : '') +
    `<div class="notice">${icon('shelves')}<span>入库优先使用指定位置；开启自动分配后，剩余商品会分配到其他有空间的位置。已占用的位置不能停用，容量不能缩减到已使用空间以下。</span></div><section class="location-grid">${state.data.locations.map(l=>{
      const percent=l.used_cm3/l.capacity_cm3*100;
      return `<article class="location-card"><div class="loc-top"><div><h3>${esc(l.code)}</h3><p>${esc(l.zone)}</p></div>${badge(l.active?'使用中':'已停用',l.active?'':'neutral')}</div><div class="rack-visual" aria-label="空间使用率 ${Math.round(percent)}%">${Array.from({length:24},(_,i)=>`<i class="${i<Math.ceil(percent/100*24)?`filled ${percent>80?'high':''}`:''}"></i>`).join('')}</div><div class="progress"><i style="width:${percent}%" class="${percent>80?'high':''}"></i></div><div class="location-meta"><span>已用 ${(l.used_cm3/1000).toFixed(1)} L</span><strong>总计 ${num(l.capacity_cm3/1000)} L</strong></div><div class="loc-footer"><span>${num(l.quantity)} 件商品 · 剩余 ${((l.capacity_cm3-l.used_cm3)/1000).toFixed(1)} L</span>${can('locations.write')?`<button class="button quiet small" data-action="location-edit" data-id="${l.id}">维护 ${icon('right')}</button>`:''}</div></article>`;
    }).join('') || empty('暂无位置，请先添加货架')}</section>`;
}
function renderMovements() {
  const records=state.data.movements.filter(m=>matches({...m,category:productById(m.product_id).category})&&(state.movementFilter==='all'||m.direction===state.movementFilter));
  return heading('EVERY MOVE, RECORDED', '每一次流转，都有记录。', '出入库流水保留操作人、时间、批次与实际分配位置，历史记录不可直接修改。', can('stock.write') ? button('登记出库','outbound','up','','') + button('登记入库','inbound','down') : '') +
    `<section class="panel">${searchToolbar(`<div class="pills">${[['all','全部流水'],['in','入库记录'],['out','出库记录']].map(([v,l])=>`<button class="pill ${state.movementFilter===v?'active':''}" data-action="movement-filter" data-value="${v}">${l}</button>`).join('')}</div>`)}<div class="table-wrap"><table><thead><tr><th>流水单号 / 时间</th><th>商品</th><th>业务类型</th><th>数量</th><th>批次及位置</th><th>销售金额</th><th>操作人 / 备注</th></tr></thead><tbody>${records.map(m=>`<tr><td><span class="number" style="font-size:10px">${esc(m.reference)}</span><span class="cell-sub number">${esc(m.created_at.slice(0,19).replace('T',' '))}</span></td><td>${esc(m.name)}<span class="cell-sub">${esc(m.sku)}</span></td><td>${badge(reasonNames[m.reason],m.direction==='in'?'':'warning')}</td><td class="number" style="color:${m.direction==='in'?'#65875b':'#ba9866'}">${m.direction==='in'?'+':'−'}${num(m.quantity)} ${esc(m.unit)}</td><td style="max-width:220px;white-space:normal;font-size:10px;line-height:1.8">${esc(m.allocation)}</td><td class="number">${m.reason==='sale'?`¥ ${money(m.quantity*m.unit_price_cents)}`:'—'}</td><td>${esc(m.actor)}<span class="cell-sub" style="max-width:170px;white-space:normal">${esc(m.note||'—')}</span></td></tr>`).join('')}</tbody></table>${records.length?'':empty()}</div><div class="table-bottom"><span>共 ${records.length} 笔记录</span><span>数量按商品计量单位统计 · 销售金额按出库时售价计算</span></div></section>`;
}
function renderAnalytics() {
  const from=state.rankRange?dateOffset(state.data.today,1-state.rankRange):'0000-00-00';
  const movements=state.data.movements.filter(m=>m.created_at.slice(0,10)>=from);
  const ranks=state.data.products.map(p=>{
    const rows=movements.filter(m=>m.product_id===p.id);
    return {...p,count:rows.length,incoming:rows.filter(m=>m.direction==='in').reduce((n,m)=>n+m.quantity,0),outgoing:rows.filter(m=>m.direction==='out').reduce((n,m)=>n+m.quantity,0)};
  }).filter(p=>p.count).sort((a,b)=>b.count-a.count||b.outgoing-a.outgoing);
  const sales=movements.filter(m=>m.reason==='sale');
  return heading('INSIGHTS FOR A BETTER EVERYDAY', '从日常流转，看见经营节奏。', '高频商品按所选期间的出入库笔数排名，同笔数时按出库数量排序。', `<select id="rank-range" aria-label="分析时间范围" style="width:125px">${[[7,'近7天'],[30,'近30天'],[0,'全部时间']].map(([v,l])=>`<option value="${v}" ${state.rankRange===v?'selected':''}>${l}</option>`).join('')}</select>`) +
    `<section class="stats">${stat('销售出库金额',money(sales.reduce((n,m)=>n+m.quantity*m.unit_price_cents,0)),'元','按历史出库售价统计，未计成本','coin')}${stat('销售出库数量',num(sales.reduce((n,m)=>n+m.quantity,0)),'件',`${sales.length} 笔销售流水`,'up')}${stat('活跃商品',ranks.length,'种','所选期间有出入库记录的商品','box')}${stat('出入库总次数',movements.length,'笔','含采购、退货、销售、领用与报损','transfer')}</section><section class="dashboard-grid"><div class="panel"><div class="panel-head" style="padding-bottom:20px"><div><h2 class="panel-title">高频出入库商品</h2><p class="panel-sub">识别常用商品，为补货和摆放提供参考</p></div>${icon('chart')}</div>${ranks.map((p,i)=>`<div class="ranking-row"><span class="rank-number">${String(i+1).padStart(2,'0')}</span><img src="${esc(image(p))}" alt=""><div><div class="ranking-name">${esc(p.name)}</div><div class="ranking-detail">入库 ${p.incoming} ${esc(p.unit)} / 出库 ${p.outgoing} ${esc(p.unit)}</div></div><div class="ranking-value">${p.count}<small>流转次数</small></div></div>`).join('')||empty()}</div><div class="panel" style="align-self:start"><div class="sales-summary"><div><p>当前库存参考售价总额</p><strong>¥ ${money(state.data.stock.reduce((n,s)=>n+s.quantity*s.price_cents,0))}</strong></div>${icon('coin')}</div><div class="modal-body"><h3 class="panel-title">分类库存分布</h3><div class="shelf-list" style="padding:22px 0 0">${state.data.categories.map(c=>{
    const q=state.data.stock.filter(s=>s.category===c.name).reduce((n,s)=>n+s.quantity,0), total=state.data.stock.reduce((n,s)=>n+s.quantity,0)||1;
    return `<div class="shelf-row" style="grid-template-columns:65px 1fr 40px"><span>${esc(c.name)}</span><div class="progress"><i style="width:${q/total*100}%"></i></div><span>${q}件</span></div>`;
  }).join('')}</div><p class="subtitle">库存售价总额用于参考，不代表利润、成本或已实现销售收入。</p></div></div></section>`;
}
function renderUsers() {
  if(state.user.role!=='admin')return empty('当前账号无权查看此页面');
  return heading('PEOPLE & PERMISSIONS', '各司其职，协作有序。', '管理员维护商品和账号；仓储人员按授予的权限执行库存及位置操作。',button('新增账号','user-new','plus'))+
    `<div class="notice">${icon('shield')}<span>权限由后端逐次校验。停用账号后原有会话也无法继续访问；管理员不可停用自己或移除自己的管理员身份。</span></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>姓名 / 用户名</th><th>角色</th><th>操作权限</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.data.users.map(u=>`<tr><td><div class="table-product"><span class="avatar">${esc(u.display_name.slice(-2))}</span><div>${esc(u.display_name)}<span class="cell-sub">${esc(u.username)}</span></div></div></td><td>${badge(u.role==='admin'?'管理员':'仓储人员',u.role==='admin'?'':'neutral')}</td><td>${u.role==='admin'?'全部管理权限':u.permissions.map(p=>p==='stock.write'?'出入库登记':'仓储位置维护').join('、')||'只读浏览'}</td><td>${badge(u.active?'正常':'已停用',u.active?'':'danger')}</td><td><div class="table-actions"><button data-action="user-edit" data-id="${u.id}">编辑 / 重置密码</button></div></td></tr>`).join('')}</tbody></table></div><div class="table-bottom"><span>共 ${state.data.users.length} 位成员</span><span>密码使用 scrypt 哈希保存</span></div></section>`;
}

let modalOpener;
function modal(title, subtitle, body, footerMarkup='', large=false) {
  modalOpener=document.activeElement;
  $('#modal-root').innerHTML=`<div class="modal-overlay"><section class="modal ${large?'large':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><div><h2 id="modal-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="icon-button" data-action="close-modal" aria-label="关闭弹窗">${icon('close')}</button></header>${body}${footerMarkup}</section></div>`;
  document.body.style.overflow='hidden';
  setTimeout(()=>$('.modal input:not([type=checkbox]), .modal select, .modal .icon-button')?.focus(),30);
}
function closeModal(){ $('#modal-root').innerHTML=''; document.body.style.overflow=''; if(modalOpener?.isConnected)modalOpener.focus(); }
function formModal(type, title, subtitle, fields, id='', extraFooter='') {
  modal(title,subtitle,`<form data-form="${type}" data-id="${id}"><div class="modal-body"><div class="form-error" role="alert"></div>${fields}</div><footer class="modal-footer">${extraFooter}<button class="button" type="button" data-action="close-modal">取消</button><button class="button primary" type="submit">${icon('check')}保存${type==='movement'?'登记':''}</button></footer></form>`);
}
function field(label, name, value='', type='text', extra='', full=false) {
  return `<label class="field ${full?'full':''}">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}

function openDetail(id) {
  state.detailId=Number(id);state.photoIndex=0;
  const p=productById(id), stocks=state.data.stock.filter(s=>s.product_id===p.id);
  const actions=(state.user.role==='admin'?button('编辑商品','product-edit','box',`data-id="${p.id}"`,''):'')+(can('stock.write')&&p.active?button('登记出库','outbound','up',`data-id="${p.id}"`,'')+button('登记入库','inbound','plus',`data-id="${p.id}"`):'');
  modal(esc(p.name),`${esc(p.category)} / ${esc(p.sku)} / ${p.active?'在用商品':'已停用'}`,`<div class="modal-body"><div class="photo-viewer"><img id="detail-photo" src="${esc(image(p))}" alt="${esc(p.name)}商品图片"><button class="photo-control prev" data-action="photo-prev" aria-label="上一张照片">${icon('left')}</button><button class="photo-control next" data-action="photo-next" aria-label="下一张照片">${icon('right')}</button></div><div class="photo-dots">${(p.images.length?p.images:[image(p)]).map((_,i)=>`<button data-action="photo-dot" data-index="${i}" class="${i===0?'active':''}" aria-label="第${i+1}张照片"></button>`).join('')}</div><div class="detail-meta"><div><span>参考售价</span><strong>¥ ${money(p.price_cents)} / ${esc(p.unit)}</strong></div><div><span>当前库存 / 预警线</span><strong>${p.quantity} / ${p.reorder_point} ${esc(p.unit)}</strong></div><div><span>单件包装（cm）</span><strong>${p.length_cm} × ${p.width_cm} × ${p.height_cm}</strong></div></div><p class="detail-description">${esc(p.description||'暂无商品介绍')}</p><h3 class="panel-title" style="margin-bottom:13px">在库批次与存放位置</h3><div class="detail-stock">${stocks.map(s=>`<div style="padding:11px 0;border-top:1px solid #edf0e7"><strong>${esc(s.batch_no)}</strong> ${stockStatus(s)}<br>${esc(s.location)} · ${s.quantity}${esc(p.unit)} · 单件占用 ${num(s.unit_volume_cm3)} cm³<br>生产 ${s.production_date} / 到期 ${s.expiry_date||'无保质期'}</div>`).join('')||'该商品暂无库存'}</div></div>`,`<footer class="modal-footer">${actions}</footer>`,true);
  const photo=$('.photo-viewer');let touchStart=0;
  photo.addEventListener('touchstart',event=>{touchStart=event.changedTouches[0].clientX;},{passive:true});
  photo.addEventListener('touchend',event=>{const delta=event.changedTouches[0].clientX-touchStart;if(Math.abs(delta)>40)changePhoto(delta>0?-1:1);},{passive:true});
}
function changePhoto(delta,index=null){const p=productById(state.detailId),images=p.images.length?p.images:[image(p)];state.photoIndex=index===null?(state.photoIndex+delta+images.length)%images.length:index;$('#detail-photo').src=images[state.photoIndex];$$('.photo-dots button').forEach((b,i)=>b.classList.toggle('active',i===state.photoIndex));}

function openProduct(id=null) {
  const p=id?productById(id):{name:'',sku:'',category_id:state.data.categories[0]?.id,unit:'件',length_cm:10,width_cm:10,height_cm:10,price_cents:0,reorder_point:20,description:'',images:[]};
  state.editImages=[...p.images];
  const fields=`<div class="form-grid">${field('商品名称 *','name',p.name,'text','required maxlength="80"')}${field('商品编码 *','sku',p.sku,'text','required maxlength="40" pattern="[A-Za-z0-9_-]+"')}<label class="field">商品分类 *<select name="category_id" required>${state.data.categories.map(c=>`<option value="${c.id}" ${p.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>${field('计量单位 *','unit',p.unit,'text','required maxlength="10"')}${field('销售单价（元） *','price',(p.price_cents/100).toFixed(2),'number','required min="0" max="1000000" step="0.01"')}${field('库存预警线 *','reorder_point',p.reorder_point,'number','required min="0" max="1000000" step="1"')}<label class="field full">包装尺寸：长 × 宽 × 高（cm） *<div class="field-row">${['length_cm','width_cm','height_cm'].map((k,i)=>`<input name="${k}" aria-label="${['长','宽','高'][i]}" type="number" min="0.1" max="1000" step="0.1" required value="${p[k]}">`).join('')}</div><small>修改尺寸仅影响新批次，已入库批次保留原占用体积。</small></label><label class="field full">商品介绍<textarea name="description" maxlength="1000">${esc(p.description)}</textarea></label><div class="field full"><span>商品照片（最多8张）</span><div class="upload-preview" id="upload-preview"></div><input id="photo-upload" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="上传商品照片"><small>支持 JPG / PNG / WebP，单次上传不超过8MB。演示商品使用内置插画，可上传实拍照片替换。</small></div></div>`;
  formModal('product',id?'编辑商品档案':'新增商品档案','维护基础信息，批次与数量在入库时填写。',fields,id||'',id?`<button class="button ${p.active?'danger':''}" style="margin-right:auto" type="button" data-action="product-archive" data-id="${p.id}">${p.active?'停用商品':'恢复使用'}</button>`:'');
  renderUploadPreview();
}
function renderUploadPreview(){const el=$('#upload-preview');if(el)el.innerHTML=state.editImages.map((src,i)=>`<span class="preview-item"><img src="${esc(src)}" alt="商品照片${i+1}"><button type="button" data-action="remove-image" data-index="${i}" aria-label="移除第${i+1}张照片">×</button></span>`).join('');}

function openMovement(direction, id=null, stockId=null) {
  const products=activeProducts();
  if(!products.length){toast('请先添加商品',true);return;}
  const p=id?productById(id):products[0], stocks=state.data.stock.filter(s=>s.product_id===p.id), expired=stockId&&stocks.find(s=>s.id===Number(stockId))?.days_left<0;
  const scan=`<div class="scan-box"><label for="scan-sku">${icon('scan')} 输入商品编码，模拟扫码调出档案</label><div class="field-row"><input id="scan-sku" value="${esc(p.sku)}" placeholder="例如：6900000000001"><button class="button" type="button" data-action="lookup">查询</button></div></div>`;
  const product=`<div class="scan-product"><img src="${esc(image(p))}" alt=""><div><strong>${esc(p.name)}</strong><p>${esc(p.sku)} · 当前库存 ${p.quantity} ${esc(p.unit)} · 单价 ¥${money(p.price_cents)}</p></div></div>`;
  const incoming=`${field('批次号 *','batch_no',`B${state.data.today.replaceAll('-','')}`,'text','required maxlength="50" list="batch-suggestions"')}<datalist id="batch-suggestions">${state.data.lots.filter(l=>l.product_id===p.id).map(l=>`<option value="${esc(l.batch_no)}">`).join('')}</datalist>${field('生产日期 *','production_date',state.data.today,'date',`required max="${state.data.today}"`)}${field('到期日期（无保质期可留空）','expiry_date','','date',`min="${state.data.today}"`)}${field('单件占用体积（cm³） *','unit_volume_cm3',Math.ceil(p.length_cm*p.width_cm*p.height_cm),'number','required min="1" max="1000000000" step="1"')}<label class="field">首选存放位置 *<select name="location_id" required>${state.data.locations.filter(l=>l.active).map(l=>`<option value="${l.id}">${esc(l.code)} · 剩余 ${((l.capacity_cm3-l.used_cm3)/1000).toFixed(1)}L</option>`).join('')}</select></label>`;
  const outgoing=`<label class="field full">出库批次 / 位置<select name="stock_id"><option value="">自动分配：先到期先出，无保质期按生产日期排序</option>${stocks.map(s=>`<option value="${s.id}" ${Number(stockId)===s.id?'selected':''}>${esc(s.batch_no)} / ${esc(s.location)} / ${s.quantity}${esc(p.unit)}${s.days_left!==null&&s.days_left<0?'（已过期，仅可报损）':''}</option>`).join('')}</select></label>`;
  const fields=`${scan}${product}<input type="hidden" name="product_id" value="${p.id}"><input type="hidden" name="direction" value="${direction}"><div class="form-grid"><label class="field">业务类型 *<select name="reason">${(direction==='in'?[['purchase','采购入库'],['return','退货入库']]:[['sale','销售出库'],['consume','领用出库'],['damage','报损出库']]).map(([v,l])=>`<option value="${v}" ${expired&&v==='damage'?'selected':''}>${l}</option>`).join('')}</select></label>${field(`数量（${esc(p.unit)}） *`,'quantity',1,'number','required min="1" max="1000000" step="1"')}${direction==='in'?incoming:outgoing}<label class="field full">备注<textarea name="note" placeholder="可填写供货来源、领用用途等" maxlength="300"></textarea></label>${direction==='in'?'<label class="checkbox-row field full" style="flex-direction:row"><input type="checkbox" name="auto_allocate" checked>首选位置不足时，自动分配到其他有空间的位置</label>':''}</div><div class="stock-hint">${direction==='in'?'同一批次的生产日期、到期日期和单件体积须一致。空间不足会整笔取消，不会产生部分入库。':'销售和领用会排除过期商品；报损允许处理过期批次。库存不足时不会产生流水。'}</div>`;
  formModal('movement',direction==='in'?'登记商品入库':'登记商品出库','编码查询 → 选择批次 → 登记数量 → 完成流转',fields);
}

function openLocation(id=null){
  const l=id?state.data.locations.find(l=>l.id===Number(id)):{code:'',zone:'',capacity_cm3:200000};
  formModal('location',id?'维护仓储位置':'新增仓储位置','位置编号建议采用：区域-货架-层位，如 A-01-01。',`<div class="form-grid">${field('位置编号 *','code',l.code,'text','required maxlength="30"')}${field('所属区域 *','zone',l.zone,'text','required maxlength="30"')}${field('可用容积（升） *','capacity_liters',l.capacity_cm3/1000,'number','required min="0.001" max="1000000" step="0.001"',true)}${id?`<p class="subtitle" style="grid-column:1/-1">当前已用 ${(l.used_cm3/1000).toFixed(3)} 升，${l.quantity} 件商品。修改容量不会改变现有库存。</p>`:''}</div>`,id||'',id?`<button class="button ${l.active?'danger':''}" style="margin-right:auto" type="button" data-action="location-archive" data-id="${l.id}">${l.active?'停用位置':'恢复使用'}</button>`:'');
}
function openUser(id=null){
  const u=id?state.data.users.find(u=>u.id===Number(id)):{username:'',display_name:'',role:'operator',active:true,permissions:['stock.write','locations.write']};
  formModal('user',id?'编辑成员与权限':'新增团队成员','管理员拥有全部权限，仓储人员可按需分配操作权限。',`<div class="form-grid">${field('用户名 *','username',u.username,'text','required minlength="3" maxlength="30" pattern="[A-Za-z0-9_]+"')}${field('姓名 *','display_name',u.display_name,'text','required maxlength="30"')}<label class="field">角色<select name="role"><option value="operator" ${u.role==='operator'?'selected':''}>仓储人员</option><option value="admin" ${u.role==='admin'?'selected':''}>管理员</option></select></label><label class="field">账号状态<select name="active"><option value="true" ${u.active?'selected':''}>正常</option><option value="false" ${!u.active?'selected':''}>停用</option></select></label>${field(id?'重置密码（留空不修改）':'初始密码 *','password','','password',`${id?'':'required'} minlength="8" maxlength="128" autocomplete="new-password"`,true)}<div class="field full"><span>仓储人员操作权限</span><div class="checkbox-group"><label class="checkbox-row"><input name="stock.write" type="checkbox" ${u.permissions.includes('stock.write')?'checked':''}>出入库登记</label><label class="checkbox-row"><input name="locations.write" type="checkbox" ${u.permissions.includes('locations.write')?'checked':''}>新增、修改和停用仓储位置</label></div><small>两项都不勾选时，仅允许浏览和导出；商品资料、分类及账号维护始终仅限管理员。</small></div></div>`,id||'');
}

function setupCarousel(){
  const track=$('.showcase-track');if(!track)return;
  let timer;const update=()=>{const cards=$$('.product-tile',track);const middle=track.getBoundingClientRect().left+track.clientWidth/2;let nearest=null,distance=Infinity;for(const card of cards){const rect=card.getBoundingClientRect();const diff=Math.abs(rect.left+rect.width/2-middle);if(diff<distance){distance=diff;nearest=card;}}cards.forEach(c=>c.classList.toggle('focused',c===nearest));};
  track.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(update,60);},{passive:true});
  update();
}

document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action]');
  if(!target)return;
  const action=target.dataset.action,id=target.dataset.id;
  try{
    if(action==='navigate')navigate(target.dataset.page);
    else if(action==='mobile'){state.mobile=!state.mobile;render();}
    else if(action==='mobile-close'){state.mobile=false;render();}
    else if(action==='demo'){const form=$('[data-form=login]');form.username.value=target.dataset.role;form.password.value=target.dataset.role==='admin'?'Admin123!':'Staff123!';form.username.focus();}
    else if(action==='logout'){await api('/api/logout',{method:'POST'}).then(r=>state.csrf=r.csrf);state.user=null;state.data=null;state.page='dashboard';render();}
    else if(action==='close-modal')closeModal();
    else if(action==='detail')openDetail(id);
    else if(action==='photo-prev')changePhoto(-1);
    else if(action==='photo-next')changePhoto(1);
    else if(action==='photo-dot')changePhoto(0,Number(target.dataset.index));
    else if(action==='product-new')openProduct();
    else if(action==='product-edit')openProduct(id);
    else if(action==='location-new')openLocation();
    else if(action==='location-edit')openLocation(id);
    else if(action==='user-new')openUser();
    else if(action==='user-edit')openUser(id);
    else if(action==='inbound'||action==='outbound')openMovement(action==='inbound'?'in':'out',id,target.dataset.stock);
    else if(action==='lookup'){
      const result=await api(`/api/products/lookup?sku=${encodeURIComponent($('#scan-sku').value.trim())}`);
      const direction=$('[name=direction]').value;openMovement(direction,result.product.id);toast(`已调出 ${result.product.name}`);
    }
    else if(action==='risk'){state.stockFilter='near';navigate('inventory');}
    else if(action==='stock-filter'){state.stockFilter=target.dataset.value;renderContent();}
    else if(action==='movement-filter'){state.movementFilter=target.dataset.value;renderContent();}
    else if(action==='showcase-category'){state.showcaseCategory=target.dataset.value;renderContent();}
    else if(action==='slide-left'||action==='slide-right'){const track=$('.showcase-track');track?.scrollBy({left:track.clientWidth*.75*(action==='slide-left'?-1:1),behavior:'smooth'});}
    else if(action==='export'){window.location.href='/api/export/inventory.csv';toast('正在导出全部批次库存 CSV');}
    else if(action==='remove-image'){state.editImages.splice(Number(target.dataset.index),1);renderUploadPreview();}
    else if(action==='product-archive'||action==='location-archive'){
      const result=await api(`/api/${action==='product-archive'?'products':'locations'}/${id}/archive`,{method:'POST',body:{}});await refresh();closeModal();render();toast(result.message);
    }
    else if(action==='category')formModal('category','维护商品分类','已有分类：'+state.data.categories.map(c=>esc(c.name)).join('、'),field('新增分类名称 *','name','','text','required maxlength="30"'));
    else if(action==='password')formModal('password','修改个人密码','请使用至少8位的新密码。',`<div class="form-grid">${field('原密码 *','old_password','','password','required autocomplete="current-password"',true)}${field('新密码 *','new_password','','password','required minlength="8" maxlength="128" autocomplete="new-password"',true)}</div>`);
  }catch(error){const errorBox=$('.modal .form-error');if(errorBox)errorBox.textContent=error.message;else toast(error.message,true);}
});

document.addEventListener('change',async event=>{
  const target=event.target;
  if(target.id==='category-filter'){state.category=target.value;renderContent();}
  else if(target.id==='chart-range'){state.chartRange=Number(target.value);renderContent();}
  else if(target.id==='rank-range'){state.rankRange=Number(target.value);renderContent();}
  else if(target.name==='batch_no'){
    const form=target.closest('form'),lot=state.data.lots.find(s=>s.product_id===Number(form.elements.product_id.value)&&s.batch_no===target.value);
    if(lot){form.elements.production_date.value=lot.production_date;form.elements.expiry_date.value=lot.expiry_date||'';form.elements.unit_volume_cm3.value=lot.unit_volume_cm3;}
  }
  else if(target.id==='photo-upload'){
    const submit=$('.modal [type=submit]');submit.disabled=true;
    try{
      for(const file of target.files){if(state.editImages.length>=8)throw new Error('最多支持8张商品图片');if(file.size>8*1024*1024)throw new Error('单张图片不能超过8MB');const form=new FormData();form.append('file',file);const result=await api('/api/uploads',{method:'POST',body:form});state.editImages.push(result.url);renderUploadPreview();}
      toast('照片已上传，保存商品后生效');
    }catch(error){toast(error.message,true);}finally{submit.disabled=false;target.value='';}
  }
});
let searchTimer;
document.addEventListener('input',event=>{
  if(event.target.id==='page-search'){
    const value=event.target.value,pos=event.target.selectionStart;
    clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=value;renderContent();const input=$('#page-search');input?.focus();input?.setSelectionRange(pos,pos);},170);
  }
});
document.addEventListener('keydown',event=>{
  if(event.target.id==='global-search'&&event.key==='Enter'){
    const value=event.target.value;navigate('products');state.query=value;render();
  }
  if(event.target.id==='scan-sku'&&event.key==='Enter'){event.preventDefault();$('[data-action=lookup]').click();}
  if(event.target.matches('.product-tile')&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.target.click();}
  if(event.key==='Escape'){closeModal();if(state.mobile){state.mobile=false;render();}}
  if(event.key==='Tab'&&$('.modal')){
    const nodes=$$('button:not([disabled]),input:not([type=hidden]):not([disabled]),select,textarea,[tabindex="0"]',$('.modal')).filter(el=>el.getClientRects().length);
    const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});

document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-form]');if(!form)return;
  event.preventDefault();const type=form.dataset.form,id=form.dataset.id;
  const body=Object.fromEntries(new FormData(form));
  const submit=$('[type=submit]',form),errorBox=$('.form-error',form);errorBox.textContent='';submit.disabled=true;
  try{
    if(type==='login'){
      const result=await api('/api/login',{method:'POST',body});state.user=result.user;state.csrf=result.csrf;await refresh();const hash=location.hash.slice(1);state.page=titles[hash]&&!(hash==='users'&&state.user.role!=='admin')?hash:'dashboard';render();return;
    }
    let endpoint,method='POST';
    if(type==='product'){endpoint='/api/products'+(id?`/${id}`:'');method=id?'PUT':'POST';body.images=state.editImages;}
    else if(type==='movement'){endpoint='/api/movements';if(body.direction==='in')body.auto_allocate=Boolean(form.elements.auto_allocate.checked);}
    else if(type==='location'){endpoint='/api/locations'+(id?`/${id}`:'');method=id?'PUT':'POST';}
    else if(type==='user'){endpoint='/api/users'+(id?`/${id}`:'');method=id?'PUT':'POST';body.active=body.active==='true';body.permissions=['stock.write','locations.write'].filter(p=>form.elements.namedItem(p).checked);}
    else if(type==='category')endpoint='/api/categories';
    else if(type==='password')endpoint='/api/password';
    const result=await api(endpoint,{method,body});await refresh();closeModal();render();
    if(type==='movement'){
      modal(body.direction==='in'?'入库登记完成':'出库登记完成',esc(result.reference),`<div class="modal-body"><div class="success-allocation">${result.allocations.map(a=>`${esc(a.batch_no)} → ${esc(a.location)}：${a.quantity} 件`).join('<br>')}</div><p class="subtitle">库存和流水已同步更新，可在出入库明细中查询。</p></div>`,`<footer class="modal-footer"><button class="button primary" data-action="close-modal">完成 ${icon('check')}</button></footer>`);
    }else toast(result.message);
  }catch(error){errorBox.textContent=error.message;}finally{if(submit.isConnected)submit.disabled=false;}
});
window.addEventListener('hashchange',()=>{if(state.user)navigate(location.hash.slice(1));});
async function init(){try{const result=await api('/api/session');state.csrf=result.csrf;state.user=result.user;if(state.user){await refresh();const page=location.hash.slice(1);state.page=titles[page]&&!(page==='users'&&state.user.role!=='admin')?page:'dashboard';}render();}catch(error){$('#root').innerHTML=`<div class="error-screen"><h2>暂时无法连接仓库</h2><p>${esc(error.message)}</p><button class="button" onclick="location.reload()">重新加载</button></div>`;}}
init();
