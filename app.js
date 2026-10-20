/* =====================================================================
 * app.js —— 四级词汇游乐场
 * 6 个游戏：Wordle / 字母填空 / 字母拼图 / 中英速配 / 记忆配对 / 听音辨词
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
    settings: Object.assign({ study: true, autoSpeak: true, online: true, onlyWrong: false, level: 'mix' },
      LS.get('wg:settings', {}))
  };

  function saveSettings() { LS.set('wg:settings', STATE.settings); }
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

    h += '<div class="hintline">' + s.w.length + ' 个字母 · 已试 ' + s.tries + ' 次 · 提示用了 ' + s.hints + ' 次</div>';

    if (!s.done) {
      h += '<div class="result"><button class="btn primary" data-act="check">检查</button>' +
        '<button class="btn" data-act="hint">提示一个字母 (-20)</button>' +
        '<button class="btn ghost" data-act="new">换一个</button></div>';
    } else {
      h += '<div class="result"><span class="badge" style="color:#3ddc97">✅ 正确</span>' +
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
    addScore(gain); markLearned(s.w); markRight(s.w);
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
   * 4. 中英速配（4 选 1）
   * ===================================================================== */
  var QZ = { s: null };

  function quizNew() {
    var pool = poolByLevel(4, 12);
    var qs = [], used = {};
    var guard = 0;
    while (qs.length < 10 && guard++ < 400) {
      var e = pick(pool);
      if (used[e.w]) continue;
      used[e.w] = 1;
      var dir = Math.random() < .55 ? 'e2z' : 'z2e';
      var ds = distractors(e, pool, 3);
      if (ds.length < 3) continue;
      var opts = shuffle([e].concat(ds));
      qs.push({ e: e, dir: dir, opts: opts, right: opts.indexOf(e), answered: false });
    }
    QZ.s = { qs: qs, i: 0, right: 0, done: false };
    quizRender();
  }
  function quizRender() {
    var s = QZ.s;
    if (s.i >= s.qs.length) {
      var acc = Math.round(s.right / s.qs.length * 100);
      Stage.innerHTML = '<div class="panel"><div style="text-align:center;padding:16px 0">' +
        '<div style="font-size:40px">' + (acc >= 80 ? '🏆' : acc >= 50 ? '👍' : '💪') + '</div>' +
        '<h2 style="margin:8px 0">' + s.right + ' / ' + s.qs.length + ' 正确</h2>' +
        '<div class="sub" style="color:#8fa0c0;font-size:12.5px">正确率 ' + acc + '%</div>' +
        '<div class="result" style="margin-top:18px"><button class="btn primary" data-act="new">再来一轮</button>' +
        '<button class="btn" data-act="tab" data-tab="book">看错词本</button></div>' +
        '<div class="mini">错的词已记入错词本，可开启“只练错词”。</div></div></div>';
      return;
    }
    var q = s.qs[s.i], e = q.e;
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🎯 中英速配</h2><div class="sub">' + (s.i + 1) + ' / ' + s.qs.length + ' · 对 ' + s.right + '</div></div>';
    h += '<div class="progress">';
    s.qs.forEach(function (x, k) { h += '<i class="' + (k < s.i ? (x.ok ? 'on' : 'bad') : '') + '"></i>'; });
    h += '</div>';

    if (q.dir === 'e2z') {
      h += '<div style="text-align:center;padding:10px 0 4px"><div style="font-size:28px;font-weight:800;letter-spacing:.5px">' + esc(e.w) + '</div>' +
        '<div class="sub" style="color:#8fa0c0;font-size:11.5px;margin-top:4px">' + esc(WE.posLabel(e)) + '</div></div>';
    } else {
      h += '<div class="clue" style="text-align:center"><span class="pos">' + esc(WE.posShort(e)) + '</span>' +
        '<span class="zh">' + esc(WE.senses(e).slice(0, 3).join('；')) + '</span></div>';
    }

    h += '<div class="opts">';
    q.opts.forEach(function (o, k) {
      var cls = 'opt';
      if (q.answered) {
        if (k === q.right) cls += ' right';
        else if (k === q.pick) cls += ' wrong';
      }
      var txt = q.dir === 'e2z' ? WE.senses(o).slice(0, 2).join('；') : o.w;
      h += '<button class="' + cls + '" data-act="opt" data-i="' + k + '" ' + (q.answered ? 'disabled' : '') + '>' +
        '<span class="k">' + 'ABCD'[k] + '</span><span>' + esc(txt) + '</span></button>';
    });
    h += '</div>';

    if (q.answered) {
      h += '<div class="result"><span class="badge">' + esc(e.w) + ' · ' + esc(WE.senses(e).slice(0, 2).join('；')) + '</span>' +
        '<button class="btn primary" data-act="next">下一题</button></div>';
      h += '<div class="result"><button class="btn small ghost" data-act="card" data-w="' + e.w + '">展开这个词的词卡</button></div>';
    }
    h += '</div>';
    Stage.innerHTML = h;
  }
  function quizOpt(k) {
    var s = QZ.s, q = s.qs[s.i];
    if (q.answered) return;
    q.answered = true;
    q.pick = k;
    if (k === q.right) {
      q.ok = true; s.right++;
      addScore(12); markLearned(q.e.w); markRight(q.e.w);
    } else {
      q.ok = false;
      STATE.streak = 0; syncTop();
      markWrong(q.e.w);
    }
    quizRender();
  }
  function quizNext() {
    QZ.s.i++;
    quizRender();
    var q = QZ.s.qs[QZ.s.i - 1];
    if (q && q.dir === 'z2e' && STATE.settings.study) {
      // 只在拼错时弹卡，避免打断节奏
      if (!q.ok) openCard(q.e);
    }
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
      var show = c.done || c.open;
      if (c.type === 'en' && show) cls += ' en';
      if (c.done) cls += ' done';
      else if (c.open) cls += ' open';
      if (!show) cls += ' back';
      h += '<button class="' + cls + '" data-act="mcard" data-i="' + i + '">' + (show ? esc(c.text) : '?') + '</button>';
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
    c.open = true;
    if (s.first < 0) { s.first = i; matchRender(); return; }
    var a = s.cards[s.first];
    s.moves++;
    if (a.k === c.k) {
      a.done = true; c.done = true;
      s.matched += 2;
      s.first = -1;
      addScore(15);
      markLearned(c.e.w); markRight(c.e.w);
      if (s.matched === 12) {
        s.done = true;
        addScore(60);
        matchRender();
        return;
      }
      matchRender(); return;
    }
    s.lock = true;
    matchRender();
    setTimeout(function () {
      a.open = false; c.open = false; s.first = -1; s.lock = false;
      matchRender();
    }, 620);
  }

  /* =====================================================================
   * 6. 听音辨词
   * ===================================================================== */
  var LSN = { s: null };
  function listenNew() {
    var pool = poolByLevel(4, 10);
    var e = pick(pool);
    var same = pool.filter(function (x) {
      return x.w !== e.w && Math.abs(x.w.length - e.w.length) <= 1 && x.w[0] === e.w[0];
    });
    if (same.length < 3) {
      same = pool.filter(function (x) { return x.w !== e.w && Math.abs(x.w.length - e.w.length) <= 2; });
    }
    var opts = shuffle([e].concat(shuffle(same).slice(0, 3)));
    LSN.s = { e: e, opts: opts, right: opts.indexOf(e), picked: -1, done: false };
    listenRender();
    setTimeout(function () { speak(e.w); }, 260);
  }
  function listenRender() {
    var s = LSN.s, e = s.e, ok = !!window.speechSynthesis;
    var h = '<div class="panel">';
    h += '<div class="rowbar"><h2>🔈 听音辨词</h2><div class="sub">听发音选单词</div></div>';
    if (!ok) h += '<div class="warnbox" style="margin-bottom:10px">这台设备的 WebView 不支持语音合成，可以改用「中英速配」。</div>';
    h += '<div style="text-align:center;padding:6px 0 10px">' +
      '<button class="btn primary" data-act="play" style="font-size:15px;padding:14px 26px">🔊 再听一遍</button>' +
      '<div class="mini">' + (s.done ? esc(WE.posLabel(e)) + ' · ' + esc(WE.senses(e).join('；')) : '点击播放，选出发音对应的单词') + '</div></div>';

    h += '<div class="opts">';
    s.opts.forEach(function (o, k) {
      var cls = 'opt';
      if (s.done) {
        if (k === s.right) cls += ' right';
        else if (k === s.picked) cls += ' wrong';
      }
      h += '<button class="' + cls + '" data-act="lopt" data-i="' + k + '" ' + (s.done ? 'disabled' : '') + '>' +
        '<span class="k">' + 'ABCD'[k] + '</span><span>' + esc(o.w) + '</span></button>';
    });
    h += '</div>';

    if (s.done) {
      h += '<div class="result"><span class="badge">' + (s.picked === s.right ? '✅ 正确' : '❌ 正确答案 ' + esc(s.opts[s.right].w)) + '</span>' +
        '<button class="btn primary" data-act="new">下一题</button>' +
        '<button class="btn" data-act="card" data-w="' + e.w + '">看词卡</button></div>';
    } else {
      h += '<div class="result"><button class="btn ghost" data-act="new">换一个</button></div>';
    }
    h += '<div class="mini">发音使用系统 TTS（美音优先），离线也能读。</div>';
    h += '</div>';
    Stage.innerHTML = h;
  }
  function listenOpt(k) {
    var s = LSN.s;
    if (s.done) return;
    s.picked = k; s.done = true;
    if (k === s.right) {
      addScore(18); markLearned(s.e.w); markRight(s.e.w);
    } else {
      STATE.streak = 0; syncTop(); markWrong(s.e.w);
    }
    speak(s.opts[s.right].w);
    listenRender();
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
    { id: 'quiz', icon: '🎯', name: '速配' },
    { id: 'match', icon: '🃏', name: '配对' },
    { id: 'listen', icon: '🔈', name: '听音' },
    { id: 'book', icon: '📚', name: '词本' }
  ];
  function renderTabs() {
    TabsEl.innerHTML = TABS.map(function (t) {
      return '<button class="tab ' + (STATE.game === t.id ? 'on' : '') + '" data-act="tab" data-tab="' + t.id + '"><i>' + t.icon + '</i>' + t.name + '</button>';
    }).join('');
  }
  function go(id) {
    STATE.game = id;
    renderTabs();
    if (id === 'wordle') wordleNew();
    else if (id === 'fill') fillNew();
    else if (id === 'anagram') anagramNew();
    else if (id === 'quiz') quizNew();
    else if (id === 'match') matchNew();
    else if (id === 'listen') listenNew();
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
        else if (STATE.game === 'quiz') quizNew();
        else if (STATE.game === 'match') matchNew();
        else if (STATE.game === 'listen') listenNew();
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

      /* --- quiz --- */
      case 'opt': quizOpt(+d.i); break;
      case 'next': quizNext(); break;

      /* --- match --- */
      case 'mcard': matchClick(+d.i); break;

      /* --- listen --- */
      case 'play': speak(LSN.s.e.w); break;
      case 'lopt': listenOpt(+d.i); break;
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
  syncTop();
  renderTabs();
  go('wordle');
  // 预加载语音列表（部分 WebView 需要）
  if (window.speechSynthesis) { try { speechSynthesis.getVoices(); } catch (e) { } }
})();