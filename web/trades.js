// Reads a broker's trade export (CSV / tab / semicolon, or a pasted table) and works out what the
// person owns now. Pure functions, no network: the file never leaves the visitor's browser.
// Used by app.js (window.PTrades) and by the Node test (module.exports).
(function (root) {
  "use strict";

  // ---- split text into rows of cells (handles "quoted, cells" and "" escapes) ----
  function sniffDelim(lines) {
    var best = ",", bestN = 0;
    [",", "\t", ";", "|"].forEach(function (d) {
      var n = 0;
      lines.slice(0, 40).forEach(function (l) { n = Math.max(n, splitLine(l, d).length); });
      if (n > bestN) { bestN = n; best = d; }
    });
    return best;
  }
  function splitLine(line, d) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === d) { out.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  }
  // Whole text -> rows; a line break inside "quotes" stays part of the cell (Robinhood does this).
  function splitAll(text, d) {
    var rows = [], row = [], cur = "", q = false;
    function endCell() { row.push(cur.replace(/\s+/g, " ").trim()); cur = ""; }
    function endRow() { endCell(); if (row.some(function (c) { return c !== ""; })) rows.push(row); row = []; }
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === d) endCell();
      else if (c === "\n") endRow();
      else cur += c;
    }
    endRow();
    return rows;
  }
  function parseTable(text) {
    text = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    var lines = text.split("\n").filter(function (l) { return l.trim() !== ""; });
    if (!lines.length) return { header: [], rows: [] };
    var d = sniffDelim(lines);
    var all = splitAll(text, d);
    // Some brokers put a few title lines above the real header: pick the line that looks most like one.
    var hi = 0, best = -1;
    all.slice(0, 30).forEach(function (cells, i) {
      var s = 0;
      cells.forEach(function (c) { if (headerWord(c)) s++; });
      if (cells.length >= 3 && s > best) { best = s; hi = i; }
    });
    var header = all[hi].map(function (h, i) { return h || ("Column " + (i + 1)); });
    var rows = all.slice(hi + 1).filter(function (r) { return r.length >= Math.min(3, header.length) && r.some(function (c) { return c !== ""; }); });
    return { header: header, rows: rows };
  }
  function headerWord(c) {
    return /symbol|ticker|instrument|quantity|qty|shares|price|action|trans|type|side|date|amount|description|commission|fee/i.test(c);
  }

  // ---- guess which column is which ----
  var GUESS = {
    symbol: [/^(symbol|ticker|instrument|stock|security symbol|underlying)$/i, /symbol|ticker/i, /^instrument|^security$/i],
    action: [/^(action|side|buy\/sell|b\/s|transaction|transaction type|trans code|transactiontype|type|activity)$/i,
             /trans(action)?[ _]?(code|type)|activity type|^action/i, /^type$|action|side/i],
    qty:    [/^(quantity|qty|shares|units|no\. of shares|number of shares)$/i, /quantity|qty|^shares\b|units/i],
    price:  [/^(price|share price|t\. price|trade price|price \(\$\)|execution price|avg price|unit price)$/i, /price/i]
  };
  function guessColumns(header) {
    var used = {}, out = {};
    ["symbol", "qty", "price", "action"].forEach(function (k) {
      out[k] = -1;
      for (var p = 0; p < GUESS[k].length && out[k] < 0; p++) {
        for (var i = 0; i < header.length; i++) {
          var h = header[i];
          if (used[i]) continue;
          if (k === "action" && /security type|asset type|account type|order type/i.test(h)) continue;
          if (k === "qty" && /price|value/i.test(h)) continue;
          if (k === "symbol" && /description/i.test(h)) continue;
          if (GUESS[k][p].test(h)) { out[k] = i; used[i] = true; break; }
        }
      }
    });
    return out;
  }

  // ---- reading cell values ----
  function num(s) {
    if (s == null) return NaN;
    s = String(s).trim();
    if (!s) return NaN;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
    s = s.replace(/[()$€£\s,+]|USD|CAD/gi, "").replace(/-/g, "");
    var v = parseFloat(s);
    return isNaN(v) ? NaN : (neg ? -v : v);
  }
  function side(s) {
    s = String(s || "").toLowerCase();
    if (/buy to cover/.test(s)) return "buy";
    if (/\b(sell|sells|sold|sale|sld|s)\b/.test(s)) return "sell";
    if (/\b(buy|buys|bought|bot|b|purchase|purchased|reinvest|reinvested|reinvestment)\b/.test(s)) return "buy";
    return "";
  }
  // "BRK.B", "BRK B", "brk/b" -> "BRK-B"; "AAPL US" -> "AAPL"
  function cleanTicker(s) {
    s = String(s || "").toUpperCase().trim().replace(/\s+(US|UN|UW|UQ)$/, "");
    s = s.replace(/[.\/ ]/g, "-").replace(/[^A-Z0-9-]/g, "");
    return s;
  }
  function tickerFromText(s) {   // Fidelity style "YOU BOUGHT APPLE INC (AAPL) (Cash)"
    var m = String(s || "").match(/\(([A-Z]{1,5}(?:[.\-][A-Z])?)\)/);
    return m ? m[1] : "";
  }

  // ---- trades -> what you own now ----
  // Order-free: shares = bought - sold; "average price paid" = money spent on buys / shares bought.
  function holdings(table, cols, known) {
    var by = {}, skipped = 0, used = 0, missingSide = 0;
    table.rows.forEach(function (r) {
      var raw = cols.symbol >= 0 ? r[cols.symbol] : "";
      var tk = cleanTicker(raw || "");
      if (!tk && cols.action >= 0) tk = cleanTicker(tickerFromText(r[cols.action]));
      var q = cols.qty >= 0 ? num(r[cols.qty]) : NaN;
      if (!tk || isNaN(q) || q === 0) { skipped++; return; }
      var sd = cols.action >= 0 ? side(r[cols.action]) : "";
      if (cols.action >= 0 && !sd) { skipped++; return; }           // dividends, deposits, fees, splits...
      if (!sd) { sd = q < 0 ? "sell" : "buy"; missingSide++; }      // no buy/sell column: use the sign
      var shares = Math.abs(q), price = cols.price >= 0 ? Math.abs(num(r[cols.price])) : NaN;
      var h = by[tk] = by[tk] || { ticker: tk, bought: 0, sold: 0, cost: 0, costShares: 0, trades: 0 };
      h.trades++; used++;
      if (sd === "buy") {
        h.bought += shares;
        if (price > 0) { h.cost += shares * price; h.costShares += shares; }
      } else h.sold += shares;
    });
    var list = Object.keys(by).map(function (k) {
      var h = by[k];
      h.shares = Math.round((h.bought - h.sold) * 1e6) / 1e6;
      h.avgPaid = h.costShares > 0 ? h.cost / h.costShares : null;
      h.known = !known || known.indexOf(h.ticker) >= 0;
      return h;
    });
    return {
      owned: list.filter(function (h) { return h.shares > 0; }).sort(function (a, b) { return a.ticker < b.ticker ? -1 : 1; }),
      closed: list.filter(function (h) { return h.shares <= 0; }).sort(function (a, b) { return a.ticker < b.ticker ? -1 : 1; }),
      oversold: list.filter(function (h) { return h.shares < 0; }).map(function (h) { return h.ticker; }).sort(),
      used: used, skipped: skipped, signOnly: missingSide > 0
    };
  }

  var api = { parseTable: parseTable, guessColumns: guessColumns, holdings: holdings, num: num, side: side, cleanTicker: cleanTicker };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PTrades = api;
})(this);
