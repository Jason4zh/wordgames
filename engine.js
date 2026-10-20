/* =====================================================================
 * engine.js —— 单词信息引擎
 * 设计原则：不对 3000+ 单词逐个写数据，而是用「规则 + 小词表」推出来
 *   1) 释义/词性：来自词库本身，解析成结构化
 *   2) 词形变化：不规则表 + 拼写规则（双写/e省略/y变i）
 *   3) 搭配/句型：按词性模板 + 释义关键词触发
 *   4) 词族派生：后缀规则生成 → 用词库校验真伪（存在才显示）
 *   5) 例句：按词性模板 + 变形结果生成（在线时再用词典 API 补真实例句）
 *   6) 考点提示：拼写/词性/用法规则集
 * ===================================================================== */
(function (global) {
  'use strict';

  var WS = Object.create(null);      // 词库索引：word -> true
  function setLexicon(words) { words.forEach(function (w) { WS[w] = 1; }); }

  /* ---------------- 1. 词性解析 ---------------- */
  var POS_ZH = {
    v: '动词', vt: '及物动词', vi: '不及物动词', n: '名词',
    adj: '形容词', adv: '副词', prep: '介词', conj: '连词',
    pron: '代词', art: '冠词', num: '数词', aux: '助动词',
    int: '感叹词', abbr: '缩写'
  };
  var KNOWN = Object.create(null);
  Object.keys(POS_ZH).forEach(function (k) { KNOWN[k] = 1; });

  /* 词库清洗：源页面常把多个词性挤在一行，如 z = "价值；价格vt.评价"
     这里把夹在释义中间的词性标记提出来，合并进 e.p，保证“解析一次、全局受益” */
  var MIDPOS = /((?:abbr|adj|adv|aux|conj|int|num|prep|pron|vt|vi|art|n|a)\.)/g;
  function fixEntry(e) {
    if (!e || typeof e !== 'object' || e._fx) return e;
    e._fx = 1;
    var z = String(e.z || '');
    if (!z || !MIDPOS.test(z)) { MIDPOS.lastIndex = 0; return e; }
    MIDPOS.lastIndex = 0;
    var parts = z.split(MIDPOS), glosses = [], pos = String(e.p || '');
    parts.forEach(function (s, i) {
      s = (s || '').trim();
      if (!s) return;
      if (i % 2 === 1) { if (pos.indexOf(s.slice(0, -1)) < 0) pos = (pos ? pos + '&' : '') + s; }
      else glosses.push(s.replace(/[；;]+$/, ''));
    });
    MIDPOS.lastIndex = 0;
    if (glosses.length) { e.z = glosses.join('；'); e.p = pos.replace(/&+/g, '&').replace(/^&|&$/g, ''); }
    return e;
  }

  function posCodes(e) {
    if (e._p) return e._p;
    fixEntry(e);
    var toks = (e.p || '').replace(/&/g, ' ').replace(/\./g, ' ').split(/\s+/);
    var out = [];
    toks.forEach(function (t) {
      t = t.toLowerCase();
      if (t === 'a') t = 'adj';
      if (t === 'ad') t = 'adv';
      if (t === 'adj.' || t === 'adv.') t = t.slice(0, -1);
      if (KNOWN[t] && out.indexOf(t) < 0) out.push(t);
    });
    // vt/vi 同时给 v 的语义，便于模板判断
    e._p = out;
    return out;
  }
  function hasPos(e, p) { return posCodes(e).indexOf(p) >= 0; }
  function isVerb(e) { var p = posCodes(e); return p.indexOf('v') >= 0 || p.indexOf('vt') >= 0 || p.indexOf('vi') >= 0; }

  function posLabel(e) {
    return posCodes(e).map(function (p) { return p + '. ' + (POS_ZH[p] || ''); }).join(' / ');
  }
  function posShort(e) {
    var p = posCodes(e);
    return p.length ? p[0] + '.' : '';
  }

  /* 中文释义拆义项 */
  function senses(e) {
    fixEntry(e);
    var arr = String(e.z || '').split(/[；;]/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s.length > 0; });
    var out = [], seen = {};
    arr.forEach(function (s) {
      s = s.replace(/^[（(]([^（）()]*)[）)]$/, '$1');
      if (!seen[s]) { seen[s] = 1; out.push(s); }
    });
    return out;
  }

  /* ---------------- 2. 变形：不规则表 ---------------- */
  var IRRV = {
    arise: ['arose', 'arisen'], awake: ['awoke', 'awoken'], be: ['was/were', 'been'],
    bear: ['bore', 'borne'], beat: ['beat', 'beaten'], become: ['became', 'become'],
    begin: ['began', 'begun'], bend: ['bent', 'bent'], bet: ['bet', 'bet'],
    bind: ['bound', 'bound'], bite: ['bit', 'bitten'], bleed: ['bled', 'bled'],
    blow: ['blew', 'blown'], break: ['broke', 'broken'], breed: ['bred', 'bred'],
    bring: ['brought', 'brought'], build: ['built', 'built'], burn: ['burnt', 'burnt'],
    burst: ['burst', 'burst'], buy: ['bought', 'bought'], catch: ['caught', 'caught'],
    choose: ['chose', 'chosen'], cling: ['clung', 'clung'], come: ['came', 'come'],
    cost: ['cost', 'cost'], creep: ['crept', 'crept'], cut: ['cut', 'cut'],
    deal: ['dealt', 'dealt'], dig: ['dug', 'dug'], do: ['did', 'done'],
    draw: ['drew', 'drawn'], dream: ['dreamt', 'dreamt'], drink: ['drank', 'drunk'],
    drive: ['drove', 'driven'], eat: ['ate', 'eaten'], fall: ['fell', 'fallen'],
    feed: ['fed', 'fed'], feel: ['felt', 'felt'], fight: ['fought', 'fought'],
    find: ['found', 'found'], flee: ['fled', 'fled'], fly: ['flew', 'flown'],
    forbid: ['forbade', 'forbidden'], forget: ['forgot', 'forgotten'],
    forgive: ['forgave', 'forgiven'], freeze: ['froze', 'frozen'],
    get: ['got', 'gotten'], give: ['gave', 'given'], go: ['went', 'gone'],
    grind: ['ground', 'ground'], grow: ['grew', 'grown'], hang: ['hung', 'hung'],
    have: ['had', 'had'], hear: ['heard', 'heard'], hide: ['hid', 'hidden'],
    hit: ['hit', 'hit'], hold: ['held', 'held'], hurt: ['hurt', 'hurt'],
    keep: ['kept', 'kept'], kneel: ['knelt', 'knelt'], know: ['knew', 'known'],
    lay: ['laid', 'laid'], lead: ['led', 'led'], lean: ['leant', 'leant'],
    leap: ['leapt', 'leapt'], learn: ['learnt', 'learnt'], leave: ['left', 'left'],
    lend: ['lent', 'lent'], let: ['let', 'let'], lie: ['lay', 'lain'],
    light: ['lit', 'lit'], lose: ['lost', 'lost'], make: ['made', 'made'],
    mean: ['meant', 'meant'], meet: ['met', 'met'], mistake: ['mistook', 'mistaken'],
    overcome: ['overcame', 'overcome'], pay: ['paid', 'paid'], prove: ['proved', 'proven'],
    put: ['put', 'put'], quit: ['quit', 'quit'], read: ['read', 'read'],
    ride: ['rode', 'ridden'], ring: ['rang', 'rung'], rise: ['rose', 'risen'],
    run: ['ran', 'run'], say: ['said', 'said'], see: ['saw', 'seen'],
    seek: ['sought', 'sought'], sell: ['sold', 'sold'], send: ['sent', 'sent'],
    set: ['set', 'set'], shake: ['shook', 'shaken'], shed: ['shed', 'shed'],
    shine: ['shone', 'shone'], shoot: ['shot', 'shot'], show: ['showed', 'shown'],
    shrink: ['shrank', 'shrunk'], shut: ['shut', 'shut'], sing: ['sang', 'sung'],
    sink: ['sank', 'sunk'], sit: ['sat', 'sat'], sleep: ['slept', 'slept'],
    slide: ['slid', 'slid'], smell: ['smelt', 'smelt'], speak: ['spoke', 'spoken'],
    speed: ['sped', 'sped'], spell: ['spelt', 'spelt'], spend: ['spent', 'spent'],
    spill: ['spilt', 'spilt'], spin: ['spun', 'spun'], spit: ['spat', 'spat'],
    split: ['split', 'split'], spread: ['spread', 'spread'], spring: ['sprang', 'sprung'],
    stand: ['stood', 'stood'], steal: ['stole', 'stolen'], stick: ['stuck', 'stuck'],
    sting: ['stung', 'stung'], stink: ['stank', 'stunk'], strike: ['struck', 'struck'],
    swear: ['swore', 'sworn'], sweep: ['swept', 'swept'], swim: ['swam', 'swum'],
    swing: ['swung', 'swung'], take: ['took', 'taken'], teach: ['taught', 'taught'],
    tear: ['tore', 'torn'], tell: ['told', 'told'], think: ['thought', 'thought'],
    throw: ['threw', 'thrown'], understand: ['understood', 'understood'],
    undertake: ['undertook', 'undertaken'], wake: ['woke', 'woken'],
    wear: ['wore', 'worn'], weave: ['wove', 'woven'], weep: ['wept', 'wept'],
    win: ['won', 'won'], wind: ['wound', 'wound'], withdraw: ['withdrew', 'withdrawn'],
    write: ['wrote', 'written']
  };

  var IRRN = {
    child: 'children', foot: 'feet', tooth: 'teeth', goose: 'geese', man: 'men',
    woman: 'women', mouse: 'mice', louse: 'lice', ox: 'oxen', basis: 'bases',
    analysis: 'analyses', crisis: 'crises', thesis: 'theses', phenomenon: 'phenomena',
    criterion: 'criteria', datum: 'data', medium: 'media', bacterium: 'bacteria',
    curriculum: 'curricula', sheep: 'sheep', deer: 'deer', means: 'means',
    series: 'series', species: 'species', fish: 'fish', aircraft: 'aircraft',
    knife: 'knives', life: 'lives', wife: 'wives', leaf: 'leaves', half: 'halves',
    shelf: 'shelves', thief: 'thieves', wolf: 'wolves', self: 'selves',
    belief: 'beliefs', chief: 'chiefs', roof: 'roofs', proof: 'proofs'
  };

  var IRRA = {
    good: ['better', 'best'], bad: ['worse', 'worst'], many: ['more', 'most'],
    much: ['more', 'most'], little: ['less', 'least'], far: ['farther', 'farthest'],
    old: ['older', 'oldest'], well: ['better', 'best']
  };

  var FE_VES = {'knife': 1, 'life': 1, 'wife': 1, 'leaf': 1, 'half': 1, 'shelf': 1, 'thief': 1, 'wolf': 1, 'self': 1};
  var O_ES = {'potato': 1, 'tomato': 1, 'hero': 1, 'echo': 1, 'veto': 1, 'volcano': 1};
  var DOUBLE = {'begin': 1, 'prefer': 1, 'occur': 1, 'admit': 1, 'permit': 1, 'refer': 1,
    'regret': 1, 'control': 1, 'forget': 1, 'upset': 1, 'equip': 1, 'compel': 1,
    'transfer': 1, 'commit': 1, 'submit': 1, 'omit': 1, 'patrol': 1, 'confer': 1,
    'infer': 1, 'deter': 1, 'incur': 1, 'recur': 1, 'propel': 1, 'excel': 1};

  var VOW = 'aeiou';
  function isCons(c) { return !!c && /[a-z]/.test(c) && VOW.indexOf(c) < 0; }
  function syll(w) {
    var s = String(w).toLowerCase().replace(/[^a-z]/g, '');
    var m = s.match(/[aeiouy]+/g);
    var n = m ? m.length : 0;
    if (/[^aeiou]e$/.test(s) && n > 1) n--;
    return n || 1;
  }
  function cvc(w) {
    var s = String(w).toLowerCase();
    if (s.length < 3) return false;
    var a = s[s.length - 3], b = s[s.length - 2], c = s[s.length - 1];
    return isCons(a) && VOW.indexOf(b) >= 0 && isCons(c) && 'wxy'.indexOf(c) < 0;
  }
  function needDouble(w) {
    var s = String(w).toLowerCase();
    if (!cvc(s)) return false;
    if (syll(s) === 1) return true;
    return !!DOUBLE[s];
  }

  function thirdOf(w) {
    if (w === 'have') return 'has';
    if (w === 'be') return 'is';
    if (/(s|x|z|ch|sh|o)$/.test(w)) return w + 'es';
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
    return w + 's';
  }
  function pastOf(w) {
    if (IRRV[w]) return IRRV[w][0];
    if (/e$/.test(w)) return w + 'd';
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ied';
    if (needDouble(w)) return w + w.slice(-1) + 'ed';
    return w + 'ed';
  }
  function ppOf(w) {
    if (IRRV[w]) return IRRV[w][1];
    return pastOf(w);
  }
  function ingOf(w) {
    if (w.length <= 2) return w + 'ing';
    if (/ie$/.test(w)) return w.slice(0, -2) + 'ying';
    if (/[^e]e$/.test(w)) return w.slice(0, -1) + 'ing';
    if (needDouble(w)) return w + w.slice(-1) + 'ing';
    return w + 'ing';
  }
  function pluralOf(w) {
    if (IRRN[w]) return IRRN[w];
    if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
    if (FE_VES[w]) return w.slice(0, -2) + 'ves';
    if (/f$/.test(w) && FE_VES[w]) return w.slice(0, -1) + 'ves';
    if (/o$/.test(w)) return O_ES[w] ? w + 'es' : w + 's';
    return w + 's';
  }
  function compOf(w) {
    if (IRRA[w]) return IRRA[w][0];
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ier';
    if (/e$/.test(w)) return w + 'r';
    if (needDouble(w)) return w + w.slice(-1) + 'er';
    if (/(ly|ful|ous|ive|ing|ed|al|ic|able|ible)$/.test(w) || syll(w) >= 3) return 'more ' + w;
    return w + 'er';
  }
  function supOf(w) {
    if (IRRA[w]) return IRRA[w][1];
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'iest';
    if (/e$/.test(w)) return w + 'st';
    if (needDouble(w)) return w + w.slice(-1) + 'est';
    if (/(ly|ful|ous|ive|ing|ed|al|ic|able|ible)$/.test(w) || syll(w) >= 3) return 'most ' + w;
    return w + 'est';
  }
  function advOf(w) {
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ily';
    if (/ble$/.test(w)) return w.slice(0, -2) + 'ly';   // possible -> possibly
    if (/le$/.test(w)) return w.slice(0, -2) + 'ly';   // simple -> simply
    if (/ic$/.test(w)) return w + 'ally';
    if (/ue$/.test(w)) return w.slice(0, -1) + 'ly';   // true -> truly
    if (/ll$/.test(w)) return w + 'y';                 // full -> fully
    return w + 'ly';
  }

  /* 变形列表 */
  function inflect(e) {
    var w = e.w, out = [];
    if (isVerb(e)) {
      out.push(['第三人称单数', thirdOf(w)]);
      out.push(['过去式', pastOf(w)]);
      out.push(['过去分词', ppOf(w)]);
      out.push(['现在分词', ingOf(w)]);
    }
    if (hasPos(e, 'n')) out.push(['复数', pluralOf(w)]);
    if (hasPos(e, 'adj')) {
      out.push(['比较级', compOf(w)]);
      out.push(['最高级', supOf(w)]);
      out.push(['副词', advOf(w)]);
    }
    return out;
  }

  /* ---------------- 3. 搭配 / 句型 ---------------- */
  var EMO_RE = /高兴|快乐|幸福|愉快|愿意|乐意|抱歉|遗憾|害怕|担心|忧虑|骄傲|自豪|生气|愤怒|难过|悲伤|满意|惊奇|惊讶|激动|失望|羞|渴望|急于|骄傲/;
  var IT_RE = /困难|容易|重要|必要|可能|有用|无用|常见|自然|奇怪|危险|安全|明智|愚蠢|礼貌|粗鲁|有益|清楚|明显|合适|方便|健康|正常|现实|公平|值得/;
  function patterns(e) {
    var out = [], z = e.z || '', w = e.w;
    if (hasPos(e, 'vt')) {
      out.push(w + ' sth.　　及物：直接接名词/代词作宾语');
      out.push('be ' + ppOf(w) + ' by sth.　　被动语态：被…所…');
      if (/使|令|让/.test(z)) out.push(w + ' sb./sth. + adj.　　使…变得…');
      if (V_DOING[w]) out.push(w + ' doing sth.　　只接动名词（高考高频）');
      else if (V_TODO[w]) out.push(w + ' to do sth.　　只接不定式');
    }
    if (hasPos(e, 'vi')) {
      out.push(w + ' + 介词 + 宾语　　不及物：须借 with / for / in / to / at 接宾语');
      out.push(w + ' + 副词　　不及物可单独用，常跟 well / hard / fast 等副词');
    }
    if (hasPos(e, 'n')) {
      if (UNCOUNT[w]) {
        out.push(w + '　　不可数名词：不加 a/an，也没有复数');
        out.push('a piece of ' + w + '　　计量用 piece / bit 等');
      } else {
        out.push(art(w) + ' ' + w + '　　可数名词单数必须带冠词（a/an）');
        out.push('the ' + w + ' of sth.　　…的…（定语用 of）');
      }
      out.push(w + ' + 名词　　名词作定语修饰后词（构成复合名词）');
    }
    if (hasPos(e, 'adj')) {
      if (PREDICATIVE[w]) out.push('be ' + w + '　　只作表语，不能直接放在名词前');
      else out.push(art(w) + ' ' + w + ' + n.　　作定语修饰名词');
      if (EMO_RE.test(z)) out.push('be ' + w + ' to do sth.　　表情感/意愿，接不定式');
      else if (IT_RE.test(z)) out.push('It is ' + w + ' (for sb.) to do sth.　　形式主语 it 句型');
      else out.push('be ' + w + ' + 介词 + sth.　　介词搭配按词记忆（about / at / with / of）');
    }
    if (hasPos(e, 'adv')) out.push(w + ' + v./adj.　　修饰动词或形容词');
    if (hasPos(e, 'prep')) out.push(w + ' + n./pron./doing　　后接宾语');
    if (hasPos(e, 'conj')) out.push(w + ' + 句子　　引导从句');
    return out.slice(0, 4);
  }

  /* ---------------- 4. 词族 / 派生 ---------------- */
  /* 精编词族：考试最爱考的转换，人工校对 */
  var DERIV = {
    abandon: [['abandonment', 'n. 放弃；遗弃'], ['abandoned', 'adj. 被遗弃的']],
    absorb: [['absorption', 'n. 吸收；专注'], ['absorbed', 'adj. 全神贯注的']],
    accept: [['acceptance', 'n. 接受；认可'], ['acceptable', 'adj. 可接受的']],
    accomplish: [['accomplishment', 'n. 成就；完成']],
    achieve: [['achievement', 'n. 成就；达到'], ['achievable', 'adj. 可实现的']],
    acquire: [['acquisition', 'n. 获得；收购']],
    adapt: [['adaptation', 'n. 适应；改编'], ['adaptable', 'adj. 能适应的']],
    admit: [['admission', 'n. 承认；准入'], ['admittance', 'n. 进入权']],
    advantage: [['advantageous', 'adj. 有利的'], ['disadvantage', 'n. 不利条件']],
    advise: [['advice', 'n. 建议（不可数）'], ['advisable', 'adj. 明智的']],
    affect: [['affection', 'n. 喜爱；感情'], ['affective', 'adj. 情感的']],
    agree: [['agreement', 'n. 协议；同意'], ['disagree', 'v. 不同意']],
    analyze: [['analysis', 'n. 分析'], ['analytical', 'adj. 分析的']],
    announce: [['announcement', 'n. 公告；宣布']],
    appear: [['appearance', 'n. 出现；外貌'], ['disappear', 'v. 消失']],
    apply: [['application', 'n. 申请；应用'], ['applicant', 'n. 申请人']],
    appreciate: [['appreciation', 'n. 欣赏；感激']],
    approve: [['approval', 'n. 批准；赞成'], ['disapprove', 'v. 不赞成']],
    argue: [['argument', 'n. 争论；论点']],
    arrive: [['arrival', 'n. 到达']],
    assist: [['assistance', 'n. 帮助'], ['assistant', 'n. 助手']],
    assume: [['assumption', 'n. 假设；承担']],
    attend: [['attention', 'n. 注意'], ['attendance', 'n. 出席；出席人数']],
    attract: [['attraction', 'n. 吸引；景点'], ['attractive', 'adj. 有吸引力的']],
    believe: [['belief', 'n. 信念'], ['believable', 'adj. 可信的']],
    benefit: [['beneficial', 'adj. 有益的']],
    care: [['careful', 'adj. 小心的'], ['careless', 'adj. 粗心的']],
    choose: [['choice', 'n. 选择']],
    clarify: [['clarity', 'n. 清晰'], ['clear', 'adj. 清楚的']],
    compete: [['competition', 'n. 竞争；比赛'], ['competitive', 'adj. 有竞争力的'], ['competitor', 'n. 竞争者']],
    conclude: [['conclusion', 'n. 结论']],
    confident: [['confidence', 'n. 信心'], ['confidential', 'adj. 机密的']],
    confuse: [['confusion', 'n. 混乱；困惑'], ['confused', 'adj. 感到困惑的'], ['confusing', 'adj. 令人困惑的']],
    contribute: [['contribution', 'n. 贡献'], ['contributor', 'n. 贡献者']],
    decide: [['decision', 'n. 决定'], ['decisive', 'adj. 决定性的']],
    deep: [['depth', 'n. 深度'], ['deepen', 'v. 加深'], ['deeply', 'adv. 深深地']],
    depend: [['dependence', 'n. 依赖'], ['dependent', 'adj. 依赖的'], ['independent', 'adj. 独立的']],
    develop: [['development', 'n. 发展'], ['developing', 'adj. 发展中的']],
    differ: [['difference', 'n. 差异'], ['different', 'adj. 不同的']],
    difficult: [['difficulty', 'n. 困难']],
    discover: [['discovery', 'n. 发现']],
    economy: [['economic', 'adj. 经济的'], ['economical', 'adj. 节约的'], ['economist', 'n. 经济学家']],
    educate: [['education', 'n. 教育'], ['educator', 'n. 教育工作者']],
    effect: [['effective', 'adj. 有效的'], ['efficient', 'adj. 高效的']],
    employ: [['employment', 'n. 就业'], ['employer', 'n. 雇主'], ['employee', 'n. 雇员']],
    encourage: [['encouragement', 'n. 鼓励'], ['discourage', 'v. 使气馁']],
    energy: [['energetic', 'adj. 精力充沛的']],
    environment: [['environmental', 'adj. 环境的']],
    equal: [['equality', 'n. 平等'], ['equally', 'adv. 同样地']],
    exist: [['existence', 'n. 存在'], ['existing', 'adj. 现存的']],
    expect: [['expectation', 'n. 期望'], ['unexpected', 'adj. 意外的']],
    explain: [['explanation', 'n. 解释']],
    express: [['expression', 'n. 表达；表情'], ['expressive', 'adj. 富于表现力的']],
    fail: [['failure', 'n. 失败'], ['failing', 'n. 弱点']],
    health: [['healthy', 'adj. 健康的'], ['unhealthy', 'adj. 不健康的']],
    imagine: [['imagination', 'n. 想象力'], ['imaginative', 'adj. 富有想象力的']],
    impress: [['impression', 'n. 印象'], ['impressive', 'adj. 令人印象深刻的']],
    inform: [['information', 'n. 信息（不可数）']],
    innovate: [['innovation', 'n. 创新'], ['innovative', 'adj. 创新的']],
    intend: [['intention', 'n. 意图'], ['intentional', 'adj. 故意的']],
    introduce: [['introduction', 'n. 介绍；引言']],
    invent: [['invention', 'n. 发明'], ['inventor', 'n. 发明家']],
    know: [['knowledge', 'n. 知识（不可数）'], ['knowledgeable', 'adj. 博学的']],
    manage: [['management', 'n. 管理'], ['manager', 'n. 经理']],
    perform: [['performance', 'n. 表演；表现']],
    permit: [['permission', 'n. 许可']],
    prefer: [['preference', 'n. 偏爱；偏好']],
    produce: [['production', 'n. 生产'], ['product', 'n. 产品'], ['productive', 'adj. 多产的']],
    pronounce: [['pronunciation', 'n. 发音']],
    propose: [['proposal', 'n. 提议']],
    protect: [['protection', 'n. 保护'], ['protective', 'adj. 保护的']],
    rely: [['reliable', 'adj. 可靠的'], ['reliance', 'n. 依赖']],
    require: [['requirement', 'n. 要求']],
    satisfy: [['satisfaction', 'n. 满意'], ['satisfactory', 'adj. 令人满意的'], ['satisfied', 'adj. 满意的']],
    science: [['scientific', 'adj. 科学的'], ['scientist', 'n. 科学家']],
    succeed: [['success', 'n. 成功'], ['successful', 'adj. 成功的'], ['successive', 'adj. 连续的']],
    suggest: [['suggestion', 'n. 建议']],
    translate: [['translation', 'n. 翻译'], ['translator', 'n. 译者']],
    vary: [['variety', 'n. 多样性'], ['various', 'adj. 各种各样的'], ['variable', 'adj. 可变的']]
  };

  function formCandidates(w, p) {
    var out = [], base = w;
    function push(f, note) { if (f && out.indexOf(f + '|' + note) < 0) out.push(f + '|' + note); }
    if (p.indexOf('vt') >= 0 || p.indexOf('vi') >= 0 || p.indexOf('v') >= 0) {
      push(base + 'ment', 'n.');
      if (/t$/.test(base)) push(base + 'ion', 'n.');
      if (/te$/.test(base)) push(base.slice(0, -1) + 'ion', 'n.');
      if (/ve$/.test(base)) { push(base + 'ment', 'n.'); push(base.slice(0, -1) + 'al', 'n.'); }
      if (/e$/.test(base)) push(base.slice(0, -1) + 'ation', 'n.');
      push(base + 'er', 'n.(人/物)');
      push(base + 'or', 'n.(人/物)');
      push(base + 'ing', 'n./adj.');
      push(base + 'ive', 'adj.');
      push(base + 'able', 'adj.');
      push(base + 'ance', 'n.');
      push(base + 'ence', 'n.');
    }
    if (p.indexOf('n') >= 0) {
      push(base + 'al', 'adj.');
      push(base + 'ful', 'adj.');
      push(base + 'less', 'adj.');
      push(base + 'ous', 'adj.');
      push(base + 'ic', 'adj.');
      push(base + 'ive', 'adj.');
      if (/[^aeiou]y$/.test(base)) push(base.slice(0, -1) + 'ical', 'adj.');
      push(base + 'ize', 'v.');
      push(base + 'en', 'v.');
    }
    if (p.indexOf('adj') >= 0) {
      push(base + 'ness', 'n.');
      if (/[^aeiou]y$/.test(base)) push(base.slice(0, -1) + 'iness', 'n.');
      if (/e$/.test(base)) push(base.slice(0, -1) + 'ity', 'n.');
      push(base + 'ity', 'n.');
      push(base + 'th', 'n.');
      push(advOf(base), 'adv.');
      push(base + 'en', 'v.');
      push(base + 'ize', 'v.');
    }
    return out;
  }

  function family(e) {
    var out = [], seen = Object.create(null);
    out.push({ w: e.w, note: '原词', self: true });
    seen[e.w] = 1;
    (DERIV[e.w] || []).forEach(function (pair) {
      if (seen[pair[0]]) return;
      seen[pair[0]] = 1;
      out.push({ w: pair[0], note: pair[1], curated: true });
    });
    formCandidates(e.w, posCodes(e)).forEach(function (s) {
      var parts = s.split('|'), f = parts[0], note = parts[1];
      if (seen[f] || !WS[f]) return;      // 关键：只保留词库中真实存在的派生词
      seen[f] = 1;
      out.push({ w: f, note: note, verified: true });
    });
    return out.slice(0, 7);
  }

  /* ---------------- 5. 例句模板 ---------------- */
  /* 抽象/具体判断：靠释义关键词，决定用哪种名词例句更自然 */
  var ABSTRACT_RE = /性|感|度|主义|概念|状态|关系|精神|品质|现象|过程|行为|情况|能力|思想|感情|意见|情绪|自由|权利|理论|意识|价值|机会|经验|信息|知识|技术|方法|政策|制度|文化|教育|经济|政治|社会|历史|科学|艺术|责任|义务|影响|作用|意义|目标|任务|问题|原因|结果|效果|标准|原则|观念|态度|兴趣|爱好|习惯|趋势|方式|手段|措施|危机|风险|压力|负担|优势|劣势|特点|特征|性质|本质|定义|主题|观点|建议|要求|命令|决定|选择|记忆|想象|思维|逻辑|命运|希望|梦想|爱情|友谊|和平|战争|宗教|法律|规则|系统|形势|局面|地位|身份|荣誉|信念|意志|良心|智慧|才华|气氛|风景/;
  /* 构词后缀也能判定抽象：-tion/-ment/-ity 等几乎都是不可数抽象名词 */
  var ABS_SUFFIX = /(tion|sion|ment|ness|ity|ance|ence|ship|hood|ism|th|cy|logy|graphy|ure)$/i;
  var MASS = { 'equipment': 1, 'furniture': 1, 'information': 1, 'knowledge': 1, 'pollution': 1,
    'education': 1, 'luggage': 1, 'baggage': 1, 'machinery': 1, 'clothing': 1, 'scenery': 1,
    'homework': 1, 'housework': 1, 'weather': 1, 'traffic': 1, 'money': 1, 'music': 1,
    'research': 1, 'evidence': 1, 'progress': 1, 'news': 1, 'advice': 1, 'bread': 1,
    'paper': 1, 'fun': 1, 'harm': 1, 'damage': 1, 'staff': 1, 'wealth': 1, 'health': 1,
    'nonsense': 1, 'vocabulary': 1 };
  function isAbstract(e) {
    var w = String(e.w || '');
    if (MASS[w] || ABS_SUFFIX.test(w)) return true;
    return ABSTRACT_RE.test(e.z || '');
  }
  function art(w) { return /^[aeiou]/i.test(w) ? 'an' : 'a'; }

  var TPL = {
    n: ['We had a long discussion about the {w} yesterday.',
      'Nobody can ignore the importance of {w} in our life.',
      'More and more attention is paid to {w} today.'],
    nc: ['I have never seen such {art} {w} before.',
      'The {w} is right there in front of you.',
      'He picked up the {w} and walked away.'],
    vt: ['They decided to {w} it at once.',
      'We should learn to {w} it in a better way.',
      'Nobody can {w} it, so let us try together.'],
    vi: ['Something strange began to {w} after that.',
      'Things will {w} quickly if we take action.'],
    adj: ['The {w} one is over there, next to the door.',
      'Everyone agrees that it is very {w}.',
      'It was a {w} moment for everyone.'],
    itadj: ['It is {w} (for us) to finish the task on time.',
      'It is {w} that so many people joined in.'],
    emoadj: ['She was {w} to hear the good news.',
      'He is always {w} to help others in need.'],
    adv: ['He finished the work {w} without any help.'],
    prep: ['{w} the help of my teacher, I made great progress.'],
    conj: ['{w} we try our best, we will succeed in the end.']
  };

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h);
  }

  function templates(e) {
    var p = posCodes(e), out = [], keys = [];
    var first = p[0] || '';
    var nounFirst = (first === 'n' || first === '');
    var verbFirst = (first === 'v' || first === 'vt' || first === 'vi');
    /* 名词：抽象/不可数走 n，具体且以名词为主才走 nc，避免 “the red / picked up the pollution” */
    if (p.indexOf('n') >= 0 && (nounFirst || p.length === 1)) keys.push(isAbstract(e) ? 'n' : 'nc');
    /* 动词：只有动词打头的词才套动词句型，避免 long→"Things will long quickly" */
    if (verbFirst && (p.indexOf('vt') >= 0 || p.indexOf('v') >= 0)) keys.push('vt');
    if (verbFirst && p.indexOf('vi') >= 0) keys.push('vi');
    if (p.indexOf('adj') >= 0) {
      var z = e.z || '', pureAdj = (p.length === 1);
      keys.push(pureAdj && EMO_RE.test(z) ? 'emoadj' : (pureAdj && IT_RE.test(z) ? 'itadj' : 'adj'));
    }
    if (first === 'adv' && p.indexOf('adv') >= 0) keys.push('adv');
    if (p.indexOf('prep') >= 0) keys.push('prep');
    if (p.indexOf('conj') >= 0) keys.push('conj');
    if (!keys.length) keys.push('n');
    var h = hash(e.w);
    keys.slice(0, 3).forEach(function (k, ki) {
      var arr = TPL[k] || TPL.n, base = h + ki * 7;
      for (var t = 0; t < arr.length && out.length < 3; t++) {
        var s = arr[(base + t) % arr.length];
        if (out.indexOf(s) < 0) out.push(s);
      }
    });
    // 及物动词再加一条过去式句子，展示变形（不及物动词不硬加宾语）
    if (hasPos(e, 'vt') && out.length < 3) {
      out.push('He ' + pastOf(e.w) + ' it last week and never looked back.');
    }
    return out.slice(0, 3).map(function (s) {
      return s.replace(/\{art\}/g, art(e.w)).replace(/\{w\}/g, e.w);
    });
  }

  /* ---------------- 6. 考点提示 ---------------- */
  var UNCOUNT = {'information': 1, 'advice': 1, 'furniture': 1, 'equipment': 1, 'luggage': 1,
    'baggage': 1, 'knowledge': 1, 'progress': 1, 'weather': 1, 'news': 1, 'traffic': 1,
    'homework': 1, 'housework': 1, 'money': 1, 'music': 1, 'bread': 1, 'paper': 1,
    'research': 1, 'evidence': 1, 'machinery': 1, 'clothing': 1, 'scenery': 1, 'fun': 1,
    'harm': 1, 'damage': 1, 'staff': 1};

  var PREDICATIVE = {'afraid': 1, 'alike': 1, 'alive': 1, 'asleep': 1, 'awake': 1,
    'aware': 1, 'alone': 1, 'ashamed': 1, 'fond': 1, 'worth': 1, 'sure': 1, 'unable': 1};

  var V_DOING = {'enjoy': 1, 'mind': 1, 'avoid': 1, 'suggest': 1, 'consider': 1, 'finish': 1,
    'practise': 1, 'practice': 1, 'imagine': 1, 'admit': 1, 'deny': 1, 'risk': 1, 'miss': 1,
    'delay': 1, 'excuse': 1, 'escape': 1, 'appreciate': 1, 'keep': 1, 'resist': 1,
    'forgive': 1, 'include': 1, 'mention': 1, 'tolerate': 1, 'quit': 1};

  var V_TODO = {'decide': 1, 'hope': 1, 'refuse': 1, 'manage': 1, 'afford': 1, 'offer': 1,
    'pretend': 1, 'promise': 1, 'agree': 1, 'expect': 1, 'plan': 1, 'want': 1, 'wish': 1,
    'learn': 1, 'fail': 1, 'choose': 1, 'determine': 1, 'desire': 1, 'intend': 1,
    'prepare': 1, 'attempt': 1, 'long': 1, 'arrange': 1, 'demand': 1};

  var HIGH = (' abandon absorb abstract academic access accommodate accompany accomplish account ' +
    'accurate achieve acquire adapt adequate adjust administration adopt advance affect afford ' +
    'aggressive alter alternative amount analysis analyze ancient anticipate anxiety appeal ' +
    'appreciate approach appropriate approve argue arise arrange artificial aspect assess assign ' +
    'assist assume assure attach attain attempt attitude attract authority available aware benefit ' +
    'capable capacity career challenge character claim commit community compare compete complex ' +
    'concentrate concept conclude conduct confident confirm conflict consequence consider consist ' +
    'constant consume contain contribute convince crucial decline define demand demonstrate deny ' +
    'depend deserve determine device devote distinguish distribute diverse dominate efficient ' +
    'eliminate emerge emphasize enable encounter encourage enhance ensure enthusiasm equip ' +
    'essential establish estimate evaluate evidence evolve exceed exclude expand explore expose ' +
    'extend facility factor feature figure flexible focus forbid formal fortune foundation ' +
    'frequent frustrate function generate genuine global guarantee handle hesitate highlight ' +
    'identify ignore illustrate implement imply impose impress incident indicate individual ' +
    'inevitable influence inform initial insist inspire install instance institute intend intense ' +
    'interact interfere interpret interrupt involve isolate issue justify maintain major manage ' +
    'manufacture measure mechanism mention method minor modify monitor motive mutual neglect ' +
    'negotiate nevertheless notion obey object observe obtain obvious occasion occupy occur ' +
    'operate opportunity oppose optimistic option organize origin outcome outline overcome ' +
    'overlook participate particular pattern perceive perform permanent permit persist ' +
    'perspective persuade phenomenon policy positive possess potential practical precise ' +
    'predict prefer prejudice preserve prevent previous priority proceed process produce ' +
    'profession profit promote propose prospect prove provide publish purchase pursue qualify ' +
    'quantity range rapid rare rational react realize reasonable recognize recommend recover ' +
    'reduce refer reflect refuse regard register regret regulate reject relate release relevant ' +
    'reliable relieve remain remark remind remote remove replace represent reputation require ' +
    'rescue research resemble reserve resist resolve resource respect respond responsible ' +
    'restore restrict result retain reveal reverse review revise reward role sacrifice satisfy ' +
    'scale scheme secure seek select sensitive separate sequence serious settle severe shift ' +
    'significant similar simplify situation solve source specific spirit spread stable standard ' +
    'status stimulate strategy stress structure struggle submit subsequent substitute sufficient ' +
    'suggest summarize superior supply suppose surface survey survive suspect sustain symbol ' +
    'sympathy system tackle target technique temporary tend tension theory therefore thorough ' +
    'threat tolerate trace tradition transfer transform transmit transport treat trend trust ' +
    'typical ultimate undergo undertake unique universal update urban urge utilize vague valid ' +
    'variety various vary vast vehicle verify version victim violate virtual virtue visible ' +
    'vital vivid voluntary vote warn waste wealth welfare whereas witness yield ').split(/\s+/);
  var HIGHSET = Object.create(null);
  HIGH.forEach(function (w) { HIGHSET[w] = 1; });

  function tips(e) {
    var out = [], w = e.w, p = posCodes(e);
    if (HIGHSET[w]) out.push('⭐ 四级/高考高频核心词：拼写、搭配、词性转换都要会');
    if (/[^aeiou]ly$/.test(w) && p.indexOf('adj') >= 0)
      out.push('⚠ -ly 结尾但这里是形容词，别当副词（同类：friendly, lovely, lonely, lively）');
    if (/ed$/.test(w) && WS[w.slice(0, -2) + 'ing'])
      out.push('⚠ -ed / -ing 形容词：-ed 多修饰人（感到…），-ing 多修饰物（令人…）');
    if (p.indexOf('n') >= 0 && p.indexOf('v') >= 0)
      out.push('一词多性：名/动兼类，完形填空常靠词性判断');
    if (UNCOUNT[w]) out.push('不可数名词：不加 a/an，也没有复数形式');
    if (!UNCOUNT[w] && p.indexOf('n') >= 0) {
      if (pluralOf(w) !== w + 's') out.push('复数特殊：' + w + ' → ' + pluralOf(w) + '（拼写常考）');
      else out.push('可数名词：复数 ' + pluralOf(w) + '，单数前要加 a/an 或 the');
    }
    if (IRRV[w]) out.push('不规则动词：' + pastOf(w) + ' / ' + ppOf(w) + '（过去式 / 过去分词）');
    if (PREDICATIVE[w]) out.push('只作表语/后置定语，不能直接放在名词前（如不能说 an afraid boy）');
    if (V_DOING[w]) out.push('后接动名词：' + w + ' doing sth.（高考高频）');
    if (V_TODO[w]) out.push('后接不定式：' + w + ' to do sth.');
    if (w.length >= 10) out.push('长词：按词根+前缀/后缀拆开记，比逐字母背快得多');
    if (p.indexOf('vt') >= 0 && p.indexOf('vi') >= 0) out.push('及物/不及物兼类：注意后面是否直接接宾语');
    if (DERIV[w]) out.push('常考词形转换：' + DERIV[w].map(function (x) { return x[0]; }).join(' / '));
    if (p.indexOf('adj') >= 0 && !DERIV[w] && p.length === 1)
      out.push('形容词用法：作定语/表语；比较级 ' + compOf(w) + '，最高级 ' + supOf(w));
    return out.slice(0, 4);
  }

  /* 难度评分（1-5），用于 Wordle 长度/难度匹配 */
  function difficulty(e) {
    var w = e.w, s = 0;
    s += w.length >= 5 ? 1 : 0;
    s += w.length >= 8 ? 1 : 0;
    s += w.length >= 10 ? 1 : 0;
    if (/[^aeiou]{3,}/.test(w)) s += 1;        // 连续辅音难拼
    if (/(tion|ment|ness|ity|ous|ive|able)$/.test(w)) s += 1;
    return Math.min(5, s);
  }

  global.WE = {
    setLexicon: setLexicon,
    posCodes: posCodes, posLabel: posLabel, posShort: posShort, hasPos: hasPos,
    isVerb: isVerb, senses: senses, inflect: inflect, patterns: patterns,
    family: family, templates: templates, tips: tips, difficulty: difficulty,
    advOf: advOf, pastOf: pastOf, ingOf: ingOf, pluralOf: pluralOf,
    isHighFreq: function (w) { return !!HIGHSET[w]; },
    hash: hash
  };
})(window);
