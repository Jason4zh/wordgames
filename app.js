/* =====================================================================
 * app.js —— 四级词汇游乐场
 * 6 个游戏：Wordle / 字母填空 / 字母拼图 / 单词找词 / 记忆配对 / 下落消除
 * ===================================================================== */
(function () {
  'use strict';

  var WE = window.WE;

  /* =====================================================================
   * 词库：github.com/kajweb/dict 全部词书，按需加载
   * 每本书 = banks/<id>.js，写入 window.WG_WORDS（紧凑数组）+ WG_BANKID / WG_BANKNAME
   * 紧凑数组：[head, pos0, zh0, uk, us, trs, syn, ant, rel, phr, sent, mem]
   * ===================================================================== */
  var BANKS = window.WG_BANKS || [];        /* [{id,name,count,tag,size}] */
  var WIDX = window.WG_IDX || {};           /* 小写词 -> 书 id（跨词库跳转用） */
  var BANK_CACHE = {};                      /* id -> {rows, name} */
  var BANK = { id: '', name: '' };          /* 当前词库 */
  var RAW = [];                             /* 当前词库紧凑数组 */
  var D = [];                               /* 当前词库适配后的对象 */
  var CARD_STK = [];                        /* 词卡跳转栈 */
  var CUR_CARD = null;

  function adaptRow(r, bid, bname) {
    var trs = r[5] || [], p = [], z = [], en = [], i, po;
    if (bid === undefined) { bid = BANK.id; bname = BANK.name; }
    for (i = 0; i < trs.length; i++) {
      po = String(trs[i][0] || '').replace(/\.$/, '');
      if (po && p.indexOf(po) < 0) p.push(po);
      if (trs[i][1]) z.push(trs[i][1]);
      if (trs[i][2]) en.push(trs[i][2]);
    }
    return {
      w: r[0], p: p.join('&'), z: z.join('；'), en: en.join('; '),
      uk: r[3] || '', us: r[4] || '', trs: trs,
      syn: r[6] || [], ant: r[7] || [], rel: r[8] || [],
      phr: r[9] || [], sent: r[10] || [], mem: r[11] || '',
      book: bid, bookName: bname || bankNameOf(bid)
    };
  }

  function useBank(rows, id, name) {
    BANK = { id: id, name: name };
    RAW = rows || [];
    D = [];
    for (var i = 0; i < RAW.length; i++) {
      var e = adaptRow(RAW[i]);
      if (/^[a-z]{3,14}$/.test(e.w) && e.z) D.push(e);
    }
    WE.setLexicon(D.map(function (x) { return x.w; }));
    STATE.settings.bank = id;
    saveSettings();
  }

  function bankNameOf(id) {
    for (var i = 0; i < BANKS.length; i++) if (BANKS[i].id === id) return BANKS[i].name;
    return id;
  }

  function loadBank(id, cb) {
    if (!id) { cb(new Error('empty')); return; }
    if (BANK_CACHE[id]) { cb(null, BANK_CACHE[id]); return; }
    var s = document.createElement('script');
    s.src = 'banks/' + id + '.js';
    s.async = true;
    s.onload = function () {
      var pack = { rows: window.WG_WORDS || [], name: window.WG_BANKNAME || bankNameOf(id) };
      BANK_CACHE[id] = pack;
      cb(null, pack);
    };
    s.onerror = function () { cb(new Error('load ' + id)); };
    document.head.appendChild(s);
  }

  var Stage = document.getElementById('stage');
  var Sheet = document.getElementById('sheet');
  var ToastEl = document.getElementById('toast');
  var TabsEl = document.getElementById('tabs');

  /* ---------------- 存储 ---------------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };

  var STATE = {
    game: 'wordle',
    pts: 0,                                   /* 本局累计分：只用于“最佳记录”，不再是货币 */
    best: LS.get('wg:best', 0),
    streak: 0,
    learned: LS.get('wg:learned', []),
    wrong: LS.get('wg:wrong', {}),
    stars: LS.get('wg:stars', []),
    settings: Object.assign({ study: true, autoSpeak: true, onlyWrong: false, level: 'mix', light: false, wlen: 0 },
      LS.get('wg:settings', {}))
  };

  function saveSettings() { LS.set('wg:settings', STATE.settings); }
  function applyTheme() {
    var on = !!STATE.settings.light;
    document.body.classList.toggle('light', on);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', on ? '#eef3fb' : '#0a1020');
  }
  function saveWrong() { LS.set('wg:wrong', STATE.wrong); }
  function saveStars() { LS.set('wg:stars', STATE.stars); }
  /* ---------------- 计分（只记录本局得分与最佳成绩） ---------------- */
  function addScore(n) {
    STATE.pts += n;
    if (n > 0) { STATE.streak++; if (STATE.streak > STATE.best) { STATE.best = STATE.streak; LS.set('wg:best', STATE.best); } }
    syncTop();
  }
  /* ---------------- 各游戏最高成绩 ---------------- */
  var BEST = LS.get('wg:bestmap', null) || {};
  var GNAME = { wordle: '🟩 拼词', fill: '🔤 填空', ll: '🔍 找词', match: '🃏 配对', fd: '🌠 下落' };
  var ROUND = null;
  function fmtClock(ms) {
    var t = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(t / 60), ss = t % 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function roundStart() {
    if (ROUND && !ROUND.done) roundEnd();
    ROUND = { game: STATE.game, t0: Date.now(), s0: STATE.pts, done: false };
    paintBest();
  }
  function roundEnd() {
    var r = ROUND;
    if (!r || r.done) return;
    r.done = true; ROUND = null;
    var pts = STATE.pts - r.s0;
    if (pts <= 0) { paintBest(); return; }
    var ms = Date.now() - r.t0, old = BEST[r.game], fresh = false;
    if (!old || pts > old.pts || (pts === old.pts && ms < old.ms)) {
      BEST[r.game] = { pts: pts, ms: ms, at: Date.now() };
      LS.set('wg:bestmap', BEST);
      fresh = true;
    }
    paintBest();
    if (fresh) toast('🏆 ' + (GNAME[r.game] || '') + ' 新纪录 +' + pts);
  }
  function paintBest() {
    if (!GNAME[STATE.game] || !Stage) return;
    var rb = Stage.querySelector('.rowbar');
    if (!rb) return;
    var old = rb.querySelector('.bestchip');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var b = BEST[STATE.game], el = document.createElement('div');
    el.className = 'bestchip';
    el.innerHTML = b ? ('🏆最佳 <b>+' + b.pts + '</b> <i>' + fmtClock(b.ms) + '</i>') : '🏆最佳 <b>—</b>';
    rb.appendChild(el);
  }

  function markLearned(w) {
    if (STATE.learned.indexOf(w) < 0) { STATE.learned.push(w); if (STATE.learned.length > 6000) STATE.learned.shift(); LS.set('wg:learned', STATE.learned); }
  }
  function markWrong(w) { STATE.wrong[w] = (STATE.wrong[w] || 0) + 1; saveWrong(); }
  function markRight(w) { if (STATE.wrong[w]) { STATE.wrong[w]--; if (STATE.wrong[w] <= 0) delete STATE.wrong[w]; saveWrong(); } }

  /* ---------------- 小工具 ---------------- */
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return a[rnd(a.length)]; }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '"' }[c]; }); }
  function toast(msg) {
    ToastEl.textContent = msg; ToastEl.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { ToastEl.classList.remove('on'); }, 1600);
  }
  function syncTop() {
    var b = document.getElementById('chipStreak');
    if (b) { b.textContent = '🔥 ' + STATE.streak; b.className = 'chip' + (STATE.streak >= 3 ? ' hot' : ''); }
  }
  /* ---------------- 发音：有道词典音频 ---------------- */
  var YD_VOICE = 'https://dict.youdao.com/dictvoice?audio=';
  var SPEAK_AU = null;
  function speak(w) {
    w = String(w == null ? '' : w).trim();
    if (!w) return false;
    var type = STATE.settings.accent === 'uk' ? 1 : 2;   /* 1 = 英式，2 = 美式 */
    try {
      if (SPEAK_AU) { try { SPEAK_AU.pause(); } catch (e) { } SPEAK_AU = null; }
      var au = new Audio(YD_VOICE + encodeURIComponent(w) + '&type=' + type);
      SPEAK_AU = au;
      au.preload = 'auto';
      au.onerror = function () { ttsFallback(w); };
      var p = au.play();
      if (p && p.catch) p.catch(function () { ttsFallback(w); });
      return true;
    } catch (e) { return ttsFallback(w); }
  }
  /* 有道音频取不到（离线 / 被拦）时退回系统 TTS */
  function ttsFallback(w) {
    try {
      if (!window.speechSynthesis) return false;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US'; u.rate = .85;
      speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 选词池 ---------------- */
  function poolByLevel(min, max) {
    var lv = STATE.settings.level;
    var arr = D.filter(function (e) {
      var L = e.w.length;
      if (L < min || L > max) return false;
      if (lv === 'easy') return L <= 6;
      if (lv === 'mid') return L >= 6 && L <= 8;
      if (lv === 'hard') return L >= 8;
      return true;
    });
    if (STATE.settings.onlyWrong) {
      var f = arr.filter(function (e) { return STATE.wrong[e.w]; });
      if (f.length >= 8) return f;
    }
    return arr.length ? arr : D;
  }
  function similar(a, b) {
    if (a.w === b.w) return false;
    if (WE.posCodes(a)[0] !== WE.posCodes(b)[0]) return false;
    return Math.abs(a.w.length - b.w.length) <= 2;
  }
  function distractors(e, pool, n) {
    var c = pool.filter(function (x) { return similar(x, e); });
    c = shuffle(c).slice(0, n);
    if (c.length < n) {
      var more = shuffle(D.filter(function (x) { return x.w !== e.w && similar(x, e); })).slice(0, n - c.length);
      c = c.concat(more);
    }
    return c;
  }

  /* =====================================================================
   * 单词卡片
   * ===================================================================== */
  function jumpBtn(w, zh) {
    if (!w) return '';
    return '<button class="pill jump" data-act="jump" data-w="' + esc(w) + '">' + esc(w) +
      (zh ? ' <span class="zh">' + esc(zh) + '</span>' : '') + '</button>';
  }

  function cardHTML(e) {
    var senses = WE.senses(e);
    var inf = WE.inflect(e);
    var pat = WE.patterns(e);
    var fam = WE.family(e);
    var tpl = WE.templates(e);
    var tips = WE.tips(e);
    var starred = STATE.stars.indexOf(e.w) >= 0;

    var h = '<div class="wc-head"><div>';
    h += '<div class="wc-word">' + esc(e.w) + '</div>';
    h += '<div class="wc-phon">' + esc(WE.posLabel(e) || WE.posShort(e) || '—') + ' · ' + esc(e.bookName || BANK.name || '词库') + '</div></div>';
    h += '<div style="display:flex;gap:6px">';
    h += '<button class="icon" data-act="speak" data-w="' + esc(e.w) + '">🔊</button>';
    h += '<button class="icon" data-act="star" data-w="' + esc(e.w) + '">' + (starred ? '⭐' : '☆') + '</button>';
    h += '</div></div>';

    if (e.uk || e.us) {
      h += '<div class="wc-phon" style="margin-top:2px">' +
        (e.uk ? '英 /' + esc(e.uk) + '/' : '') +
        (e.uk && e.us ? '　' : '') +
        (e.us ? '美 /' + esc(e.us) + '/' : '') + '</div>';
    }

    h += '<div class="wc-gloss">' + (senses.length ? senses.map(function (s, i) {
      return '<div><span class="n">' + (i + 1) + '.</span>' + esc(s) + '</div>';
    }).join('') : '<div>（该词库没有给中文释义）</div>') + '</div>';

    if (e.en) h += '<div class="mini" style="margin-top:2px">' + esc(e.en) + '</div>';

    /* ---- 同近义词：点词条直接开另一个词的词卡 ---- */
    if (e.syn && e.syn.length) {
      h += '<div class="sec"><h4>同近义词 <em>点词条看词卡</em></h4>';
      e.syn.forEach(function (g) {
        var ws = (g[2] || []).map(function (w) { return jumpBtn(w); }).join('');
        if (!ws) return;
        h += '<div style="margin-bottom:6px">' +
          (g[0] ? '<span class="pill" style="background:transparent;border-color:#24304c">' + esc(g[0]) + '</span>' : '') +
          ws + (g[1] ? '<div class="mini" style="margin:0">' + esc(g[1]) + '</div>' : '') + '</div>';
      });
      h += '</div>';
    }

    /* ---- 反义词：只读词库原字段，仓库里没有就不显示 ---- */
    if (e.ant && e.ant.length) {
      var ants = [], seenA = {};
      e.ant.forEach(function (g) {
        (g[2] || []).forEach(function (w) { if (w && !seenA[w]) { seenA[w] = 1; ants.push(w); } });
      });
      if (ants.length) {
        h += '<div class="sec"><h4>反义词 <em>点词条看词卡</em></h4><div>' +
          ants.map(function (w) { return jumpBtn(w); }).join('') + '</div></div>';
      }
    }

    /* ---- 同根词 / 派生 ---- */
    if (e.rel && e.rel.length) {
      h += '<div class="sec"><h4>同根词 / 派生 <em>点词条看词卡</em></h4>';
      e.rel.forEach(function (g) {
        var ws = (g[1] || []).map(function (p) { return jumpBtn(p[0], p[1]); }).join('');
        if (!ws) return;
        h += '<div style="margin-bottom:6px">' +
          (g[0] ? '<span class="pill" style="background:transparent;border-color:#24304c">' + esc(g[0]) + '</span>' : '') +
          ws + '</div>';
      });
      h += '</div>';
    }

    /* ---- 短语 ---- */
    if (e.phr && e.phr.length) {
      h += '<div class="sec"><h4>常用短语 <em>词库原文</em></h4><ul>';
      e.phr.forEach(function (p) {
        h += '<li><b>' + esc(p[0]) + '</b>' + (p[1] ? '　' + esc(p[1]) : '') + '</li>';
      });
      h += '</ul></div>';
    }

    /* ---- 例句：优先用词库真实例句 ---- */
    if (e.sent && e.sent.length) {
      h += '<div class="sec"><h4>例句 <em>词库原文</em></h4>';
      e.sent.forEach(function (s) {
        h += '<p class="ex">' + esc(s[0]) + (s[1] ? '<small>' + esc(s[1]) + '</small>' : '') + '</p>';
      });
      h += '</div>';
    } else {
      h += '<div class="sec"><h4>例句 <em>结构模板，重点看搭配位置</em></h4>';
      tpl.forEach(function (s) {
        var hl = esc(s).replace(new RegExp('\\b' + e.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*', 'gi'), function (m) { return '<i>' + m + '</i>'; });
        h += '<p class="ex">' + hl + '</p>';
      });
      h += '</div>';
    }

    /* ---- 记忆法 ---- */
    if (e.mem) {
      h += '<div class="sec"><h4>记忆法</h4><div class="warnbox">' + esc(e.mem) + '</div></div>';
    }

    if (inf.length) {
      h += '<div class="sec"><h4>词形变化 <em>规则引擎生成</em></h4><div>';
      inf.forEach(function (p) { h += '<span class="pill">' + p[0] + ' <b>' + esc(p[1]) + '</b></span>'; });
      h += '</div></div>';
    }

    h += '<div class="sec"><h4>常用搭配 / 句型 <em>按词性生成</em></h4><ul>';
    pat.forEach(function (p) { h += '<li>' + esc(p) + '</li>'; });
    h += '</ul></div>';

    if (fam.length > 1) {
      h += '<div class="sec"><h4>词族 / 派生 <em>规则引擎</em></h4><div>';
      fam.forEach(function (f) {
        h += '<span class="pill">' + (f.self ? '<b>' + esc(f.w) + '</b>（原词）' : esc(f.w) + ' <span style="color:#8fa0c0">' + esc(f.note) + '</span>') + '</span>';
      });
      h += '</div></div>';
    }


    if (tips.length) {
      h += '<div class="sec"><h4>考点提示</h4><div class="warnbox">' +
        tips.map(function (t) { return esc(t); }).join('<br>') + '</div></div>';
    }

    h += '<div class="mini">数据来源：<code>github.com/kajweb/dict</code>《' + esc(e.bookName || BANK.name || '词库') +
      '》。释义、音标、同近义词、反义词、同根词、短语、例句、记忆法均为该词库原文，仓库没有的字段不显示；词形变化、搭配、考点由本地规则引擎推导。</div>';

    return h;
  }

  function openCard(e, keepStk) {
    if (!keepStk) CARD_STK = [];
    CUR_CARD = e;
    var back = '';
    if (CARD_STK.length) {
      var p = CARD_STK[CARD_STK.length - 1];
      back = '<button class="btn small" data-act="cardback" style="margin-bottom:8px">← ' + esc(p.w) + '</button>';
    }
    Sheet.innerHTML = '<div class="sheet-in" id="sheetIn">' + back + cardHTML(e) + '</div>';
    Sheet.classList.add('on');
    if (STATE.settings.autoSpeak) speak(e.w);
  }

  /* 按词打开词卡：当前词库找不到就去全库索引里找书，动态加载后打开 */
  function openWord(word) {
    word = String(word || '').trim();
    if (!word) return;
    var low = word.toLowerCase(), hit = null, i;
    for (i = 0; i < D.length; i++) if (D[i].w.toLowerCase() === low) { hit = D[i]; break; }
    if (!hit) {
      for (i = 0; i < RAW.length; i++) {
        if (String(RAW[i][0]).toLowerCase() === low) { hit = adaptRow(RAW[i]); break; }
      }
    }
    if (hit) {
      if (CUR_CARD) CARD_STK.push(CUR_CARD);
      openCard(hit, true);
      return;
    }
    var bid = WIDX[low];
    if (!bid) { toast('词库里没有 ' + word); return; }
    toast('📚 载入《' + bankNameOf(bid) + '》…');
    loadBank(bid, function (err, pack) {
      if (err) { toast('词库载入失败'); return; }
      var rows = pack.rows, f = null, j;
      for (j = 0; j < rows.length; j++) {
        if (String(rows[j][0]).toLowerCase() === low) { f = adaptRow(rows[j], bid, pack.name); break; }
      }
      if (!f) { toast('没找到 ' + word); return; }
      if (CUR_CARD) CARD_STK.push(CUR_CARD);
      openCard(f, true);
    });
  }

  function closeSheet() { Sheet.classList.remove('on'); Sheet.innerHTML = ''; CARD_STK = []; CUR_CARD = null; }


  /* =====================================================================
   * 1. Wordle
   * ===================================================================== */
  var WD = { s: null };

  function wordleLen() {
    var fixed = Math.round(Number(STATE.settings.wlen) || 0);
    if (fixed >= 4) return fixed;
    var lv = STATE.settings.level;
    if (lv === 'easy') return pick([4, 5]);
    if (lv === 'mid') return pick([6, 7]);
    if (lv === 'hard') return pick([8, 9]);
    return pick([5, 6, 7]);
  }
  function wordleNew() {
    roundStart();
    var len = wordleLen();
    var pool = D.filter(function (e) { return e.w.length === len; });
    if (STATE.settings.onlyWrong) {
      var f = pool.filter(function (e) { return STATE.wrong[e.w]; });
      if (f.length) pool = f;
    }
    var e = pick(pool);
    WD.s = { e: e, ans: e.w, len: len, rows: [], cur: '', row: 0, max: len >= 8 ? 5 : 6, over: false, animRow: -1, rev: {} };
    wordleRender();
  }
  function evalGuess(g, a) {
    var res = new Array(g.length), i, cnt = {};
    for (i = 0; i < a.length; i++) if (g[i] === a[i]) res[i] = 'ok';
    for (i = 0; i < a.length; i++) if (!res[i]) cnt[a[i]] = (cnt[a[i]] || 0) + 1;
    for (i = 0; i < g.length; i++) {
      if (res[i]) continue;
      if (cnt[g[i]] > 0) { res[i] = 'near'; cnt[g[i]]--; } else res[i] = 'no';
    }
    return res;
  }
  function keyState(letter) {
    var st = '';
    WD.s.rows.forEach(function (r) {
      r.res.forEach(function (v, i) {
        if (r.guess[i] !== letter) return;
        if (v === 'ok') st = 'ok';
        else if (v === 'near' && st !== 'ok') st = 'near';
        else if (v === 'no' && !st) st = 'no';
      });
    });
    return st;
  }
  function wordleRender() {
    var s = WD.s, e = s.e, senses = WE.senses(e);
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🟩 猜单词 Wordle</h2><div class="sub">' + s.len + ' 个字母 · 还剩 <b>' + (s.max - s.row) + '</b> 次</div></div>';
    var wlCur = Math.round(Number(STATE.settings.wlen) || 0);
    h += '<div class="seg" style="width:fit-content;max-width:100%;flex-wrap:wrap;margin:0 0 9px">';
    [0, 4, 5, 6, 7, 8].forEach(function (n) {
      h += '<button data-act="wlen" data-n="' + n + '" class="' + (wlCur === n ? 'on' : '') + '">' + (n ? n + ' 字母' : '🎲 随机') + '</button>';
    });
    h += '</div>';
    h += '<div class="clue"><div class="tip">不给中文提示，只按 <b>' + s.len + '</b> 个字母硬猜。绿=字母和位置都对，黄=有这个字母但位置不对。</div></div>';

    var revIdx = Object.keys(s.rev).map(Number).sort(function (a, b) { return a - b; });
    if (revIdx.length) {
      h += '<div class="wrev">' + revIdx.map(function (i2) { return '第 ' + (i2 + 1) + ' 个是 <b>' + s.rev[i2] + '</b>'; }).join(' · ') + '</div>';
    }
    h += '<div class="grid" id="wgrid" style="grid-template-columns:repeat(' + s.len + ',1fr);max-width:' + Math.min(s.len * 52, 340) + 'px">';
    for (var r = 0; r < s.max; r++) {
      var row = s.rows[r];
      for (var c = 0; c < s.len; c++) {
        var ch = '', cls = 'tile';
        if (row) { ch = row.guess[c]; cls += ' ' + row.res[c]; }
        else if (r === s.row && s.cur[c]) { ch = s.cur[c]; cls += ' filled'; }
        if (r === s.animRow && row) cls += ' reveal';
        var delay = (r === s.animRow && row) ? ' style="animation-delay:' + (c * 55) + 'ms"' : '';
        h += '<div class="' + cls + '"' + delay + '>' + ch + '</div>';
      }
    }
    h += '</div>';

    var rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    h += '<div class="kbd">';
    rows.forEach(function (kr, i) {
      h += '<div class="krow">';
      if (i === 2) h += '<button class="key wide" data-act="wenter">ENTER</button>';
      kr.split('').forEach(function (k) {
        h += '<button class="key ' + keyState(k) + '" data-act="wkey" data-k="' + k + '">' + k + '</button>';
      });
      if (i === 2) h += '<button class="key wide" data-act="wdel">⌫</button>';
      h += '</div>';
    });
    h += '</div>';

      if (s.over) {
        h += '<div class="result">' + (s.win ? '<span class="badge" style="color:#3ddc97">✅ 猜对了</span>' : '<span class="badge" style="color:#ff5f73">❌ 答案是 ' + esc(s.ans) + '</span>');
        h += '<div class="sub" style="width:100%">' + esc(WE.posShort(e)) + ' ' + esc(senses.slice(0, 2).join('；')) + '</div>';
        h += '<button class="btn primary" data-act="new">再来一个</button>';
      h += '<button class="btn" data-act="card" data-w="' + e.w + '">看词卡</button></div>';
      }
    h += '<div class="mini">键盘可直接输入；Enter 提交，Backspace 删字。</div>';
    h += '</div>';
    Stage.innerHTML = h; paintBest();
    s.animRow = -1;
  }
  function wordleKey(k) {
    var s = WD.s;
    if (!s || s.over || s.cur.length >= s.len) return;
    s.cur += k; wordleRender();
  }
  function wordleDel() {
    var s = WD.s;
    if (!s || s.over || !s.cur) return;
    s.cur = s.cur.slice(0, -1); wordleRender();
  }
  function wordleEnter() {
    var s = WD.s;
    if (!s || s.over || s.cur.length !== s.len) return;
    var res = evalGuess(s.cur, s.ans);
    s.rows.push({ guess: s.cur, res: res });
    s.animRow = s.row;
    s.row++;
    s.cur = '';
    if (s.cur === s.ans || s.rows[s.row - 1].guess === s.ans) {
      s.over = true; s.win = true;
      var gain = 100 + (s.max - s.row) * 20;
      addScore(gain); roundEnd(); markLearned(s.ans); markRight(s.ans);
      if (STATE.settings.autoSpeak) speak(s.ans);
      wordleRender();
      if (STATE.settings.study) setTimeout(function () { openCard(s.e); }, 420);
      return;
    }
    if (s.row >= s.max) {
      s.over = true; s.win = false;
      STATE.streak = 0; roundEnd(); markWrong(s.ans); markLearned(s.ans);
      wordleRender();
      if (STATE.settings.study) setTimeout(function () { openCard(s.e); }, 420);
      return;
    }
    wordleRender();
  }

  /* =====================================================================
   * 2. 字母填空
   * ===================================================================== */
  var FL = { s: null };

  function fillNew() {
    roundStart();
    var e = pick(poolByLevel(5, 10));
    var w = e.w, n = w.length;
    /* 首尾字母固定显示，只挖中间的字母 */
    var inner = [];
    for (var q = 1; q < n - 1; q++) inner.push(q);
    var hideN = Math.max(1, Math.min(4, Math.round(n * 0.35)));
    hideN = Math.max(0, Math.min(hideN, inner.length));
    var idx = shuffle(inner).slice(0, hideN).sort(function (a, b) { return a - b; });
    var hidden = {};
    idx.forEach(function (i) { hidden[i] = 1; });
    var need = idx.map(function (i) { return w[i]; });
    var decoyPool = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(function (c) { return w.indexOf(c) < 0; });
    var decoys = shuffle(decoyPool).slice(0, Math.max(2, hideN));
    var bank = shuffle(need.map(function (ch) { return { ch: ch, used: false }; })
      .concat(decoys.map(function (ch) { return { ch: ch, used: false }; })));

    FL.s = {
      e: e, w: w, hideN: hideN,
      slots: w.split('').map(function (ch, i) { return { ch: ch, hid: !!hidden[i], fill: null, lock: false, tile: -1 }; }),
      bank: bank, done: false, tries: 0, hints: 0
    };
    fillRender();
  }
  function fillRender() {
    var s = FL.s, e = s.e, sn = WE.senses(e);
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🔤 字母填空</h2><div class="sub">挖空 ' + s.hideN + ' 个字母</div></div>';
    h += '<div class="clue"><span class="pos">' + esc(WE.posShort(e)) + '</span><span class="zh">' + esc(sn.slice(0, 3).join('；')) + '</span>';
    h += '<div class="tip">点下面字母 bank 填进空格；点已填的空格可退回。首尾字母固定显示，只挖中间的字母。</div></div>';

    h += '<div class="slots">';
    s.slots.forEach(function (sl, i) {
      var cls = 'slot', txt = sl.ch;
      if (sl.hid) {
        if (sl.fill) { cls += ' filled'; txt = sl.fill; }
        else { cls += ' blank'; txt = '·'; }
        if (sl.lock) cls += ' ok';
        if (s.done) cls += ' ok';
      }
      h += '<button class="' + cls + '" data-act="slot" data-i="' + i + '">' + esc(txt) + '</button>';
    });
    h += '</div>';

    h += '<div class="bank">';
    s.bank.forEach(function (b, i) {
      h += '<button class="letter' + (b.used ? ' used' : '') + '" data-act="lbank" data-i="' + i + '">' + esc(b.ch) + '</button>';
    });
    h += '</div>';

    h += '<div class="hintline">' + s.w.length + ' 个字母 · 已试 ' + s.tries + ' 次 · 提示用了 ' + s.hints + ' 次</div>';

    if (!s.done) {
      h += '<div class="result"><button class="btn primary" data-act="check">检查</button>' +
        '<button class="btn ghost" data-act="new">换一个</button></div>';
    } else {
      h += '<div class="result"><span class="badge" style="color:#3ddc97">✅ 正确</span>' +
        '<span class="badge">' + (s.hints > 0 ? '本局 +0（用过提示）' : '本局 +' + (s.gain || 0)) + '</span>' +
        '<button class="btn primary" data-act="new">下一个</button>' +
        '<button class="btn" data-act="card" data-w="' + e.w + '">看词卡</button></div>';
    }
    h += '</div>';
    Stage.innerHTML = h; paintBest();
  }
  function fillClickBank(i) {
    var s = FL.s;
    if (s.done) return;
    var b = s.bank[i];
    if (!b || b.used) return;
    for (var k = 0; k < s.slots.length; k++) {
      var sl = s.slots[k];
      if (sl.hid && !sl.fill && !sl.lock) {
        sl.fill = b.ch; sl.tile = i; b.used = true;
        fillRender(); return;
      }
    }
    toast('空格已经填满啦');
  }
  function fillClickSlot(i) {
    var s = FL.s;
    if (s.done) return;
    var sl = s.slots[i];
    if (!sl.hid || sl.lock || !sl.fill) return;
    if (sl.tile >= 0) s.bank[sl.tile].used = false;
    sl.fill = null; sl.tile = -1;
    fillRender();
  }
  function fillCheck() {
    var s = FL.s, ok = true, missing = false;
    s.slots.forEach(function (sl) {
      if (sl.hid && !sl.fill) missing = true;
    });
    if (missing) { toast('还有空格没填'); return; }
    s.slots.forEach(function (sl) { if (sl.hid && sl.fill !== sl.ch) ok = false; });
    if (!ok) {
      s.tries++;
      var bad = 0;
      s.slots.forEach(function (sl) { if (sl.hid && sl.fill !== sl.ch) bad++; });
      toast(bad + ' 个字母位置不对，再想想');
      STATE.streak = 0; syncTop();
      fillRender();
      return;
    }
    s.done = true;
    var gain = Math.max(20, 70 + s.hideN * 10 - s.tries * 10 - s.hints * 20);
    if (s.hints > 0) gain = 0;   /* 本轮用过提示：不计分 */
    s.gain = gain;
    if (gain > 0) addScore(gain);
    roundEnd();
    markLearned(s.w); markRight(s.w);
    if (STATE.settings.autoSpeak) speak(s.w);
    fillRender();
    if (STATE.settings.study) setTimeout(function () { openCard(s.e); }, 380);
  }


  /* =====================================================================
   * 4. 单词找词（字母棋盘，单词可横 / 竖 / 斜 45° 任意方向）
   *    排布算法：穷举全位置 + 优先交叉共享字母 + 多次整体重排取最多词
   * ===================================================================== */
  var LL = { s: null };
  var WS_DIRS = [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]];

  function wsBuild(words, N) {
    var g = [], i, j;
    for (i = 0; i < N; i++) { g.push([]); for (j = 0; j < N; j++) g[i].push(''); }
    var placed = [];
    words.forEach(function (e) {
      var w = String(e.w).toLowerCase();
      var best = null, bestCross = -1;
      for (var d = 0; d < 8; d++) {
        var dr = WS_DIRS[d][0], dc = WS_DIRS[d][1];
        for (var r0 = 0; r0 < N; r0++) {
          for (var c0 = 0; c0 < N; c0++) {
            var r1 = r0 + dr * (w.length - 1), c1 = c0 + dc * (w.length - 1);
            if (r1 < 0 || r1 >= N || c1 < 0 || c1 >= N) continue;
            var ok = true, cross = 0;
            for (var k = 0; k < w.length; k++) {
              var ch = g[r0 + dr * k][c0 + dc * k];
              if (!ch) continue;
              if (ch !== w[k]) { ok = false; break; }
              cross++;
            }
            if (!ok) continue;
            /* 重合字母越多越省面积；同分时随机，避免布局千篇一律 */
            if (cross > bestCross || (cross === bestCross && Math.random() < 0.4)) {
              bestCross = cross;
              best = { r: r0, c: c0, dr: dr, dc: dc };
            }
          }
        }
      }
      if (!best) return;
      for (var m = 0; m < w.length; m++) g[best.r + best.dr * m][best.c + best.dc * m] = w[m];
      placed.push(e);
    });
    var bag = '';
    words.forEach(function (e) { bag += String(e.w).toLowerCase(); });
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      if (g[i][j]) continue;
      g[i][j] = (bag && Math.random() < 0.7) ? bag[rnd(bag.length)] : String.fromCharCode(97 + rnd(26));
    }
    return { g: g, placed: placed };
  }

  function wsCellsOf(g, N, w) {
    for (var d = 0; d < 8; d++) {
      var dr = WS_DIRS[d][0], dc = WS_DIRS[d][1];
      for (var r = 0; r < N; r++) {
        for (var c = 0; c < N; c++) {
          var ok = true, cells = [];
          for (var k = 0; k < w.length; k++) {
            var rr = r + dr * k, cc = c + dc * k;
            if (rr < 0 || rr >= N || cc < 0 || cc >= N) { ok = false; break; }
            if (g[rr][cc] !== w[k]) { ok = false; break; }
            cells.push(rr * N + cc);
          }
          if (ok) return cells;
        }
      }
    }
    return null;
  }
  function llNew() {
    roundStart();
    var pool = poolByLevel(3, 6);
    var cand = pool.filter(function (e) { return /^[a-z]{3,6}$/.test(e.w); });
    if (cand.length < 16) cand = D.filter(function (e) { return /^[a-z]{3,6}$/.test(e.w); });
    var words = [], seen = {}, guard = 0;
    while (words.length < 8 && guard++ < 900) {
      var e = pick(cand);
      if (!e || seen[e.w]) continue;
      seen[e.w] = 1; words.push(e);
    }
    var N = 16, best = null;
    var tries = N >= 12 ? 6 : 14;
    for (var t = 0; t < tries; t++) {
      var bd = wsBuild(shuffle(words), N);
      if (!best || bd.placed.length > best.placed.length) best = bd;
      if (best.placed.length >= 7) break;
    }
    var picked = best.placed;
    LL.s = {
      N: N, grid: best.g,
      words: picked.map(function (e) {
        return { e: e, w: String(e.w).toLowerCase(), found: false, cells: null };
      }),
      start: -1, bad: [], foundCount: 0, tries: 0, done: false, peek: [], peekW: ''
    };
    llRender();
  }

  function llRender() {
    var s = LL.s, N = s.N, i, j, idx, cls;
    var got = {};
    s.words.forEach(function (w) {
      if (w.found && w.cells) w.cells.forEach(function (c) { got[c] = 1; });
    });
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🔍 单词找词</h2><div class="sub">找到 ' + s.foundCount + '/' + s.words.length + ' · 出手 ' + s.tries + '</div></div>';
    h += '<div class="mini" style="margin:0 0 7px">棋盘里藏着这一局的四级单词，但不会提前告诉你。先点起点格再点终点格，词可横、竖、斜 45° 排列，也可能首尾反向。找对之后词才会出现在下方，点它可以看词卡。</div>';
    h += '<div class="wsgrid' + (N >= 12 ? ' ws16' : '') + '" style="grid-template-columns:repeat(' + N + ',1fr)">';
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      idx = i * N + j;
      cls = 'wscell';
      if (got[idx]) cls += ' got';
      if (s.start === idx) cls += ' sel';
      if (s.peek && s.peek.indexOf(idx) >= 0) cls += ' peek';
      if (s.bad.indexOf(idx) >= 0) cls += ' bad';
      h += '<button class="' + cls + '" data-act="ll" data-i="' + idx + '">' + esc(s.grid[i][j]) + '</button>';
    }
    h += '</div>';
    h += '<div class="wslist">';
    var shown = s.words.filter(function (w) { return w.found; });
    if (!shown.length) {
      h += '<span class="wshint">🔒 目标词不预告 · 找出第一个才会出现在这里</span>';
    } else {
      shown.forEach(function (w) {
        h += '<button class="wschip got" data-act="card" data-w="' + esc(w.e.w) + '">' + esc(w.w) + '</button>';
      });
    }
    h += '</div>';
    if (s.done) {
      h += '<div class="result"><span class="badge" style="color:#3ddc97">✅ 全部找到</span>' +
        '<button class="btn primary" data-act="new">再来一局</button></div>';
    } else {
      h += '<div class="result"><button class="btn ghost" data-act="new">换一盘</button></div>';
    }
    h += '</div>';
    Stage.innerHTML = h; paintBest();
  }

  function llClick(i) {
    var s = LL.s, N = s.N;
    if (s.done) return;
    if (s.start < 0) { s.start = i; s.bad = []; llRender(); return; }
    if (s.start === i) { s.start = -1; llRender(); return; }
    var r0 = Math.floor(s.start / N), c0 = s.start % N;
    var r1 = Math.floor(i / N), c1 = i % N;
    var dr = r1 - r0, dc = c1 - c0;
    if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) {
      toast('只能横、竖或斜 45°');
      s.start = i; llRender(); return;
    }
    var len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
    var sr = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
    var sc = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
    var cells = [], str = '';
    for (var k = 0; k < len; k++) {
      var r = r0 + sr * k, c = c0 + sc * k;
      cells.push(r * N + c);
      str += s.grid[r][c];
    }
    s.tries++;
    var rev = str.split('').reverse().join('');
    var hitW = null;
    s.words.forEach(function (w) {
      if (!w.found && (w.w === str || w.w === rev)) hitW = w;
    });
    s.start = -1;
    if (hitW) {
      hitW.found = true; hitW.cells = cells;
      s.foundCount++; s.bad = [];
      addScore(18); markLearned(hitW.e.w); markRight(hitW.e.w);
      if (s.foundCount === s.words.length) { s.done = true; addScore(60); roundEnd(); llRender(); toast('🎉 全部找到'); return; }
      llRender(); toast('✅ ' + hitW.w + ' 找到了');
      return;
    }
    s.bad = cells;
    llRender();
    toast('这条线上不是列表里的词');
    setTimeout(function () {
      if (LL.s !== s) return;
      s.bad = []; llRender();
    }, 420);
  }

