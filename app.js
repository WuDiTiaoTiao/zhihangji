(function () {
  "use strict";

  var KEY = "zhihangji.v2";
  var COLORS = [
    { id: "coral", fill: "rgba(232, 92, 106, 0.42)", edge: "#c43a4a" },
    { id: "lilac", fill: "rgba(124, 104, 196, 0.42)", edge: "#5c46a8" },
    { id: "teal", fill: "rgba(36, 164, 150, 0.42)", edge: "#0d7a70" },
    { id: "amber", fill: "rgba(230, 164, 48, 0.46)", edge: "#a86a08" },
    { id: "blue", fill: "rgba(64, 132, 220, 0.42)", edge: "#1c58b4" }
  ];
  var ZOOMS = [1, 1.6, 2.4];

  var app = document.getElementById("app");
  var state = load();
  var view = { name: "library" };
  var ui = { query: "" };
  var dbp = null;
  var thumbUrls = {};
  var sheetUrl = null;
  var livePdf = null;
  var mountToken = 0;
  var toastTimer = 0;
  var renderTask = null;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.js", window.location.href).href;
  }

  function uid() {
    return "p" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "");
      if (!raw || !Array.isArray(raw.patterns)) throw new Error("empty");
      raw.patterns.forEach(function (p) {
        if (typeof p.row === "number" && p.row >= 1) {
          p.row = Math.round(p.row);
          return;
        }
        var mark = p.marks && p.marks[String(p.page || 1)];
        var h = mark && mark.h > 0.005 ? mark.h : 0.045;
        var y = mark && typeof mark.y === "number" ? mark.y : 0;
        p.row = Math.max(1, Math.floor(y / h) + 1);
      });
      return { patterns: raw.patterns, theme: raw.theme === "dark" ? "dark" : "light" };
    } catch (e) {
      return { patterns: [], theme: "light" };
    }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify({ patterns: state.patterns, theme: state.theme }));
  }

  save();

  function applyTheme() {
    if (state.theme === "dark") document.body.dataset.theme = "dark";
    else delete document.body.dataset.theme;
  }

  function db() {
    if (!dbp) {
      dbp = new Promise(function (resolve, reject) {
        var req = indexedDB.open("zhihangji-files", 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbp;
  }

  function idbPut(id, blob) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction("files", "readwrite");
        tx.objectStore("files").put(blob, id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(id) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction("files", "readonly");
        var req = tx.objectStore("files").get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbDel(id) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction("files", "readwrite");
        tx.objectStore("files").delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function get(id) {
    for (var i = 0; i < state.patterns.length; i++) {
      if (state.patterns[i].id === id) return state.patterns[i];
    }
    return null;
  }

  function current() {
    return view.id ? get(view.id) : null;
  }

  function colorOf(id) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i];
    return COLORS[0];
  }

  function pageMark(p) {
    if (!p.marks) p.marks = {};
    var key = String(p.page || 1);
    if (!p.marks[key]) p.marks[key] = { y: 0, h: 0.045 };
    return p.marks[key];
  }

  function rowNo(p) {
    var n = Number(p && p.row);
    if (!isFinite(n) || n < 1) return 1;
    return Math.round(n);
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function syncWide() {
    document.body.classList.toggle("wide", window.innerWidth >= 900);
  }

  function nav(active) {
    return '<nav class="nav"><button data-act="tab" data-name="library"' + (active === "library" ? ' class="on"' : "") + '>图解</button><button data-act="tab" data-name="me"' + (active === "me" ? ' class="on"' : "") + '>我的</button></nav>';
  }

  function filtered() {
    var q = ui.query.trim().toLowerCase();
    var list = state.patterns.filter(function (p) { return !q || p.title.toLowerCase().indexOf(q) >= 0; });
    return list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  function cardHtml(p) {
    var where = "第 " + rowNo(p) + " 行";
    if (p.pageCount > 1) where += " · 第 " + (p.page || 1) + "/" + p.pageCount + " 页";
    return '<article class="card"><div class="thumb" data-act="open" data-id="' + p.id + '"><img alt="" data-thumb="' + p.id + '"></div><div class="card-body"><label class="card-name-label">名称</label><input class="card-name" data-name-for="' + p.id + '" value="' + esc(p.title) + '" autocomplete="off"><div class="card-tools"><span>' + where + '</span><button class="textbtn" data-act="delete" data-id="' + p.id + '">删除</button></div></div></article>';
  }

  function bindNames(root) {
    (root || app).querySelectorAll("[data-name-for]").forEach(function (input) {
      if (input.dataset.bound) return;
      input.dataset.bound = "1";
      input.addEventListener("input", function () {
        var p = get(input.getAttribute("data-name-for"));
        if (!p) return;
        p.title = input.value;
        p.updatedAt = Date.now();
        save();
      });
      input.addEventListener("blur", function () {
        var p = get(input.getAttribute("data-name-for"));
        if (!p) return;
        var name = input.value.trim() || "未命名图解";
        input.value = name;
        p.title = name;
        p.updatedAt = Date.now();
        save();
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") input.blur();
      });
    });
  }

  function fillThumbs(root) {
    (root || app).querySelectorAll("[data-thumb]").forEach(function (img) {
      var id = img.getAttribute("data-thumb");
      if (thumbUrls[id]) { img.src = thumbUrls[id]; return; }
      idbGet(id + ":thumb").then(function (blob) {
        if (!blob || !img.isConnected) return;
        thumbUrls[id] = URL.createObjectURL(blob);
        img.src = thumbUrls[id];
      }).catch(function () {});
    });
  }

  function lastOpened() {
    var best = null;
    state.patterns.forEach(function (p) {
      if (p.openedAt && (!best || p.openedAt > best.openedAt)) best = p;
    });
    return best;
  }

  function renderLibrary() {
    var resume = lastOpened();
    var list = filtered();
    var resumeHtml = resume ? '<button class="resume" data-act="open" data-id="' + resume.id + '"><span>继续上次<small style="display:block;font-weight:400;margin-top:2px">色条还停在原来的位置</small></span><b>' + esc(resume.title) + '</b></button>' : "";
    var body = list.length ? '<div class="grid" id="grid">' + list.map(cardHtml).join("") + "</div>" : '<div class="empty"><p>导入织毛线的图片或 PDF。行数用加减自己记，色条拖到图上对应的位置，下次打开都还在。</p><button class="solid" data-act="import">导入图片或 PDF</button></div>';
    app.innerHTML = '<div class="pad"><div class="headrow"><h1>织行记</h1><button class="solid" data-act="import">导入</button></div><p class="sub">行数自己加减，透明色条自己拖到图上对应的位置，两件事互不影响。</p><label class="search"><input id="q" placeholder="搜索图解" value="' + esc(ui.query) + '"></label>' + resumeHtml + body + "</div>" + nav("library");
    var q = document.getElementById("q");
    if (q) q.addEventListener("input", function () {
      ui.query = q.value;
      var grid = document.getElementById("grid");
      var listNow = filtered();
      if (!grid) { render(); return; }
      if (!listNow.length) { render(); return; }
      grid.innerHTML = listNow.map(cardHtml).join("");
      fillThumbs(grid);
      bindNames(grid);
    });
    fillThumbs(app);
    bindNames(app);
  }

  function renderMe() {
    app.innerHTML = '<div class="pad"><div class="headrow"><h1>我的</h1></div><div class="panel"><button data-act="theme"><span>深色</span><b>' + (state.theme === "dark" ? "开" : "关") + '</b></button><div class="work"><span>图解</span><b>' + state.patterns.length + '</b></div><button data-act="clear"><span>清空这台浏览器里的图解</span></button></div><p class="note">图片、PDF 和色条位置只保存在这台浏览器里，不会上传。换手机或清除网站数据前，图解还在原来的文件里，可以重新导入；色条位置会重新对。</p></div>' + nav("me");
  }

  function renderViewer() {
    var p = current();
    if (!p) { view = { name: "library" }; renderLibrary(); return; }
    var colors = COLORS.map(function (c) {
      return '<button data-act="color" data-color="' + c.id + '"' + (p.color === c.id ? ' class="on"' : "") + ' style="background:' + c.edge + '" aria-label="' + c.id + '"></button>';
    }).join("");
    var zooms = ZOOMS.map(function (z) {
      return '<button data-act="zoom" data-zoom="' + z + '">' + (z === 1 ? "适应" : z + "×") + "</button>";
    }).join("");
    var pager = p.pageCount > 1 ? '<div class="tools" style="margin-top:8px"><button class="ghost" data-act="page" data-dir="-1">上一页</button><div class="pager" id="pager-label">' + (p.page || 1) + " / " + p.pageCount + '</div><button class="ghost" data-act="page" data-dir="1">下一页</button></div>' : "";
    var media = p.kind === "pdf" ? '<canvas id="sheet-canvas"></canvas>' : '<img id="sheet-img" alt="">';
    app.innerHTML = '<header class="top"><button class="back" data-act="back">返回</button><label class="name-field"><span>名称</span><input id="title-input" data-name-for="' + p.id + '" value="' + esc(p.title) + '" autocomplete="off"></label></header><section class="meter"><div class="counter"><button class="round" data-act="nudge" data-dir="-1" aria-label="上一行">−</button><div class="count-block"><div class="big" id="rownum">' + rowNo(p) + '</div><div class="count-cap">当前行</div></div><button class="round plus" data-act="nudge" data-dir="1" aria-label="下一行">+</button></div><p class="hint">加减按色条高度移动一行，色条会跟着走</p></section><div class="stage" id="stage"><p class="loading" id="loading">正在打开图解…</p><div class="sheet pending" id="sheet">' + media + '<div id="mark" class="mark"><span>这一行</span><i class="grip"></i></div></div></div><div class="dock"><div class="colors">' + colors + '</div><p class="hint">拖动图上的色条对准这一行，底部小柄可改高度</p><div class="tools zoom">' + zooms + "</div>" + pager + "</div>";
    app.innerHTML = '<header class="top"><button class="back" data-act="back">返回</button><label class="name-field"><span>名称</span><input id="title-input" data-name-for="' + p.id + '" value="' + esc(p.title) + '" autocomplete="off"></label></header><section class="meter"><div class="counter"><button class="round" data-act="nudge" data-dir="-1" aria-label="上一行">−</button><div class="count-block"><div class="big" id="rownum">' + rowNo(p) + '</div><div class="count-cap">当前行</div></div><button class="round plus" data-act="nudge" data-dir="1" aria-label="下一行">+</button></div><p class="hint">加减只改行数，不会移动色条</p></section><div class="stage" id="stage"><p class="loading" id="loading">正在打开图解…</p><div class="sheet pending" id="sheet">' + media + '<div id="mark" class="mark"><span>这一行</span><i class="grip"></i></div></div></div><div class="dock"><div class="colors">' + colors + '</div><p class="hint">拖动色条只改它自己的位置，底部小柄可改高度</p><div class="tools zoom">' + zooms + "</div>" + pager + "</div>";
    document.body.classList.add("reader");
    bindMark();
    bindNames(app);
    mountSheet();
  }

  function render() {
    applyTheme();
    syncWide();
    document.body.classList.toggle("reader", view.name === "viewer");
    if (view.name === "viewer") renderViewer();
    else if (view.name === "me") renderMe();
    else renderLibrary();
  }

  function updateRowLabel() {
    var p = current();
    var el = document.getElementById("rownum");
    if (p && el) el.textContent = String(rowNo(p));
  }

  function placeMark() {
    var p = current();
    var sheet = document.getElementById("sheet");
    var mark = document.getElementById("mark");
    if (!p || !sheet || !mark || !sheet.clientHeight) return;
    var m = pageMark(p);
    var H = sheet.clientHeight;
    var hPx = Math.max(8, Math.min(H, m.h * H));
    var top = Math.min(Math.max(0, m.y * H), Math.max(0, H - hPx));
    var c = colorOf(p.color);
    mark.style.top = top + "px";
    mark.style.height = hPx + "px";
    mark.style.background = c.fill;
    mark.style.outline = "2px solid " + c.edge;
    mark.style.outlineOffset = "-2px";
  }

  function layoutSheet() {
    var p = current();
    var stage = document.getElementById("stage");
    var sheet = document.getElementById("sheet");
    if (!p || !stage || !sheet) return;
    sheet.style.width = Math.max(1, Math.round(stage.clientWidth * (p.zoom || 1))) + "px";
  }

  function bindMark() {
    var mark = document.getElementById("mark");
    var sheet = document.getElementById("sheet");
    if (!mark || !sheet) return;
    var drag = null;
    mark.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      var p = current();
      if (!p || !sheet.clientHeight) return;
      mark.setPointerCapture(e.pointerId);
      var m = pageMark(p);
      var H = sheet.clientHeight;
      drag = {
        mode: e.target.classList.contains("grip") ? "resize" : "move",
        y0: e.clientY,
        top: m.y * H,
        h: Math.max(8, m.h * H)
      };
      e.preventDefault();
    });
    mark.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var p = current();
      var H = sheet.clientHeight || 1;
      var m = pageMark(p);
      var dy = e.clientY - drag.y0;
      if (drag.mode === "resize") {
        var h = Math.min(H * 0.45, Math.max(8, drag.h + dy));
        m.h = h / H;
        if (m.y + m.h > 1) m.y = Math.max(0, 1 - m.h);
      } else {
        var hPx = Math.max(8, m.h * H);
        var top = Math.min(Math.max(0, drag.top + dy), Math.max(0, H - hPx));
        m.y = top / H;
      }
      placeMark();
    });
    function endDrag() {
      if (!drag) return;
      drag = null;
      var p = current();
      if (!p) return;
      p.updatedAt = Date.now();
      save();
    }
    mark.addEventListener("pointerup", endDrag);
    mark.addEventListener("pointercancel", endDrag);
  }

  function dropLive() {
    mountToken++;
    if (livePdf) {
      try { livePdf.destroy(); } catch (e) {}
      livePdf = null;
    }
    if (sheetUrl) {
      URL.revokeObjectURL(sheetUrl);
      sheetUrl = null;
    }
  }

  function finishSheet(center) {
    var sheet = document.getElementById("sheet");
    var loading = document.getElementById("loading");
    if (loading) loading.remove();
    if (sheet) sheet.classList.remove("pending");
    layoutSheet();
    placeMark();
    if (center) {
      var mark = document.getElementById("mark");
      if (mark) mark.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  function drawPdf(p, token, center) {
    var canvas = document.getElementById("sheet-canvas");
    if (!livePdf || !canvas) return Promise.resolve();
    if (renderTask) {
      try { renderTask.cancel(); } catch (e) {}
      renderTask = null;
    }
    var pageNo = Math.min(Math.max(1, p.page || 1), livePdf.numPages);
    return livePdf.getPage(pageNo).then(function (page) {
      if (token !== mountToken) return;
      layoutSheet();
      var sheet = document.getElementById("sheet");
      var cssW = sheet ? sheet.clientWidth : 360;
      var base = page.getViewport({ scale: 1 });
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var scale = (cssW / base.width) * dpr;
      var vp = page.getViewport({ scale: scale });
      if (vp.height > 8192) {
        scale *= 8192 / vp.height;
        vp = page.getViewport({ scale: scale });
      }
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
      return renderTask.promise;
    }).then(function () {
      renderTask = null;
      if (token === mountToken) finishSheet(center);
    }).catch(function (err) {
      if (err && (err.name === "RenderingCancelledException" || /cancel/i.test(err.message || ""))) return;
      if (token === mountToken) toast("这一页没画出来");
    });
  }

  function mountSheet() {
    var token = ++mountToken;
    var p = current();
    if (!p) return;
    layoutSheet();
    idbGet(p.id).then(function (blob) {
      if (token !== mountToken) return;
      if (!blob) { toast("这张图解不在这台浏览器里了"); return; }
      if (p.kind === "image") {
        sheetUrl = URL.createObjectURL(blob);
        var img = document.getElementById("sheet-img");
        img.onload = function () { if (token === mountToken) finishSheet(true); };
        img.onerror = function () { if (token === mountToken) toast("这张图打不开"); };
        img.src = sheetUrl;
        return;
      }
      if (!window.pdfjsLib) { toast("PDF 组件没载入"); return; }
      return blob.arrayBuffer().then(function (buf) {
        return pdfjsLib.getDocument({ data: buf }).promise;
      }).then(function (pdf) {
        if (token !== mountToken) { pdf.destroy(); return; }
        livePdf = pdf;
        p.pageCount = pdf.numPages;
        if (p.page > p.pageCount) p.page = p.pageCount;
        save();
        var label = document.getElementById("pager-label");
        if (label) label.textContent = (p.page || 1) + " / " + p.pageCount;
        return drawPdf(p, token, true);
      });
    }).catch(function (err) {
      if (token === mountToken) toast(err && err.message ? err.message : "打不开这个文件");
    });
  }

  function openPattern(id) {
    var p = get(id);
    if (!p) return;
    dropLive();
    p.openedAt = Date.now();
    save();
    view = { name: "viewer", id: id };
    render();
  }

  function nudge(dir) {
    var p = current();
    if (!p) return;
    var step = Number(dir);
    if (!step) return;
    p.row = Math.max(1, rowNo(p) + step);
    p.updatedAt = Date.now();
    updateRowLabel();
    save();
  }

  function setZoom(z) {
    var p = current();
    if (!p) return;
    p.zoom = Number(z) || 1;
    save();
    if (p.kind === "pdf" && livePdf) drawPdf(p, mountToken, false);
    else { layoutSheet(); requestAnimationFrame(placeMark); }
  }

  function setPage(dir) {
    var p = current();
    if (!p) return;
    var next = (p.page || 1) + dir;
    if (next < 1 || next > (p.pageCount || 1)) return;
    p.page = next;
    p.updatedAt = Date.now();
    save();
    var label = document.getElementById("pager-label");
    if (label) label.textContent = next + " / " + p.pageCount;
    if (p.kind === "pdf") drawPdf(p, mountToken, true);
    else placeMark();
  }

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("这张图打不开，请换成 JPG 或 PNG")); };
      img.src = url;
    });
  }

  function canvasBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("缩略图没生成"));
      }, "image/jpeg", 0.72);
    });
  }

  function thumbFromImage(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var scale = Math.min(1, 480 / w, 2000 / h);
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasBlob(canvas);
  }

  function pdfPageBlob(pdf, num) {
    return pdf.getPage(num).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(480 / base.width, 2000 / base.height);
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise.then(function () {
        return canvasBlob(canvas);
      });
    });
  }

  function importOne(file) {
    var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    var isImage = /^image\//.test(file.type);
    if (!isPdf && !isImage) return Promise.reject(new Error(file.name + " 不是图片或 PDF"));
    if (file.size > 40 * 1024 * 1024) return Promise.reject(new Error(file.name + " 超过 40MB"));
    var id = uid();
    var pattern = {
      id: id,
      title: file.name.replace(/\.[^.]+$/, "") || "未命名图解",
      kind: isPdf ? "pdf" : "image",
      page: 1,
      pageCount: 1,
      zoom: 1,
      color: "coral",
      marks: { "1": { y: 0, h: 0.045 } },
      row: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      openedAt: 0
    };
    var stored = isPdf ? file.slice(0, file.size, file.type || "application/pdf") : file;
    if (!isPdf) {
      return loadImage(file).then(thumbFromImage).then(function (thumb) {
        return idbPut(id, stored).then(function () { return idbPut(id + ":thumb", thumb); });
      }).then(function () {
        state.patterns.unshift(pattern);
        save();
      });
    }
    if (!window.pdfjsLib) return Promise.reject(new Error("PDF 组件没载入"));
    return file.arrayBuffer().then(function (buf) {
      return pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      pattern.pageCount = pdf.numPages;
      return pdfPageBlob(pdf, 1).then(function (thumb) {
        pdf.destroy();
        return idbPut(id, stored).then(function () { return idbPut(id + ":thumb", thumb); });
      });
    }).then(function () {
      state.patterns.unshift(pattern);
      save();
    });
  }

  function importFiles(files) {
    var i = 0;
    function next() {
      if (i >= files.length) { render(); return; }
      var file = files[i++];
      toast("正在导入 " + i + "/" + files.length);
      importOne(file).then(next).catch(function (err) {
        toast(err && err.message ? err.message : "导入失败");
        next();
      });
    }
    next();
  }

  function removePattern(id) {
    var p = get(id);
    if (!p) return;
    if (!window.confirm("删除「" + p.title + "」？色条位置也会一起去掉。")) return;
    state.patterns = state.patterns.filter(function (item) { return item.id !== id; });
    if (thumbUrls[id]) { URL.revokeObjectURL(thumbUrls[id]); delete thumbUrls[id]; }
    save();
    Promise.all([idbDel(id), idbDel(id + ":thumb")]).catch(function () {});
    if (view.id === id) {
      dropLive();
      view = { name: "library" };
    }
    render();
  }

  app.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act]");
    if (!t || !app.contains(t)) return;
    var act = t.dataset.act;
    if (act === "import") { document.getElementById("file").click(); return; }
    if (act === "tab") {
      if (view.name === "viewer") dropLive();
      view = { name: t.dataset.name };
      render();
      return;
    }
    if (act === "open") { openPattern(t.dataset.id); return; }
    if (act === "delete") { e.stopPropagation(); removePattern(t.dataset.id); return; }
    if (act === "back") {
      dropLive();
      view = { name: "library" };
      render();
      return;
    }
    if (act === "nudge") { nudge(Number(t.dataset.dir)); return; }
    if (act === "zoom") { setZoom(t.dataset.zoom); return; }
    if (act === "page") { setPage(Number(t.dataset.dir)); return; }
    if (act === "color") {
      var cur = current();
      if (!cur) return;
      cur.color = t.dataset.color;
      cur.updatedAt = Date.now();
      save();
      app.querySelectorAll(".colors button").forEach(function (btn) { btn.classList.toggle("on", btn === t); });
      placeMark();
      return;
    }
    if (act === "theme") {
      state.theme = state.theme === "dark" ? "light" : "dark";
      save();
      render();
      return;
    }
    if (act === "clear") {
      if (!state.patterns.length) return;
      if (!window.confirm("清空这台浏览器里的全部图解？")) return;
      var ids = state.patterns.map(function (p) { return p.id; });
      state.patterns = [];
      save();
      Promise.all(ids.reduce(function (jobs, id) {
        jobs.push(idbDel(id), idbDel(id + ":thumb"));
        return jobs;
      }, [])).catch(function () {});
      render();
    }
  });

  document.getElementById("file").addEventListener("change", function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = "";
    if (files.length) importFiles(files);
  });

  window.addEventListener("resize", function () {
    syncWide();
    if (view.name !== "viewer") return;
    var p = current();
    if (!p) return;
    if (p.kind === "pdf" && livePdf) drawPdf(p, mountToken, false);
    else { layoutSheet(); placeMark(); }
  });

  window.addEventListener("keydown", function (e) {
    if (view.name !== "viewer") return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); nudge(1); }
    if (e.key === "ArrowUp") { e.preventDefault(); nudge(-1); }
    if (e.key === "Escape") {
      dropLive();
      view = { name: "library" };
      render();
    }
  });

  render();
})();
