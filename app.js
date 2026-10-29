(function () {
  "use strict";

  var KEY = "zhihangji.v1";
  var CATS = [
    { id: "配件", color: "#7464b0" },
    { id: "玩偶", color: "#d4896a" },
    { id: "衣服", color: "#5d93b5" },
    { id: "家居", color: "#6aa384" },
    { id: "其他", color: "#9a93ad" }
  ];
  var SORTS = [
    { id: "default", label: "默认" },
    { id: "update", label: "更新" },
    { id: "progress", label: "进度" },
    { id: "category", label: "分类" },
    { id: "name", label: "名称" }
  ];

  function uid() {
    return "p" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function todayKey(date) {
    var d = date || new Date();
    var z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  function fmtClock(ms) {
    var s = Math.floor(Math.max(0, ms) / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    return h + ":" + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  }

  function fmtShort(ms) {
    var s = Math.floor(Math.max(0, ms) / 1000);
    if (s < 60) return s + "秒";
    return fmtClock(ms);
  }

  function splitPages(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var pages = [[]];
    lines.forEach(function (line) {
      if (/^\s*-{3,}\s*$/.test(line) || /^\s*第\s*\d+\s*页\s*$/.test(line) || /^\s*【第.+页】\s*$/.test(line)) {
        pages.push([]);
      } else {
        pages[pages.length - 1].push(line);
      }
    });
    return pages.map(function (p) { return p.join("\n"); });
  }

  function isSection(text) {
    if (!text || text.length > 28) return false;
    return /^(#{1,3}\s+)?([一二三四五六七八九十]+[、.．]|第[一二三四五六七八九十0-9]+[部分节段章]|【[^】]{1,16}】)/.test(text);
  }

  function isNote(text) {
    return /^(注意|提示|重要|※|★|注[:：])/.test(text) || /^[（(][^）)]+[）)]$/.test(text);
  }

  function splitTail(body) {
    var instruction = body || "";
    var note = "";
    var count = null;
    var noteMatch = instruction.match(/[（(]([^）)]+)[）)]\s*$/);
    if (noteMatch && !/^\d+\s*针?$/.test(noteMatch[1].trim())) {
      note = noteMatch[1].trim();
      instruction = instruction.slice(0, noteMatch.index).trim();
    }
    var countMatch = instruction.match(/[（(]\s*(\d+)\s*针?\s*[）)]\s*$/);
    if (countMatch) {
      count = Number(countMatch[1]);
      instruction = instruction.slice(0, countMatch.index).trim();
    }
    return { instruction: instruction, count: count, note: note };
  }

  function matchRow(text) {
    var patterns = [
      { re: /^R\s*(\d+)\s*(?:[-~～—–到至]\s*R?\s*(\d+))?\s*[:：.、]?\s*(.*)$/i, style: "R" },
      { re: /^第\s*(\d+)\s*行\s*(?:[-~～—–到至]\s*第?\s*(\d+)\s*行?)?\s*[:：.、]?\s*(.*)$/, style: "cn" },
      { re: /^第\s*(\d+)\s*[-~～—–到至]\s*第?\s*(\d+)\s*行\s*[:：.、]?\s*(.*)$/, style: "cn" },
      { re: /^(\d+)\s*(?:[-~～—–到至]\s*(\d+))?\s*行\s*[:：.、]?\s*(.*)$/, style: "plain" },
      { re: /^行\s*(\d+)\s*(?:[-~～—–到至]\s*(\d+))?\s*[:：.、]?\s*(.*)$/, style: "plain" }
    ];
    var found = null;
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i].re);
      if (m) { found = { m: m, style: patterns[i].style }; break; }
    }
    if (!found) return null;
    var start = Number(found.m[1]);
    var end = found.m[2] ? Number(found.m[2]) : start;
    if (!isFinite(start) || start < 0 || start > 9999) return null;
    if (!isFinite(end)) end = start;
    if (end < start) { var tmp = start; start = end; end = tmp; }
    if (end - start > 300) end = start + 300;
    var tail = splitTail((found.m[3] || "").trim());
    return {
      kind: "row",
      rowStart: start,
      rowEnd: end,
      style: found.style,
      text: tail.instruction,
      count: tail.count,
      note: tail.note
    };
  }

  function rowLabel(line) {
    if (line.rowStart === line.rowEnd) {
      if (line.style === "cn") return "第" + line.rowStart + "行";
      if (line.style === "plain") return line.rowStart + "行";
      return "R" + line.rowStart;
    }
    if (line.style === "cn") return "第" + line.rowStart + "-" + line.rowEnd + "行";
    if (line.style === "plain") return line.rowStart + "-" + line.rowEnd + "行";
    return "R" + line.rowStart + "-" + line.rowEnd;
  }

  function parsePattern(raw) {
    var chunks = splitPages(raw);
    var pages = [];
    chunks.forEach(function (chunk) {
      var lines = [];
      chunk.split("\n").forEach(function (rawLine) {
        var text = rawLine.trim();
        if (!text) return;
        var row = matchRow(text);
        if (row) lines.push(row);
        else if (isSection(text)) lines.push({ kind: "section", text: text.replace(/^#{1,3}\s+/, "") });
        else if (isNote(text)) lines.push({ kind: "note", text: text });
        else lines.push({ kind: "text", text: text });
      });
      if (lines.length) pages.push({ lines: lines });
    });
    if (!pages.length) pages.push({ lines: [] });
    var rows = [];
    pages.forEach(function (page, pi) {
      page.lines.forEach(function (line, li) {
        line.id = "p" + pi + "l" + li;
        if (line.kind === "row") {
          line.stepStart = rows.length;
          for (var n = line.rowStart; n <= line.rowEnd; n++) {
            rows.push({ page: pi, line: li, row: n, lineId: line.id });
          }
          line.stepEnd = rows.length - 1;
        }
      });
    });
    return { pages: pages, rows: rows };
  }

  function sectionAnchors(parsed) {
    var list = [];
    var seen = 0;
    parsed.pages.forEach(function (page, pi) {
      page.lines.forEach(function (line) {
        if (line.kind === "section") list.push({ title: line.text, step: seen, page: pi });
        else if (line.kind === "row") seen += line.rowEnd - line.rowStart + 1;
      });
    });
    return list;
  }

  function currentSection(parsed, step) {
    var title = "";
    sectionAnchors(parsed).forEach(function (a) { if (a.step <= step) title = a.title; });
    return title;
  }

  var api = { parsePattern: parsePattern, rowLabel: rowLabel, fmtClock: fmtClock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  var app = document.getElementById("app");
  var state = load();
  var view = { name: "library" };
  var ui = {
    query: "",
    selectMode: false,
    selected: {},
    menu: false,
    pagePick: false,
    bump: false,
    scrollRow: false,
    toTop: false,
    draftCat: "配件"
  };
  var hold = null;
  var holdOrigin = null;

  function catColor(id) {
    var found = CATS.filter(function (c) { return c.id === id; })[0];
    return found ? found.color : "#9a93ad";
  }

  function makePattern(partial) {
    var now = Date.now();
    partial = partial || {};
    return {
      id: partial.id || uid(),
      title: String(partial.title || "未命名图解").slice(0, 60),
      category: CATS.some(function (c) { return c.id === partial.category; }) ? partial.category : "其他",
      yarn: String(partial.yarn || "").slice(0, 40),
      needle: String(partial.needle || "").slice(0, 40),
      body: String(partial.body || ""),
      createdAt: partial.createdAt || now,
      updatedAt: partial.updatedAt || now,
      openedAt: partial.openedAt || 0,
      step: isFinite(partial.step) ? partial.step : 0,
      done: !!partial.done,
      freeRow: isFinite(partial.freeRow) ? Math.max(0, partial.freeRow) : 0,
      browsePage: null,
      elapsedMs: isFinite(partial.elapsedMs) ? Math.max(0, partial.elapsedMs) : 0,
      rowElapsedMs: 0,
      tickAt: null
    };
  }

  function scarfText() {
    var lines = [
      "一、罗纹边",
      "4.5mm 棒针，中细线。起针数用 2 的倍数，想改宽窄就改这个数。",
      "R1: 起针 24 针 (24)",
      "R2: 1 下针，1 上针，重复到行尾 (24)"
    ];
    var i;
    for (i = 3; i <= 8; i++) lines.push("R" + i + ": 1 下针，1 上针，重复到行尾 (24)");
    lines.push("R9: 1 下针，1 上针，重复到行尾 (24) （边织好了就可以进入主体）");
    lines.push("二、平针主体");
    lines.push("不够长就按同样的写法往后加行。");
    for (i = 10; i <= 25; i++) {
      var stitch = i % 2 ? "下针" : "上针";
      var extra = i === 12 ? " （可以在这里量一下长度）" : "";
      lines.push("R" + i + ": 24 " + stitch + " (24)" + extra);
    }
    lines.push("三、收边");
    lines.push("R26-33: 1 下针，1 上针，重复到行尾 (24)");
    lines.push("R34: 收针 (24)");
    lines.push("留一段线，把线头藏进罗纹里。");
    return lines.join("\n");
  }

  function coasterText() {
    return [
      "一、圆片杯垫",
      "双头针或轮针，适合中细线。织的时候轻轻拉，避免起针处留下孔。",
      "R1: 起 8 针，连成环 (8)",
      "R2: 每针加 1 针 (16)",
      "R3: 1 下针，加 1 针，重复到行尾 (24)",
      "R4: 2 下针，加 1 针，重复到行尾 (32)",
      "R5: 3 下针，加 1 针，重复到行尾 (40)",
      "R6: 40 下针 (40) （直径差不多就停在这里）",
      "R7: 3 下针，2 并 1，重复到行尾 (32)",
      "R8: 2 下针，2 并 1，重复到行尾 (24)",
      "R9: 1 下针，2 并 1，重复到行尾 (16)",
      "R10: 2 并 1，重复到行尾 (8)",
      "穿线收口，轻轻拉圆，藏好线头。"
    ].join("\n");
  }

  function guideText() {
    return [
      "一、记一行",
      "打开一份图解，点右边的加号，就记下织完了一行，并走到下一行。",
      "点减号退回。点正文里的某一行，可以直接跳过去。",
      "跳转只改位置，不计入「今天织了多少」。加号和减号才会计入。",
      "两侧小箭头用来跳到上一节或下一节。长按加号可以连续记行。",
      "二、怎么写才能被认成一行",
      "一行写一个步骤。行首用 R1、第1行，或者 1行。",
      "连续相同的几行可以写成 R3-4。",
      "行尾用（24）写下这一行的针数。",
      "再用一对括号写提醒，会显示成红色。",
      "想分成多页，就单独写一行三个减号。",
      "---",
      "三、试一试",
      "下面三行可以真的往下记。",
      "R1: 随便织 10 针 (10)",
      "R2: 再织 10 针 (10)",
      "R3: 收针 (10) （织到这里就完成了）"
    ].join("\n");
  }

  function defaultState() {
    var now = Date.now();
    return {
      v: 1,
      sort: "default",
      theme: "light",
      stats: { totalRows: 0, byDate: {} },
      patterns: [
        makePattern({ id: "sample-scarf", title: "罗纹围巾", category: "配件", needle: "4.5mm", yarn: "中细线", body: scarfText(), createdAt: now - 3, updatedAt: now - 3 }),
        makePattern({ id: "sample-coaster", title: "圆片杯垫", category: "家居", needle: "双头针", yarn: "中细线", body: coasterText(), createdAt: now - 2, updatedAt: now - 2 }),
        makePattern({ id: "sample-guide", title: "怎么记行", category: "其他", body: guideText(), createdAt: now - 1, updatedAt: now - 1 })
      ]
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.patterns)) return defaultState();
      data.v = 1;
      data.sort = SORTS.some(function (s) { return s.id === data.sort; }) ? data.sort : "default";
      data.theme = data.theme === "dark" ? "dark" : "light";
      data.stats = data.stats || { totalRows: 0, byDate: {} };
      data.stats.totalRows = data.stats.totalRows || 0;
      data.stats.byDate = data.stats.byDate || {};
      data.patterns = data.patterns.map(function (p) { return makePattern(p); });
      return data;
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      var copy = JSON.parse(JSON.stringify(state));
      copy.patterns.forEach(function (p) { p.tickAt = null; p.browsePage = null; });
      localStorage.setItem(KEY, JSON.stringify(copy));
    } catch (e) {
      if (!save.warned) { save.warned = true; toast("没能保存，这台浏览器的本地存储不可用"); }
    }
  }

  function getPattern(id) {
    return state.patterns.filter(function (p) { return p.id === id; })[0] || null;
  }

  function progressOf(p) {
    var parsed = parsePattern(p.body);
    var total = parsed.rows.length;
    if (!total) {
      return { parsed: parsed, total: 0, step: 0, done: false, finished: p.freeRow || 0, current: null };
    }
    var step = Math.min(Math.max(p.step || 0, 0), total - 1);
    return {
      parsed: parsed,
      total: total,
      step: step,
      done: !!p.done,
      finished: p.done ? total : step,
      current: parsed.rows[step]
    };
  }

  function shownPage(p, prog) {
    var pages = Math.max(1, prog.parsed.pages.length);
    var page = p.browsePage == null ? (prog.current ? prog.current.page : 0) : p.browsePage;
    if (page < 0) page = 0;
    if (page > pages - 1) page = pages - 1;
    return page;
  }

  function addToday(n) {
    var key = todayKey();
    var cur = state.stats.byDate[key] || 0;
    var next = Math.max(0, cur + n);
    var applied = next - cur;
    state.stats.byDate[key] = next;
    state.stats.totalRows = Math.max(0, (state.stats.totalRows || 0) + applied);
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.classList.remove("show"); }, 1700);
  }

  function ask(message, okText, cancelText) {
    return new Promise(function (resolve) {
      var el = document.createElement("div");
      el.className = "modal";
      el.innerHTML = '<div class="sheet"><h3>确认一下</h3><p>' + esc(message) + '</p><div class="choices"><button type="button" data-no>' + esc(cancelText || "取消") + '</button><button type="button" class="ok" data-ok>' + esc(okText || "确定") + '</button></div></div>';
      function close(v) { el.remove(); resolve(v); }
      el.querySelector("[data-ok]").onclick = function () { close(true); };
      el.querySelector("[data-no]").onclick = function () { close(false); };
      el.addEventListener("click", function (e) { if (e.target === el) close(false); });
      document.body.appendChild(el);
    });
  }

  function icon(name) {
    if (name === "search") return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
    if (name === "back") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>';
    if (name === "book") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5.5A3.5 3.5 0 0 1 8.5 4H19v15H8.5A3.5 3.5 0 0 0 5 22.5z"/><path d="M5 5.5v17"/></svg>';
    if (name === "needles") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 19L17 7"/><path d="M7 5l12 12"/><circle cx="6" cy="6" r="1.4" fill="currentColor"/><circle cx="18" cy="18" r="1.4" fill="currentColor"/></svg>';
    if (name === "user") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.4-3 3.8-4.5 7-4.5S17.6 16 19 19"/></svg>';
    if (name === "up") return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 14l6-6 6 6"/></svg>';
    if (name === "down") return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 10l6 6 6-6"/></svg>';
    if (name === "check") return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>';
    return "";
  }

  function ratioOf(p) {
    var prog = progressOf(p);
    if (!prog.total) return p.freeRow ? Math.min(1, p.freeRow / 40) : 0;
    return prog.finished / prog.total;
  }

  function statusText(p) {
    var prog = progressOf(p);
    if (!prog.total) {
      if (p.freeRow) return "已织 " + p.freeRow + " 行";
      return "自由计行";
    }
    if (p.done) return "织完了";
    if (!p.openedAt && prog.step === 0) return prog.total + " 行";
    return "织到第 " + prog.current.row + " 行";
  }

  function paperPreview(p) {
    var parsed = parsePattern(p.body);
    var html = "";
    var count = 0;
    parsed.pages.forEach(function (page) {
      page.lines.forEach(function (line) {
        if (count >= 16) return;
        count++;
        if (line.kind === "section") html += '<div class="s">' + esc(line.text) + "</div>";
        else if (line.kind === "row") html += '<div class="r"><span>' + esc(rowLabel(line)) + "</span><span class=\"c\">" + (line.count != null ? line.count : "") + "</span></div>";
        else html += "<div>" + esc(line.text) + "</div>";
      });
    });
    if (!html) html = "<div>还没有正文</div>";
    var ratio = ratioOf(p);
    var bar = ratio > 0 ? '<div class="paper-progress"><span style="width:' + Math.round(ratio * 100) + '%"></span></div>' : "";
    var ribbon = p.done ? '<span class="ribbon">完成</span>' : "";
    return '<div class="paper">' + ribbon + '<div class="paper-inner">' + html + "</div>" + bar + "</div>";
  }

  function matchQuery(p) {
    var q = ui.query.trim().toLowerCase();
    if (!q) return true;
    return (p.title + " " + p.category + " " + p.body + " " + p.yarn + " " + p.needle).toLowerCase().indexOf(q) !== -1;
  }

  function grouped() {
    var items = state.patterns.filter(matchQuery);
    if (state.sort === "name") items.sort(function (a, b) { return a.title.localeCompare(b.title, "zh"); });
    else if (state.sort === "update") items.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    else if (state.sort === "progress") {
      items.sort(function (a, b) {
        var ad = a.done ? -1 : ratioOf(a);
        var bd = b.done ? -1 : ratioOf(b);
        return bd - ad;
      });
    }
    if (state.sort === "category") {
      return CATS.map(function (c) {
        return { cat: c, items: items.filter(function (p) { return p.category === c.id; }).sort(function (a, b) { return a.title.localeCompare(b.title, "zh"); }) };
      }).filter(function (g) { return g.items.length; });
    }
    return [{ cat: null, items: items }];
  }

  function resumeTarget() {
    return state.patterns.filter(function (p) { return p.openedAt && !p.done; }).sort(function (a, b) { return b.openedAt - a.openedAt; })[0] || null;
  }

  function nav(active) {
    return '<nav class="nav">' +
      '<button type="button" data-act="go" data-name="library" class="' + (active === "library" ? "on" : "") + '">' + icon("book") + "图解</button>" +
      '<button type="button" data-act="go" data-name="weave" class="' + (active === "weave" ? "on" : "") + '">' + icon("needles") + "编织</button>" +
      '<button type="button" data-act="go" data-name="me" class="' + (active === "me" ? "on" : "") + '">' + icon("user") + "我的</button>" +
      "</nav>";
  }

  function renderLibrary() {
    var groups = grouped();
    var resume = resumeTarget();
    var cards = groups.map(function (g) {
      var head = g.cat ? '<h3 class="group-label">' + esc(g.cat.id) + "</h3>" : "";
      var grid = '<div class="grid">' + g.items.map(function (p) {
        var on = ui.selected[p.id] ? " on" : "";
        var tick = ui.selectMode ? '<span class="tick">' + (ui.selected[p.id] ? icon("check") : "") + "</span>" : "";
        return '<button type="button" class="card' + on + '" data-act="open" data-id="' + esc(p.id) + '">' + tick + paperPreview(p) +
          '<div class="card-name"><i class="dot" style="background:' + catColor(p.category) + '"></i>' + esc(p.title) + "</div>" +
          '<div class="card-sub">' + esc(statusText(p)) + "</div></button>";
      }).join("") + "</div>";
      return head + grid;
    }).join("");
    var matched = 0;
    groups.forEach(function (g) { matched += g.items.length; });
    if (!state.patterns.length) {
      cards = '<div class="empty"><h2>还没有图解</h2><p>把图解按一行一条贴进来，就可以跟着记织到第几行。</p><button type="button" class="solid" data-act="create">导入一份</button></div>';
    } else if (ui.query && !matched) {
      cards = '<div class="empty"><p>没有找到「' + esc(ui.query) + '」</p></div>';
    }
    var add = state.patterns.length && !ui.query
      ? '<div class="grid"><button type="button" class="card" data-act="create"><div class="paper add-paper">＋</div><div class="card-name">导入图解</div></button></div>'
      : "";
    var resumeHtml = resume && !ui.query ? '<button type="button" class="resume" data-act="open" data-id="' + esc(resume.id) + '">继续织 · ' + esc(resume.title) + " · " + esc(statusText(resume)) + "</button>" : "";
    var selCount = Object.keys(ui.selected).length;
    var selbar = ui.selectMode ? '<div class="selbar"><span>已选 ' + selCount + '</span><span><button type="button" class="ghost" data-act="sel-all">全选</button> <button type="button" class="ghost" data-act="sel-del">删除</button></span></div>' : "";
    return '<div class="pad">' +
      '<label class="search">' + icon("search") + '<input id="q" placeholder="搜索图解" value="' + esc(ui.query) + '" /></label>' +
      '<div class="headrow"><h1>图解</h1><div class="head-actions">' +
      '<button type="button" class="ghost" data-act="create">＋ 导入</button>' +
      '<button type="button" class="ghost' + (ui.selectMode ? " on" : "") + '" data-act="select">' + (ui.selectMode ? "取消" : "选择") + "</button>" +
      "</div></div>" +
      '<div class="tabs">' + SORTS.map(function (s) {
        return '<button type="button" data-act="tab" data-sort="' + s.id + '" class="' + (state.sort === s.id ? "on" : "") + '">' + s.label + "</button>";
      }).join("") + "</div>" +
      '<div id="listwrap">' + resumeHtml + cards + add + "</div>" +
      '<p class="countline" id="countline">' + (ui.query ? "找到 " + matched + " 份" : state.patterns.length + " 份图解 · 只存在这台设备") + "</p></div>" + selbar + nav("library");
  }

  function renderWeave() {
    var list = state.patterns.filter(function (p) { return p.openedAt && !p.done; }).sort(function (a, b) { return b.openedAt - a.openedAt; });
    var body = list.length ? '<div class="list">' + list.map(function (p) {
      var prog = progressOf(p);
      var pct = Math.round(ratioOf(p) * 100);
      return '<button type="button" class="work" data-act="open" data-id="' + esc(p.id) + '"><span><b>' + esc(p.title) + "</b><span>" + esc(statusText(p)) + (prog.total ? " · " + prog.finished + "/" + prog.total : "") + '</span><div class="track"><i style="width:' + pct + '%"></i></div></span><span>继续</span></button>';
    }).join("") + "</div>" : '<div class="empty"><h2>还没开始织</h2><p>从一份图解接着记，或者先不写步骤，只数今天织了多少行。</p></div>';
    return '<div class="page"><h1>编织</h1><p class="lead">正在织的会留在这里，点进去接着数。</p>' + body +
      '<div style="margin-top:14px"><button type="button" class="solid" data-act="free">先不写图解，只数行数</button></div></div>' + nav("weave");
  }

  function last7() {
    var out = [];
    var labels = "日一二三四五六";
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = todayKey(d);
      out.push({ n: state.stats.byDate[key] || 0, label: i === 0 ? "今" : "周" + labels[d.getDay()] });
    }
    return out;
  }

  function renderMe() {
    var days = last7();
    var max = days.reduce(function (m, d) { return Math.max(m, d.n); }, 1);
    var totalMs = state.patterns.reduce(function (s, p) { return s + (p.elapsedMs || 0); }, 0);
    var today = state.stats.byDate[todayKey()] || 0;
    var done = state.patterns.filter(function (p) { return p.done; }).length;
    return '<div class="page"><h1>我的</h1><p class="lead">行数和用时都记在这台浏览器里。换手机或清缓存前，先导出一份备份。</p>' +
      '<div class="statgrid"><div class="stat"><b>' + today + '</b><span>今天（行）</span></div><div class="stat"><b>' + (state.stats.totalRows || 0) + '</b><span>累计（行）</span></div><div class="stat"><b>' + fmtShort(totalMs) + '</b><span>织的时间</span></div></div>' +
      '<div class="week">' + days.map(function (d) {
        var h = Math.max(6, Math.round((d.n / max) * 72));
        return '<div><strong>' + d.n + '</strong><i class="bar' + (d.label === "今" ? " on" : "") + '" style="height:' + h + 'px"></i><em>' + d.label + "</em></div>";
      }).join("") + "</div>" +
      '<div class="list" style="margin-top:14px">' +
      '<button type="button" data-act="export">导出备份</button>' +
      '<button type="button" data-act="import">导入备份或图解文本</button>' +
      '<button type="button" data-act="theme">' + (state.theme === "dark" ? "切换浅色" : "切换深色") + "</button>" +
      '<button type="button" data-act="open-guide">看怎么记行</button>' +
      "</div><p class=\"countline\">" + state.patterns.length + " 份图解 · 织完 " + done + " 份</p></div>" +
      '<input id="file" type="file" accept=".json,.txt,.md,text/plain,application/json" hidden />' + nav("me");
  }

  function renderEditor() {
    var draft = ui.draft || { title: "", category: "配件", yarn: "", needle: "", body: "" };
    var parsed = parsePattern(draft.body || "");
    var hint = parsed.rows.length
      ? "识别到 " + parsed.rows.length + " 行" + (parsed.pages.length > 1 ? " · " + parsed.pages.length + " 页" : "") + "。保存后就可以一行一行跟着记。"
      : "还没识别到行号。写成 R1: 或 第1行： 才会自动跟着走；也可以先保存，用加号自己数。";
    return '<div class="topbar"><div class="side left"><button type="button" class="textbtn quiet" data-act="cancel">取消</button></div><h2>' + (view.patternId ? "编辑图解" : "导入图解") + '</h2><div class="side right"><button type="button" class="textbtn" data-act="save">保存</button></div></div>' +
      '<div class="page"><label class="field"><span>名称</span><input id="f-title" maxlength="60" value="' + esc(draft.title) + '" placeholder="例如：罗纹围巾" /></label>' +
      '<div class="field"><span>分类</span><div class="chips">' + CATS.map(function (c) {
        return '<button type="button" data-act="cat" data-cat="' + c.id + '" class="' + (draft.category === c.id ? "on" : "") + '">' + c.id + "</button>";
      }).join("") + "</div></div>" +
      '<div class="split2"><label class="field"><span>针</span><input id="f-needle" maxlength="40" value="' + esc(draft.needle) + '" placeholder="4.5mm" /></label>' +
      '<label class="field"><span>线</span><input id="f-yarn" maxlength="40" value="' + esc(draft.yarn) + '" placeholder="中细线" /></label></div>' +
      '<label class="field"><span>正文</span><textarea id="f-body" placeholder="R1: 起针 20 针 (20)">' + esc(draft.body) + "</textarea></label>" +
      '<p class="hintline" id="hint">' + esc(hint) + "</p>" +
      '<button type="button" class="ghost" data-act="fill">填入示例格式</button> ' +
      '<button type="button" class="ghost" data-act="paste">从剪贴板粘贴</button>' +
      (view.patternId ? '<div style="margin-top:18px"><button type="button" class="textbtn quiet" data-act="delete" data-id="' + esc(view.patternId) + '">删除这份图解</button></div>' : "") +
      "</div>";
  }

  function renderReader() {
    var p = getPattern(view.patternId);
    if (!p) { view = { name: "library" }; return renderLibrary(); }
    var prog = progressOf(p);
    var page = shownPage(p, prog);
    var pageLines = (prog.parsed.pages[page] && prog.parsed.pages[page].lines) || [];
    var away = prog.current && prog.current.page !== page;
    var big = "0";
    var rowCaption = "已织行数";
    var stitch = "";
    if (!prog.total) {
      big = String(p.freeRow || 0);
      rowCaption = "已织 " + (p.freeRow || 0) + " 行";
    } else if (p.done) {
      big = "织完";
      rowCaption = "共 " + prog.total + " 行";
    } else {
      big = String(prog.current.row);
      rowCaption = "第" + prog.current.row + "行";
      var line = prog.parsed.pages[prog.current.page].lines[prog.current.line];
      if (line && line.count != null) stitch = line.count + "针";
    }
    var section = prog.total ? currentSection(prog.parsed, prog.step) : "";
    var spec = [p.needle, p.yarn].filter(Boolean).join(" · ");
    var linesHtml = pageLines.map(function (line) {
      if (line.kind === "section") return '<h3 class="sec">' + esc(line.text) + "</h3>";
      if (line.kind === "note") return '<p class="note-line">' + esc(line.text) + "</p>";
      if (line.kind === "text") return '<p class="prose-text">' + esc(line.text) + "</p>";
      var active = prog.current && prog.current.lineId === line.id && !away && !p.done;
      var now = "";
      if (active && line.rowStart !== line.rowEnd) now = '<i class="now">正在第 ' + prog.current.row + " 行</i>";
      var count = line.count != null ? '<span class="pc">(' + line.count + ")</span>" : "";
      var note = line.note ? '<span class="pn">' + esc(line.note) + "</span>" : "";
      var step = line.stepStart;
      return '<button type="button" class="pline' + (active ? " active" : "") + '" data-act="jump" data-step="' + step + '" data-rowid="' + line.id + '"><span class="pl"><b class="rlabel">' + esc(rowLabel(line)) + "</b>" + esc(line.text) + now + '</span><span class="pr">' + count + note + "</span></button>";
    }).join("");
    if (!linesHtml) linesHtml = '<div class="empty"><p>这份还没有正文。可以先用加号自己数，或回去把步骤贴进来。</p></div>';
    var chip = prog.parsed.pages.length > 1 ? '<button type="button" class="pagechip" data-act="pages">' + (page + 1) + "/" + prog.parsed.pages.length + "页</button>" : "";
    var menu = ui.menu ? '<div class="pop" id="pop"><button type="button" data-act="edit">编辑图解</button><button type="button" data-act="reset">重置进度</button><button type="button" class="danger" data-act="delete" data-id="' + esc(p.id) + '">删除</button></div>' : "";
    var picker = "";
    if (ui.pagePick) {
      picker = '<div class="modal" data-act="closepick"><div class="sheet"><h3>翻到哪一页</h3><div class="pagelist">' + prog.parsed.pages.map(function (pg, i) {
        var preview = (pg.lines[0] && (pg.lines[0].text || rowLabel(pg.lines[0]))) || "空白";
        return '<button type="button" data-act="page" data-page="' + i + '">第 ' + (i + 1) + " 页 · " + esc(preview) + "</button>";
      }).join("") + "</div></div></div>";
    }
    return '<div class="topbar"><div class="side left"><button type="button" class="iconbtn" data-act="back" aria-label="返回">' + icon("back") + '</button></div><h2>' + esc(p.title) + '</h2><div class="side right"><div class="capsule"><button type="button" data-act="menu" aria-label="更多">···</button><i></i><button type="button" data-act="locate" aria-label="回到当前行">◎</button></div></div></div>' +
      menu +
      '<div class="counter"><div class="counter-row">' +
      '<button type="button" class="mini" data-act="nudge" data-dir="-1" aria-label="上一节">' + icon("up") + "</button>" +
      '<button type="button" class="round" data-hold="minus" aria-label="减一行">−</button>' +
      '<div class="big' + (p.done ? " small-word" : "") + (ui.bump ? " bump" : "") + '" aria-live="polite">' + esc(big) + "</div>" +
      '<button type="button" class="round plus" data-hold="plus" aria-label="加一行">+</button>' +
      '<button type="button" class="mini" data-act="nudge" data-dir="1" aria-label="下一节">' + icon("down") + "</button>" +
      "</div><div class=\"meta\"><span data-live=\"total\">" + fmtClock(p.elapsedMs || 0) + "</span><b>" + esc(rowCaption) + "</b>" +
      (stitch ? "<span>" + esc(stitch) + "</span>" : "") +
      '<span>本行 <span data-live="row">' + fmtShort(p.rowElapsedMs || 0) + "</span></span></div>" +
      (section ? '<div class="section-name">' + esc(section) + "</div>" : "") +
      (spec ? '<div class="spec">' + esc(spec) + "</div>" : "") +
      (prog.total ? '<div class="spec">这份已织 ' + prog.finished + " / " + prog.total + " 行</div>" : "") +
      (!prog.total ? '<div class="spec">没有识别到行号，加号记的是你自己数的行</div>' : "") +
      "</div>" +
      (away ? '<button type="button" class="away" data-act="locate">织到第 ' + prog.current.row + " 行，在第 " + (prog.current.page + 1) + " 页 · 点此回去</button>" : "") +
      '<div class="prose" id="prose">' + linesHtml + "</div>" + chip + picker;
  }

  function render() {
    document.body.dataset.theme = state.theme || "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.theme === "dark" ? "#14131a" : "#f4f1f8");
    document.body.classList.toggle("wide", view.name !== "reader" && view.name !== "editor");
    document.body.classList.toggle("reader", view.name === "reader");
    document.body.classList.toggle("editor", view.name === "editor");
    var focusId = document.activeElement && document.activeElement.id;
    var selStart = focusId && document.activeElement.selectionStart;
    var html = view.name === "reader" ? renderReader() : view.name === "editor" ? renderEditor() : view.name === "weave" ? renderWeave() : view.name === "me" ? renderMe() : renderLibrary();
    app.innerHTML = html;
    if (focusId) {
      var next = document.getElementById(focusId);
      if (next && (focusId === "q" || focusId.indexOf("f-") === 0)) {
        next.focus();
        if (selStart != null && next.setSelectionRange) {
          var pos = Math.min(selStart, next.value.length);
          next.setSelectionRange(pos, pos);
        }
      }
    }
    if (ui.toTop) { ui.toTop = false; window.scrollTo(0, 0); }
    if (ui.scrollRow) {
      ui.scrollRow = false;
      var active = document.querySelector(".pline.active");
      if (active) active.scrollIntoView({ block: "center" });
    }
    ui.bump = false;
  }

  function openPattern(id) {
    var p = getPattern(id);
    if (!p) return;
    accumulate(p);
    p.openedAt = Date.now();
    p.updatedAt = Date.now();
    p.tickAt = Date.now();
    p.browsePage = null;
    view = { name: "reader", patternId: id };
    ui.menu = false;
    ui.pagePick = false;
    ui.scrollRow = true;
    ui.selectMode = false;
    save();
    render();
  }

  function leaveReader() {
    var p = view.patternId && getPattern(view.patternId);
    if (p) { accumulate(p); p.tickAt = null; save(); }
    view = { name: "library" };
    ui.menu = false;
    ui.toTop = true;
    render();
  }

  function accumulate(p) {
    if (!p || !p.tickAt || document.hidden) {
      if (p && document.hidden) p.tickAt = null;
      return;
    }
    var now = Date.now();
    var d = Math.min(120000, Math.max(0, now - p.tickAt));
    p.elapsedMs += d;
    p.rowElapsedMs += d;
    p.tickAt = now;
  }

  function tick() {
    if (view.name !== "reader" || document.hidden) return;
    var p = getPattern(view.patternId);
    if (!p) return;
    if (!p.tickAt) p.tickAt = Date.now();
    accumulate(p);
    var total = document.querySelector('[data-live="total"]');
    var row = document.querySelector('[data-live="row"]');
    if (total) total.textContent = fmtClock(p.elapsedMs);
    if (row) row.textContent = fmtShort(p.rowElapsedMs);
    if (!tick.last || Date.now() - tick.last > 5000) { tick.last = Date.now(); save(); }
  }

  function bumpRender() {
    ui.bump = true;
    ui.scrollRow = true;
    render();
  }

  function plus(p) {
    var prog = progressOf(p);
    p.updatedAt = Date.now();
    p.rowElapsedMs = 0;
    p.browsePage = null;
    if (!prog.total) {
      p.freeRow = (p.freeRow || 0) + 1;
      addToday(1);
      try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
      return;
    }
    if (p.done) { toast("已经织完了"); ui.bump = false; return; }
    addToday(1);
    try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
    if (prog.step >= prog.total - 1) {
      p.done = true;
      p.step = prog.total - 1;
      toast("这一份织完了");
    } else {
      p.step = prog.step + 1;
    }
  }

  function minus(p) {
    var prog = progressOf(p);
    p.updatedAt = Date.now();
    p.rowElapsedMs = 0;
    p.browsePage = null;
    if (!prog.total) {
      if (p.freeRow > 0) { p.freeRow -= 1; addToday(-1); }
      return;
    }
    if (p.done) {
      p.done = false;
      addToday(-1);
      return;
    }
    if (prog.step > 0) {
      p.step = prog.step - 1;
      addToday(-1);
    }
  }

  function runHold(act) {
    var p = getPattern(view.patternId);
    if (!p || view.name !== "reader") return;
    accumulate(p);
    if (act === "plus") plus(p); else minus(p);
    save();
    bumpRender();
  }

  function nudge(p, dir) {
    var prog = progressOf(p);
    if (!prog.total) {
      p.freeRow = Math.max(0, (p.freeRow || 0) + dir * 10);
      p.updatedAt = Date.now();
      save();
      bumpRender();
      return;
    }
    var anchors = sectionAnchors(prog.parsed).map(function (a) { return a.step; });
    var unique = anchors.filter(function (v, i) { return anchors.indexOf(v) === i; });
    if (unique.length >= 2) {
      if (dir > 0) {
        var next = unique.filter(function (i) { return i > prog.step; })[0];
        if (next != null) { jump(p, next); return; }
      } else {
        var prevs = unique.filter(function (i) { return i < prog.step; });
        if (prevs.length) { jump(p, prevs[prevs.length - 1]); return; }
      }
    }
    if (prog.parsed.pages.length > 1) { flip(dir); return; }
    jump(p, prog.step + dir * 10);
  }

  function jump(p, step) {
    var prog = progressOf(p);
    if (!prog.total) return;
    p.done = false;
    p.step = Math.max(0, Math.min(step, prog.total - 1));
    p.browsePage = null;
    p.rowElapsedMs = 0;
    p.updatedAt = Date.now();
    save();
    ui.scrollRow = true;
    render();
  }

  function flip(dir) {
    var p = getPattern(view.patternId);
    if (!p) return;
    var prog = progressOf(p);
    var pages = Math.max(1, prog.parsed.pages.length);
    var page = Math.min(pages - 1, Math.max(0, shownPage(p, prog) + dir));
    p.browsePage = prog.current && page === prog.current.page ? null : page;
    save();
    window.scrollTo(0, 0);
    render();
  }

  function openEditor(id) {
    var p = id ? getPattern(id) : null;
    ui.draft = p ? {
      title: p.title, category: p.category, yarn: p.yarn, needle: p.needle, body: p.body
    } : { title: "", category: "配件", yarn: "", needle: "", body: "" };
    view = { name: "editor", patternId: id || null, back: view.name === "reader" ? "reader" : "library" };
    ui.menu = false;
    render();
  }

  function readDraftFromDom() {
    var title = document.getElementById("f-title");
    if (!title) return ui.draft;
    ui.draft = {
      title: title.value,
      category: ui.draft.category,
      yarn: document.getElementById("f-yarn").value,
      needle: document.getElementById("f-needle").value,
      body: document.getElementById("f-body").value
    };
    return ui.draft;
  }

  function saveEditor() {
    var draft = readDraftFromDom();
    if (!draft.title.trim()) { toast("先写个名字"); return; }
    if (view.patternId) {
      var p = getPattern(view.patternId);
      p.title = draft.title.trim();
      p.category = draft.category;
      p.yarn = draft.yarn.trim();
      p.needle = draft.needle.trim();
      p.body = draft.body;
      p.updatedAt = Date.now();
      var total = parsePattern(p.body).rows.length;
      if (!total) { p.step = 0; p.done = false; }
      else if (p.step > total - 1) { p.step = total - 1; p.done = false; }
      save();
      if (view.back === "reader") openPattern(p.id);
      else { view = { name: "library" }; ui.toTop = true; render(); }
    } else {
      var created = makePattern({
        title: draft.title.trim(),
        category: draft.category,
        yarn: draft.yarn.trim(),
        needle: draft.needle.trim(),
        body: draft.body
      });
      state.patterns.unshift(created);
      save();
      openPattern(created.id);
    }
  }

  function updateHint() {
    var body = document.getElementById("f-body");
    var hint = document.getElementById("hint");
    if (!body || !hint) return;
    var parsed = parsePattern(body.value);
    hint.textContent = parsed.rows.length
      ? "识别到 " + parsed.rows.length + " 行" + (parsed.pages.length > 1 ? " · " + parsed.pages.length + " 页" : "") + "。保存后就可以一行一行跟着记。"
      : "还没识别到行号。写成 R1: 或 第1行： 才会自动跟着走；也可以先保存，用加号自己数。";
  }

  async function removePattern(id) {
    var p = getPattern(id);
    if (!p) return;
    var ok = await ask("删除「" + p.title + "」？织到哪一行也会一起删掉。", "删除");
    if (!ok) return;
    state.patterns = state.patterns.filter(function (x) { return x.id !== id; });
    delete ui.selected[id];
    save();
    view = { name: "library" };
    ui.toTop = true;
    render();
  }

  function exportBackup() {
    var payload = {
      v: 1,
      exportedAt: new Date().toISOString(),
      stats: state.stats,
      theme: state.theme,
      sort: state.sort,
      patterns: state.patterns.map(function (p) {
        return {
          title: p.title, category: p.category, yarn: p.yarn, needle: p.needle, body: p.body,
          step: p.step, done: p.done, freeRow: p.freeRow, elapsedMs: p.elapsedMs,
          createdAt: p.createdAt, updatedAt: p.updatedAt, openedAt: p.openedAt
        };
      })
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "织行记备份-" + todayKey() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("备份已下载");
  }

  function importPatterns(list, mode) {
    var clean = list.map(function (item) { return makePattern(Object.assign({}, item, { id: uid() })); }).filter(function (p) { return p.title || p.body; });
    if (!clean.length) { toast("没有读到图解"); return; }
    if (mode === "replace") state.patterns = clean;
    else state.patterns = clean.concat(state.patterns);
    if (list.stats) state.stats = list.stats;
    save();
    view = { name: "library" };
    ui.toTop = true;
    render();
    toast(mode === "replace" ? "已用备份替换" : "已加进图解");
  }

  function handleFileText(name, text) {
    var trimmed = text.trim();
    var asJson = false;
    var data = null;
    if (/\.json$/i.test(name) || trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
      try {
        data = JSON.parse(trimmed);
        asJson = true;
      } catch (e) { asJson = false; }
    }
    if (asJson) {
      var patterns = Array.isArray(data) ? data : data.patterns;
      if (!Array.isArray(patterns)) { toast("这个文件不是织行记备份"); return; }
      var el = document.createElement("div");
      el.className = "modal";
      el.innerHTML = '<div class="sheet"><h3>读到 ' + patterns.length + ' 份图解</h3><p>加进来会留着你现在的。替换会用这份备份盖掉当前图解。</p><div class="choices"><button type="button" data-no>取消</button><button type="button" data-add>加进来</button><button type="button" class="ok" data-rep>替换</button></div></div>';
      function close() { el.remove(); }
      el.querySelector("[data-no]").onclick = close;
      el.querySelector("[data-add]").onclick = function () { close(); importPatterns(patterns, "append"); };
      el.querySelector("[data-rep]").onclick = function () {
        close();
        importPatterns(patterns, "replace");
        if (data.stats) { state.stats = data.stats; save(); }
      };
      document.body.appendChild(el);
      return;
    }
    ui.draft = { title: name.replace(/\.[^.]+$/, "").slice(0, 60) || "导入的图解", category: "其他", yarn: "", needle: "", body: text };
    view = { name: "editor", patternId: null, back: "library" };
    render();
    toast("已放进正文，确认后保存");
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-hold]")) return;
    var t = e.target.closest("[data-act]");
    if (!t) {
      if (ui.menu) { ui.menu = false; render(); }
      return;
    }
    var act = t.dataset.act;
    if (act === "go") {
      if (view.name === "reader") {
        var cur = getPattern(view.patternId);
        if (cur) { accumulate(cur); cur.tickAt = null; }
      }
      view = { name: t.dataset.name };
      ui.menu = false;
      ui.selectMode = false;
      ui.toTop = true;
      save();
      render();
      return;
    }
    if (act === "tab") { state.sort = t.dataset.sort; save(); render(); return; }
    if (act === "select") { ui.selectMode = !ui.selectMode; ui.selected = {}; render(); return; }
    if (act === "open") {
      if (ui.selectMode) {
        if (ui.selected[t.dataset.id]) delete ui.selected[t.dataset.id];
        else ui.selected[t.dataset.id] = true;
        render();
        return;
      }
      openPattern(t.dataset.id);
      return;
    }
    if (act === "create") { openEditor(null); return; }
    if (act === "sel-all") {
      var allOn = state.patterns.every(function (p) { return ui.selected[p.id]; });
      ui.selected = {};
      if (!allOn) state.patterns.forEach(function (p) { ui.selected[p.id] = true; });
      render();
      return;
    }
    if (act === "sel-del") {
      var ids = Object.keys(ui.selected);
      if (!ids.length) { toast("先点选要删的图解"); return; }
      ask("删除选中的 " + ids.length + " 份图解？", "删除").then(function (ok) {
        if (!ok) return;
        state.patterns = state.patterns.filter(function (p) { return !ui.selected[p.id]; });
        ui.selected = {};
        ui.selectMode = false;
        save();
        render();
      });
      return;
    }
    if (act === "back") { leaveReader(); return; }
    if (act === "menu") { ui.menu = !ui.menu; render(); return; }
    if (act === "locate") {
      var p0 = getPattern(view.patternId);
      if (!p0) return;
      p0.browsePage = null;
      ui.scrollRow = true;
      ui.menu = false;
      render();
      return;
    }
    if (act === "jump") { jump(getPattern(view.patternId), Number(t.dataset.step)); return; }
    if (act === "nudge") { nudge(getPattern(view.patternId), Number(t.dataset.dir)); return; }
    if (act === "pages") { ui.pagePick = true; render(); return; }
    if (act === "closepick") { if (e.target === t) { ui.pagePick = false; render(); } return; }
    if (act === "page") {
      var p1 = getPattern(view.patternId);
      var prog = progressOf(p1);
      var page = Number(t.dataset.page);
      p1.browsePage = prog.current && page === prog.current.page ? null : page;
      ui.pagePick = false;
      save();
      window.scrollTo(0, 0);
      render();
      return;
    }
    if (act === "edit") { openEditor(view.patternId); return; }
    if (act === "reset") {
      ask("进度回到第 1 行？今天和累计的行数仍保留。", "重置").then(function (ok) {
        if (!ok) return;
        var p2 = getPattern(view.patternId);
        p2.step = 0;
        p2.done = false;
        p2.freeRow = 0;
        p2.rowElapsedMs = 0;
        p2.browsePage = null;
        p2.updatedAt = Date.now();
        ui.menu = false;
        save();
        ui.scrollRow = true;
        render();
      });
      return;
    }
    if (act === "delete") { removePattern(t.dataset.id); return; }
    if (act === "cancel") {
      if (view.back === "reader" && view.patternId) openPattern(view.patternId);
      else { view = { name: "library" }; ui.toTop = true; render(); }
      return;
    }
    if (act === "cat") {
      readDraftFromDom();
      ui.draft.category = t.dataset.cat;
      render();
      return;
    }
    if (act === "save") { saveEditor(); return; }
    if (act === "fill") {
      var body = document.getElementById("f-body");
      var sample = "一、起针\nR1: 起针 20 针 (20)\nR2: 20 下针 (20)\nR3-4: 20 下针 (20) （记号扣别在这一行）\n\n---\n二、收针\nR5: 2 并 1，重复到行尾 (10)";
      if (body.value.trim()) {
        ask("用示例格式换掉现在的正文？", "换掉").then(function (ok) {
          if (!ok) return;
          body.value = sample;
          updateHint();
        });
      } else {
        body.value = sample;
        updateHint();
      }
      return;
    }
    if (act === "paste") {
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast("这里读不了剪贴板，长按输入框粘贴就行"); return; }
      navigator.clipboard.readText().then(function (text) {
        if (!text) { toast("剪贴板是空的"); return; }
        document.getElementById("f-body").value = text;
        updateHint();
      }).catch(function () { toast("没有读到剪贴板，可以长按输入框粘贴"); });
      return;
    }
    if (act === "free") {
      var created = makePattern({
        title: "计行 " + (new Date().getMonth() + 1) + "月" + new Date().getDate() + "日",
        category: "其他",
        body: ""
      });
      state.patterns.unshift(created);
      save();
      openPattern(created.id);
      return;
    }
    if (act === "export") { exportBackup(); return; }
    if (act === "import") { var file = document.getElementById("file"); if (file) file.click(); return; }
    if (act === "theme") {
      state.theme = state.theme === "dark" ? "light" : "dark";
      save();
      render();
      return;
    }
    if (act === "open-guide") {
      var guide = getPattern("sample-guide");
      if (guide) openPattern(guide.id);
      else {
        ui.draft = { title: "怎么记行", category: "其他", yarn: "", needle: "", body: guideText() };
        view = { name: "editor", patternId: null, back: "me" };
        render();
      }
    }
  });

  document.addEventListener("input", function (e) {
    if (e.target.id === "q") {
      ui.query = e.target.value;
      var wrap = document.getElementById("listwrap");
      var count = document.getElementById("countline");
      if (!wrap) return;
      var holder = document.createElement("div");
      holder.innerHTML = renderLibrary();
      var nextWrap = holder.querySelector("#listwrap");
      var nextCount = holder.querySelector("#countline");
      if (nextWrap) wrap.innerHTML = nextWrap.innerHTML;
      if (count && nextCount) count.innerHTML = nextCount.innerHTML;
      return;
    }
    if (e.target.id === "f-body" || e.target.id === "f-title") updateHint();
  });

  document.addEventListener("change", function (e) {
    if (e.target.id !== "file" || !e.target.files || !e.target.files[0]) return;
    var file = e.target.files[0];
    var reader = new FileReader();
    reader.onload = function () { handleFileText(file.name, String(reader.result || "")); };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  });

  document.addEventListener("pointerdown", function (e) {
    var t = e.target.closest("[data-hold]");
    if (!t || view.name !== "reader") return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    clearHold(false);
    holdOrigin = { x: e.clientX, y: e.clientY, moved: false };
    var act = t.dataset.hold;
    hold = {
      act: act,
      repeated: false,
      interval: null,
      timeout: setTimeout(function () {
        if (!hold) return;
        hold.repeated = true;
        runHold(act);
        hold.interval = setInterval(function () { runHold(act); }, 140);
      }, 420)
    };
  });
  document.addEventListener("pointermove", function (e) {
    if (!hold || !holdOrigin) return;
    if (Math.abs(e.clientX - holdOrigin.x) + Math.abs(e.clientY - holdOrigin.y) > 16) {
      holdOrigin.moved = true;
      clearHold(false);
    }
  });
  document.addEventListener("pointerup", function () { clearHold(true); });
  document.addEventListener("pointercancel", function () { clearHold(false); });

  function clearHold(fireOnce) {
    if (!hold) return;
    clearTimeout(hold.timeout);
    clearInterval(hold.interval);
    var should = fireOnce && holdOrigin && !holdOrigin.moved && !hold.repeated;
    var act = hold.act;
    hold = null;
    holdOrigin = null;
    if (should) runHold(act);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (ui.pagePick) { ui.pagePick = false; render(); return; }
      if (ui.menu) { ui.menu = false; render(); return; }
      if (view.name === "reader") leaveReader();
      else if (view.name === "editor") {
        if (view.back === "reader" && view.patternId) openPattern(view.patternId);
        else view = { name: "library" };
        render();
      }
      return;
    }
    if (view.name !== "reader") return;
    if (e.target && e.target.matches && e.target.matches("input, textarea")) return;
    if (e.key === "+" || e.key === "=" || e.key === "ArrowDown") { e.preventDefault(); runHold("plus"); }
    else if (e.key === "-" || e.key === "_" || e.key === "ArrowUp") { e.preventDefault(); runHold("minus"); }
    else if (e.key === "ArrowRight") { e.preventDefault(); flip(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); flip(-1); }
  });

  document.addEventListener("visibilitychange", function () {
    var p = view.name === "reader" && getPattern(view.patternId);
    if (!p) return;
    if (document.hidden) { accumulate(p); p.tickAt = null; save(); }
    else p.tickAt = Date.now();
  });

  setInterval(tick, 1000);
  render();
})();