/* =====================================================================
   * 5. 记忆配对
   * ===================================================================== */
  var MC = { s: null };
  function shortZh(e) {
    var s = WE.senses(e).join('；');
    return s.length > 16 ? s.slice(0, 16) + '…' : s;
  }
  var MC_RULE_KEY = 'wg:mcr';
  var MC_RULE = (function () {
    var save = LS.get(MC_RULE_KEY, null), o = { rows: 3, cols: 4 };
    if (save) {
      var r = Math.round(parseFloat(save.rows)), c = Math.round(parseFloat(save.cols));
      if (isFinite(r) && isFinite(c) && r >= 1 && r <= 6 && c >= 2 && c <= 6 && (r * c) % 2 === 0 && r * c >= 4 && r * c <= 36) {
        o.rows = r; o.cols = c;
      }
    }
    return o;
  })();
  function matchNew() {
    roundStart();
    var r = MC_RULE;
    var cells = r.rows * r.cols;
    if (cells % 2 !== 0) cells -= 1;            /* 兜底：格子总数必须是偶数 */
    var want = Math.max(1, Math.floor(cells / 2));
    var pool = poolByLevel(4, 8);
    var picked = [], seen = {}, guard = 0;
    while (picked.length < want && guard++ < 400 + want * 40) {
      var e = pick(pool);
      if (seen[e.w]) continue;
      seen[e.w] = 1; picked.push(e);
    }
    var cards = [];
    picked.forEach(function (e, k) {
      cards.push({ k: k, type: 'en', text: e.w, e: e });
      cards.push({ k: k, type: 'zh', text: shortZh(e), e: e });
    });
    var pairs = picked.length;
    MC.s = {
      cards: shuffle(cards), first: -1, lock: false, moves: 0, matched: 0,
      total: pairs * 2, pairs: pairs, rows: r.rows, cols: r.cols, done: false
    };
    matchRender();
  }
  function matchRender() {
    var s = MC.s;
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🃏 记忆配对</h2><div class="sub">配对 ' + (s.matched / 2) + '/' + s.pairs + ' · 翻牌 ' + s.moves + '</div></div>';
    h += '<div class="mini" style="margin:0 0 6px">翻开两张：英文 ↔ 中文，配对成功就留在场上。当前布局 ' + s.rows + ' 行 × ' + s.cols + ' 列（' + (s.rows * s.cols) + ' 格，' + s.pairs + ' 对）。</div>';
    h += '<div class="mgrid" style="grid-template-columns:repeat(' + s.cols + ',1fr)">';
    s.cards.forEach(function (c, i) {
      var cls = 'mcard';
      if (c.type === 'en') cls += ' en';
      if (c.done) cls += ' done open';
      else if (c.open) cls += ' open';
      h += '<button class="' + cls + '" data-act="mcard" data-i="' + i + '">' +
        '<span class="mci"><span class="mcf mcb">?</span>' +
        '<span class="mcf mcfr">' + esc(c.text) + '</span></span></button>';
    });
    h += '</div>';
    if (s.done) {
      h += '<div class="result"><span class="badge" style="color:#3ddc97">✅ 全部配对</span>' +
        '<button class="btn primary" data-act="new">再来一局</button>' +
        '<button class="btn small" data-act="mcrule">⚙️ 行列</button></div>';
    } else {
      h += '<div class="result"><button class="btn ghost" data-act="new">重开</button>' +
        '<button class="btn small" data-act="mcrule">⚙️ 行列</button></div>';
    }
    h += '</div>';
    Stage.innerHTML = h; paintBest();
  }
  /* 自定义行列：格子总数必须是偶数（一张英文 + 一张中文凑一对） */
  function matchRulesOpen() {
    var r = MC_RULE;
    var h = '<div class="sheet-in">';
    h += '<div class="rowbar"><h2>⚙️ 配对 · 自定义行列</h2><button class="icon" data-act="close">✕</button></div>';
    h += '<div class="mini">格子总数 = 行 × 列，<b>必须是偶数</b>，否则凑不成整对。可用范围：行 1~6、列 2~6，格子总数 4~36。保存后立刻按新布局开一局。</div>';
    h += '<div class="numrow"><div class="lbl">行数<small>1 ~ 6</small></div>' +
      '<input type="number" data-mck="rows" value="' + r.rows + '" step="1" inputmode="numeric"><em>行</em></div>';
    h += '<div class="numrow"><div class="lbl">列数<small>2 ~ 6</small></div>' +
      '<input type="number" data-mck="cols" value="' + r.cols + '" step="1" inputmode="numeric"><em>列</em></div>';
    h += '<div class="fdstat" style="margin-top:8px"><span>当前 <b>' + (r.rows * r.cols) + '</b> 格 · <b>' + (r.rows * r.cols / 2) + '</b> 对（' + r.rows + '×' + r.cols + '）</span></div>';
    h += '<div class="result"><button class="btn" data-act="mcdef">恢复默认</button>' +
      '<button class="btn primary" data-act="mcsave">保存并开始</button></div>';
    h += '</div>';
    Sheet.innerHTML = h;
    Sheet.classList.add('on');
  }
  function matchReadRules() {
    var ri = document.querySelector('.sheet-in input[data-mck="rows"]');
    var ci = document.querySelector('.sheet-in input[data-mck="cols"]');
    var rows = Math.round(parseFloat(ri ? ri.value : MC_RULE.rows));
    var cols = Math.round(parseFloat(ci ? ci.value : MC_RULE.cols));
    if (!isFinite(rows) || !isFinite(cols)) { toast('行、列都要填数字'); return null; }
    if (rows < 1 || rows > 6 || cols < 2 || cols > 6) { toast('行数 1~6，列数 2~6'); return null; }
    if (rows * cols < 4) { toast('格子太少，至少 4 格（2 对）'); return null; }
    if (rows * cols > 36) { toast('格子太多，最多 36 格（18 对）'); return null; }
    if ((rows * cols) % 2 !== 0) { toast('行 × 列 = ' + (rows * cols) + ' 是奇数，格子总数必须是偶数'); return null; }
    return { rows: rows, cols: cols };
  }
  function matchClick(i) {
    var s = MC.s;
    if (s.lock || s.done) return;
    var c = s.cards[i];
    if (c.done || c.open) return;
    var el = document.querySelector('.mcard[data-i="' + i + '"]');
    c.open = true;
    if (el) el.classList.add('open');   /* 先加类触发翻转动画，不立即重绘 */
    if (s.first < 0) { s.first = i; return; }
    var a = s.cards[s.first];
    s.lock = true;
    s.moves++;
    var ok = (a.k === c.k);
    setTimeout(function () {
      if (ok) {
        a.done = true; c.done = true;
        s.matched += 2; s.first = -1; s.lock = false;
        addScore(15); markLearned(c.e.w); markRight(c.e.w);
        if (s.matched === s.total) { s.done = true; addScore(60); roundEnd(); }
        matchRender();
        return;
      }
      a.open = false; c.open = false; s.first = -1; s.lock = false;
      matchRender();
    }, ok ? 430 : 760);
  }

    /* =====================================================================
   * 6. 下落消除（规则全自定义 · 计时 · 错词词卡 · 难度评估决定每题得分）
   *    · 所有数值由玩家填写：初始 ❤️、答对回心、选错/漏接扣心、
   *      下落速度、生成间隔、同屏上限、选项个数、得分基数
   *    · 顶部有计时器；答错会弹出该词词卡并暂停，看完点“继续”
   *    · 难度评估：按填写参数（并参考实际正确率）算出系数，
   *      直接乘在每题得分上 —— 填得越狠，分数越高
   * ===================================================================== */
  var FD = { s: null };
  var FD_KEYS = ['hearts', 'gain', 'wrong', 'miss', 'vmin', 'vmax', 'gap', 'max', 'opts', 'base', 'bspd', 'bheart', 'bonus'];
  var FD_DEF = { hearts: 5, gain: 1, wrong: 2, miss: 1, vmin: 8, vmax: 13, gap: 1.25, max: 4, opts: 4, base: 12, bspd: 3, bheart: 1, bonus: 1 };
  var FD_RULE = (function () {
    var save = LS.get('wg:fdr', null), r = {}, i, k, v;
    for (i = 0; i < FD_KEYS.length; i++) { k = FD_KEYS[i]; r[k] = FD_DEF[k]; }
    if (save) {
      for (i = 0; i < FD_KEYS.length; i++) {
        k = FD_KEYS[i];
        v = parseFloat(save[k]);

        if (isFinite(v)) r[k] = v;
      }
    }
    return r;
  })();

  function fdCloneRules() {
    var r = {}, i;
    for (i = 0; i < FD_KEYS.length; i++) r[FD_KEYS[i]] = FD_RULE[FD_KEYS[i]];
    return r;
  }
  function fdNum(v, lo, hi, dft) {
    v = parseFloat(v);
    if (!isFinite(v)) v = dft;
    return Math.max(lo, Math.min(hi, v));
  }
  function fdClock(ms) {
    var t = Math.floor(ms / 1000), m = Math.floor(t / 60), s2 = t % 60;
    return m + ':' + (s2 < 10 ? '0' : '') + s2;
  }
  /* 难度评估：把玩家填的规则折算成一个得分系数（默认规则 = 1.00） */
  function fdFac(s) {
    var r = FD_RULE;
    var mid = (r.vmin + r.vmax) / 2;
    var arr = [mid / 10.5, 1.25 / r.gap, r.max / 4, r.opts / 4, (r.wrong + r.miss) / 3, 5 / r.hearts, (r.bonus >= 1 ? r.bspd : 3) / 3];
    var sum = 0;
    arr.forEach(function (v) { sum += Math.max(0.5, Math.min(2, v)); });
    var f = sum / arr.length;
    if (s && s.answered >= 5) {
      var acc = s.correct / s.answered;
      if (acc >= 0.8) f *= 1.15;
      else if (acc < 0.5) f *= 0.9;
    }
    return Math.max(0.5, Math.min(2.5, Math.round(f * 100) / 100));
  }
  function fdRuleText() {
    var r = FD_RULE;
    return '❤️' + r.hearts + ' · 对+' + r.gain + ' · 错−' + r.wrong + ' · 漏−' + r.miss +
      ' · 速' + r.vmin + '~' + r.vmax + '%/s · ' + r.gap + 's/张 · 同屏' + r.max +
      ' · 选项' + r.opts + ' · 分' + r.base + (r.bonus >= 1 ? ' · ✨×' + r.bspd + ' +' + r.bheart + '❤️' : ' · ✨关');
  }

  function fdStop() {
    var s = FD.s;
    if (!s) return;
    s.running = false;
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
  }
  function fdNew() {
    fdStop();
    roundStart();
    FD.s = {
      pool: poolByLevel(3, 12), items: [], hearts: FD_RULE.hearts, sel: null, opts: [],
      uid: 1, over: false, running: true, last: 0, spawnT: 0, t: 0, paused: false,
      right: 0, answered: 0, correct: 0, combo: 0, bestCombo: 0, hist: [], pts: 0, wrongs: [], bonusHit: 0
    };
    fdRender();
    fdSpawn(); fdSpawn();
    FD.s.raf = requestAnimationFrame(fdLoop);
  }
  function fdRender() {
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🌠 下落消除</h2><div class="sub">' +
      '❤️ <b id="fdHearts">5</b> · ⏱ <b id="fdTime">0:00</b> · 答对 <b id="fdRight">0</b> · 得分 <b id="fdPts">0</b></div></div>';
    h += '<div class="mini" style="margin:0 0 6px">点中下落的卡片选中它，再在下方选出对应答案。规则数值全部可自己填。' +
      (FD_RULE.bonus >= 1 ? '<b>金色闪烁的是奖励词</b>：速度是普通词的倍数，答对额外回 ❤️，掉出也不扣心。' : '<b>奖励词已关闭</b>：想重新打开就到规则面板底部拨开关。') +
      '答错的词不会当场打断，会在本局结束后统一列出复习。难度评估按你填的参数（并参考正确率）折算系数，乘在每题得分上。</div>';
    h += '<div class="fdstat"><span>评估系数 <b id="fdFac">×1.00</b></span>' +
      '<span>每题得分 <b id="fdUnit">12</b></span>' +
      '<span>正确率 <b id="fdAcc">—</b></span>' +
      '<span>连击 <b id="fdCombo">0</b></span></div>';
    h += '<div class="fdrule"><span id="fdRuleTxt">' + esc(fdRuleText()) + '</span>' +
      '<button class="btn small" data-act="fdrule">⚙️ 自定义规则</button></div>';
    h += '<div class="fdbox" id="fdBox"></div>';
    h += '<div class="fdbank" id="fdBank"></div>';
    h += '<div class="result"><button class="btn ghost" data-act="new">重开</button></div>';
    h += '</div>';
    Stage.innerHTML = h; paintBest();
    fdHud(); fdBank();
  }
  function fdHud() {
    var s = FD.s;
    if (!s) return;
    if (s.hearts < 0) s.hearts = 0;
    var f = fdFac(s);
    var a = document.getElementById('fdHearts'); if (a) a.textContent = s.hearts;
    var b = document.getElementById('fdRight'); if (b) b.textContent = s.right;
    var g = document.getElementById('fdPts'); if (g) g.textContent = s.pts;
    var ti = document.getElementById('fdTime'); if (ti) ti.textContent = fdClock(s.t);
    var fa = document.getElementById('fdFac'); if (fa) fa.textContent = '×' + f.toFixed(2);
    var u = document.getElementById('fdUnit'); if (u) u.textContent = Math.round(FD_RULE.base * f);
    var cb = document.getElementById('fdCombo'); if (cb) cb.textContent = s.combo;
    var ac = document.getElementById('fdAcc');
    if (ac) ac.textContent = s.answered ? Math.round(s.correct / s.answered * 100) + '%' : '—';
    var rt = document.getElementById('fdRuleTxt'); if (rt) rt.textContent = fdRuleText();
  }
  function fdBank() {
    var s = FD.s, el = document.getElementById('fdBank');
    if (!el) return;
    if (!s.sel) { el.innerHTML = '<div class="fdtip">👆 先点一个下落的卡片</div>'; return; }
    var q = s.sel.type === 'en' ? s.sel.e.w : shortZh(s.sel.e);
    el.innerHTML = '<div class="fdtip">选出 <b>' + esc(q) + '</b> 的' +
      (s.sel.type === 'en' ? '中文意思' : '英文单词') + '</div>' +
      s.opts.map(function (o, k) {
        return '<button class="fdopt" data-act="fdans" data-i="' + k + '">' + esc(o.txt) + '</button>';
      }).join('');
  }
  /* 答错时的词卡 */
  function fdWrongCard(it) {
    var el = document.getElementById('fdBank');
    if (!el) return;
    var e = it.e;
    el.innerHTML = '<div class="fdwc"><div class="fdwc-h"><b>' + esc(e.w) + '</b>' +
      '<button class="icon" data-act="fdspeak" data-w="' + esc(e.w) + '">🔊</button></div>' +
      '<div class="fdwc-zh"><i>' + esc(WE.posShort(e)) + '</i> ' + esc(WE.senses(e).join('；')) + '</div>' +
      '<div class="fdwc-q">刚才问到：<b>' + esc(it.type === 'en' ? e.w : shortZh(e)) + '</b></div>' +
      '<button class="btn primary" data-act="fdresume" style="width:100%;margin-top:8px">继续</button></div>';
  }
  function fdSpawn() {
    var s = FD.s;
    if (!s || !s.running || s.over) return;
    var box = document.getElementById('fdBox');
    if (!box) return;
    var r = FD_RULE;
    if (s.items.length >= r.max) return;
    var e = pick(s.pool);
    var type = Math.random() < 0.5 ? 'en' : 'zh';
    var el = document.createElement('button');
    var lo = Math.min(r.vmin, r.vmax), hi = Math.max(r.vmin, r.vmax);
    var bonus = r.bonus >= 1 && Math.random() < 0.16;
    var it = {
      u: s.uid++, e: e, type: type, bonus: bonus,
      x: 3 + Math.random() * 52, y: -12,
      v: (lo + Math.random() * (hi - lo)) * (bonus ? r.bspd : 1),
      rot: -18 + Math.random() * 36, el: el
    };
    el.className = 'fditem ' + type + (bonus ? ' bonus' : '');
    el.setAttribute('data-act', 'fdsel');
    el.setAttribute('data-u', it.u);
    el.textContent = type === 'en' ? e.w : shortZh(e);
    el.style.left = it.x + '%';
    el.style.top = it.y + '%';
    el.style.transform = 'rotate(' + it.rot.toFixed(1) + 'deg)';
    box.appendChild(el);
    s.items.push(it);
  }
  function fdLoop(ts) {
    var s = FD.s;
    if (!s || !s.running) return;
    if (!s.last) s.last = ts;
    var dt = Math.min(80, ts - s.last) / 1000;
    s.last = ts;
    if (s.paused) { s.raf = requestAnimationFrame(fdLoop); return; }
    var box = document.getElementById('fdBox');
    if (!box) { s.raf = requestAnimationFrame(fdLoop); return; }
    s.t += dt * 1000;
    for (var i = s.items.length - 1; i >= 0; i--) {
      var it = s.items[i];
      it.y += it.v * dt;              /* v 的单位是 %/秒，按容器高度自适应 */
      if (it.y > 100) { fdLose(it); continue; }
      it.el.style.top = it.y.toFixed(2) + '%';
    }
    s.spawnT += dt;
    if (s.spawnT > FD_RULE.gap) { s.spawnT = 0; fdSpawn(); }
    var ti = document.getElementById('fdTime');
    if (ti) ti.textContent = fdClock(s.t);
    if (s.running) s.raf = requestAnimationFrame(fdLoop);
  }
  function fdDrop(it) {
    if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
    var i = FD.s.items.indexOf(it);
    if (i >= 0) FD.s.items.splice(i, 1);
  }
  function fdHurt(n) {
    var s = FD.s;
    if (!s) return;
    s.hearts -= n;
  }
  function fdLose(it) {
    var s = FD.s;
    fdDrop(it);
    if (s.sel === it) { s.sel = null; s.opts = []; }
    if (it.bonus) {
      fdHud(); fdBank();
      toast('✨ 奖励词掉出，不扣 ❤️');
      return;
    }
    fdHurt(FD_RULE.miss);
    s.answered++; s.combo = 0; s.hist.push(false);
    fdHud(); fdBank();
    if (s.hearts <= 0) { fdOver(); return; }
    toast('漏接一个，−' + FD_RULE.miss + ' ❤️');
  }
  function fdPick(u) {
    var s = FD.s;
    if (!s || s.over || s.paused) return;
    var it = null;
    s.items.forEach(function (x) { if (x.u === u) it = x; });
    if (!it) return;
    s.sel = it;
    s.items.forEach(function (x) { x.el.classList.toggle('sel', x === it); });
    fdMakeOpts(it);
  }
  function fdMakeOpts(it) {
    var s = FD.s;
    var need = Math.max(2, Math.round(FD_RULE.opts)) - 1;
    var others = [], seen = {}, guard = 0;
    seen[it.e.w] = 1;
    while (others.length < need && guard++ < 400) {
      var e2 = pick(s.pool);
      if (seen[e2.w]) continue;
      seen[e2.w] = 1; others.push(e2);
    }
    s.opts = shuffle([it.e].concat(others)).map(function (e) {
      return { e: e, txt: it.type === 'en' ? shortZh(e) : e.w, ok: e.w === it.e.w };
    });
    fdBank();
  }
  function fdAns(k) {
    var s = FD.s;
    if (!s || s.over || !s.sel || s.paused) return;
    var o = s.opts[k];
    if (!o) return;
    var it = s.sel;
    var r = FD_RULE;
    if (o.ok) {
      var hb = it.bonus ? Math.round(r.bheart) : r.gain;
      s.hearts += hb; s.right++; s.answered++; s.correct++;
      s.combo++;
      if (it.bonus) s.bonusHit++;
      if (s.combo > s.bestCombo) s.bestCombo = s.combo;
      s.hist.push(true);
      var gain = Math.round(r.base * fdFac(s) * (1 + Math.min(s.combo - 1, 5) * 0.1));
      s.pts += gain;
      addScore(gain); markLearned(it.e.w); markRight(it.e.w);
      fdDrop(it);
      s.sel = null; s.opts = [];
      fdHud(); fdBank();
      toast((it.bonus ? '✨ 奖励词 +' : '✅ 消除 +') + hb + '❤️ +' + gain + ' 分' + (s.combo > 1 ? ' · 连击 ×' + s.combo : ''));
      return;
    }
    fdHurt(r.wrong);
    s.answered++; s.combo = 0; s.hist.push(false);
    markWrong(it.e.w);
    if (s.wrongs.indexOf(it.e.w) < 0) s.wrongs.push(it.e.w);
    fdDrop(it);
    s.sel = null; s.opts = [];
    fdHud(); fdBank();
    toast('❌ 选错 −' + r.wrong + ' ❤️');
    if (s.hearts <= 0) fdOver();
  }
  function fdOver() {
    var s = FD.s;
    if (s.over) return;
    s.over = true; s.running = false; s.paused = false; roundEnd();
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
    var box = document.getElementById('fdBox');
    if (box) box.innerHTML = '<div class="fdover"><div class="fdheart">💔</div><h3>❤️ 用完了</h3>' +
      '<div class="sub">用时 ' + fdClock(s.t) + ' · 消除 ' + s.right + ' 个 · ✨奖励词 ' + s.bonusHit + ' 个 · 本局 +' + s.pts + ' 分</div>' +
      '<div class="sub">正确率 ' + (s.answered ? Math.round(s.correct / s.answered * 100) : 0) +
      '% · 最高连击 ' + s.bestCombo + ' · 评估 ×' + fdFac(s).toFixed(2) + '</div>' +
      '<button class="btn primary" data-act="new" style="margin-top:10px">再来一局</button></div>';
    var bank = document.getElementById('fdBank');
    if (bank) bank.innerHTML = fdWrongList();
  }
  /* 本局结束后才展示错词 */
  function fdWrongList() {
    var s = FD.s;
    if (!s || !s.wrongs.length) return '<div class="fdtip">🎉 这一局没有选错的词</div>';
    return '<div class="fdwrongs"><div class="dsub">本局错词 ' + s.wrongs.length + ' 个 · 点开复习</div>' +
      '<div class="dpills">' + s.wrongs.map(function (w) {
        return '<button class="pill" data-act="card" data-w="' + esc(w) + '">' + esc(w) + '</button>';
      }).join('') + '</div></div>';
  }

  /* 自定义规则面板：所有数值手填 */
  function fdRulesOpen() {
    var r = FD_RULE;
    function row(k, label, step, unit, hint) {
      return '<div class="numrow"><div class="lbl">' + label +
        (hint ? '<small>' + hint + '</small>' : '') + '</div>' +
        '<input type="number" data-k="' + k + '" value="' + r[k] + '" step="' + step + '" inputmode="decimal">' +
        (unit ? '<em>' + unit + '</em>' : '') + '</div>';
    }
    var h = '<div class="sheet-in">';
    h += '<div class="rowbar"><h2>⚙️ 下落消除 · 自定义规则</h2><button class="icon" data-act="close">✕</button></div>';
    h += '<div class="mini">所有数值都按你填的原样生效，<b>不再自动纠正</b>：0、负数、小数、超过常规范围的值都会照用（填 0 张同屏就不会掉卡，填 0 秒间隔会瞬间刷满）。难度评估会用这些数值算一个系数（默认规则 = ×1.00）。</div>';
    h += row('hearts', '初始 ❤️', '1', '颗', '开局手上几颗心');
    h += row('gain', '答对回心', '1', '颗', '普通词答对回几颗');
    h += row('wrong', '选错扣心', '1', '颗', '选错一次扣几颗');
    h += row('miss', '漏接扣心', '1', '颗', '掉出去一张扣几颗');
    h += row('vmin', '下落速度下限（慢）', '1', '%/s', '每秒下落多少屏高的百分比，越小越慢');
    h += row('vmax', '下落速度上限（快）', '1', '%/s', '单位是 %/s，跟屏幕高度无关，换手机速度不变');
    h += row('gap', '生成间隔', '0.05', '秒', '每隔几秒掉一张');
    h += row('max', '同屏上限', '1', '张', '屏幕上最多同时几张');
    h += row('opts', '选项个数', '1', '个', '每题给几个选项');
    h += row('base', '得分基数', '1', '分', '最终得分 = 基数 × 评估系数');
    h += row('bspd', '✨ 奖励词速度倍数', '0.5', '倍', '普通词速度 × 这个倍数');
    h += row('bheart', '✨ 奖励词答对回心', '1', '颗', '答对奖励词额外加几颗 ❤️，掉出不扣心');
    h += '<div class="numrow"><div class="lbl">✨ 启用奖励词<small>关掉后不再出现金色奖励词</small></div>' +
      '<div class="switch' + (r.bonus >= 1 ? ' on' : '') + '" data-act="fdbonus"></div></div>';
    h += '<div class="fdstat" style="margin-top:10px"><span>当前评估系数 <b>' + fdFac(null).toFixed(2) + '</b></span>' +
      '<span>每题预计 <b>' + Math.round(r.base * fdFac(null)) + '</b> 分</span></div>';
    h += '<div class="result"><button class="btn" data-act="fddef">恢复默认</button>' +
      '<button class="btn primary" data-act="fdsave">保存并开始</button></div>';
    h += '</div>';
    Sheet.innerHTML = h;
    Sheet.classList.add('on');
  }
  function fdReadRules() {
    var r = fdCloneRules();
    var ins = document.querySelectorAll('.sheet-in input[data-k]');
    for (var i = 0; i < ins.length; i++) {
      var k = ins[i].getAttribute('data-k');
      if (FD_KEYS.indexOf(k) < 0) continue;
      var v = parseFloat(ins[i].value);
      if (!isFinite(v)) continue;   /* 只挡“空着/不是数字”，数字一律原样保存 */
      r[k] = v;
    }
    return r;
  }

