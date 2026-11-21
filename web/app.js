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
      var at = s.built_at || s.news_at || s.base_at;
      $("status-text").textContent = "Updated every weekday morning and evening · last update " +
        (at ? d3.timeFormat("%b %-d, %-I:%M %p")(new Date(at)) : "—");
      return;
    }
    if (s.public_at && phase !== "live") {   // borrowed public copy while this computer builds its own
      box.dataset.state = "busy";
      var pub = new Date(s.public_at);
      $("status-text").textContent = "Showing the public forecast" +
        (isNaN(pub) ? "" : " from " + d3.timeFormat("%b %-d, %-I:%M %p")(pub)) +
        " while this computer makes its own (" + (phase || "working") + "; the first time takes 15-30 minutes)";
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
    var set = function (id, m) { var v = get(m); countTo($(id), isNaN(v) ? "—" : v.toFixed(1) + "%"); };
    set("t-acc", "direction_accuracy"); set("t-naive", "naive_accuracy");
    set("t-cover", "range_coverage"); set("t-base", "base_rate");
    if (cal.length) { $("p-start").textContent = day(cal[0].period_start); $("p-end").textContent = day(cal[0].period_end); }
    var edge = get("direction_accuracy") - get("naive_accuracy") >= 0.5;
    $("edge-line").textContent = edge
      ? "On past data the model called up or down a little better than always guessing the more common outcome."
      : "On past data the model called up or down no better than always guessing the more common outcome, so the price ranges are the more useful numbers here.";
  }

  function renderChart(rows, animate) {
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
    var outline = g.append("rect").attr("x", function (k) { return x(k.mlo); }).attr("width", function (k) { return Math.max(1, x(k.mhi) - x(k.mlo)); })
      .attr("y", rowH * 0.18).attr("height", rowH * 0.64).attr("rx", 3)
      .style("fill", "none").style("stroke", "var(--chart-muted)");
    var bars = g.append("rect").attr("x", function (k) { return x(k.lo); }).attr("width", function (k) { return Math.max(1, x(k.hi) - x(k.lo)); })
      .attr("y", rowH * 0.32).attr("height", rowH * 0.36).attr("rx", 2).style("fill", "var(--series)");
    if (animate && !calmMotion) {
      bars.attr("x", x(0)).attr("width", 0).transition().delay(function (_, i) { return 120 + i * 30; }).duration(750).ease(d3.easeCubicOut)
        .attr("x", function (k) { return x(k.lo); }).attr("width", function (k) { return Math.max(1, x(k.hi) - x(k.lo)); });
      outline.style("opacity", 0).transition().delay(function (_, i) { return 380 + i * 30; }).duration(500).style("opacity", 1);
    }
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
    var market = sel.value === "__market";
    var all = market ? (state.market_news || []).slice(0, 60)
      : news.filter(function (h) { return !sel.value || h.ticker === sel.value; }).slice(0, 40);
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
      if (market) { list.appendChild(storyItem(h, true)); return; }
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

  function renderCandles(r, animate) {
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
    if (animate && !calmMotion) {
      c.style("opacity", 0).transition().delay(function (_, i) { return i * 5; }).duration(350).style("opacity", 1);
      g.select(".sf-c-band").style("opacity", 0).transition().delay(data.length * 5).duration(500).style("opacity", 1);
    }

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

  function renderAdvice(animate) {
    if (!openTicker || !state || !state.forecast) return;
    var r = state.forecast.find(function (x) { return x.ticker === openTicker; });
    if (!r || !r.advice) return;
    var f = r.fund || {}, s = r.stats || {};
    $("adv-title").textContent = r.ticker + " (" + r.name + ")";
    $("adv-sub").textContent = "$" + money(r.price) + " · prices as of " + day(r.as_of) + (f.sector ? " · " + f.sector : "");
    fillVerdict($("adv-short"), r.advice.short, "Signal: " + r.advice.short.strength.toLowerCase() + " · Risk this week: " + r.advice.short.risk.toLowerCase());
    fillVerdict($("adv-long"), r.advice.long, "Signal: " + r.advice.long.strength.toLowerCase());
    renderCandles(r, animate);

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
  var NASDAQ = ["AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "PEP", "WMT", "COST", "TSLA", "NFLX", "AMD", "AVGO", "ADBE", "INTC", "CSCO", "QCOM"];
  var FRAMES = [   // label, candle size, visible span (none = TradingView's default for that size)
    ["1 min", "1"], ["5 min", "5"], ["30 min", "30"], ["1 hour", "60"], ["1 day", "D"],
    ["1 month", "D", "1M"], ["6 months", "D", "6M"], ["1y", "D", "12M"], ["5y", "W", "60M"], ["Max", "M", "ALL"]
  ];
  var frame = 4, liveShown = false;
  function isDark() { return false; }   // the page uses the light warm-paper palette
  function renderLive() {
    if (!openTicker || !liveShown) return;
    var box = $("live-chart"), f = FRAMES[frame];
    box.replaceChildren();
    var cfg = {
      symbol: (NASDAQ.indexOf(openTicker) > -1 ? "NASDAQ:" : "NYSE:") + openTicker.replace("-", "."),   // BRK-B -> NYSE:BRK.B
      interval: f[1], timezone: "America/New_York", theme: isDark() ? "dark" : "light", style: "1",
      locale: "en", autosize: true, allow_symbol_change: false, hide_side_toolbar: true,
      hide_top_toolbar: true, save_image: false, calendar: false, support_host: "https://www.tradingview.com",
      backgroundColor: "#fefbf6", gridColor: "rgba(216, 208, 195, 0.6)"
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
    renderAdvice(true);
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
    countTo($("sc-range"), t.range_hit_pct.toFixed(0) + "%");
    countTo($("sc-dir"), t.direction_hit_pct.toFixed(0) + "%");
    $("sc-naive").textContent = t.always_up_hit_pct.toFixed(0) + "%";
    countTo($("sc-n"), String(t.graded));
    $("sc-span").textContent = "From " + t.weeks + " forecast day" + (t.weeks === 1 ? "" : "s") + ", " + day(t.first) +
      (t.first === t.last ? "" : " to " + day(t.last)) + (t.pending ? " · " + t.pending + " still waiting" : "");
    // Few weeks graded: explain that early numbers swing a lot, with the long-run test numbers for comparison.
    var early = t.weeks < 8;
    $("sc-early").hidden = !early;
    if (early) {
      var upShare = t.always_up_hit_pct, wk = t.weeks === 1 ? "1 week" : t.weeks + " weeks";
      var tDir = calVal("direction_accuracy"), tCov = calVal("range_coverage");
      var fell = Math.round((100 - upShare) / 100 * t.graded);
      var mood = upShare <= 20 ? " In that time " + (fell === t.graded ? "all " + fell : fell + " of " + t.graded) + " stocks fell, a market-wide drop. That is the hardest kind of week for any forecast: when nearly everything falls together, the up/down calls and ranges miss together."
        : upShare >= 80 ? " In that time " + upShare.toFixed(0) + "% of the stocks rose, a market-wide jump, so the scores may look better than usual."
        : "";
      $("sc-early-h").textContent = "Early days: only " + wk + " checked so far";
      $("sc-early-text").textContent = "A few weeks can look great or awful by luck alone." + mood +
        (!isNaN(tDir) && !isNaN(tCov) ? " For comparison, in testing on about 4 years of past weeks the ranges caught " + tCov.toFixed(0) +
          "% of prices and the up/down calls were right " + tDir.toFixed(0) + "% of the time. Expect these live numbers to move toward that as more weeks get checked." : "");
    }
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

  // ---------- Motion helpers (all skipped when the visitor asks for less motion) ----------
  var calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function stagger(box) {
    if (!box || calmMotion) return;
    [].forEach.call(box.children, function (c, i) { c.style.setProperty("--i", Math.min(i, 14)); });
    box.classList.remove("sf-anim"); void box.offsetWidth; box.classList.add("sf-anim");
    clearTimeout(box._anim);
    box._anim = setTimeout(function () { box.classList.remove("sf-anim"); }, 2400);
  }
  function animatePage(page) {
    if (!page || calmMotion) return;
    stagger(page);
    page.querySelectorAll("[data-stagger]").forEach(stagger);
  }
  // Numbers roll up from zero the first time they appear.
  function countTo(node, text) {
    var first = node.dataset.val == null;
    node.dataset.val = text;
    var m = /^(\D*?)([\d,]*\.?\d+)(.*)$/.exec(text);
    if (!first || calmMotion || !m) { node.textContent = text; return; }
    var end = parseFloat(m[2].replace(/,/g, "")), dec = (m[2].split(".")[1] || "").length;
    var fmt = d3.format((m[2].indexOf(",") > -1 ? "," : "") + "." + dec + "f"), t0 = null;
    function tick(t) {
      if (t0 == null) t0 = t;
      var k = Math.min(1, (t - t0) / 800);
      node.textContent = k < 1 ? m[1] + fmt(end * (1 - Math.pow(1 - k, 3))) + m[3] : text;
      if (k < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ---------- Today: what happened in the market ----------
  var pct2 = function (v) { return (v > 0.005 ? "+" : v < -0.005 ? "−" : "") + Math.abs(v).toFixed(2) + "%"; };
  var arrow = function (v) { return v > 0.005 ? "▲ " : v < -0.005 ? "▼ " : ""; };
  var joinAnd = function (a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; };
  var briefLen = "quick";
  try { briefLen = localStorage.getItem("sf-brief") || "quick"; } catch (e) {}
  var mkPick = "^GSPC", mkSpan = 2;
  var SPANS = [["1M", 22], ["3M", 66], ["6M", 130], ["1Y", 260]];

  function fmtLevel(m, v) {
    if (m.unit === "pts") return v.toFixed(2) + "%";
    if (m.symbol === "BTC-USD") return "$" + d3.format(",.0f")(v);
    if (m.symbol === "CL=F" || m.symbol === "GC=F") return "$" + money(v);
    return d3.format(",.2f")(v);
  }
  function fmtChg(m) { return arrow(m.chg_pct) + (m.unit === "pts" ? signed(m.chg_pts) + " pts" : pct2(m.chg_pct)); }
  function chgTone(m) {
    if (Math.abs(m.chg_pct) < 0.05 || m.unit === "pts") return "flat";
    return (m.symbol === "^VIX" ? m.chg_pct < 0 : m.chg_pct > 0) ? "up" : "down";
  }
  function moveWord(v) {
    var a = Math.abs(v);
    if (a < 0.1) return "was flat";
    return (v > 0 ? (a < 0.5 ? "edged up " : a < 1.5 ? "rose " : "jumped ") : (a < 0.5 ? "slipped " : a < 1.5 ? "fell " : "dropped ")) + a.toFixed(1) + "%";
  }
  function dayWord(iso) {   // "today", "yesterday", "on Friday", "on Nov 3"
    var d = new Date(iso + "T12:00:00"), n = new Date();
    var diff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12) - d) / 86400000);
    return diff <= 0 ? "today" : diff === 1 ? "yesterday" : "on " + d3.timeFormat(diff < 7 ? "%A" : "%b %-d")(d);
  }
  function nyNow() {
    var o = {};
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; });
    return { wd: o.weekday, min: (Number(o.hour) % 24) * 60 + Number(o.minute) };
  }
  function marketOpen() { var n = nyNow(); return n.wd !== "Sat" && n.wd !== "Sun" && n.min >= 570 && n.min < 960; }

  function renderClock() {
    var h = new Date().getHours();
    $("hello").textContent = h < 4 || h >= 22 ? "Up late, night owl?" : h < 12 ? "Good morning!" : h < 17 ? "Good afternoon!" : "Good evening!";
    $("today-title").textContent = h >= 4 && h < 12 ? "Here's what happened while you were asleep" : "Here's what's up with the market";
    var n = nyNow(), now = new Date(), diff = ((now.getHours() * 60 + now.getMinutes()) - n.min + 2160) % 1440 - 720;
    var local = function (nyMin) { return d3.timeFormat("%-I:%M %p")(new Date(now.getTime() + (nyMin - n.min) * 60000)); };
    var yours = function (nyMin) { return Math.abs(diff) > 1 ? " (" + local(nyMin) + " your time)" : ""; };
    var weekend = n.wd === "Sat" || n.wd === "Sun";
    var text;
    if (marketOpen()) text = "The US stock market is open right now. It closes at 4:00 PM New York time" + yours(960) + ".";
    else if (weekend || (n.wd === "Fri" && n.min >= 960)) text = "The US stock market is closed for the weekend. It opens again Monday at 9:30 AM New York time" + yours(570) + ".";
    else if (n.min < 570) text = "The US stock market opens today at 9:30 AM New York time" + yours(570) + ".";
    else text = "The US stock market has closed for the day. It opens again tomorrow at 9:30 AM New York time" + yours(570) + ".";
    $("market-clock").textContent = text + " Holidays aren't counted.";
  }

  function marketBy() { var by = {}; ((state.market || {}).markets || []).forEach(function (m) { by[m.symbol] = m; }); return by; }
  var STORY_RX = /\b(stocks?|markets?|wall street|dow|s&p|nasdaq|shares|fed|rates?|inflation|earnings|economy|treasur\w*)\b/i;
  function stories() {
    var all = state.market_news || [], cut = Date.now() - 36 * 3600000;
    var recent = all.filter(function (h) { return new Date(h.published).getTime() >= cut; });
    return recent.length >= 5 ? recent : all;
  }
  var nameOf = function (tk) { var r = (state.forecast || []).find(function (x) { return x.ticker === tk; }); return r ? r.name : tk; };

  function renderBrief() {
    var box = $("brief-list"), by = marketBy(), items = [];
    var add = function (k, full, parts) { items.push({ k: k, full: full, parts: parts }); };
    var three = [by["^GSPC"], by["^IXIC"], by["^DJI"]].filter(Boolean);
    if (three.length) {
      var ups = three.filter(function (m) { return m.chg_pct >= 0.1; }).length, downs = three.filter(function (m) { return m.chg_pct <= -0.1; }).length;
      var mood = ups === three.length ? "Stocks rose" : downs === three.length ? "Stocks fell" : ups && downs ? "It was a mixed day for stocks" : "Stocks barely moved";
      add("market", false, [mood + " " + dayWord(three[0].date) + ": " + joinAnd(three.map(function (m) { return "the " + m.name + " " + moveWord(m.chg_pct); })) + "."]);
    }
    if (by["^RUT"]) add("market", true, ["Smaller companies (the Russell 2000) " + moveWord(by["^RUT"].chg_pct) + "."]);
    var fut = (state.market || {}).futures || [];
    if (!marketOpen() && fut.length) {
      var es = fut[0];
      add("futures", false, ["Right now, futures point to a " + (es.chg_pct >= 0.15 ? "higher" : es.chg_pct <= -0.15 ? "lower" : "quiet") +
        " start: S&P 500 futures are " + pct2(es.chg_pct) + ". That's only a hint, not a promise."]);
    }
    var vix = by["^VIX"];
    if (vix) {
      var med = d3.median(vix.series, function (d) { return d[1]; });
      add("mood", true, ["The VIX \"fear gauge\" is at " + vix.last.toFixed(1) + (vix.last > med * 1.15 ? ", higher than usual for the past year, so traders are more nervous than normal."
        : vix.last < med * 0.87 ? ", lower than usual for the past year, so traders are fairly calm." : ", about normal for the past year.")]);
    }
    var tnx = by["^TNX"];
    if (tnx) add("rates", true, ["The 10-year US interest rate " + (tnx.chg_pts >= 0.01 ? "rose" : tnx.chg_pts <= -0.01 ? "fell" : "held") + " to " + tnx.last.toFixed(2) + "%" +
      (tnx.chg_pts >= 0.03 ? ". Higher rates tend to weigh on stock prices." : ".")]);
    if (by["CL=F"] && by["GC=F"]) add("goods", true, ["Oil " + moveWord(by["CL=F"].chg_pct) + " to $" + money(by["CL=F"].last) + " a barrel, and gold " + moveWord(by["GC=F"].chg_pct) + "."]);
    if (by["BTC-USD"]) add("goods", true, ["Bitcoin " + moveWord(by["BTC-USD"].chg_pct) + " to $" + d3.format(",.0f")(by["BTC-USD"].last) + "."]);

    var mv = state.moves || {};
    var tks = (state.forecast || []).map(function (r) { return r.ticker; }).filter(function (tk) { return mv[tk]; })
      .sort(function (a, b) { return mv[b].chg_pct - mv[a].chg_pct; });
    if (tks.length) {
      var up = tks.filter(function (tk) { return mv[tk].chg_pct > 0; }).length, b = mv[tks[0]], w = mv[tks[tks.length - 1]];
      add("stocks", false, ["Of our " + tks.length + " stocks, " + up + " went up and " + (tks.length - up) + " went down. " +
        (b.chg_pct > 0 ? "Biggest gain: " : "Smallest drop: ") + b.name + " (" + pct2(b.chg_pct) + "). " +
        (w.chg_pct < 0 ? "Biggest drop: " : "Smallest gain: ") + w.name + " (" + pct2(w.chg_pct) + ")."]);
    }
    var st = stories();
    if (st.length) {
      var talk = {};
      st.forEach(function (h) { (h.mentions || []).forEach(function (tk) { talk[tk] = (talk[tk] || 0) + 1; }); });
      var hot = Object.keys(talk).sort(function (a, b) { return talk[b] - talk[a]; }).slice(0, 3).filter(function (tk) { return talk[tk] >= 2; });
      if (hot.length) add("stocks", true, ["Most talked-about of our stocks in the market news: " +
        joinAnd(hot.map(function (tk) { return nameOf(tk) + " (" + talk[tk] + " headlines)"; })) + "."]);
      var g = st.filter(function (h) { return h.tone === "good"; }).length, bd = st.filter(function (h) { return h.tone === "bad"; }).length;
      add("news", true, ["Market news mood: " + (g > bd * 1.5 ? "mostly upbeat" : bd > g * 1.5 ? "mostly gloomy" : "mixed") + ", with " + g + " good, " + bd + " bad and " +
        (st.length - g - bd) + " neutral headlines."]);
      var top = st.find(function (h) { return STORY_RX.test(h.title); }) || st[0];
      add("news", false, ["Top story: ", { text: top.title, url: top.url }, " (" + top.source + ")."]);
    }
    var fc = (state.forecast || []).slice().sort(function (a, b) { return (b.high - b.low) / b.price - (a.high - a.low) / a.price; });
    if (fc.length > 1) add("forecast", true, ["Next week, the forecast expects the bumpiest ride from " + fc[0].name + " and " + fc[1].name + " (their likely price ranges are the widest)."]);

    box.replaceChildren();
    items.filter(function (it) { return briefLen === "full" || !it.full; }).forEach(function (it) {
      var li = el("li", "sf-brief-item sf-brief--" + it.k), t = el("span");
      it.parts.forEach(function (p) {
        if (typeof p === "string") { t.append(p); return; }
        var url = safeUrl(p.url);
        if (url) { var a = el("a", null, p.text); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; t.appendChild(a); } else t.append(p.text);
      });
      li.append(el("span", "sf-brief-dot"), t);
      box.appendChild(li);
    });
    if (!box.children.length) box.appendChild(el("li", "sf-sub", "The market summary appears after the next update."));
    document.querySelectorAll("#brief .sf-seg-btn").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.len === briefLen)); });
  }
  document.querySelectorAll("#brief .sf-seg-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      briefLen = b.dataset.len;
      try { localStorage.setItem("sf-brief", briefLen); } catch (e) {}
      if (state && state.forecast) { renderBrief(); stagger($("brief-list")); }
    });
  });

  function spark(series, tone) {
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 30"); svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "sf-spark sf-spark--" + tone); svg.setAttribute("aria-hidden", "true");
    var ys = series.map(function (d) { return d[1]; }), lo = d3.min(ys), hi = d3.max(ys);
    var line = d3.line().x(function (_, i) { return i / Math.max(1, ys.length - 1) * 100; })
      .y(function (v) { return hi === lo ? 15 : 27 - (v - lo) / (hi - lo) * 24; });
    var p = document.createElementNS(NS, "path");
    p.setAttribute("d", line(ys)); p.setAttribute("pathLength", "1");
    svg.appendChild(p);
    return svg;
  }

  function renderMarkets() {
    var mk = (state.market || {}).markets || [], grid = $("mk-grid");
    grid.replaceChildren();
    if (!mk.length) { grid.appendChild(el("p", "sf-sub", "Market numbers aren't available right now. They come back with the next update.")); return; }
    if (!mk.some(function (m) { return m.symbol === mkPick; })) mkPick = mk[0].symbol;
    mk.forEach(function (m) {
      var b = el("button", "sf-mk"), tone = chgTone(m);
      b.type = "button"; b.dataset.sym = m.symbol; b.title = m.name + ": " + m.what;
      b.setAttribute("aria-pressed", String(m.symbol === mkPick));
      b.append(el("span", "sf-mk-name", m.name), el("span", "sf-mk-val", fmtLevel(m, m.last)),
               el("span", "sf-mk-chg sf-mk-chg--" + tone, fmtChg(m)), spark(m.series.slice(-22), tone));
      b.addEventListener("click", function () {
        mkPick = m.symbol;
        grid.querySelectorAll(".sf-mk").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.sym === mkPick)); });
        renderMkChart();
      });
      grid.appendChild(b);
    });
  }

  // Big market chart: TradingView Lightweight Charts (open source, Apache 2.0).
  var lwc = null, lwcSeries = null;
  function renderMkChart() {
    var mk = ((state.market || {}).markets || []).find(function (m) { return m.symbol === mkPick; });
    if (!mk) return;
    $("mk-chart-title").textContent = mk.name + " · " + fmtLevel(mk, mk.last);
    $("mk-chart-what").textContent = mk.what.charAt(0).toUpperCase() + mk.what.slice(1) + ". Daily closes; drag to scroll, pinch or scroll to zoom.";
    if (!window.LightweightCharts) { $("mk-chart").replaceChildren(el("p", "sf-sub", "The chart couldn't load. Try refreshing the page.")); return; }
    if (!lwc) {
      lwc = LightweightCharts.createChart($("mk-chart"), {
        autoSize: true,
        layout: { background: { type: "solid", color: "transparent" }, textColor: "#5e534a", fontFamily: "IBM Plex Sans, system-ui, sans-serif" },
        grid: { vertLines: { visible: false }, horzLines: { color: "rgba(216, 208, 195, 0.7)" } },
        rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
        crosshair: { mode: 0, vertLine: { color: "#84786f", labelBackgroundColor: "#5e534a" }, horzLine: { color: "#84786f", labelBackgroundColor: "#5e534a" } },
        handleScroll: { vertTouchDrag: false }
      });
      lwcSeries = lwc.addAreaSeries({ lineWidth: 2, priceLineVisible: false });
    }
    var pts = mk.series.slice(-SPANS[mkSpan][1]).map(function (d) { return { time: d[0], value: d[1] }; });
    var rising = pts.length > 1 && pts[pts.length - 1].value >= pts[0].value;
    var rgb = mk.symbol === "^VIX" ? "173, 66, 22" : rising ? "33, 118, 60" : "185, 28, 28";
    lwcSeries.applyOptions({ lineColor: "rgb(" + rgb + ")", topColor: "rgba(" + rgb + ", 0.32)", bottomColor: "rgba(" + rgb + ", 0.02)",
      priceFormat: mk.symbol === "BTC-USD" ? { type: "price", precision: 0, minMove: 1 } : { type: "price", precision: 2, minMove: 0.01 } });
    lwcSeries.setData(pts);
    lwc.timeScale().fitContent();
  }
  (function () {
    var bar = $("mk-spans");
    SPANS.forEach(function (s, i) {
      var b = el("button", "sf-range", s[0]);
      b.type = "button"; b.setAttribute("aria-pressed", String(i === mkSpan));
      b.addEventListener("click", function () {
        mkSpan = i;
        bar.querySelectorAll("button").forEach(function (x, j) { x.setAttribute("aria-pressed", String(j === i)); });
        renderMkChart();
      });
      bar.appendChild(b);
    });
  })();

  function renderFutures() {
    var f = (state.market || {}).futures || [], row = $("fut-row");
    $("futures").hidden = marketOpen() || !f.length;
    row.replaceChildren();
    f.forEach(function (m) {
      var c = el("div", "sf-fut-item"), tone = Math.abs(m.chg_pct) < 0.05 ? "flat" : m.chg_pct > 0 ? "up" : "down";
      c.append(el("span", "sf-mk-name", m.name), el("span", "sf-mk-chg sf-mk-chg--" + tone, arrow(m.chg_pct) + pct2(m.chg_pct)));
      row.appendChild(c);
    });
  }

  var heatHalf = "high";
  document.querySelectorAll(".sf-half-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      heatHalf = b.dataset.half;
      if (state && state.forecast) { renderHeat(); stagger($("heat")); }
    });
  });

  function renderHeat() {
    var mv = state.moves || {}, box = $("heat");
    box.replaceChildren();
    var rows = (state.forecast || []).filter(function (r) { return mv[r.ticker]; })
      .sort(function (a, b) { return mv[b.ticker].chg_pct - mv[a.ticker].chg_pct; });
    if (!rows.length) { box.appendChild(el("p", "sf-sub", "Daily changes appear after the next price update.")); return; }
    $("movers-title").textContent = "How our " + rows.length + " stocks did " + dayWord(mv[rows[0].ticker].date);
    var ext = Math.max(2, d3.max(rows, function (r) { return Math.abs(mv[r.ticker].chg_pct); }));
    // split at the midpoint: top half = high end, bottom half = low end
    var mid = Math.ceil(rows.length / 2), hi = rows.slice(0, mid), lo = rows.slice(mid);
    document.querySelectorAll(".sf-half-btn").forEach(function (b) {
      var n = b.dataset.half === "high" ? hi.length : lo.length;
      b.textContent = (b.dataset.half === "high" ? "High end" : "Low end") + " (" + n + ")";
      b.setAttribute("aria-pressed", String(b.dataset.half === heatHalf));
    });
    $("movers-sub").textContent = heatHalf === "high"
      ? "The top " + hi.length + " on the last trading day, best first. Tap a stock for its forecast and advice."
      : "The bottom " + lo.length + " on the last trading day, worst last. Tap a stock for its forecast and advice.";
    (heatHalf === "high" ? hi : lo).forEach(function (r) {
      var v = mv[r.ticker].chg_pct, b = el("button", "sf-heat-cell");
      b.type = "button";
      b.dataset.dir = v > 0.05 ? "up" : v < -0.05 ? "down" : "flat";
      b.style.setProperty("--amt", Math.round(10 + Math.min(1, Math.abs(v) / ext) * 32) + "%");
      b.setAttribute("aria-label", r.name + " " + pct2(v) + ". Open its forecast");
      b.append(el("strong", null, r.ticker), el("span", "sf-heat-name", r.name), el("span", "sf-heat-chg", pct2(v)));
      b.addEventListener("click", function () { openAdvice(r.ticker); });
      box.appendChild(b);
    });
  }

  function storyItem(h, withTag) {
    var li = el("li");
    if (withTag) li.appendChild(el("span", "sf-tk sf-tk--mkt", "Market"));
    var hl = el("span", "sf-hl"), url = safeUrl(h.url);
    if (url) { var a = el("a", null, h.title); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; hl.appendChild(a); }
    else hl.textContent = h.title;
    var meta = el("span", "sf-meta", h.source + " · " + ago(h.published));
    (h.mentions || []).forEach(function (tk) {
      var b = el("button", "sf-chip", tk);
      b.type = "button"; b.setAttribute("aria-label", "Open forecast for " + tk);
      b.addEventListener("click", function () { openAdvice(tk); });
      meta.appendChild(b);
    });
    li.append(hl, el("span", "sf-pill sf-pill--" + h.tone, h.tone), meta);
    return li;
  }
  var storyLimit = 8;
  function renderStories() {
    var list = $("story-list"), st = stories();
    list.replaceChildren();
    var g = st.filter(function (h) { return h.tone === "good"; }).length, bd = st.filter(function (h) { return h.tone === "bad"; }).length;
    var mood = $("mood");
    mood.hidden = !st.length;
    mood.dataset.tone = g > bd * 1.5 ? "good" : bd > g * 1.5 ? "bad" : "neutral";
    mood.textContent = "News mood: " + (mood.dataset.tone === "good" ? "upbeat" : mood.dataset.tone === "bad" ? "gloomy" : "mixed");
    if (!st.length) list.appendChild(el("li", "sf-sub", "No market headlines yet. They appear after the next news check."));
    st.slice(0, storyLimit).forEach(function (h) { list.appendChild(storyItem(h, false)); });
    var more = $("story-more");
    if (!more) {
      more = el("button", "sf-more", ""); more.id = "story-more"; more.type = "button";
      more.addEventListener("click", function () { storyLimit += 8; renderStories(); });
      list.after(more);
    }
    var left = Math.min(st.length, 48) - Math.min(storyLimit, st.length);
    more.hidden = left <= 0;
    more.textContent = "Show more stories (" + left + " more)";
  }

  // Live scrolling prices: free TradingView ticker-tape widget, loaded once.
  var tapeDone = false;
  function renderTape() {
    if (tapeDone) return;
    tapeDone = true;
    var wrap = el("div", "tradingview-widget-container"), sc = document.createElement("script");
    sc.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    sc.async = true;
    var sym = function (p, t) { return { proName: p, title: t }; };
    sc.textContent = JSON.stringify({
      symbols: [sym("FOREXCOM:SPXUSD", "S&P 500"), sym("FOREXCOM:NSXUSD", "Nasdaq 100"), sym("FOREXCOM:DJI", "Dow"),
        sym("BITSTAMP:BTCUSD", "Bitcoin"), sym("OANDA:XAUUSD", "Gold"),
        sym("NASDAQ:NVDA", "Nvidia"), sym("NASDAQ:AAPL", "Apple"), sym("NASDAQ:MSFT", "Microsoft"),
        sym("NASDAQ:AMZN", "Amazon"), sym("NASDAQ:GOOGL", "Alphabet"), sym("NASDAQ:META", "Meta")],
      showSymbolLogo: true, isTransparent: true, displayMode: "adaptive", colorTheme: "light", locale: "en"
    });
    wrap.append(el("div", "tradingview-widget-container__widget"), sc);
    $("tape").appendChild(wrap);
  }

  // ---------- Today page: the rest of the site at a glance ----------
  function calVal(m) { var r = (state.calibration || []).find(function (x) { return x.metric === m; }); return r ? Number(r.value) : NaN; }
  function renderFeats() {
    var rows = state.forecast || [];
    var wide = rows.slice().sort(function (a, b) { return (b.high - b.low) / b.price - (a.high - a.low) / a.price; })[0];
    $("f-fc").textContent = wide ? "Biggest expected swing: " + wide.name + " (" + pct((wide.low / wide.price - 1) * 100) + " to " + pct((wide.high / wide.price - 1) * 100) + ")" : "—";
    var n = rows.filter(changed).length;
    $("f-why").textContent = "The news changed " + n + " of " + rows.length + " forecasts";
    var t = state.track || {}, cov = calVal("range_coverage");
    $("f-track").textContent = t.graded ? t.graded + " live forecasts checked so far" : !isNaN(cov) ? "Ranges hit " + cov.toFixed(0) + "% in testing" : "—";
    $("f-news").textContent = (state.news || []).length + " stock headlines, " + (state.market_news || []).length + " market stories";
  }
  function renderPreview() {
    var box = $("pv"), rows = (state.forecast || []).slice();
    box.replaceChildren();
    if (!rows.length) return;
    var lo = function (r) { return (r.low / r.price - 1) * 100; }, hi = function (r) { return (r.high / r.price - 1) * 100; };
    rows.sort(function (a, b) { return (hi(b) - lo(b)) - (hi(a) - lo(a)); });
    var ext = d3.max(rows, function (r) { return Math.max(-lo(r), hi(r)); }) * 1.05;
    var pos = function (v) { return (50 + v / ext * 50).toFixed(2) + "%"; };
    var tried = false;   // "CLICK ME!!" on the first card until the visitor opens any stock
    try { tried = localStorage.getItem("sf-opened-card") === "1"; } catch (e) {}
    rows.forEach(function (r, i) {
      var c = el("button", "sf-pv-card");
      c.type = "button";
      if (i === 0 && !tried) { c.classList.add("is-hint"); c.appendChild(el("span", "sf-clickme", "CLICK ME!!")); }
      c.setAttribute("aria-label", r.name + ": likely between $" + money(r.low) + " and $" + money(r.high) + " in 5 trading days. Open details");
      var top = el("span", "sf-pv-top");
      top.append(el("strong", null, r.ticker), el("span", "sf-pv-up", "Up " + r.up_pct + "%"));
      var bar = el("span", "sf-pv-bar"), fill = el("span", "sf-pv-fill"), now = el("span", "sf-pv-now");
      fill.style.left = pos(lo(r)); fill.style.width = (hi(r) - lo(r)) / ext * 50 + "%";
      now.style.left = "50%";
      fill.style.transformOrigin = Math.max(0, Math.min(100, -lo(r) / (hi(r) - lo(r)) * 100)).toFixed(1) + "% 50%";   // grows out from today's price
      bar.append(fill, now);
      var ends = el("span", "sf-pv-ends");
      ends.append(el("span", null, "$" + money(r.low)), el("span", null, "$" + money(r.high)));
      c.append(top, el("span", "sf-pv-name", r.name), el("span", "sf-pv-price", "$" + money(r.price) + " today"), bar, ends,
               el("span", "sf-pv-pct", pct(lo(r)) + " to " + pct(hi(r))));
      c.addEventListener("click", function () {
        try { localStorage.setItem("sf-opened-card", "1"); } catch (e) {}
        box.querySelectorAll(".sf-clickme").forEach(function (x) { x.remove(); });
        box.querySelectorAll(".is-hint").forEach(function (x) { x.classList.remove("is-hint"); });
        openAdvice(r.ticker);
      });
      box.appendChild(c);
    });
  }
  function renderHonest() {
    var cov = calVal("range_coverage"), t = state.track || {};
    var waf = $("waffle"), hit = isNaN(cov) ? 0 : Math.round(cov);
    if (waf.children.length !== 100 || waf.dataset.hit !== String(hit)) {
      waf.replaceChildren();
      waf.dataset.hit = hit;
      for (var i = 0; i < 100; i++) { var c = el("span", i < hit ? "sf-w sf-w--in" : "sf-w"); c.style.setProperty("--i", i); waf.appendChild(c); }
    }
    if (!waf.dataset.watch) {   // squares fill in when the visitor scrolls down to them
      waf.dataset.watch = "1";
      if (!("IntersectionObserver" in window)) waf.classList.add("is-seen");
      else new IntersectionObserver(function (es, obs) {
        if (es[0].isIntersecting) { waf.classList.add("is-seen"); obs.disconnect(); }
      }, { threshold: 0.4 }).observe(waf);
    }
    countTo($("h-live"), String(t.graded || 0));
    $("h-live-sub").textContent = t.graded
      ? "Published forecasts graded against real prices: " + t.range_hit_pct.toFixed(0) + "% landed inside their range."
      : "Each forecast is graded 5 trading days after it's published. " + (t.pending ? t.pending + " are waiting." : "");
  }

  function renderToday() {
    renderClock(); renderTape(); renderBrief(); renderFeats(); renderPreview(); renderHonest(); renderMarkets(); renderMkChart(); renderFutures(); renderHeat();
  }
  setInterval(function () { if (state && state.forecast) { renderClock(); renderFutures(); } }, 60000);

  // ---------- My money: likely range for the visitor's own mix of stocks ----------
  // Each stock's 80% range -> center + spread; combined with how the stocks moved together over
  // the past year (state.corr). Tested on 70,000 random portfolios, 2023-2026: 80.0% inside.
  var PF_KEY = "sf-money-v1", PF_Z = 1.2815516;
  var pf = [];
  try { pf = JSON.parse(localStorage.getItem(PF_KEY) || "[]") || []; } catch (e) { pf = []; }
  function pfSave() { try { localStorage.setItem(PF_KEY, JSON.stringify(pf)); } catch (e) {} }
  var usd = function (v) { return (v < 0 ? "−$" : "$") + d3.format(",.0f")(Math.abs(v)); };
  var usdSigned = function (v) { return (v > 0 ? "+" : "") + usd(v); };

  function pfRow(h, i, rows) {
    var row = el("div", "sf-pf-row");
    // Type-to-search stock picker (ticker or company name)
    var pick = el("div", "sf-pf-pick");
    var sel = document.createElement("input");
    sel.type = "text"; sel.className = "sf-pf-sel"; sel.autocomplete = "off"; sel.spellcheck = false;
    sel.placeholder = "Search a stock, e.g. Apple";
    sel.setAttribute("role", "combobox"); sel.setAttribute("aria-expanded", "false"); sel.setAttribute("aria-label", "Stock");
    var ul = el("ul", "sf-search-list sf-pf-list-pop"); ul.setAttribute("role", "listbox"); ul.hidden = true;
    var all = rows.slice().sort(function (a, b) { return a.ticker < b.ticker ? -1 : 1; });
    var label = function (r) { return r.ticker + " (" + r.name + ")"; };
    var cur = rows.find(function (x) { return x.ticker === h.tk; });
    sel.value = cur ? label(cur) : "";
    var hits = [], act = 0;
    function choose(r) {
      sel.value = label(r); ul.hidden = true; sel.setAttribute("aria-expanded", "false");
      pf[i].tk = r.ticker; pfSave(); renderMoney(false); inp.focus();
    }
    function paint() {
      ul.replaceChildren();
      hits.forEach(function (r, k) {
        var li = el("li", "sf-search-item"); li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(k === act));
        var who = el("span", "sf-search-who");
        who.append(el("span", "sf-search-tk", r.ticker), el("span", "sf-search-name", r.name));
        li.append(who, el("span", "sf-search-price", "$" + money(r.price)));
        li.addEventListener("mousedown", function (e) { e.preventDefault(); choose(r); });
        ul.appendChild(li);
      });
      ul.hidden = !hits.length; sel.setAttribute("aria-expanded", String(!ul.hidden));
    }
    function filter() {
      var q = sel.value.trim().toLowerCase();
      if (cur && sel.value === label(cur)) q = "";
      hits = all.filter(function (r) { return !q || r.ticker.toLowerCase().indexOf(q) === 0 || r.name.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) {   // exact / starts-with ticker first
          var sa = a.ticker.toLowerCase().indexOf(q) === 0 ? 0 : 1, sb = b.ticker.toLowerCase().indexOf(q) === 0 ? 0 : 1;
          return sa - sb;
        });
      act = 0; paint();
    }
    sel.addEventListener("focus", function () { sel.select(); filter(); });
    sel.addEventListener("input", filter);
    sel.addEventListener("blur", function () {
      ul.hidden = true; sel.setAttribute("aria-expanded", "false");
      var r = rows.find(function (x) { return x.ticker === pf[i].tk; });
      sel.value = r ? label(r) : "";      // put back the chosen stock if they typed but didn't pick
    });
    sel.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!hits.length) return;
        act = (act + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length; paint();
        ul.children[act].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") { e.preventDefault(); if (hits[act]) choose(hits[act]); }
      else if (e.key === "Escape") { ul.hidden = true; sel.setAttribute("aria-expanded", "false"); }
    });
    pick.append(sel, ul);
    var inp = document.createElement("input");
    inp.type = "number"; inp.min = "0"; inp.step = "any"; inp.inputMode = "decimal";
    inp.className = "sf-pf-amt";
    inp.placeholder = h.unit === "usd" ? "Dollars" : "Shares";
    inp.setAttribute("aria-label", h.unit === "usd" ? "Dollars" : "Number of shares");
    if (h.amt) inp.value = h.amt;
    var seg = el("div", "sf-seg");
    [["shares", "Shares"], ["usd", "$"]].forEach(function (u) {
      var b = el("button", "sf-seg-btn", u[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", String((h.unit || "shares") === u[0]));
      b.addEventListener("click", function () { pf[i].unit = u[0]; pfSave(); renderMoney(true); });
      seg.appendChild(b);
    });
    var del = el("button", "sf-pf-del", "×");
    del.type = "button";
    del.setAttribute("aria-label", "Remove this stock");
    del.addEventListener("click", function () { pf.splice(i, 1); pfSave(); renderMoney(true); });
    inp.addEventListener("input", function () { pf[i].amt = inp.value; pfSave(); renderMoney(false); });
    var price = el("span", "sf-pf-price");
    var r = rows.find(function (x) { return x.ticker === h.tk; });
    price.textContent = r ? "$" + money(r.price) + " a share" : "";
    row.append(pick, inp, seg, price, del);
    return row;
  }

  function renderMoney(rebuildList) {
    var rows = state && state.forecast;
    if (!rows) return;
    if (!pf.length) pf.push({ tk: "", amt: "", unit: "shares" });
    var list = $("pf-list");
    if (rebuildList || list.children.length !== pf.length) {
      list.replaceChildren();
      pf.forEach(function (h, i) { list.appendChild(pfRow(h, i, rows)); });
    } else {   // just refresh the "$x a share" hints without stealing focus from the input
      pf.forEach(function (h, i) {
        var r = rows.find(function (x) { return x.ticker === h.tk; });
        list.children[i].querySelector(".sf-pf-price").textContent = r ? "$" + money(r.price) + " a share" : "";
      });
    }
    $("pf-clear").hidden = !(pf.length > 1 || pf[0].tk || pf[0].amt);

    // merge holdings by stock, worth in dollars now
    var by = {};
    pf.forEach(function (h) {
      var r = rows.find(function (x) { return x.ticker === h.tk; }), a = parseFloat(h.amt);
      if (!r || !(a > 0)) return;
      var v = h.unit === "usd" ? a : a * r.price;
      by[r.ticker] = by[r.ticker] || { r: r, v: 0 };
      by[r.ticker].v += v;
    });
    var hs = Object.keys(by).map(function (k) { return by[k]; });
    $("pf-empty").hidden = hs.length > 0;
    $("pf-result").hidden = hs.length === 0;
    if (!hs.length) return;

    var corr = state.corr || { tickers: [], m: [] };
    var ci = function (tk) { return corr.tickers.indexOf(tk); };
    var total = 0, mu = 0, sumLo = 0, sumHi = 0;
    hs.forEach(function (h) {
      var lo = h.r.low / h.r.price - 1, hi = h.r.high / h.r.price - 1;
      h.c = (lo + hi) / 2; h.sd = (hi - lo) / (2 * PF_Z); h.lo = lo; h.hi = hi;
      total += h.v; mu += h.v * h.c; sumLo += h.v * lo; sumHi += h.v * hi;
    });
    var varSum = 0;
    hs.forEach(function (a) {
      hs.forEach(function (b) {
        var ia = ci(a.r.ticker), ib = ci(b.r.ticker);
        var rho = a === b ? 1 : (ia >= 0 && ib >= 0 ? corr.m[ia][ib] : 1);   // unknown pair: assume they move together (safer, wider)
        varSum += a.v * b.v * a.sd * b.sd * rho;
      });
    });
    var sd = Math.sqrt(Math.max(varSum, 0));
    var lowV = total + mu - PF_Z * sd, highV = total + mu + PF_Z * sd;

    $("pf-now").textContent = usd(total);
    $("pf-now-sub").textContent = hs.length + " stock" + (hs.length === 1 ? "" : "s") + ", at the latest prices";
    $("pf-range").textContent = usd(lowV) + " to " + usd(highV);
    $("pf-change").textContent = "That's " + usdSigned(lowV - total) + " to " + usdSigned(highV - total) +
      " (" + pct((lowV / total - 1) * 100) + " to " + pct((highV / total - 1) * 100) + ")";

    // bar: band = likely range, mark = today's worth; scale covers both with some room
    var span = Math.max(highV - lowV, 1), a0 = Math.min(lowV, total) - span * 0.25, a1 = Math.max(highV, total) + span * 0.25;
    var x = function (v) { return ((v - a0) / (a1 - a0) * 100) + "%"; };
    $("pf-band").style.left = x(lowV);
    $("pf-band").style.width = ((highV - lowV) / (a1 - a0) * 100) + "%";
    $("pf-mark").style.left = x(total);
    $("pf-end-lo").textContent = usd(lowV);
    $("pf-end-hi").textContent = usd(highV);
    $("pf-end-lo").style.left = x(lowV);
    $("pf-end-hi").style.left = x(highV);

    var sumW = sumHi - sumLo, togW = highV - lowV;
    $("pf-spread").textContent = hs.length > 1 && sumW > togW * 1.02
      ? "Adding up each stock's own range would give a swing of " + usd(sumW) + ". Together it's only " + usd(togW) +
        ", because your stocks rarely all hit their best or worst at the same time. That's what spreading your money out does."
      : hs.length === 1 ? "Tip: add more stocks to see how spreading your money out changes the range." : "";

    var tb = $("pf-rows");
    tb.replaceChildren();
    hs.sort(function (a, b) { return b.v - a.v; }).forEach(function (h) {
      var tr = document.createElement("tr");
      tr.append(el("td", null, h.r.ticker + " (" + h.r.name + ")"), el("td", "sf-num", usd(h.v)),
        el("td", "sf-num", (h.v / total * 100).toFixed(0) + "%"),
        el("td", "sf-num", usd(h.v * (1 + h.lo))), el("td", "sf-num", usd(h.v * (1 + h.hi))));
      tb.appendChild(tr);
    });
  }
  $("pf-add").addEventListener("click", function () {
    pf.push({ tk: "", amt: "", unit: "shares" }); pfSave(); renderMoney(true);
    var sels = document.querySelectorAll(".sf-pf-sel"); if (sels.length) sels[sels.length - 1].focus();
  });
  $("pf-clear").addEventListener("click", function () { pf = []; pfSave(); renderMoney(true); });

  function render() {
    if (!state) return;
    renderStatus(state.status || {});
    var ready = !!state.forecast;
    $("loading").hidden = ready;
    if (!ready) { $("loading-phase").textContent = (state.status && state.status.phase) || ""; return; }
    var first = !rendered;
    rendered = true;
    renderToday();
    renderSummary(state.forecast, state.calibration || []);
    renderChart(state.forecast, first);
    renderTable(state.forecast);
    renderNotes(state.forecast);
    renderNews(state.news || [], state.forecast);
    renderScorecard(state.track);
    renderMoney(first);
    renderAdvice();
    if (first) animatePage(document.querySelector(".sf-page:not([hidden])"));
  }
  var rendered = false;

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
      if (m && m[1] === "home") m[1] = "today";    // Home is the old Today page
      if (m && m[1] === "money") return { page: "today", el: $("money") };   // My money lives on Home
      if (m && pages.some(function (p) { return p.dataset.page === m[1]; })) return { page: m[1] };
      var el = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
      var host = el && el.closest(".sf-page");
      return host ? { page: host.dataset.page, el: el } : { page: "today" };
    }
    function show() {
      var t = target();
      pages.forEach(function (p) { p.hidden = p.dataset.page !== t.page; });
      tabs.forEach(function (a) {
        if (a.dataset.page === t.page) { a.setAttribute("aria-current", "page"); a.scrollIntoView({ block: "nearest", inline: "nearest" }); }
        else a.removeAttribute("aria-current");
      });
      moveGlow();
      var page = pages.filter(function (p) { return p.dataset.page === t.page; })[0];
      if (state && state.forecast) {
        if (t.page === "forecasts") { lastW = $("range-chart").clientWidth; renderChart(state.forecast, true); }
        if (t.page === "recap" && lwc) lwc.timeScale().fitContent();
        if (!booting) animatePage(page);
      }
      booting = false;
      window.dispatchEvent(new Event("resize"));   // the range chart sizes itself once its page is visible
      if (t.el && t.el.closest(".sf-page").dataset.page !== "guide") t.el.scrollIntoView();
      else window.scrollTo(0, 0);
    }
    var booting = true;
    // Mauve pill that slides to the page you pick
    function moveGlow() {
      var cur = document.querySelector('.sf-menu-link[aria-current="page"]'), glow = document.querySelector(".sf-menu-glow");
      if (!cur || !glow) return;
      glow.style.width = cur.offsetWidth + "px";
      glow.style.height = cur.offsetHeight + "px";
      glow.style.transform = "translate(" + cur.offsetLeft + "px," + cur.offsetTop + "px)";
      if (!glow.classList.contains("is-on")) requestAnimationFrame(function () { glow.classList.add("is-on"); });
    }
    window.addEventListener("resize", moveGlow);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveGlow);
    window.addEventListener("hashchange", show);
    show();
  })();


  // First visit: a welcome box that only closes after ticking "I understand" (remembered on this device).
  (function () {
    var d = $("welcome"), box = $("wl-ok"), go = $("wl-go"), KEY = "sf-welcomed-v1";
    var seen = false;
    try { seen = localStorage.getItem(KEY) === "1"; } catch (e) {}
    if (seen || !d.showModal) { d.remove(); return; }
    d.addEventListener("cancel", function (e) { e.preventDefault(); });   // Esc can't skip it
    box.addEventListener("change", function () { go.disabled = !box.checked; });
    go.addEventListener("click", function () {
      if (!box.checked) return;
      try { localStorage.setItem(KEY, "1"); } catch (e) {}
      d.classList.add("is-leaving");
      setTimeout(function () { d.close(); d.remove(); var b = $("buddy"); if (b) document.body.appendChild(b); }, calmMotion ? 0 : 260);
    });
    d.showModal();
    var b = $("buddy"); if (b) d.appendChild(b);   // keep the cat above the box
    box.focus();
  })();

  poll();
})();
