/* Hover help: a small "?" next to tricky words on the page. Hover, focus or tap it for a one-line
   explanation. Works on parts drawn later (tables, pop-ups) by watching the page for new labels. */
(function () {
  "use strict";

  // Label text (as shown on the page, lower case) -> plain-words explanation.
  var HELP = {
    "up": "The chance the price ends the next 5 trading days higher. 58% means about 58 times out of 100 in similar past weeks.",
    "down": "The chance the price ends the next 5 trading days lower. It's 100% minus the Up chance.",
    "model up": "The chance of going up before recent news was taken into account.",
    "range low": "The bottom of the 80% likely range: the price should end above this about 9 weeks out of 10.",
    "range high": "The top of the 80% likely range: the price should end below this about 9 weeks out of 10.",
    "range": "The 80% likely range that was forecast: where the price should end about 4 weeks out of 5.",
    "news (3 days)": "How good or bad the headlines from the last 3 days were, from −1 (all bad) to +1 (all good), rated by a finance news model.",
    "changed by news": "Whether strong news nudged the chance of going up (lean up / lean down) or widened the range (Range x1.4 and similar).",
    "said up": "The chance of going up that this forecast gave when it was published.",
    "price then": "The price when the forecast was published.",
    "5 days later": "The real price 5 trading days after the forecast.",
    "inside range": "Whether the real price landed inside the forecast's 80% range. The goal is about 80% of the time.",
    "direction": "Whether the forecast called up or down right: above 50% counts as calling up.",
    "the 80% price range": "A range the price should end inside about 4 weeks out of 5. Wider means a bumpier week is expected.",
    "up/down calls right": "How often the up or down call was right in testing. Compare it with always guessing the more common outcome.",
    "weeks that went up": "How often these stocks rose over 5 trading days. Because most weeks go up, guessing \"up\" every week already looks decent.",
    "live forecasts checked": "Forecasts published on this site and later graded against the real price.",
    "price landed inside the range": "How often the real price ended inside the 80% range. Close to 80% means the ranges are honest.",
    "called up or down right": "How often the up/down call was right. Always saying \"up\" is the bar to beat.",
    "forecasts checked": "How many published forecasts have been graded so far. More checks means a fairer score.",
    "before the bell": "Futures trade before the market opens, so they hint at the opening. They're often wrong.",
    "short term · next week": "Buy if the chance of going up is at least 3 points above a normal week, Sell if 3 below, otherwise Hold. A weak hint, not advice.",
    "long term · 1 year or more": "Four simple checks (trend, past year, analyst targets, price vs earnings), each +1 or −1. +2 or more is Buy, −2 or less is Sell.",
    "what analysts think": "Ratings and price targets from Wall Street analysts. For reading only: the forecast doesn't use them.",
    "how much it swings (yearly)": "Volatility: how much the price typically moves in a year. Higher means a bumpier ride.",
    "biggest drop, last 5 years": "The largest fall from a high point to a later low in the last 5 years.",
    "52-week range": "The lowest and highest price in the past year.",
    "below its 52-week high": "How far the price is under its highest point of the past year.",
    "200-day average": "The average closing price over the last 200 trading days. Above it often means an uptrend.",
    "moves vs the market (beta)": "Beta: 1.5x means the stock tends to move 1.5% when the whole market moves 1%.",
    "p/e, last 12 months": "Price-to-earnings: the price divided by the last year's profit per share. Higher means investors pay more for each $1 of profit.",
    "p/e, next 12 months": "Price divided by the profit per share analysts expect over the next year.",
    "dividend yield": "Cash the company pays shareholders each year, as a share of the price.",
    "next earnings": "When the company next reports its results. Prices often jump around these dates.",
    "s&p 500, past year": "How the 500 largest US companies did together, to compare with this stock.",
    "this week: chance of going up": "The chance the price ends the next 5 trading days higher.",
    "this week: 80% likely range": "Where the price should end after 5 trading days, about 4 weeks out of 5.",
    "your biggest risk": "The stock that could move your total the most, because of how much you hold and how much it swings.",
    "wildest and calmest": "Which of your stocks swings the most and which swings the least.",
    "could change by": "How much this holding's value could rise or fall, within the 80% likely range."
  };
  var PREFIX = { "average yearly growth since": "The average yearly gain since the first price we have, including the bad years." };

  function keyFor(node) {
    if (node.dataset.help) return node.dataset.help;
    var t = (node.firstChild && node.firstChild.nodeType === 3 ? node.firstChild.nodeValue : node.textContent || "")
      .trim().toLowerCase().replace(/\s+/g, " ");
    if (HELP[t]) return t;
    for (var p in PREFIX) if (t.indexOf(p) === 0) return "@" + p;
    return null;
  }
  function textFor(key) { return key.charAt(0) === "@" ? PREFIX[key.slice(1)] : HELP[key] || key; }

  // One shared bubble.
  var bubble = document.createElement("div");
  bubble.className = "sf-help-bubble"; bubble.id = "sf-help-bubble"; bubble.setAttribute("role", "tooltip"); bubble.hidden = true;
  var openBtn = null, pinned = false;

  function show(btn, pin) {
    if (!bubble.isConnected) document.body.appendChild(bubble);
    // inside an open pop-up (<dialog>), the bubble must live in it to be drawn on top
    var host = btn.closest("dialog[open]") || document.body;
    if (bubble.parentNode !== host) host.appendChild(bubble);
    openBtn = btn; pinned = !!pin;
    bubble.textContent = textFor(btn.dataset.key);
    bubble.hidden = false;
    btn.setAttribute("aria-describedby", "sf-help-bubble");
    var r = btn.getBoundingClientRect(), w = Math.min(280, window.innerWidth - 24);
    bubble.style.maxWidth = w + "px";
    bubble.style.position = "fixed"; bubble.style.left = "0px"; bubble.style.top = "0px";   // measure at full width
    var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    var left = Math.max(12, Math.min(r.left + r.width / 2 - bw / 2, window.innerWidth - bw - 12));
    var top = r.top - bh - 8 < 8 ? r.bottom + 8 : r.top - bh - 8;
    if (host === document.body) {
      bubble.style.position = "fixed";
      bubble.style.left = left + "px"; bubble.style.top = top + "px";
    } else {   // inside a pop-up: place it within the pop-up, allowing for how far it has scrolled
      var h = host.getBoundingClientRect();
      bubble.style.position = "absolute";
      bubble.style.left = (left - h.left - host.clientLeft + host.scrollLeft) + "px";
      bubble.style.top = (top - h.top - host.clientTop + host.scrollTop) + "px";
    }
  }
  function hide() {
    if (openBtn) openBtn.removeAttribute("aria-describedby");
    bubble.hidden = true; openBtn = null; pinned = false;
  }

  function decorate(root) {
    var nodes = (root || document).querySelectorAll("[data-help], th, dt, .sf-label, .sf-h, .sf-h3");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.querySelector(":scope > .sf-help") || n.closest(".sf-help-off")) continue;
      var key = keyFor(n);
      if (!key) continue;
      var b = document.createElement("button");
      b.type = "button"; b.className = "sf-help"; b.dataset.key = key; b.textContent = "?";
      b.setAttribute("aria-label", "What does this mean?");
      n.appendChild(b);
    }
  }

  document.addEventListener("mouseover", function (e) {
    var b = e.target.closest && e.target.closest(".sf-help");
    if (b && !pinned) show(b, false);
  });
  document.addEventListener("mouseout", function (e) {
    var b = e.target.closest && e.target.closest(".sf-help");
    if (b && !pinned && openBtn === b) hide();
  });
  document.addEventListener("focusin", function (e) {
    if (e.target.classList && e.target.classList.contains("sf-help")) show(e.target, false);
  });
  document.addEventListener("focusout", function (e) {
    if (e.target === openBtn && !pinned) hide();
  });
  // Tap or click: pin it open (phones have no hover). The "?" sits inside clickable rows and
  // table headers, so stop the click from opening a pop-up or sorting a table.
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".sf-help");
    if (b) {
      e.preventDefault(); e.stopPropagation();
      if (openBtn === b && pinned) hide(); else show(b, true);
    } else if (openBtn) hide();
  }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && openBtn) hide(); });
  // keep the bubble next to its "?" while the page or a pop-up scrolls; close it once the "?" is gone
  function follow() {
    if (!openBtn) return;
    if (!openBtn.isConnected || !openBtn.offsetParent) hide(); else show(openBtn, pinned);
  }
  window.addEventListener("scroll", follow, true);
  window.addEventListener("resize", follow);

  var queued = false;
  function soon() {
    if (queued) return;
    queued = true;
    setTimeout(function () { queued = false; decorate(); }, 60);
  }
  function start() {
    decorate();
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        // ignore our own "?" buttons and the bubble, or we'd loop forever
        var added = list[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var a = added[j];
          if (a.nodeType === 1 && !a.classList.contains("sf-help") && a !== bubble) { soon(); return; }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