/* =====================================================================
   * 词本
   * ===================================================================== */
  var bookTab = 'wrong';
  function renderBook() {
    var keys = Object.keys(STATE.wrong).sort(function (a, b) { return STATE.wrong[b] - STATE.wrong[a]; });
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>📚 我的词本</h2><div class="sub">已学 ' + STATE.learned.length + ' · 错词 ' + keys.length + ' · 收藏 ' + STATE.stars.length + '</div></div>';
    h += '<div class="seg" style="width:fit-content;margin-bottom:8px">' +
      '<button data-act="booktab" data-t="wrong" class="' + (bookTab === 'wrong' ? 'on' : '') + '">错词本</button>' +
      '<button data-act="booktab" data-t="star" class="' + (bookTab === 'star' ? 'on' : '') + '">收藏</button>' +
      '</div>';

    var list = bookTab === 'wrong' ? keys : STATE.stars;
    if (!list.length) {
      h += '<div class="empty">' + (bookTab === 'wrong' ? '还没有错词，去玩几局吧 🎮' : '还没有收藏，词卡右上角点 ☆ 收藏') + '</div>';
    } else {
      h += '<div class="wlist">';
      list.slice(0, 60).forEach(function (w) {
        var e = D.filter(function (x) { return x.w === w; })[0];
        if (!e) e = { w: w, p: '', z: '不在当前词库，点开会自动切到它所在的那本词书' };
        var cnt = STATE.wrong[w] || 0;
        h += '<button class="witem" data-act="card" data-w="' + w + '"><span><b>' + esc(w) + '</b>' +
          '<small>' + esc(WE.posShort(e)) + ' ' + esc(WE.senses(e).slice(0, 2).join('；')) + '</small></span>' +
          (bookTab === 'wrong' && cnt ? '<span class="cnt">错 ' + cnt + '</span>' : '<span class="cnt">☆</span>') + '</button>';
      });
      h += '</div>';
    }

    h += '<div class="result" style="margin-top:14px">';
    h += '<button class="btn" data-act="practice">只练错词：' + (STATE.settings.onlyWrong ? '开' : '关') + '</button>';
    if (bookTab === 'wrong') h += '<button class="btn warn" data-act="clearwrong">清空错词本</button>';
    h += '</div>';
    h += '<div class="mini">错词次数答对一次减一，减到 0 自动移出。开启“只练错词”后，各游戏优先从错词里出题（错词 ≥ 8 个时生效）。</div>';
    h += '</div>';
    Stage.innerHTML = h; paintBest();
  }

  /* =====================================================================
   * 设置
   * ===================================================================== */
  function openSettings() {
    var st = STATE.settings;
    function sw(k, title, sub) {
      return '<div class="setrow"><div class="lbl">' + title + '<small>' + sub + '</small></div>' +
        '<div class="switch ' + (st[k] ? 'on' : '') + '" data-act="tog" data-k="' + k + '"></div></div>';
    }
    var h = '<div class="sheet-in">';
    h += '<div class="rowbar"><h2>⚙️ 设置</h2><button class="icon" data-act="close">✕</button></div>';
    h += sw('study', '答案后展开词卡', '展示释义、词形、搭配、词族、例句、考点');
    h += sw('autoSpeak', '自动发音', '有道词典音频（需联网），取不到时退回系统 TTS');
    h += '<div class="setrow"><div class="lbl">发音口音<small>有道音频：美式 / 英式</small></div>' +
      '<div class="seg">' +
      ['us:美式', 'uk:英式'].map(function (x) {
        var p = x.split(':'), cur = st.accent || 'us';
        return '<button data-act="accent" data-v="' + p[0] + '" class="' + (cur === p[0] ? 'on' : '') + '">' + p[1] + '</button>';
      }).join('') + '</div></div>';
    h += sw('light', '亮色主题', '浅色背景，白天与户外更清晰');
    h += '<div class="setrow"><div class="lbl">难度<small>影响出题词长与 Wordle 字母数</small></div>' +
      '<div class="seg">' +
      ['easy:基础', 'mid:进阶', 'hard:挑战', 'mix:混合'].map(function (x) {
        var p = x.split(':');
        return '<button data-act="level" data-v="' + p[0] + '" class="' + (st.level === p[0] ? 'on' : '') + '">' + p[1] + '</button>';
      }).join('') + '</div></div>';
    h += '<div class="setrow"><div class="lbl">只练错词<small>错词 ≥ 8 个时生效</small></div>' +
      '<div class="switch ' + (st.onlyWrong ? 'on' : '') + '" data-act="tog" data-k="onlyWrong"></div></div>';
    h += '<div class="setrow" style="display:block"><div class="lbl">最高成绩<small>每个游戏单局最高得分</small></div><div class="bestlist">' +
      ['wordle', 'fill', 'll', 'match', 'fd'].map(function (k) {
        var b = BEST[k];
        return '<div class="bestrow"><span>' + GNAME[k] + '</span><b>' + (b ? '+' + b.pts : '—') + '</b><i>' + (b ? fmtClock(b.ms) : '') + '</i></div>';
      }).join('') + '</div></div>';
    h += '<div class="setrow"><div class="lbl">当前词库<small>' + esc(BANK.name || '未选择') + ' · ' + D.length + ' 个可玩词条</small></div>' +
      '<button class="btn small" data-act="banksel">📚 换词库</button></div>';
    h += '<div class="setrow"><div class="lbl">数据<small>分数、错词、收藏都存在本机</small></div>' +
      '<button class="btn small warn" data-act="reset">重置进度</button></div>';
    h += '<div class="mini">词库来源：<code>github.com/kajweb/dict</code>，共收录该仓库全部 ' + BANKS.length + ' 本词书（合计 ' +
      BANKS.reduce(function (a, b) { return a + (+b.count || 0); }, 0) + ' 词）。释义、音标、同近义词、反义词、同根词、短语、例句、记忆法均为词库原文；' +
      '反义词只取词库原文，仓库没有就不显示；变形、搭配、考点由本地规则引擎推导，联网时补充自由词典内容。</div>';
    h += '</div>';
    Sheet.innerHTML = h;
    Sheet.classList.add('on');
  }

  /* ---------------- 词库选择 ---------------- */
  function bankOpen() {
    var h = '<div class="sheet-in"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<b style="font-size:16px">📚 选择词库</b><button class="icon" data-act="close">✕</button></div>';
    h += '<div class="mini" style="margin:0 0 10px">全部 ' + BANKS.length +
      ' 本均来自 <code>github.com/kajweb/dict</code>。切换词库会重置当前这一局的进度，已学、错词、最高成绩不受影响。</div>';
    BANKS.forEach(function (b) {
      h += '<button class="bankrow' + (b.id === BANK.id ? ' on' : '') + '" data-act="pick" data-id="' + esc(b.id) + '">' +
        '<b>' + esc(b.name) + (b.id === BANK.id ? ' ✅' : '') + '</b>' +
        '<small>' + (+b.count || 0) + ' 词 · ' + esc(b.tag || '') + ' · ' + esc(b.id) + '</small></button>';
    });
    h += '</div>';
    Sheet.innerHTML = h;
    Sheet.classList.add('on');
  }

  function pickBank(id) {
    if (!id || id === BANK.id) { closeSheet(); return; }
    closeSheet();
    Stage.innerHTML = '<div class="mini" style="padding:24px">📚 正在载入《' + esc(bankNameOf(id)) + '》…</div>';
    loadBank(id, function (err, pack) {
      if (err) { toast('词库载入失败：' + id); go(STATE.game); return; }
      useBank(pack.rows, id, pack.name);
      toast('已切换到《' + pack.name + '》');
      go(STATE.game === 'book' ? 'book' : STATE.game);
    });
  }

  /* =====================================================================
   * 单词搜索
   * ===================================================================== */
  var SIDX = window.WG_SIDX || {};   /* word(小写) -> [词库id, 释义摘要] */
  var SKEYS = null;
  var SQ = '';
  var SRES = null;                   /* { list:[], total:0 } 最近一次结果 */

  function searchKeys() {
    if (!SKEYS) SKEYS = Object.keys(SIDX);
    return SKEYS;
  }
  /* 匹配优先级：单词前缀 > 单词包含 > 中文释义包含 */
  function searchRun(q, limit) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return { list: [], total: 0 };
    var keys = searchKeys(), i, k, v;
    var pre = [], mid = [], zh = [];
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (k.indexOf(q) === 0) pre.push(k);
      else if (k.indexOf(q) > 0) mid.push(k);
      else {
        v = SIDX[k];
        if (v && v[1] && v[1].indexOf(q) >= 0) zh.push(k);
      }
    }
    pre.sort(); mid.sort();
    var all = pre.concat(mid, zh);
    return { list: all.slice(0, limit || 80), total: all.length };
  }
  function renderSearchRes() {
    var box = document.getElementById('sres');
    if (!box) return;
    var q = SQ.trim();
    if (!q) {
      box.innerHTML = '<div class="shint">输入英文单词或中文释义开始搜索<br>例如 <b>boost</b>、<b>促进</b>、<b>pre</b></div>';
      return;
    }
    var r = searchRun(q, 80);
    SRES = r;
    if (!r.total) {
      box.innerHTML = '<div class="shint">没有找到和「' + esc(q) + '」相关的词</div>';
      return;
    }
    var h = '<div class="scount">找到 ' + r.total + ' 个词' + (r.total > 80 ? '，显示前 80 个（继续输入可缩小范围）' : '') + '</div>';
    r.list.forEach(function (w) {
      var v = SIDX[w] || ['', ''];
      h += '<button class="srow" data-act="jump" data-w="' + esc(w) + '">' +
        '<b>' + esc(w) + '</b>' +
        '<small>' + esc(v[1] || '—') + '</small>' +
        '<i>' + esc(bankNameOf(v[0])) + '</i></button>';
    });
    box.innerHTML = h;
  }
  function renderSearch() {
    var n = searchKeys().length;
    var h = '<div class="panel"><h2>🔎 单词搜索</h2>';
    h += '<div class="sbar"><input id="sbox" class="sinput" type="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="输入英文或中文释义，如 boost / 促进" value="' + esc(SQ) + '"></div>';
    h += '<div class="mini" style="margin:8px 0 10px">全库 <b>' + n + '</b> 个词，覆盖 ' + BANKS.length + ' 本词书。点结果直接看词卡，跨词库也能打开。</div>';
    h += '<div id="sres"></div></div>';
    Stage.innerHTML = h;
    renderSearchRes();
  }

  /* =====================================================================
   * 路由 / 事件
   * ===================================================================== */
  var TABS = [
    { id: 'wordle', icon: '🟩', name: '拼词' },
    { id: 'fill', icon: '🔤', name: '填空' },
    { id: 'll', icon: '🔍', name: '找词' },
    { id: 'match', icon: '🃏', name: '配对' },
    { id: 'fd', icon: '🌠', name: '下落' },
    { id: 'search', icon: '🔎', name: '搜索' },
    { id: 'book', icon: '📚', name: '词本' }
  ];

  function renderTabs() {
    TabsEl.innerHTML = TABS.map(function (t) {
      return '<button class="tab ' + (STATE.game === t.id ? 'on' : '') + '" data-act="tab" data-tab="' + t.id + '"><i>' + t.icon + '</i>' + t.name + '</button>';
    }).join('');
  }
  function go(id) {
    fdStop();
    STATE.game = id;
    document.body.classList.toggle('fdmode', id === 'fd');   /* 下落页全屏 */
    renderTabs();
    if (id === 'wordle') wordleNew();
    else if (id === 'fill') fillNew();
    else if (id === 'll') llNew();
    else if (id === 'match') matchNew();
    else if (id === 'fd') fdNew();
    else if (id === 'search') renderSearch();
    else if (id === 'book') renderBook();
  }

  /* 搜索框输入：只重绘结果区，不重建输入框，避免失焦 */
  document.addEventListener('input', function (ev) {
    if (ev.target && ev.target.id === 'sbox') {
      SQ = ev.target.value;
      renderSearchRes();
    }
  });

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!t) {
      if (ev.target === Sheet) closeSheet();
      return;
    }
    var act = t.getAttribute('data-act');
    var d = t.dataset;

    switch (act) {
      case 'settings': openSettings(); break;
      case 'banksel': bankOpen(); break;
      case 'pick': pickBank(d.id); break;
      case 'jump': openWord(d.w); break;
      case 'cardback': {
        var pv = CARD_STK.pop();
        if (pv) openCard(pv, true); else closeSheet();
        break;
      }
      case 'close': closeSheet(); break;
      case 'tab': go(d.tab); break;
      case 'speak': speak(d.w); break;
      case 'accent':
        STATE.settings.accent = d.v; saveSettings(); openSettings(); break;
      case 'star': {
        var i = STATE.stars.indexOf(d.w);
        if (i >= 0) STATE.stars.splice(i, 1); else STATE.stars.push(d.w);
        saveStars();
        t.textContent = i >= 0 ? '☆' : '⭐';
        toast(i >= 0 ? '已取消收藏' : '已收藏');
        break;
      }
      case 'tog':
        STATE.settings[d.k] = !STATE.settings[d.k];
        saveSettings();
        if (d.k === 'light') applyTheme();
        if (d.k === 'onlyWrong') { closeSheet(); go(STATE.game); }
        else { t.classList.toggle('on'); }
        break;
      case 'level':
        STATE.settings.level = d.v;
        saveSettings();
        openSettings();
        break;
      case 'reset':
        STATE.pts = 0; STATE.best = 0; STATE.streak = 0; BEST = {}; LS.set('wg:bestmap', {});
        STATE.learned = []; STATE.wrong = {}; STATE.stars = [];
        LS.set('wg:best', 0); LS.set('wg:learned', []);
        try { localStorage.removeItem('wg:score'); localStorage.removeItem('wg:inv'); } catch (e) { }
        saveWrong(); saveStars(); syncTop(); closeSheet(); toast('进度已重置'); go(STATE.game);
        break;
      case 'card': openWord(d.w); break;
      case 'booktab': bookTab = d.t; renderBook(); break;
      case 'practice':
        STATE.settings.onlyWrong = !STATE.settings.onlyWrong;
        saveSettings(); renderBook(); break;
      case 'clearwrong':
        STATE.wrong = {}; saveWrong(); renderBook(); toast('错词本已清空'); break;

      /* --- wordle --- */
      case 'wkey': wordleKey(d.k); break;
      case 'wenter': wordleEnter(); break;
      case 'wdel': wordleDel(); break;
      case 'new':
        if (STATE.game === 'wordle') wordleNew();
        else if (STATE.game === 'fill') fillNew();
        else if (STATE.game === 'll') llNew();
        else if (STATE.game === 'match') matchNew();
        else if (STATE.game === 'fd') fdNew();
        break;
      /* --- fill --- */
      case 'lbank': fillClickBank(+d.i); break;
      case 'slot': fillClickSlot(+d.i); break;
      case 'check': fillCheck(); break;




      /* --- match --- */
      case 'mcard': matchClick(+d.i); break;
      case 'mcrule': matchRulesOpen(); break;
      case 'mcsave': {
        var mr = matchReadRules();
        if (!mr) break;
        MC_RULE.rows = mr.rows; MC_RULE.cols = mr.cols;
        LS.set(MC_RULE_KEY, { rows: mr.rows, cols: mr.cols });
        closeSheet(); matchNew(); toast('布局已改为 ' + mr.rows + '×' + mr.cols);
        break;
      }
      case 'mcdef':
        MC_RULE.rows = 3; MC_RULE.cols = 4;
        LS.set(MC_RULE_KEY, { rows: 3, cols: 4 });
        closeSheet(); matchNew(); toast('已恢复 3×4');
        break;
      /* --- 单词找词 --- */
      case 'll': llClick(+d.i); break;

      /* --- 下落消除 --- */
      case 'fdsel': fdPick(+d.u); break;
      case 'fdans': fdAns(+d.i); break;
      case 'fdresume':
        if (FD.s && !FD.s.over) { FD.s.paused = false; FD.s.sel = null; FD.s.opts = []; fdBank(); }
        break;
      case 'fdspeak': speak(d.w); break;
      case 'fdrule': fdRulesOpen(); break;
      case 'fdbonus':
        FD_RULE.bonus = FD_RULE.bonus >= 1 ? 0 : 1;
        LS.set('wg:fdr', FD_RULE);
        (function () {
          var sw = document.querySelector('.sheet-in .switch[data-act="fdbonus"]');
          if (sw) sw.className = 'switch' + (FD_RULE.bonus >= 1 ? ' on' : '');
        })();
        break;
      case 'fdsave':
        FD_RULE = fdReadRules();
        LS.set('wg:fdr', FD_RULE);
        closeSheet(); fdNew(); toast('规则已保存');
        break;
      case 'fddef':
        (function () {
          var r = {}, i;
          for (i = 0; i < FD_KEYS.length; i++) r[FD_KEYS[i]] = FD_DEF[FD_KEYS[i]];
          FD_RULE = r;
        })();
        LS.set('wg:fdr', FD_RULE);
        fdRulesOpen(); toast('已恢复默认');
        break;
      case 'wlen':
        STATE.settings.wlen = +d.n || 0; saveSettings(); wordleNew(); break;


    }
  });

  document.addEventListener('keydown', function (ev) {
    if (Sheet.classList.contains('on')) return;
    if (STATE.game !== 'wordle' || !WD.s) return;
    if (/^[a-zA-Z]$/.test(ev.key)) { ev.preventDefault(); wordleKey(ev.key.toLowerCase()); }
    else if (ev.key === 'Enter') { ev.preventDefault(); wordleEnter(); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); wordleDel(); }
  });

  /* ---------------- 启动：先载入词库，再进游戏 ---------------- */
  applyTheme();
  (function startApp() {
    var preferred = STATE.settings.bank;
    var ok = false, i;
    for (i = 0; i < BANKS.length; i++) if (BANKS[i].id === preferred) { ok = true; break; }
    var firstId = ok ? preferred : (BANKS[0] && BANKS[0].id) || '';

    if (!firstId) {
      Stage.innerHTML = '<div class="mini" style="padding:24px">没找到词库文件：请确认 <code>banks/meta.js</code> 与 <code>banks/&lt;id&gt;.js</code> 都在应用目录里。</div>';
      return;
    }

    Stage.innerHTML = '<div class="mini" style="padding:24px">📚 正在载入词库…</div>';
    loadBank(firstId, function (err, pack) {
      if (err) {
        Stage.innerHTML = '<div class="mini" style="padding:24px">词库载入失败：' + esc(firstId) + '</div>';
        return;
      }
      useBank(pack.rows, firstId, pack.name);
      syncTop();
      renderTabs();
      go('wordle');
    });
  })();
  // 预加载语音列表（部分 WebView 需要）
  if (window.speechSynthesis) { try { speechSynthesis.getVoices(); } catch (e) { } }
})();