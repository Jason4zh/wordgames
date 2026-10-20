/* =====================================================================
 * app.js —— 四级词汇游乐场
 * 6 个游戏：Wordle / 字母填空 / 字母拼图 / 单词找词 / 记忆配对 / 下落消除
 * ===================================================================== */
(function () {
  'use strict';

  var D = (window.WORDS || []).filter(function (e) { return /^[a-z]{3,14}$/.test(e.w); });
  var WE = window.WE;
  WE.setLexicon(D.map(function (e) { return e.w; }));
  var FILE_MODE = (location.protocol === 'file:');   /* 本地打开时禁用跨域请求，避免卡在“正在拉取…” */

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
    score: LS.get('wg:score', 0),
    best: LS.get('wg:best', 0),
    streak: 0,
    learned: LS.get('wg:learned', []),
    wrong: LS.get('wg:wrong', {}),
    stars: LS.get('wg:stars', []),
    settings: Object.assign({ study: true, autoSpeak: true, online: true, onlyWrong: false, level: 'mix', light: false },
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
  function addScore(n) {
    STATE.score += n;
    if (n > 0) { STATE.streak++; if (STATE.streak > STATE.best) { STATE.best = STATE.streak; LS.set('wg:best', STATE.best); } }
    LS.set('wg:score', STATE.score);
    syncTop();
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
    var a = document.getElementById('chipScore'), b = document.getElementById('chipStreak');
    if (a) a.textContent = '💎 ' + STATE.score;
    if (b) { b.textContent = '🔥 ' + STATE.streak; b.className = 'chip' + (STATE.streak >= 3 ? ' hot' : ''); }
  }
  function speak(w) {
    try {
      if (!window.speechSynthesis) return false;
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US'; u.rate = .85;
      var vs = speechSynthesis.getVoices() || [];
      for (var i = 0; i < vs.length; i++) { if (/en[-_]US/i.test(vs[i].lang)) { u.voice = vs[i]; break; } }
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
    h += '<div class="wc-phon">' + esc(WE.posLabel(e)) + ' · 四级词库</div></div>';
    h += '<div style="display:flex;gap:6px">';
    h += '<button class="icon" data-act="speak" data-w="' + e.w + '">🔊</button>';
    h += '<button class="icon" data-act="star" data-w="' + e.w + '">' + (starred ? '⭐' : '☆') + '</button>';
    h += '</div></div>';

    h += '<div class="wc-gloss">' + senses.map(function (s, i) {
      return '<div><span class="n">' + (i + 1) + '.</span>' + esc(s) + '</div>';
    }).join('') + '</div>';

    if (inf.length) {
      h += '<div class="sec"><h4>词形变化 <em>规则引擎生成</em></h4><div>';
      inf.forEach(function (p) { h += '<span class="pill">' + p[0] + ' <b>' + esc(p[1]) + '</b></span>'; });
      h += '</div></div>';
    }

    h += '<div class="sec"><h4>常用搭配 / 句型 <em>按词性生成</em></h4><ul>';
    pat.forEach(function (p) { h += '<li>' + esc(p) + '</li>'; });
    h += '</ul></div>';

    if (fam.length > 1) {
      h += '<div class="sec"><h4>词族 / 派生 <em>词库校验</em></h4><div>';
      fam.forEach(function (f) {
        h += '<span class="pill">' + (f.self ? '<b>' + esc(f.w) + '</b>（原词）' : esc(f.w) + ' <span style="color:#8fa0c0">' + esc(f.note) + '</span>') + '</span>';
      });
      h += '</div></div>';
    }

    h += '<div class="sec"><h4>例句 <em>结构模板，重点看搭配位置</em></h4>';
    tpl.forEach(function (s) {
      var hl = s.replace(new RegExp('\\b' + e.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*', 'gi'), function (m) { return '<i>' + m + '</i>'; });
      h += '<p class="ex">' + hl + '</p>';
    });
    h += '</div>';

    if (STATE.settings.online) {
      var hasPack = !!(window.DICT && window.DICT[e.w]);
      var tip = hasPack
        ? '📖 已从离线词典数据包 <code>dict.js</code> 载入权威数据。'
        : '🌐 打开词卡时会联网查询：音标、英文释义、真实例句、同义词，并自动翻译成中文。取不到时用上面的本地规则引擎兜底。';
      h += '<div class="sec"><h4>权威词典 <em id="dictSrc">' + (hasPack ? '离线数据包' : '联网词典') + '</em></h4><div id="onlineBox" class="mini">' + tip + '</div></div>';
    }

    if (tips.length) {
      h += '<div class="sec"><h4>高考 / 四级考点</h4><div class="warnbox">' +
        tips.map(function (t) { return esc(t); }).join('<br>') + '</div></div>';
    }

    h += '<div class="mini">释义与词性来自《大学英语四级基本词汇》词库；词形变化、搭配、词族、考点由本地规则引擎推导，例句为可套用的结构模板。' +
      (STATE.settings.online ? '联网时补充自由词典的真实例句与英文释义。' : '当前未开启联网补词。') + '</div>';

    return h;
  }

  function openCard(e) {
    Sheet.innerHTML = '<div class="sheet-in" id="sheetIn">' + cardHTML(e) + '</div>';
    Sheet.classList.add('on');
    if (STATE.settings.autoSpeak) speak(e.w);
    if (STATE.settings.online) fetchDict(e.w);
  }
  function closeSheet() { Sheet.classList.remove('on'); Sheet.innerHTML = ''; }

  /* ---------------- 在线权威词典：有道（中文释义 + 柯林斯双解）→ Wiktionary 兜底 ---------------- */
  function gv(o, k) { return (o && typeof o === 'object') ? o[k] : undefined; }

  /* 有道 jsonapi：ec=中文释义，collins=柯林斯双解，blng_sents_part=双语例句，phrs=搭配，syno=同义词 */
  function parseYoudao(j) {
    var d = { src: '有道词典 · 柯林斯双解', phon: '', defs: [], collins: [], sents: [], phrs: [], syn: [] };
    if (!j) return d;
    var simp = gv(gv(j, 'simple'), 'word');
    if (simp && simp[0]) d.phon = simp[0].ukphone || simp[0].usphone || '';

    (gv(gv(j, 'ec'), 'word') || []).forEach(function (w) {
      (w.trs || []).forEach(function (t) {
        (t.tr || []).forEach(function (tr) {
          var l = gv(tr, 'l');
          if (!l) return;
          (l.i || []).forEach(function (s) {
            s = String(s).trim();
            if (s && d.defs.indexOf(s) < 0 && d.defs.length < 6) d.defs.push(s);
          });
        });
      });
    });

    (gv(gv(j, 'collins'), 'collins_entries') || []).forEach(function (c) {
      var entries = gv(c, 'entries');
      if (!entries) return;
      (entries.entry || []).forEach(function (en) {
        (en.tran_entry || []).forEach(function (te) {
          if (d.collins.length >= 3) return;
          var pos = gv(gv(te, 'pos_entry'), 'pos') || '';
          var sent = (gv(gv(te, 'exam_sents'), 'sent') || [])[0] || {};
          var e = String(sent.eng_sent || '').trim(), z = String(sent.chn_sent || '').trim();
          var tran = String(te.tran || '').replace(/<[^>]+>/g, '').trim();
          if (e) d.collins.push({ en: e, zh: z, pos: pos, def: tran });
        });
      });
    });

    (gv(gv(j, 'blng_sents_part'), 'sentence-pair') || []).forEach(function (p) {
      if (d.sents.length >= 3) return;
      var en = String(p.sentence || '').trim(), zh = String(p['sentence-translation'] || '').trim();
      if (en) d.sents.push({ en: en, zh: zh, src: p.source || '' });
    });

    (gv(gv(j, 'phrs'), 'phrs') || []).forEach(function (p) {
      var phr = gv(p, 'phr') || {};
      var head = gv(gv(gv(phr, 'headword'), 'l'), 'i') || '';
      var tr = '';
      (phr.trs || []).forEach(function (t) {
        var i = gv(gv(gv(t, 'tr'), 'l'), 'i');
        if (i) tr = tr ? tr + '；' + i : i;
      });
      if (head && tr && d.phrs.length < 5) d.phrs.push(head + ' — ' + tr);
    });

    (gv(gv(j, 'syno'), 'synos') || []).forEach(function (s) {
      var s2 = gv(s, 'syno') || {};
      var ws = (s2.ws || []).map(function (x) { return x.w; }).filter(Boolean);
      if (ws.length && d.syn.length < 3) {
        d.syn.push(((s2.pos || '') + ' ' + (s2.tran || '')).trim() + '：' + ws.slice(0, 5).join(', '));
      }
    });
    return d;
  }

  function parseDictApi(j) {
    var d = { src: 'Wiktionary · 自由词典', phon: '', zh: '', defs: [], collins: [], sents: [], phrs: [], syn: [] };
    (Array.isArray(j) ? j : []).slice(0, 2).forEach(function (e) {
      if (!d.phon && e.phonetic) d.phon = e.phonetic;
      if (!d.phon && e.phonetics) {
        for (var k = 0; k < e.phonetics.length; k++) {
          if (e.phonetics[k] && e.phonetics[k].text) { d.phon = e.phonetics[k].text; break; }
        }
      }
      (e.meanings || []).forEach(function (m) {
        var pos = m.partOfSpeech || '';
        (m.definitions || []).forEach(function (df) {
          if (df.definition && d.defs.length < 5) d.defs.push((pos ? pos + '. ' : '') + df.definition);
          if (df.example && d.sents.length < 4) d.sents.push({ en: df.example, zh: '' });
        });
        (m.synonyms || []).forEach(function (s) {
          if (s && d.syn.length < 8 && d.syn.indexOf(s) < 0) d.syn.push(s);
        });
      });
    });
    return d;
  }

  function renderDict(w, d) {
    var h = '';
    if (d.phon) h += '<div class="dphon">/' + esc(String(d.phon).replace(/^\/+|\/+$/g, '')) + '/</div>';
    if (d.zh) h += '<div class="dzh">' + esc(d.zh) + '</div>';
    if (d.defs.length) {
      h += '<div class="dsub">权威释义</div><ol class="dlist">';
      d.defs.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
      h += '</ol>';
    }
    if (d.collins.length) {
      h += '<div class="dsub">柯林斯双解例句</div>';
      d.collins.forEach(function (c) {
        h += '<p class="ex">' + esc(c.en) + (c.zh ? '<small>' + esc(c.zh) + '</small>' : '') + '</p>';
      });
    }
    if (d.sents.length) {
      var hasZh = d.sents.some(function (s) { return s.zh; });
      h += '<div class="dsub">' + (d.collins.length ? '更多双语例句' : (hasZh ? '双语例句' : '英文例句')) + '</div>';
      d.sents.forEach(function (s) {
        h += '<p class="ex">' + esc(s.en) + (s.zh ? '<small>' + esc(s.zh) + '</small>' : '') + '</p>';
      });
    }
    if (d.phrs.length) {
      h += '<div class="dsub">固定搭配</div><div class="dpills">';
      d.phrs.forEach(function (p) { h += '<span class="pill">' + esc(p) + '</span>'; });
      h += '</div>';
    }
    if (d.syn.length) {
      h += '<div class="dsub">同义词</div><div class="dpills">';
      d.syn.forEach(function (p) { h += '<span class="pill">' + esc(p) + '</span>'; });
      h += '</div>';
    }
    if (!h) return '';
    return h + '<div class="dsrc">来源：' + esc(d.src) + '</div>';
  }

  /* 调试/自检入口：可在控制台用 WG_DICT.parseYoudao(原始 JSON) 检查解析结果 */
  window.WG_DICT = { parseYoudao: parseYoudao, parseDictApi: parseDictApi, renderDict: renderDict };

  /* 有道 jsonapi 不带 CORS 头，浏览器（含 file://）会直接拒绝。
   * 若你有可用的 CORS 代理（能转发并回 Access-Control-Allow-Origin），
   * 在 index.html 里写 window.WG_PROXY='https://你的代理/?url=' 即可启用有道层。 */
  var PROXY = window.WG_PROXY || '';

  var DICT_API = [
    { label: '有道词典 · 柯林斯双解',
      url: function (w) {
        if (!PROXY) return null;
        return PROXY + encodeURIComponent('https://dict.youdao.com/jsonapi?q=' + w);
      },
      parse: parseYoudao },
    { label: 'Wiktionary · 自由词典',
      url: function (w) { return 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w); },
      parse: parseDictApi }
  ];

  function setDictSrc(t) {
    var e = document.getElementById('dictSrc');
    if (e && t) e.textContent = t;
  }

  /* 中文释义：mymemory 翻译接口带 ACAO:*，file:// 下也能取到 */
  function fetchZh(w, ms) {
    return new Promise(function (res) {
      if (!window.fetch) { res(''); return; }
      var ctrl = window.AbortController ? new AbortController() : null;
      var done = false;
      var timer = setTimeout(function () { done = true; if (ctrl) ctrl.abort(); res(''); }, ms || 4000);
      fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(w) + '&langpair=' + encodeURIComponent('en|zh-CN'), ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (done) return;
          done = true; clearTimeout(timer);
          var t = String((j && j.responseData && j.responseData.translatedText) || '').trim();
          if (!t || /^[A-Za-z\s.,'"()\-]+$/.test(t)) t = '';   /* 没翻成中文就当失败 */
          res(t.slice(0, 200));
        })
        .catch(function () { if (done) return; done = true; clearTimeout(timer); res(''); });
    });
  }

  /* 若用户放了 dict.js（window.DICT），优先用离线权威数据包 */
  function dictFromPack(w) {
    var pack = window.DICT && window.DICT[w];
    if (!pack) return null;
    return {
      src: pack.src || '离线词典数据包', phon: pack.phon || '', zh: pack.zh || '',
      defs: pack.defs || [], collins: pack.collins || [],
      sents: pack.sents || [], phrs: pack.phrs || [], syn: pack.syn || []
    };
  }

  function fetchDict(w) {
    var box = document.getElementById('onlineBox');
    if (!box) return;

    var local = dictFromPack(w);
    if (local) { box.innerHTML = renderDict(w, local); setDictSrc('离线数据包'); return; }

    var cacheKey = 'wg:d6:' + w;
    var cached = LS.get(cacheKey, null);
    if (cached) {
      try {
        var c = JSON.parse(cached);
        if (c && c.html) { box.innerHTML = c.html; setDictSrc(c.src); return; }
      } catch (e) { }
    }

    box.innerHTML = '🌐 正在联网查词…';
    var i = 0, finished = false;

    (function next() {
      if (finished) return;
      if (i >= DICT_API.length) {
        finished = true;
        setDictSrc('未联网');
        box.innerHTML = '在线词典没取到这个词（可能未收录或网络受限）。上面已用本地规则引擎给出搭配与例句，可先照着用。';
        return;
      }
      var api = DICT_API[i++];
      var url = api.url(w);
      if (!url) return next();

      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);
      fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          clearTimeout(timer);
          var d = api.parse(j);
          if (!d.defs.length && !d.collins.length && !d.sents.length) throw new Error('empty');
          /* 中文：优先翻前两条例句（双语例句最实用），没有例句才翻单词本身 */
          var two = d.sents.slice(0, 2);
          if (two.length) {
            return Promise.all(two.map(function (s) {
              return fetchZh(s.en, 3500).then(function (zh) { if (zh) s.zh = zh; });
            })).then(function () { return d; });
          }
          return fetchZh(w, 3500).then(function (zh) {
            if (zh && !d.zh) d.zh = '中译：' + zh;
            return d;
          });
        })
        .then(function (d) {
          if (finished) return;
          var html = renderDict(w, d);
          if (!html) throw new Error('empty');
          finished = true;
          box.innerHTML = html;
          setDictSrc(d.src);
          try { LS.set(cacheKey, JSON.stringify({ src: d.src, html: html })); } catch (e) { }
        })
        .catch(function () { clearTimeout(timer); next(); });
    })();
  }

  /* =====================================================================
   * 1. Wordle
   * ===================================================================== */
  var WD = { s: null };

  function wordleLen() {
    var lv = STATE.settings.level;
    if (lv === 'easy') return pick([4, 5]);
    if (lv === 'mid') return pick([6, 7]);
    if (lv === 'hard') return pick([8, 9]);
    return pick([5, 6, 7]);
  }
  function wordleNew() {
    var len = wordleLen();
    var pool = D.filter(function (e) { return e.w.length === len; });
    if (STATE.settings.onlyWrong) {
      var f = pool.filter(function (e) { return STATE.wrong[e.w]; });
      if (f.length) pool = f;
    }
    var e = pick(pool);
    WD.s = { e: e, ans: e.w, len: len, rows: [], cur: '', row: 0, max: len >= 8 ? 5 : 6, over: false, animRow: -1 };
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
    h += '<div class="clue"><span class="pos">' + esc(WE.posShort(e)) + '</span><span class="zh">' + esc(senses.slice(0, 3).join('；')) + '</span>';
    h += '<div class="tip">根据中文释义猜出英文单词。绿=字母和位置都对，黄=有这个字母但位置不对。</div></div>';

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
      h += '<button class="btn primary" data-act="new">再来一个</button>';
      h += '<button class="btn" data-act="card" data-w="' + e.w + '">看词卡</button></div>';
    }
    h += '<div class="mini">键盘可直接输入；Enter 提交，Backspace 删字。</div>';
    h += '</div>';
    Stage.innerHTML = h;
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
      addScore(gain); markLearned(s.ans); markRight(s.ans);
      if (STATE.settings.autoSpeak) speak(s.ans);
      wordleRender();
      if (STATE.settings.study) setTimeout(function () { openCard(s.e); }, 420);
      return;
    }
    if (s.row >= s.max) {
      s.over = true; s.win = false;
      STATE.streak = 0; markWrong(s.ans); markLearned(s.ans);
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
    var e = pick(poolByLevel(5, 10));
    var w = e.w, n = w.length;
    var hideN = Math.max(1, Math.min(4, Math.round(n * 0.35)));
    var idx = shuffle(range(n)).slice(0, hideN).sort(function (a, b) { return a - b; });
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
    h += '<div class="tip">点下面字母 bank 填进空格；点已填的空格可退回。首尾字母已给出。</div></div>';

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

    h += '<div class="hintline">' + s.w.length + ' 个字母 · 已试 ' + s.tries + ' 次 · 提示用了 ' + s.hints + ' 次' +
      (s.hints > 0 ? ' <span style="color:#ffb545">·本轮不计钻石</span>' : '') + '</div>';

    if (!s.done) {
      h += '<div class="result"><button class="btn primary" data-act="check">检查</button>' +
        '<button class="btn" data-act="hint">提示一个字母 (-20)</button>' +
        '<button class="btn ghost" data-act="new">换一个</button></div>';
    } else {
      h += '<div class="result"><span class="badge" style="color:#3ddc97">✅ 正确</span>' +
        '<span class="badge">' + (s.hints > 0 ? '💎 +0（用过提示）' : '💎 +' + (s.gain || 0)) + '</span>' +
        '<button class="btn primary" data-act="new">下一个</button>' +
        '<button class="btn" data-act="card" data-w="' + e.w + '">看词卡</button></div>';
    }
    h += '</div>';
    Stage.innerHTML = h;
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
    if (s.hints > 0) gain = 0;   /* 本轮用过提示：不增加钻石 */
    s.gain = gain;
    if (gain > 0) addScore(gain);
    markLearned(s.w); markRight(s.w);
    if (STATE.settings.autoSpeak) speak(s.w);
    fillRender();
    if (STATE.settings.study) setTimeout(function () { openCard(s.e); }, 380);
  }
  function fillHint() {
    var s = FL.s;
    if (s.done) return;
    for (var i = 0; i < s.slots.length; i++) {
      var sl = s.slots[i];
      if (sl.hid && !sl.lock && sl.fill !== sl.ch) {
        if (sl.fill && sl.tile >= 0) s.bank[sl.tile].used = false;
        sl.fill = sl.ch; sl.lock = true; sl.tile = -1;
        s.hints++;
        // 占用一个同字母的 bank 块，避免重复使用
        for (var k = 0; k < s.bank.length; k++) {
          if (!s.bank[k].used && s.bank[k].ch === sl.ch) { s.bank[k].used = true; break; }
        }
        STATE.score = Math.max(0, STATE.score - 20); LS.set('wg:score', STATE.score); syncTop();
        fillRender(); return;
      }
    }
    toast('没有需要提示的空格了');
  }

  /* =====================================================================
   * 3. 字母拼图
   * ===================================================================== */
  var AN = { s: null };

  function anagramNew() {
    var e = pick(poolByLevel(4, 9));
    var w = e.w;
    var letters = w.split('');
    var sc = shuffle(letters);
    if (sc.join('') === w) sc = shuffle(sc);
    AN.s = {
      e: e, w: w,
      pool: sc.map(function (ch, i) { return { ch: ch, id: i, used: false }; }),
      ans: [], done: false
    };
    anagramRender();
  }
  function anagramRender() {
    var s = AN.s, e = s.e, sn = WE.senses(e);
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🧩 字母拼图</h2><div class="sub">' + s.w.length + ' 个字母</div></div>';
    h += '<div class="clue"><span class="pos">' + esc(WE.posShort(e)) + '</span><span class="zh">' + esc(sn.slice(0, 3).join('；')) + '</span>';
    h += '<div class="tip">按顺序点字母拼出单词；点上面的字母可以退回。</div></div>';

    h += '<div class="answer">';
    for (var i = 0; i < s.w.length; i++) {
      var it = s.ans[i];
      h += '<button class="anslot' + (it ? ' on' : '') + '" data-act="ans" data-i="' + i + '">' + (it ? esc(it.ch) : '') + '</button>';
    }
    h += '</div>';

    h += '<div class="pool">';
    s.pool.forEach(function (p) {
      h += '<button class="ptile" data-act="tile" data-i="' + p.id + '" style="' + (p.used ? 'opacity:.25;pointer-events:none' : '') + '">' + esc(p.ch) + '</button>';
    });
    h += '</div>';

    if (s.done) {
      h += '<div class="result"><span class="badge" style="color:#3ddc97">✅ ' + esc(s.w) + '</span>' +
        '<button class="btn primary" data-act="new">下一个</button>' +
        '<button class="btn" data-act="card" data-w="' + e.w + '">看词卡</button></div>';
    } else {
      h += '<div class="result"><button class="btn" data-act="clear">清空</button>' +
        '<button class="btn ghost" data-act="new">换一个</button></div>';
    }
    h += '</div>';
    Stage.innerHTML = h;
  }
  function anagramTile(id) {
    var s = AN.s;
    if (s.done) return;
    var p = null;
    s.pool.forEach(function (x) { if (x.id === id) p = x; });
    if (!p || p.used || s.ans.length >= s.w.length) return;
    p.used = true;
    s.ans.push({ ch: p.ch, id: id });
    if (s.ans.length === s.w.length) {
      var guess = s.ans.map(function (x) { return x.ch; }).join('');
      if (guess === s.w) {
        s.done = true;
        var gain = 50 + s.w.length * 8;
        addScore(gain); markLearned(s.w); markRight(s.w);
        if (STATE.settings.autoSpeak) speak(s.w);
        anagramRender();
        if (STATE.settings.study) setTimeout(function () { openCard(s.e); }, 380);
        return;
      } else {
        toast('拼错啦，再试一次');
        STATE.streak = 0; syncTop();
        setTimeout(function () {
          s.pool.forEach(function (x) { x.used = false; });
          s.ans = [];
          anagramRender();
        }, 320);
        anagramRender();
        return;
      }
    }
    anagramRender();
  }
  function anagramUndo(i) {
    var s = AN.s;
    if (s.done) return;
    var it = s.ans[i];
    if (!it) return;
    s.pool.forEach(function (x) { if (x.id === it.id) x.used = false; });
    s.ans.splice(i, 1);
    anagramRender();
  }

  /* =====================================================================
   * 4. 单词找词（字母棋盘，单词可横 / 竖 / 斜 45° 任意方向）
   * ===================================================================== */
  var LL = { s: null };
  var WS_DIRS = [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]];

  function wsBuild(words, N) {
    var g = [], i, j;
    for (i = 0; i < N; i++) { g.push([]); for (j = 0; j < N; j++) g[i].push(''); }
    var placed = [];
    words.forEach(function (e) {
      var w = String(e.w).toLowerCase();
      for (var att = 0; att < 260; att++) {
        var d = WS_DIRS[rnd(8)];
        var r0 = rnd(N), c0 = rnd(N);
        var r1 = r0 + d[0] * (w.length - 1), c1 = c0 + d[1] * (w.length - 1);
        if (r1 < 0 || r1 >= N || c1 < 0 || c1 >= N) continue;
        var ok = true;
        for (var k = 0; k < w.length; k++) {
          var ch = g[r0 + d[0] * k][c0 + d[1] * k];
          if (ch && ch !== w[k]) { ok = false; break; }
        }
        if (!ok) continue;
        for (var m = 0; m < w.length; m++) g[r0 + d[0] * m][c0 + d[1] * m] = w[m];
        placed.push(e);
        break;
      }
    });
    var bag = '';
    words.forEach(function (e) { bag += String(e.w).toLowerCase(); });
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      if (g[i][j]) continue;
      g[i][j] = (bag && Math.random() < 0.7) ? bag[rnd(bag.length)] : String.fromCharCode(97 + rnd(26));
    }
    return { g: g, placed: placed };
  }

  function llNew() {
    var pool = poolByLevel(3, 7);
    var cand = pool.filter(function (e) { return /^[a-z]{3,7}$/.test(e.w); });
    if (cand.length < 12) cand = D.filter(function (e) { return /^[a-z]{3,7}$/.test(e.w); });
    var words = [], seen = {}, guard = 0;
    while (words.length < 6 && guard++ < 900) {
      var e = pick(cand);
      if (!e || seen[e.w]) continue;
      seen[e.w] = 1; words.push(e);
    }
    var N = 8, best = null;
    for (var t = 0; t < 8; t++) {
      var bd = wsBuild(words, N);
      if (!best || bd.placed.length > best.placed.length) best = bd;
      if (best.placed.length === words.length) break;
    }
    var picked = best.placed.slice(0, 5);
    LL.s = {
      N: N, grid: best.g,
      words: picked.map(function (e) {
        return { e: e, w: String(e.w).toLowerCase(), zh: shortZh(e), found: false, cells: null };
      }),
      start: -1, bad: [], foundCount: 0, tries: 0, done: false
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
    h += '<div class="mini" style="margin:0 0 7px">在字母棋盘里找出列表中的单词：先点起点格，再点终点格。单词可横、竖、斜 45° 排列，也可能首尾反向。</div>';
    h += '<div class="wsgrid" style="grid-template-columns:repeat(' + N + ',1fr)">';
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
      idx = i * N + j;
      cls = 'wscell';
      if (got[idx]) cls += ' got';
      if (s.start === idx) cls += ' sel';
      if (s.bad.indexOf(idx) >= 0) cls += ' bad';
      h += '<button class="' + cls + '" data-act="ll" data-i="' + idx + '">' + esc(s.grid[i][j]) + '</button>';
    }
    h += '</div>';
    h += '<div class="wslist">';
    s.words.forEach(function (w) {
      h += '<span class="wschip' + (w.found ? ' got' : '') + '"><b>' + esc(w.w) + '</b><small>' + esc(w.zh) + '</small></span>';
    });
    h += '</div>';
    if (s.done) {
      h += '<div class="result"><span class="badge" style="color:#3ddc97">✅ 全部找到</span>' +
        '<button class="btn primary" data-act="new">再来一局</button></div>';
    } else {
      h += '<div class="result"><button class="btn ghost" data-act="new">换一盘</button></div>';
    }
    h += '</div>';
    Stage.innerHTML = h;
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
      if (s.foundCount === s.words.length) { s.done = true; addScore(60); llRender(); toast('🎉 全部找到'); return; }
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
  function matchNew() {
    var pool = poolByLevel(4, 8);
    var picked = [], seen = {};
    var guard = 0;
    while (picked.length < 6 && guard++ < 300) {
      var e = pick(pool);
      if (seen[e.w]) continue;
      seen[e.w] = 1; picked.push(e);
    }
    var cards = [];
    picked.forEach(function (e, k) {
      cards.push({ k: k, type: 'en', text: e.w, e: e });
      cards.push({ k: k, type: 'zh', text: shortZh(e), e: e });
    });
    MC.s = { cards: shuffle(cards), first: -1, lock: false, moves: 0, matched: 0, done: false };
    matchRender();
  }
  function matchRender() {
    var s = MC.s;
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🃏 记忆配对</h2><div class="sub">配对 ' + (s.matched / 2) + '/6 · 翻牌 ' + s.moves + '</div></div>';
    h += '<div class="mini" style="margin:0 0 6px">翻开两张：英文 ↔ 中文，配对成功就留在场上。</div>';
    h += '<div class="mgrid">';
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
        '<button class="btn primary" data-act="new">再来一局</button></div>';
    } else {
      h += '<div class="result"><button class="btn ghost" data-act="new">重开</button></div>';
    }
    h += '</div>';
    Stage.innerHTML = h;
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
        if (s.matched === 12) { s.done = true; addScore(60); }
        matchRender();
        return;
      }
      a.open = false; c.open = false; s.first = -1; s.lock = false;
      matchRender();
    }, ok ? 430 : 760);
  }

    /* =====================================================================
   * 6. 下落消除（自定义规则 · 难度评估影响钻石）
   *    · 选对 +1 ❤️，按当前难度得钻石（简单 6 / 普通 12 / 困难 22，连击有加成）
   *    · 选错、漏接按当前难度扣 ❤️；❤️ 归零结束
   *    · 难度按最近 3 题正确率自动升降，直接决定钻石单价
   * ===================================================================== */
  var FD = { s: null };
  var FD_DIFF = [
    { name: '简单', hearts: 6, v: [22, 32], gap: 1.70, max: 3, opts: 3, miss: 1, wrong: 1, gem: 6 },
    { name: '普通', hearts: 5, v: [32, 46], gap: 1.25, max: 4, opts: 4, miss: 1, wrong: 2, gem: 12 },
    { name: '困难', hearts: 4, v: [44, 62], gap: 0.95, max: 5, opts: 4, miss: 2, wrong: 3, gem: 22 }
  ];
  function fdCfg() { return FD_DIFF[FD.s ? FD.s.diff : 1]; }

  function fdStop() {
    var s = FD.s;
    if (!s) return;
    s.running = false;
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
  }
  function fdNew() {
    fdStop();
    FD.s = {
      pool: poolByLevel(3, 12), items: [], diff: 1, hearts: FD_DIFF[1].hearts,
      sel: null, opts: [], uid: 1, over: false, running: true, last: 0, spawnT: 0,
      right: 0, answered: 0, correct: 0, combo: 0, bestCombo: 0, hist: [], gem: 0
    };
    fdRender();
    fdSpawn(); fdSpawn();
    FD.s.raf = requestAnimationFrame(fdLoop);
  }
  function fdRender() {
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🌠 下落消除</h2><div class="sub">' +
      '❤️ <b id="fdHearts">5</b> · 难度 <b id="fdDiff">普通</b> · 答对 <b id="fdRight">0</b> · 💎 <b id="fdGem">0</b></div></div>';
    h += '<div class="mini" style="margin:0 0 6px">点中下落的卡片选中它，再在下方选出对应答案。选对 +1❤️ 并按难度拿钻石（简单 6 / 普通 12 / 困难 22，连击最高再 +50%）；选错、漏接按难度扣心（简单 1 / 普通 1~2 / 困难 2~3）。连对 3 题难度上升，连错 3 题难度下降，钻石单价随之变化。</div>';
    h += '<div class="fdstat"><span>正确率 <b id="fdAcc">—</b></span>' +
      '<span>钻石单价 <b id="fdUnit">12</b>/题</span>' +
      '<span>连击 <b id="fdCombo">0</b></span></div>';
    h += '<div class="fdbox" id="fdBox"></div>';
    h += '<div class="fdbank" id="fdBank"></div>';
    h += '<div class="result"><button class="btn ghost" data-act="new">重开</button></div>';
    h += '</div>';
    Stage.innerHTML = h;
    fdHud(); fdBank();
  }
  function fdHud() {
    var s = FD.s;
    if (!s) return;
    if (s.hearts < 0) s.hearts = 0;
    var c = FD_DIFF[s.diff];
    var a = document.getElementById('fdHearts'); if (a) a.textContent = s.hearts;
    var d = document.getElementById('fdDiff'); if (d) d.textContent = c.name;
    var b = document.getElementById('fdRight'); if (b) b.textContent = s.right;
    var g = document.getElementById('fdGem'); if (g) g.textContent = s.gem;
    var u = document.getElementById('fdUnit'); if (u) u.textContent = c.gem;
    var cb = document.getElementById('fdCombo'); if (cb) cb.textContent = s.combo;
    var ac = document.getElementById('fdAcc');
    if (ac) ac.textContent = s.answered ? Math.round(s.correct / s.answered * 100) + '%' : '—';
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
  function fdSpawn() {
    var s = FD.s;
    if (!s || !s.running || s.over) return;
    var box = document.getElementById('fdBox');
    if (!box) return;
    var c = FD_DIFF[s.diff];
    if (s.items.length >= c.max) return;
    var e = pick(s.pool);
    var type = Math.random() < 0.5 ? 'en' : 'zh';
    var el = document.createElement('button');
    var it = {
      u: s.uid++, e: e, type: type,
      x: 3 + Math.random() * 50, y: -46,
      v: c.v[0] + Math.random() * (c.v[1] - c.v[0]),
      rot: -18 + Math.random() * 36, el: el
    };
    el.className = 'fditem ' + type;
    el.setAttribute('data-act', 'fdsel');
    el.setAttribute('data-u', it.u);
    el.textContent = type === 'en' ? e.w : shortZh(e);
    el.style.left = it.x + '%';
    el.style.top = it.y + 'px';
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
    var box = document.getElementById('fdBox');
    if (!box) return;
    var H = box.clientHeight;
    for (var i = s.items.length - 1; i >= 0; i--) {
      var it = s.items[i];
      it.y += it.v * dt;
      if (it.y > H - 6) { fdLose(it); continue; }
      it.el.style.top = it.y.toFixed(1) + 'px';
    }
    s.spawnT += dt;
    if (s.spawnT > FD_DIFF[s.diff].gap) { s.spawnT = 0; fdSpawn(); }
    if (s.running) s.raf = requestAnimationFrame(fdLoop);
  }
  function fdDrop(it) {
    if (it.el && it.el.parentNode) it.el.parentNode.removeChild(it.el);
    var i = FD.s.items.indexOf(it);
    if (i >= 0) FD.s.items.splice(i, 1);
  }
  function fdLose(it) {
    var s = FD.s;
    var c = FD_DIFF[s.diff];
    fdDrop(it);
    s.hearts -= c.miss;
    s.answered++; s.combo = 0; s.hist.push(false);
    if (s.sel === it) { s.sel = null; s.opts = []; }
    fdHud(); fdBank();
    if (s.hearts <= 0) { fdOver(); return; }
    toast('漏接一个，−' + c.miss + ' ❤️');
    fdEvalDiff();
  }
  function fdPick(u) {
    var s = FD.s;
    if (!s || s.over) return;
    var it = null;
    s.items.forEach(function (x) { if (x.u === u) it = x; });
    if (!it) return;
    s.sel = it;
    s.items.forEach(function (x) { x.el.classList.toggle('sel', x === it); });
    fdMakeOpts(it);
  }
  function fdMakeOpts(it) {
    var s = FD.s;
    var c = FD_DIFF[s.diff];
    var others = [], seen = {}, guard = 0;
    seen[it.e.w] = 1;
    while (others.length < c.opts - 1 && guard++ < 300) {
      var e2 = pick(s.pool);
      if (seen[e2.w]) continue;
      seen[e2.w] = 1; others.push(e2);
    }
    s.opts = shuffle([it.e].concat(others)).map(function (e) {
      return { e: e, txt: it.type === 'en' ? shortZh(e) : e.w, ok: e.w === it.e.w };
    });
    fdBank();
  }
  function fdEvalDiff() {
    var s = FD.s;
    if (!s || s.over) return;
    if (!s.answered || s.answered % 3 !== 0) return;
    var last3 = s.hist.slice(-3), ok = 0;
    last3.forEach(function (x) { if (x) ok++; });
    if (ok === 3 && s.diff < 2) {
      s.diff++;
      fdHud();
      toast('🔥 难度评估 → ' + FD_DIFF[s.diff].name + '，钻石 ' + FD_DIFF[s.diff].gem + '/题');
    } else if (ok <= 1 && s.diff > 0) {
      s.diff--;
      fdHud();
      toast('🌿 难度评估 → ' + FD_DIFF[s.diff].name + '，钻石 ' + FD_DIFF[s.diff].gem + '/题');
    }
  }
  function fdAns(k) {
    var s = FD.s;
    if (!s || s.over || !s.sel) return;
    var o = s.opts[k];
    if (!o) return;
    var it = s.sel;
    var c = FD_DIFF[s.diff];
    if (o.ok) {
      s.hearts++; s.right++; s.answered++; s.correct++;
      s.combo++;
      if (s.combo > s.bestCombo) s.bestCombo = s.combo;
      s.hist.push(true);
      var gain = Math.round(c.gem * (1 + Math.min(s.combo - 1, 5) * 0.1));
      s.gem += gain;
      addScore(gain); markLearned(it.e.w); markRight(it.e.w);
      fdDrop(it);
      s.sel = null; s.opts = [];
      fdHud(); fdBank();
      toast('✅ 消除 +1❤️ 💎+' + gain + (s.combo > 1 ? ' · 连击 ×' + s.combo : ''));
      fdEvalDiff();
      return;
    }
    s.hearts -= c.wrong;
    s.answered++; s.combo = 0; s.hist.push(false);
    var btns = document.querySelectorAll('#fdBank .fdopt');
    if (btns[k]) btns[k].classList.add('bad');
    fdHud();
    toast('❌ 选错 −' + c.wrong + ' ❤️');
    if (s.hearts <= 0) { fdOver(); return; }
    setTimeout(function () {
      if (FD.s !== s || s.over) return;
      s.sel = null; s.opts = [];
      s.items.forEach(function (x) { x.el.classList.remove('sel'); });
      fdBank();
    }, 420);
    fdEvalDiff();
  }
  function fdOver() {
    var s = FD.s;
    s.over = true; s.running = false;
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
    var box = document.getElementById('fdBox');
    if (box) box.innerHTML = '<div class="fdover"><div class="fdheart">💔</div><h3>❤️ 用完了</h3>' +
      '<div class="sub">本轮消除 ' + s.right + ' 个 · 💎 +' + s.gem + ' · 最高难度 ' +
      FD_DIFF[s.diff].name + '</div>' +
      '<div class="sub">正确率 ' + (s.answered ? Math.round(s.correct / s.answered * 100) : 0) + '% · 最高连击 ' + s.bestCombo + '</div>' +
      '<button class="btn primary" data-act="new" style="margin-top:10px">再来一局</button></div>';
    var bank = document.getElementById('fdBank');
    if (bank) bank.innerHTML = '';
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
        if (!e) return;
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
    Stage.innerHTML = h;
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
    h += sw('autoSpeak', '自动发音', '看到/答对单词时用系统 TTS 朗读');
    h += sw('online', '联网补词', '查 dictionaryapi.dev 的真实例句与英文释义');
    h += sw('light', '亮色主题', '浅色背景，白天与户外更清晰');
    h += '<div class="setrow"><div class="lbl">难度<small>影响出题词长与 Wordle 字母数</small></div>' +
      '<div class="seg">' +
      ['easy:基础', 'mid:进阶', 'hard:挑战', 'mix:混合'].map(function (x) {
        var p = x.split(':');
        return '<button data-act="level" data-v="' + p[0] + '" class="' + (st.level === p[0] ? 'on' : '') + '">' + p[1] + '</button>';
      }).join('') + '</div></div>';
    h += '<div class="setrow"><div class="lbl">只练错词<small>错词 ≥ 8 个时生效</small></div>' +
      '<div class="switch ' + (st.onlyWrong ? 'on' : '') + '" data-act="tog" data-k="onlyWrong"></div></div>';
    h += '<div class="setrow"><div class="lbl">数据<small>词库 ' + D.length + ' 词 · 分数与错词都存在本机</small></div>' +
      '<button class="btn small warn" data-act="reset">重置进度</button></div>';
    h += '<div class="mini">词库来源：应届毕业生网《大学英语四级基本词汇（3400）》，实际解析出 ' + D.length +
      ' 个可用词条。释义为词库原文；用法、变形、词族、例句由本地规则引擎生成，联网时补充自由词典内容。</div>';
    h += '</div>';
    Sheet.innerHTML = h;
    Sheet.classList.add('on');
  }

  /* =====================================================================
   * 路由 / 事件
   * ===================================================================== */
  var TABS = [
    { id: 'wordle', icon: '🟩', name: '拼词' },
    { id: 'fill', icon: '🔤', name: '填空' },
    { id: 'anagram', icon: '🧩', name: '拼图' },
    { id: 'll', icon: '🔍', name: '找词' },
    { id: 'match', icon: '🃏', name: '配对' },
    { id: 'fd', icon: '🌠', name: '下落' },
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
    renderTabs();
    if (id === 'wordle') wordleNew();
    else if (id === 'fill') fillNew();
    else if (id === 'anagram') anagramNew();
    else if (id === 'll') llNew();
    else if (id === 'match') matchNew();
    else if (id === 'fd') fdNew();
    else if (id === 'book') renderBook();
  }

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
      case 'close': closeSheet(); break;
      case 'tab': go(d.tab); break;
      case 'speak': speak(d.w); break;
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
        STATE.score = 0; STATE.best = 0; STATE.streak = 0;
        STATE.learned = []; STATE.wrong = {}; STATE.stars = [];
        LS.set('wg:score', 0); LS.set('wg:best', 0); LS.set('wg:learned', []);
        saveWrong(); saveStars(); syncTop(); closeSheet(); toast('进度已重置'); go(STATE.game);
        break;
      case 'card': {
        var w = d.w;
        var ent = D.filter(function (x) { return x.w === w; })[0];
        if (ent) openCard(ent);
        break;
      }
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
        else if (STATE.game === 'anagram') anagramNew();
        else if (STATE.game === 'll') llNew();
        else if (STATE.game === 'match') matchNew();
        else if (STATE.game === 'fd') fdNew();
        break;
      /* --- fill --- */
      case 'lbank': fillClickBank(+d.i); break;
      case 'slot': fillClickSlot(+d.i); break;
      case 'check': fillCheck(); break;
      case 'hint': fillHint(); break;

      /* --- anagram --- */
      case 'tile': anagramTile(+d.i); break;
      case 'ans': anagramUndo(+d.i); break;
      case 'clear':
        AN.s.ans = []; AN.s.pool.forEach(function (x) { x.used = false; }); anagramRender(); break;



      /* --- match --- */
      case 'mcard': matchClick(+d.i); break;
      /* --- 单词找词 --- */
      case 'll': llClick(+d.i); break;

      /* --- 下落消除 --- */
      case 'fdsel': fdPick(+d.u); break;
      case 'fdans': fdAns(+d.i); break;


    }
  });

  document.addEventListener('keydown', function (ev) {
    if (Sheet.classList.contains('on')) return;
    if (STATE.game !== 'wordle' || !WD.s) return;
    if (/^[a-zA-Z]$/.test(ev.key)) { ev.preventDefault(); wordleKey(ev.key.toLowerCase()); }
    else if (ev.key === 'Enter') { ev.preventDefault(); wordleEnter(); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); wordleDel(); }
  });

  /* ---------------- 启动 ---------------- */
  applyTheme();
  syncTop();
  renderTabs();
  go('wordle');
  // 预加载语音列表（部分 WebView 需要）
  if (window.speechSynthesis) { try { speechSynthesis.getVoices(); } catch (e) { } }
})();