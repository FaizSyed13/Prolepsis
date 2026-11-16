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

  function renderStatus(s) {
    var box = $("status"), phase = s.phase || "";
    if (STATIC) {
      box.dataset.state = "live";
      $("status-text").textContent = "Updated every weekday evening · last update " +
        (s.built_at ? d3.timeFormat("%b %-d, %-I:%M %p")(new Date(s.built_at)) : "—");
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
    var shown = news.filter(function (h) { return !sel.value || h.ticker === sel.value; }).slice(0, 40);
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
    stat(dl, "Analysts' average target", dollars(f.targetMeanPrice) + (f.targetLowPrice ? " (" + dollars(f.targetLowPrice) + " – " + dollars(f.targetHighPrice) + ")" : ""));
    stat(dl, "Analyst rating", f.recommendationKey ? f.recommendationKey.replace("_", " ") + (f.numberOfAnalystOpinions ? " (" + f.numberOfAnalystOpinions + " analysts)" : "") : "—");
    stat(dl, "Next earnings", f.next_earnings ? day(f.next_earnings) : "Not announced");
    stat(dl, "This week: chance of going up", r.up_pct + "%");
    stat(dl, "This week: 80% likely range", dollars(r.low) + " – " + dollars(r.high));

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

  function openAdvice(tk) {
    openTicker = tk;
    var d = $("advice");
    if (!d.open) d.showModal();
    renderAdvice();
    d.scrollTop = 0;
  }
  $("adv-close").addEventListener("click", function () { $("advice").close(); });
  $("advice").addEventListener("click", function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $("advice").addEventListener("close", function () { openTicker = null; });

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

  $("news-filter").addEventListener("change", function () { if (state && state.forecast) renderNews(state.news || [], state.forecast); });
  var lastW = 0;
  window.addEventListener("resize", function () {
    var w = $("range-chart").clientWidth;
    if (state && state.forecast && Math.abs(w - lastW) > 4) { lastW = w; renderChart(state.forecast); }
  });
  poll();
})();
