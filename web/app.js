(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var pct = function (v) { return (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + Math.abs(v).toFixed(1) + "%"; };
  var signed = function (v) { return (v > 0.005 ? "+" : v < -0.005 ? "−" : "") + Math.abs(v).toFixed(2); };
  var money = d3.format(",.2f");
  var day = function (s) { return d3.utcFormat("%b %-d, %Y")(new Date(s + "T00:00:00Z")); };
  var clock = function (iso) { return iso ? d3.timeFormat("%-I:%M %p")(new Date(iso)) : "—"; };
  var changed = function (r) { return r.lean !== "none" || Number(r.range_mult) !== 1; };
  var safeUrl = function (u) { return /^https?:\/\//i.test(u || "") ? u : null; };
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  var pill = function (part) {
    var kind = part.indexOf("range") === 0 ? "range" : part.indexOf("up") > -1 ? "up" : "down";
    return el("span", "sf-pill sf-pill--" + kind, part);
  };
  var ago = function (iso) {
    var m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return Math.round(m) + " min ago";
    if (m < 48 * 60) return Math.round(m / 60) + " h ago";
    return Math.round(m / 1440) + " days ago";
  };

  var state = null;

  var STATIC = !!window.STATE_URL;   // public daily copy (GitHub Pages) instead of the PC program

  // "How to read this page": open on the first visit, then remember if the visitor hid it.
  (function () {
    var guide = $("how-to-read"), KEY = "sf-guide-hidden";
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    // Folded by default on phones (it's long there); open by default on bigger screens.
    if (saved === "1" || (saved === null && window.matchMedia("(max-width: 600px)").matches)) guide.open = false;
    guide.addEventListener("toggle", function () {
      try { localStorage.setItem(KEY, guide.open ? "0" : "1"); } catch (e) {}
    });
    document.querySelectorAll('a[href="#how-to-read"]').forEach(function (a) {
      a.addEventListener("click", function () { guide.open = true; });
    });
  })();

  function renderStatus(s) {
    var box = $("status"), phase = s.phase || "";
    if (STATIC) {
      box.dataset.state = "live";
      var at = s.built_at || s.news_at || s.base_at;
      $("status-text").textContent = "Updated every weekday evening · last update " +
        (at ? d3.timeFormat("%b %-d, %-I:%M %p")(new Date(at)) : "—");
      return;
    }
    var live = phase === "live";
    box.dataset.state = s.error && !live ? "error" : live ? "live" : "busy";
    var parts = [];
    if (live) parts.push("Live");
    else parts.push(phase || "Working");
    if (s.news_at) parts.push("news checked " + clock(s.news_at) + (s.news_new ? " (" + s.news_new + " new headlines)" : ""));
    if (s.base_at) parts.push("prices updated " + clock(s.base_at));
    if (s.error) parts.push("last update failed: " + s.error);
    $("status-text").textContent = parts.join(" · ");
  }

  function renderSummary(rows, cal) {
    $("asof").textContent = rows.length ? day(rows[0].as_of) : "—";
    $("nadj").textContent = String(rows.filter(changed).length);
    var get = function (m) { var r = cal.find(function (x) { return x.metric === m; }); return r ? Number(r.value) : NaN; };
    var set = function (id, m) { var v = get(m); $(id).textContent = isNaN(v) ? "—" : v.toFixed(1) + "%"; };
    set("t-acc", "direction_accuracy"); set("t-naive", "naive_accuracy");
    set("t-cover", "range_coverage"); set("t-base", "base_rate");
    if (cal.length) { $("p-start").textContent = day(cal[0].period_start); $("p-end").textContent = day(cal[0].period_end); }
    var edge = get("direction_accuracy") - get("naive_accuracy") >= 0.5;
    $("edge-line").textContent = edge
      ? "On past data the model called up or down a little better than always guessing the more common outcome."
      : "On past data the model called up or down no better than always guessing the more common outcome, so the price ranges are the more useful numbers here.";
  }

  function renderChart(rows) {
    var box = $("range-chart");
    box.replaceChildren();
    var data = rows.map(function (r) {
      return { r: r, lo: (r.low / r.price - 1) * 100, hi: (r.high / r.price - 1) * 100,
               mlo: (r.model_low / r.price - 1) * 100, mhi: (r.model_high / r.price - 1) * 100 };
    }).sort(function (a, b) { return (b.hi - b.lo) - (a.hi - a.lo); });
    var endText = function (k) { return pct(k.lo) + " / " + pct(k.hi); };

    var W = Math.max(box.clientWidth || 0, 280), rowH = 28;
    var svg = d3.select(box).append("svg").attr("width", "100%").attr("role", "img")
      .attr("aria-label", "80% likely price range for each stock over the next 5 trading days, as a percent change from today's price");
    var left = 0, right = 0, probe = svg.append("g");
    probe.append("g").selectAll("text").data(data).join("text").attr("class", "sf-lab sf-lab--chg")
      .text(function (k) { return k.r.ticker; }).each(function () { left = Math.max(left, this.getComputedTextLength()); });
    probe.append("g").selectAll("text").data(data).join("text").text(endText)
      .each(function () { right = Math.max(right, this.getComputedTextLength()); });
    probe.remove();
    left = left || 44; right = right || 96;
    var m = { l: left + 12, r: right + 12, t: 26, b: 6 };
    var H = m.t + data.length * rowH + m.b;
    svg.attr("viewBox", "0 0 " + W + " " + H).attr("height", H);

    var ext = d3.max(data, function (k) { return Math.max(-k.lo, k.hi, -k.mlo, k.mhi); }) * 1.04;
    var x = d3.scaleLinear().domain([-ext, ext]).range([m.l, W - m.r]);
    var ticks = x.ticks(W < 520 ? 4 : 7);
    var grid = svg.append("g");
    grid.selectAll("line").data(ticks).join("line")
      .attr("x1", x).attr("x2", x).attr("y1", m.t - 6).attr("y2", H - m.b)
      .style("stroke", function (t) { return t === 0 ? "var(--ref)" : "var(--grid)"; })
      .style("stroke-width", function (t) { return t === 0 ? 1.5 : 1; });
    grid.selectAll("text").data(ticks).join("text").attr("x", x).attr("y", m.t - 12).attr("text-anchor", "middle")
      .text(function (t) { return t === 0 ? "Today" : pct(t); });

    var tip = el("div", "sf-tip"); tip.hidden = true; box.appendChild(tip);
    var g = svg.append("g").selectAll("g").data(data).join("g")
      .attr("transform", function (_, i) { return "translate(0," + (m.t + i * rowH) + ")"; });
    g.append("rect").attr("x", function (k) { return x(k.mlo); }).attr("width", function (k) { return Math.max(1, x(k.mhi) - x(k.mlo)); })
      .attr("y", rowH * 0.18).attr("height", rowH * 0.64).attr("rx", 3)
      .style("fill", "none").style("stroke", "var(--chart-muted)");
    g.append("rect").attr("x", function (k) { return x(k.lo); }).attr("width", function (k) { return Math.max(1, x(k.hi) - x(k.lo)); })
      .attr("y", rowH * 0.32).attr("height", rowH * 0.36).attr("rx", 2).style("fill", "var(--series)");
    g.append("text").attr("class", function (k) { return changed(k.r) ? "sf-lab sf-lab--chg" : "sf-lab"; })
      .attr("x", m.l - 12).attr("y", rowH / 2).attr("dy", "0.35em").attr("text-anchor", "end")
      .text(function (k) { return k.r.ticker; });
    g.append("text").attr("x", W - m.r + 12).attr("y", rowH / 2).attr("dy", "0.35em").text(endText);
    g.append("rect").attr("class", "sf-hit").attr("width", W).attr("height", rowH).style("fill", "transparent")
      .on("click", function (ev, k) { tip.hidden = true; openAdvice(k.r.ticker); })
      .on("pointerenter pointermove", function (ev, k) {
        var r = k.r;
        tip.replaceChildren(
          el("strong", null, r.ticker + " (" + r.name + ")  $" + money(r.price)),
          el("div", null, "Likely range: $" + money(r.low) + " – $" + money(r.high)),
          el("span", null, "Model alone: $" + money(r.model_low) + " – $" + money(r.model_high)),
          el("div", null, "Up " + r.up_pct + "%, down " + r.down_pct + "%")
        );
        if (r.changed) tip.appendChild(el("span", null, "Changed by news: " + r.changed));
        tip.hidden = false;
        var p = d3.pointer(ev, box);
        tip.style.left = Math.max(0, Math.min(p[0] + 14, box.clientWidth - tip.offsetWidth - 4)) + "px";
        tip.style.top = (p[1] + 14) + "px";
      })
      .on("pointerleave", function () { tip.hidden = true; });
  }

  function renderTable(rows) {
    var tb = $("rows");
    tb.replaceChildren();
    rows.slice().sort(function (a, b) { return b.up_pct - a.up_pct || d3.ascending(a.ticker, b.ticker); }).forEach(function (r) {
      var tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.setAttribute("aria-label", "Open advice for " + r.ticker + " (" + r.name + ")");
      tr.addEventListener("click", function () { openAdvice(r.ticker); });
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAdvice(r.ticker); } });
      var td = function (cls, text) { var c = el("td", cls, text); tr.appendChild(c); return c; };
      var s = td("");
      s.append(el("strong", null, r.ticker), el("span", "sf-name", " (" + r.name + ")"));
      td("sf-num", money(r.price));
      var moved = r.up_pct > r.model_up_pct ? " sf-moved sf-moved--up" : r.up_pct < r.model_up_pct ? " sf-moved sf-moved--down" : "";
      td("sf-num" + moved, r.up_pct + "%");
      td("sf-num", r.down_pct + "%");
      td("sf-num sf-dim", r.model_up_pct + "%");
      td("sf-num", money(r.low));
      td("sf-num", money(r.high));
      var n = r.news || { n: 0, score: 0 };
      var nc = td("");
      if (n.n) {
        var t = n.score >= 0.25 ? "good" : n.score <= -0.25 ? "bad" : "neutral";
        nc.append(el("span", "sf-pill sf-pill--" + t, t + " " + signed(n.score)), el("span", "sf-dim", " " + n.n));
      } else nc.append(el("span", "sf-dim", "none"));
      var ch = td("");
      (r.changed ? r.changed.split(", ") : []).forEach(function (part) { ch.appendChild(pill(part)); });
      tb.appendChild(tr);
    });
  }

  function renderNotes(rows) {
    var box = $("notes");
    box.replaceChildren();
    var list = rows.filter(changed).sort(function (a, b) { return d3.ascending(a.ticker, b.ticker); });
    if (!list.length) { box.appendChild(el("p", "sf-sub", "The news didn't change any forecast right now.")); return; }
    list.forEach(function (r) {
      var card = el("article", "sf-note");
      card.tabIndex = 0;
      card.addEventListener("click", function () { openAdvice(r.ticker); });
      card.addEventListener("keydown", function (e) { if (e.key === "Enter") openAdvice(r.ticker); });
      card.appendChild(el("h3", null, r.ticker + " (" + r.name + ")"));
      if (r.event) card.appendChild(el("span", "sf-event", r.event));
      card.appendChild(el("p", null, r.reason));
      var c = el("div");
      r.changed.split(", ").forEach(function (part) { c.appendChild(pill(part)); });
      card.appendChild(c);
      box.appendChild(card);
    });
  }

  var newsLimit = 12;   // headlines shown before "Show more"
  function renderNews(news, rows) {
    var sel = $("news-filter"), keep = sel.value;
    if (sel.options.length <= 1) {
      rows.slice().sort(function (a, b) { return d3.ascending(a.ticker, b.ticker); }).forEach(function (r) {
        sel.appendChild(new Option(r.ticker + " (" + r.name + ")", r.ticker));
      });
      sel.value = keep;
    }
    var list = $("news-list");
    list.replaceChildren();
    var all = news.filter(function (h) { return !sel.value || h.ticker === sel.value; }).slice(0, 40);
    var shown = all.slice(0, newsLimit);
    var more = $("news-more");
    if (!more) {
      more = el("button", "sf-more", "");
      more.id = "news-more"; more.type = "button";
      more.addEventListener("click", function () { newsLimit += 12; renderNews(state.news || [], state.forecast); });
      list.after(more);
    }
    more.hidden = all.length <= shown.length;
    more.textContent = "Show more headlines (" + (all.length - shown.length) + " more)";
    if (!shown.length) { list.appendChild(el("li", "sf-sub", "No headlines yet. The first news check can take a couple of minutes.")); return; }
    shown.forEach(function (h) {
      var li = el("li");
      var tkb = el("button", "sf-tk", h.ticker);
      tkb.type = "button";
      tkb.setAttribute("aria-label", "Open advice for " + h.ticker);
      tkb.addEventListener("click", function () { openAdvice(h.ticker); });
      li.appendChild(tkb);
      var hl = el("span", "sf-hl");
      var url = safeUrl(h.url);
      if (url) { var a = el("a", null, h.title); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; hl.appendChild(a); }
      else hl.textContent = h.title;
      li.appendChild(hl);
      li.appendChild(el("span", "sf-pill sf-pill--" + h.tone, h.tone));
      li.appendChild(el("span", "sf-meta", h.source + " · " + ago(h.published)));
      list.appendChild(li);
    });
  }

  // ---------- Advice panel ----------
  var openTicker = null;
  var fmtS = function (x) { if (x == null) return "—"; var v = x * 100; return (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + Math.abs(v).toFixed(1) + "%"; };
  var fmtU = function (x) { return x == null ? "—" : (x * 100).toFixed(1) + "%"; };
  var signCls = function (x) { return x == null ? null : x > 0 ? "sf-pos" : x < 0 ? "sf-neg" : null; };
  var dollars = function (x) { return x == null ? "—" : "$" + money(x); };
  var num1 = function (x) { return x == null ? "—" : Number(x).toFixed(1); };

  function stat(dl, label, value, cls) {
    var d = el("div");
    d.append(el("dt", null, label), el("dd", cls || null, value));
    dl.appendChild(d);
  }

  function fillVerdict(sec, a, meta) {
    var p = sec.querySelector(".sf-vpill");
    p.dataset.v = a.verdict;
    p.textContent = a.verdict;
    sec.querySelector(".sf-vmeta").textContent = meta;
    var ul = sec.querySelector(".sf-reasons");
    ul.replaceChildren();
    a.reasons.forEach(function (t) { ul.appendChild(el("li", null, t)); });
  }

  // ---------- Candlestick chart ----------
  function nextWeekdays(last, n) {
    var out = [], d = new Date(last + "T00:00:00Z");
    while (out.length < n) { d = new Date(d.getTime() + 86400000); var w = d.getUTCDay(); if (w && w < 6) out.push(d.toISOString().slice(0, 10)); }
    return out;
  }

  function renderCandles(r) {
    var box = $("adv-candles");
    box.replaceChildren();
    var raw = (state.candles || {})[r.ticker] || [];
    if (!raw.length) { box.appendChild(el("p", "sf-sub", "Price history is still loading. It appears after the next price update.")); return; }
    var data = raw.map(function (c) { return { date: c[0], o: c[1], h: c[2], l: c[3], c: c[4] }; });
    var future = nextWeekdays(data[data.length - 1].date, 5);
    var slots = data.map(function (d) { return d.date; }).concat(future);

    var W = Math.max(box.clientWidth || 0, 280), H = W < 520 ? 240 : 300;
    var m = { l: 4, r: 56, t: 10, b: 26 };
    var x = d3.scaleBand().domain(slots).range([m.l, W - m.r]).paddingInner(0.25);
    var lo = Math.min(d3.min(data, function (d) { return d.l; }), r.low);
    var hi = Math.max(d3.max(data, function (d) { return d.h; }), r.high);
    var y = d3.scaleLinear().domain([lo, hi]).nice(5).range([H - m.b, m.t]);

    var svg = d3.select(box).append("svg").attr("width", "100%").attr("height", H).attr("viewBox", "0 0 " + W + " " + H)
      .attr("role", "img").attr("aria-label", r.ticker + " daily candlestick chart for the last 6 months, with the 80% likely range for the next 5 trading days");
    var g = svg.append("g");
    y.ticks(5).forEach(function (t) {
      g.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(t)).attr("y2", y(t)).style("stroke", "var(--grid)");
      g.append("text").attr("x", W - m.r + 8).attr("y", y(t)).attr("dy", "0.35em").text("$" + d3.format(",.0f")(t));
    });
    var lastMonth = "";
    data.forEach(function (d) {
      var mo = d.date.slice(0, 7);
      if (mo !== lastMonth) {
        lastMonth = mo;
        g.append("text").attr("x", x(d.date)).attr("y", H - 8).text(d3.utcFormat("%b")(new Date(d.date + "T00:00:00Z")));
      }
    });

    var bx = x(future[0]) - x.step() * x.paddingInner() / 2, bw = W - m.r - bx;
    g.append("rect").attr("class", "sf-c-band").attr("x", bx).attr("width", bw)
      .attr("y", y(r.high)).attr("height", Math.max(1, y(r.low) - y(r.high))).attr("rx", 3);
    g.append("line").attr("class", "sf-c-now").attr("x1", bx).attr("x2", W - m.r).attr("y1", y(r.price)).attr("y2", y(r.price));
    g.append("text").attr("x", bx + 4).attr("y", y(r.high) - 5).text("next 5 days");

    var bw2 = Math.max(1, x.bandwidth());
    var c = g.append("g").selectAll("g").data(data).join("g")
      .attr("class", function (d) { return d.c >= d.o ? "sf-c-up" : "sf-c-down"; });
    c.append("line").attr("x1", function (d) { return x(d.date) + bw2 / 2; }).attr("x2", function (d) { return x(d.date) + bw2 / 2; })
      .attr("y1", function (d) { return y(d.h); }).attr("y2", function (d) { return y(d.l); });
    c.append("rect").attr("x", function (d) { return x(d.date); }).attr("width", bw2)
      .attr("y", function (d) { return y(Math.max(d.o, d.c)); })
      .attr("height", function (d) { return Math.max(1, Math.abs(y(d.o) - y(d.c))); });

    var cross = g.append("line").attr("class", "sf-c-cross").attr("y1", m.t).attr("y2", H - m.b).style("display", "none");
    var tip = el("div", "sf-tip"); tip.hidden = true; box.appendChild(tip);
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).style("fill", "transparent")
      .on("pointerenter pointermove", function (ev) {
        var p = d3.pointer(ev, box), i = Math.floor((p[0] - m.l) / x.step());
        if (i < 0 || i >= slots.length) return;
        var cx = x(slots[i]) + bw2 / 2;
        cross.attr("x1", cx).attr("x2", cx).style("display", null);
        if (i < data.length) {
          var d = data[i], chg = d.c - d.o;
          tip.replaceChildren(el("strong", null, day(d.date)),
            el("div", null, "Open $" + money(d.o) + " · Close $" + money(d.c)),
            el("div", null, "High $" + money(d.h) + " · Low $" + money(d.l)),
            el("span", null, (chg >= 0 ? "Closed up " : "Closed down ") + "$" + money(Math.abs(chg)) + " on the day"));
        } else {
          tip.replaceChildren(el("strong", null, "Next 5 trading days"),
            el("div", null, "80% likely range: $" + money(r.low) + " – $" + money(r.high)),
            el("span", null, "Today's price: $" + money(r.price)));
        }
        tip.hidden = false;
        tip.style.left = Math.max(0, Math.min(p[0] + 14, box.clientWidth - tip.offsetWidth - 4)) + "px";
        tip.style.top = Math.min(p[1] + 14, H - 20) + "px";
      })
      .on("pointerleave", function () { tip.hidden = true; cross.style("display", "none"); });
  }

  function renderAdvice() {
    if (!openTicker || !state || !state.forecast) return;
    var r = state.forecast.find(function (x) { return x.ticker === openTicker; });
    if (!r || !r.advice) return;
    var f = r.fund || {}, s = r.stats || {};
    $("adv-title").textContent = r.ticker + " (" + r.name + ")";
    $("adv-sub").textContent = "$" + money(r.price) + " · prices as of " + day(r.as_of) + (f.sector ? " · " + f.sector : "");
    fillVerdict($("adv-short"), r.advice.short, "Signal: " + r.advice.short.strength.toLowerCase() + " · Risk this week: " + r.advice.short.risk.toLowerCase());
    fillVerdict($("adv-long"), r.advice.long, "Signal: " + r.advice.long.strength.toLowerCase());
    renderCandles(r);

    var dl = $("adv-stats");
    dl.replaceChildren();
    stat(dl, "Past month", fmtS(s.ret_1m), signCls(s.ret_1m));
    stat(dl, "Past 6 months", fmtS(s.ret_6m), signCls(s.ret_6m));
    stat(dl, "Past year", fmtS(s.ret_1y), signCls(s.ret_1y));
    stat(dl, "S&P 500, past year", fmtS(s.spy_1y), signCls(s.spy_1y));
    stat(dl, "Past 3 years", fmtS(s.ret_3y), signCls(s.ret_3y));
    stat(dl, "Past 5 years", fmtS(s.ret_5y), signCls(s.ret_5y));
    stat(dl, "Average yearly growth since " + (s.first_date || "").slice(0, 4), fmtS(s.cagr), signCls(s.cagr));
    stat(dl, "How much it swings (yearly)", fmtU(s.vol_1y));
    stat(dl, "Biggest drop, last 5 years", fmtS(s.max_dd_5y), "sf-neg");
    stat(dl, "52-week range", dollars(s.low_52w) + " – " + dollars(s.high_52w));
    stat(dl, "Below its 52-week high", fmtS(s.from_high_52w), signCls(s.from_high_52w));
    stat(dl, "200-day average", dollars(s.ma200));
    stat(dl, "Moves vs the market (beta)", s.beta_1y == null ? "—" : s.beta_1y.toFixed(2) + "x");
    stat(dl, "P/E, last 12 months", num1(f.trailingPE));
    stat(dl, "P/E, next 12 months", num1(f.forwardPE));
    stat(dl, "Dividend yield", f.dividendYield == null ? "—" : Number(f.dividendYield).toFixed(2) + "%");
    stat(dl, "Next earnings", f.next_earnings ? day(f.next_earnings) : "Not announced");
    stat(dl, "This week: chance of going up", r.up_pct + "%");
    stat(dl, "This week: 80% likely range", dollars(r.low) + " – " + dollars(r.high));
    renderAnalyst(r, f);

    var list = $("adv-news");
    list.replaceChildren();
    var hs = (state.news || []).filter(function (h) { return h.ticker === r.ticker; }).slice(0, 6);
    if (!hs.length) list.appendChild(el("li", "sf-sub", "No headlines in the last 3 days."));
    hs.forEach(function (h) {
      var li = el("li"), hl = el("span", "sf-hl"), url = safeUrl(h.url);
      if (url) { var a = el("a", null, h.title); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; hl.appendChild(a); }
      else hl.textContent = h.title;
      li.append(hl, el("span", "sf-pill sf-pill--" + h.tone, h.tone), el("span", "sf-meta", h.source + " · " + ago(h.published)));
      list.appendChild(li);
    });
  }

  // ---------- What analysts think (reading only, not used by the model) ----------
  var RATING_KINDS = [["strongBuy", "Strong buy"], ["buy", "Buy"], ["hold", "Hold"], ["sell", "Sell"], ["strongSell", "Strong sell"]];
  function renderAnalyst(r, f) {
    var a = f.analyst || {}, now = a.now, before = a.before;
    var bar = $("an-bar"), legend = $("an-legend"), lines = $("an-lines");
    bar.replaceChildren(); legend.replaceChildren(); lines.replaceChildren();
    var total = now ? RATING_KINDS.reduce(function (t, k) { return t + (now[k[0]] || 0); }, 0) : 0;
    bar.hidden = legend.hidden = !total;
    if (total) {
      RATING_KINDS.forEach(function (k) {
        var n = now[k[0]] || 0;
        if (n) { var seg = el("span", "sf-an-seg sf-an--" + k[0]); seg.style.flexGrow = n; seg.title = k[1] + ": " + n; bar.appendChild(seg); }
        var li = el("li", null); li.append(el("span", "sf-an-dot sf-an--" + k[0]), el("span", null, k[1] + " " + n)); legend.appendChild(li);
      });
      bar.setAttribute("aria-label", RATING_KINDS.map(function (k) { return k[1] + " " + (now[k[0]] || 0); }).join(", "));
    }
    function line(text, cls) { lines.appendChild(el("li", cls || null, text)); }
    function buys(x) { return (x.strongBuy || 0) + (x.buy || 0); }
    function sells(x) { return (x.sell || 0) + (x.strongSell || 0); }
    if (total) {
      var pb = Math.round(buys(now) / total * 100), ps = Math.round(sells(now) / total * 100);
      line(pb + "% of " + total + " analysts say buy, " + (100 - pb - ps) + "% hold, " + ps + "% sell.");
    }
    if (total && before) {
      var tb = RATING_KINDS.reduce(function (t, k) { return t + (before[k[0]] || 0); }, 0);
      if (tb) {
        var d = Math.round(buys(now) / total * 100) - Math.round(buys(before) / tb * 100);
        line(d === 0 ? "About the same share say buy as 3 months ago."
          : (d > 0 ? "More" : "Fewer") + " analysts say buy than 3 months ago (" + (d > 0 ? "+" : "") + d + (Math.abs(d) === 1 ? " point)." : " points)."), d > 0 ? "sf-pos" : d < 0 ? "sf-neg" : null);
      }
    }
    if (f.targetMeanPrice) {
      var up = (f.targetMeanPrice / r.price - 1) * 100;
      line("Average price target " + dollars(f.targetMeanPrice) + ", " + Math.abs(up).toFixed(1) + "% " + (up >= 0 ? "above" : "below") + " today's price"
        + (f.targetLowPrice ? " (lowest " + dollars(f.targetLowPrice) + ", highest " + dollars(f.targetHighPrice) + ")." : "."));
    }
    if (a.est_up_30d != null || a.est_down_30d != null) {
      var u = a.est_up_30d || 0, dn = a.est_down_30d || 0;
      line("Next year's profit estimate, last 30 days: raised by " + u + " analyst" + (u === 1 ? "" : "s") + ", cut by " + dn + ".", u > dn ? "sf-pos" : dn > u ? "sf-neg" : null);
    }
    if (a.est_change_90d_pct != null) {
      var c = a.est_change_90d_pct;
      line("Expected profit per share next year is " + (c === 0 ? "unchanged" : (c > 0 ? "up " : "down ") + Math.abs(c).toFixed(1) + "%") + " from 3 months ago.", c > 0 ? "sf-pos" : c < 0 ? "sf-neg" : null);
    }
    if (!lines.children.length) line("No analyst data available for this stock right now.", "sf-sub");
  }

  // ---------- Live chart (free TradingView widget) ----------
  var NASDAQ = ["AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "PEP", "WMT", "COST"];
  var FRAMES = [   // label, candle size, visible span (none = TradingView's default for that size)
    ["1 min", "1"], ["5 min", "5"], ["30 min", "30"], ["1 hour", "60"], ["1 day", "D"],
    ["1 month", "D", "1M"], ["6 months", "D", "6M"], ["1y", "D", "12M"], ["5y", "W", "60M"], ["Max", "M", "ALL"]
  ];
  var frame = 4, liveShown = false;
  function isDark() { return true; }   // the page always uses the dark Catppuccin Mocha palette
  function renderLive() {
    if (!openTicker || !liveShown) return;
    var box = $("live-chart"), f = FRAMES[frame];
    box.replaceChildren();
    var cfg = {
      symbol: (NASDAQ.indexOf(openTicker) > -1 ? "NASDAQ:" : "NYSE:") + openTicker,
      interval: f[1], timezone: "America/New_York", theme: isDark() ? "dark" : "light", style: "1",
      locale: "en", autosize: true, allow_symbol_change: false, hide_side_toolbar: true,
      hide_top_toolbar: true, save_image: false, calendar: false, support_host: "https://www.tradingview.com",
      backgroundColor: "#1e1e2e", gridColor: "rgba(49, 50, 68, 0.6)"
    };
    if (f[2]) cfg.range = f[2];
    var wrap = el("div", "tradingview-widget-container");
    wrap.style.height = "100%";
    var inner = el("div", "tradingview-widget-container__widget");
    inner.style.height = "100%";
    var sc = document.createElement("script");
    sc.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    sc.async = true;
    sc.textContent = JSON.stringify(cfg);
    wrap.append(inner, sc);
    box.appendChild(wrap);
  }
  (function () {
    var bar = $("live-ranges");
    FRAMES.forEach(function (f, i) {
      var b = el("button", "sf-range", f[0]);
      b.type = "button";
      b.setAttribute("aria-pressed", String(i === frame));
      b.addEventListener("click", function () {
        frame = i;
        bar.querySelectorAll("button").forEach(function (x, j) { x.setAttribute("aria-pressed", String(j === i)); });
        renderLive();
      });
      bar.appendChild(b);
    });
  })();
  function showTab(live) {
    liveShown = live;
    $("tab-forecast").setAttribute("aria-selected", String(!live));
    $("tab-live").setAttribute("aria-selected", String(live));
    $("pane-forecast").hidden = live;
    $("pane-live").hidden = !live;
    if (live) renderLive(); else $("live-chart").replaceChildren();
  }
  $("tab-forecast").addEventListener("click", function () { showTab(false); });
  $("tab-live").addEventListener("click", function () { showTab(true); });

  function openAdvice(tk) {
    openTicker = tk;
    var d = $("advice");
    if (!d.open) { d.showModal(); d.appendChild($("buddy")); }   // keep the cat above the pop-up
    renderAdvice();
    d.scrollTop = 0;
  }
  $("adv-close").addEventListener("click", function () { $("advice").close(); });
  $("advice").addEventListener("click", function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $("advice").addEventListener("close", function () { openTicker = null; showTab(false); document.body.appendChild($("buddy")); });

  // Little cat that trails the mouse, gets happy over clickable things, and pops a heart on click.
  // Only with a real mouse (not touch screens), and it never blocks clicks.
  (function () {
    var buddy = $("buddy");
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) { buddy.remove(); return; }
    var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var tx = -100, ty = -100, x = -100, y = -100, tilt = 0, running = false;
    var CLICKY = "a, button, summary, select, input, label, tr[tabindex], [role=option], .sf-note, .sf-hit, .sf-tk";

    function step() {
      var k = calm ? 1 : 0.16;
      var dx = tx - x;
      x += dx * k; y += (ty - y) * k;
      tilt += ((Math.max(-18, Math.min(18, dx * 0.6))) - tilt) * 0.2;
      buddy.style.transform = "translate(" + (x + 16).toFixed(1) + "px," + (y + 14).toFixed(1) + "px) rotate(" + tilt.toFixed(1) + "deg)";
      if (Math.abs(tx - x) + Math.abs(ty - y) + Math.abs(tilt) > 0.3) requestAnimationFrame(step); else running = false;
    }
    document.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      if (x < -50) { x = e.clientX; y = e.clientY; }
      tx = e.clientX; ty = e.clientY;
      buddy.classList.add("is-on");
      buddy.classList.toggle("is-happy", !!(e.target.closest && e.target.closest(CLICKY)));
      if (!running) { running = true; requestAnimationFrame(step); }
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", function () { buddy.classList.remove("is-on"); });
    window.addEventListener("blur", function () { buddy.classList.remove("is-on"); });
    document.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || calm) return;
      var h = el("span", "sf-heart", "♥");
      h.setAttribute("aria-hidden", "true");
      h.style.left = e.clientX + "px"; h.style.top = e.clientY + "px";
      ($("advice").open ? $("advice") : document.body).appendChild(h);
      setTimeout(function () { h.remove(); }, 950);
    });
  })();

  // ---------- Scorecard: published forecasts checked against what happened ----------
  function renderScorecard(t) {
    t = t || { graded: 0, pending: 0 };
    var has = t.graded > 0;
    $("sc-empty").hidden = has;
    $("sc-body").hidden = !has;
    if (!has) {
      $("sc-pending").textContent = t.pending ? t.pending + " forecasts are waiting for their 5 days to pass." : "";
      return;
    }
    $("sc-range").textContent = t.range_hit_pct.toFixed(0) + "%";
    $("sc-dir").textContent = t.direction_hit_pct.toFixed(0) + "%";
    $("sc-naive").textContent = t.always_up_hit_pct.toFixed(0) + "%";
    $("sc-n").textContent = String(t.graded);
    $("sc-span").textContent = "From " + t.weeks + " forecast day" + (t.weeks === 1 ? "" : "s") + ", " + day(t.first) +
      (t.first === t.last ? "" : " to " + day(t.last)) + (t.pending ? " · " + t.pending + " still waiting" : "");
    var nn = t.news_changed;
    $("sc-news").textContent = nn < 20
      ? "The news changed " + nn + " of these forecasts, too few yet to tell whether the news adjustments help."
      : "The news changed " + nn + " of these forecasts. Overall, the up/down chances were " +
        (t.brier_news < t.brier_model ? "a little more accurate with the news adjustments than without them."
         : t.brier_news > t.brier_model ? "a little less accurate with the news adjustments than without them."
         : "equally accurate with or without the news adjustments.");
    $("sc-latest-h").textContent = "Latest checked: forecasts from " + day(t.last);
    var body = $("sc-rows");
    body.replaceChildren();
    (t.latest || []).forEach(function (r) {
      var tr = document.createElement("tr");
      tr.append(el("td", null, r.ticker), el("td", "sf-num", "$" + money(r.price)), el("td", "sf-num", r.up_pct + "%"),
        el("td", "sf-num", "$" + money(r.low) + " – $" + money(r.high)), el("td", "sf-num", "$" + money(r.final)),
        el("td", r.in_range ? "sf-yes" : "sf-no", r.in_range ? "Yes" : "No"),
        el("td", r.direction_right ? "sf-yes" : "sf-no", r.direction_right ? "Right" : "Wrong"));
      body.appendChild(tr);
    });
  }

  function render() {
    if (!state) return;
    renderStatus(state.status || {});
    var ready = !!state.forecast;
    $("loading").hidden = ready;
    if (!ready) { $("loading-phase").textContent = (state.status && state.status.phase) || ""; return; }
    renderSummary(state.forecast, state.calibration || []);
    renderChart(state.forecast);
    renderTable(state.forecast);
    renderNotes(state.forecast);
    renderNews(state.news || [], state.forecast);
    renderScorecard(state.track);
    renderAdvice();
  }

  function poll() {
    fetch(window.STATE_URL || "/api/state", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (s) { state = s; render(); })
      .catch(function () {
        $("status").dataset.state = "error";
        $("status-text").textContent = STATIC ? "Couldn't load today's forecast. Try refreshing the page."
          : "Can't reach the forecast program. Is its window still open?";
      })
      .finally(function () { setTimeout(poll, STATIC ? 1800000 : state && state.forecast ? 60000 : 5000); });
  }

  // Search bar: click to see every stock, type to narrow the list, pick one to open its details.
  (function () {
    var input = $("search-input"), list = $("search-list"), clear = $("search-clear"), box = $("search");
    var items = [], active = -1;
    var norm = function (s) { return String(s || "").toLowerCase(); };

    function rank(r, q) {
      if (!q) return 0;
      var t = norm(r.ticker), n = norm(r.name);
      if (t === q) return 1;
      if (t.indexOf(q) === 0) return 2;
      if (n.indexOf(q) === 0) return 3;
      if (n.split(/[^a-z0-9]+/).some(function (w) { return w.indexOf(q) === 0; })) return 4;
      if (n.indexOf(q) > -1 || t.indexOf(q) > -1) return 5;
      return -1;
    }
    function mark(text, q) {   // text with the typed letters in bold
      var span = el("span"), i = q ? norm(text).indexOf(q) : -1;
      if (i < 0) { span.textContent = text; return span; }
      span.append(text.slice(0, i), el("mark", null, text.slice(i, i + q.length)), text.slice(i + q.length));
      return span;
    }
    function setActive(i) {
      active = i;
      Array.prototype.forEach.call(list.children, function (li, j) { li.setAttribute("aria-selected", String(j === i)); });
      var cur = list.children[i];
      if (cur && cur.id) { input.setAttribute("aria-activedescendant", cur.id); cur.scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    }
    function show() {
      if (!state || !state.forecast) return;
      var q = norm(input.value.trim()), base = state.base_rate_pct || 55;
      clear.hidden = !input.value;
      items = state.forecast.map(function (r) { return { r: r, k: rank(r, q) }; })
        .filter(function (x) { return x.k >= 0; })
        .sort(function (a, b) { return a.k - b.k || d3.ascending(a.r.ticker, b.r.ticker); })
        .map(function (x) { return x.r; });
      list.replaceChildren();
      if (!items.length) {
        list.appendChild(el("li", "sf-search-empty", "No stock matches \"" + input.value.trim() + "\". Try a company name or ticker."));
      }
      items.forEach(function (r, i) {
        var li = el("li", "sf-search-item");
        li.id = "search-opt-" + i;
        li.setAttribute("role", "option");
        var edge = r.up_pct - base, tone = edge >= 3 ? "up" : edge <= -3 ? "down" : "flat";
        var who = el("span", "sf-search-who");
        who.append(el("strong", "sf-search-tk"), el("span", "sf-search-name"));
        who.firstChild.appendChild(mark(r.ticker, q));
        who.lastChild.appendChild(mark(r.name, q));
        var right = el("span", "sf-search-right");
        right.append(el("span", "sf-search-price", "$" + money(r.price)),
                     el("span", "sf-search-up sf-search-up--" + tone, r.up_pct + "% up"));
        li.append(who, right);
        li.addEventListener("pointerdown", function (e) { e.preventDefault(); });   // keep focus in the box
        li.addEventListener("click", function () { pick(r); });
        li.addEventListener("pointermove", function () { if (active !== i) setActive(i); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      setActive(q && items.length ? 0 : -1);
    }
    function hide() { list.hidden = true; input.setAttribute("aria-expanded", "false"); setActive(-1); }
    function pick(r) { hide(); input.blur(); openAdvice(r.ticker); }

    input.addEventListener("focus", show);
    input.addEventListener("click", show);
    input.addEventListener("input", show);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.hidden) { show(); return; }
        if (!items.length) return;
        var n = items.length, d = e.key === "ArrowDown" ? 1 : -1;
        setActive(active < 0 ? (d > 0 ? 0 : n - 1) : (active + d + n) % n);
      } else if (e.key === "Enter") {
        var r = items[active >= 0 ? active : 0];
        if (r && !list.hidden) { e.preventDefault(); pick(r); }
      } else if (e.key === "Escape") {
        if (!list.hidden) hide(); else { input.value = ""; clear.hidden = true; }
      }
    });
    input.addEventListener("blur", function () { setTimeout(hide, 120); });
    clear.addEventListener("click", function () { input.value = ""; input.focus(); show(); });
    document.addEventListener("pointerdown", function (e) { if (!box.contains(e.target)) hide(); });
  })();

  $("news-filter").addEventListener("change",function () { newsLimit = 12; if (state && state.forecast) renderNews(state.news || [], state.forecast); });
  var lastW = 0;
  window.addEventListener("resize", function () {
    var w = $("range-chart").clientWidth;
    if (state && state.forecast && Math.abs(w - lastW) > 4) { lastW = w; renderChart(state.forecast); }
  });
  // Pages: the menu on top shows one group of sections at a time (#/home, #/forecasts, ...).
  // Old links to a section (#scorecard, #how-to-read) open the page holding it.
  (function () {
    var pages = [].slice.call(document.querySelectorAll(".sf-page"));
    var tabs = [].slice.call(document.querySelectorAll(".sf-menu-link"));
    function target() {
      var hash = location.hash || "", m = /^#\/([\w-]+)$/.exec(hash);
      if (m && pages.some(function (p) { return p.dataset.page === m[1]; })) return { page: m[1] };
      var el = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
      var host = el && el.closest(".sf-page");
      return host ? { page: host.dataset.page, el: el } : { page: "home" };
    }
    function show() {
      var t = target();
      pages.forEach(function (p) { p.hidden = p.dataset.page !== t.page; });
      tabs.forEach(function (a) {
        if (a.dataset.page === t.page) { a.setAttribute("aria-current", "page"); a.scrollIntoView({ block: "nearest", inline: "nearest" }); }
        else a.removeAttribute("aria-current");
      });
      window.dispatchEvent(new Event("resize"));   // the range chart sizes itself once its page is visible
      if (t.el) { if (t.el.tagName === "DETAILS") t.el.open = true; t.el.scrollIntoView(); }
      else window.scrollTo(0, 0);
    }
    window.addEventListener("hashchange", show);
    show();
  })();

  poll();
})();
