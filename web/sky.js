// Living sky background, like a weather app: the visitor's own time of day (from their device clock)
// and, only if they ask for it, their local weather (browser location -> Open-Meteo, free, no key).
// Scenes: time = dawn | day | dusk | night; weather = clear | cloudy | rain | storm | snow.
// Test any scene with ?sky=night-rain (or day-clear, dusk-cloudy, dawn-snow ...).
(function () {
  "use strict";
  var sky = document.getElementById("sky");
  if (!sky) return;
  var fx = document.getElementById("sky-fx"), ctx = fx.getContext("2d");
  var cloudsEl = document.getElementById("sky-clouds");
  var chip = document.getElementById("sky-chip"), chipText = document.getElementById("sky-text"), wxBtn = document.getElementById("sky-wx");
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var WX_KEY = "sf-wx-v1", WX_CACHE = "sf-wx-cache-v1";
  var cur = { time: "", wx: "clear" }, sun = null;   // sun: { rise: Date, set: Date } from the weather service

  // ---------- which scene ----------
  function timeOfDay(now) {
    var rise, set;
    if (sun && sun.rise && sun.set && sun.rise.toDateString() === now.toDateString()) { rise = sun.rise; set = sun.set; }
    else { rise = new Date(now); rise.setHours(6, 30, 0, 0); set = new Date(now); set.setHours(18, 30, 0, 0); }
    var t = now.getTime(), H = 3600e3;
    if (t >= rise.getTime() - 0.6 * H && t < rise.getTime() + 1.2 * H) return "dawn";
    if (t >= set.getTime() - 1.2 * H && t < set.getTime() + 0.6 * H) return "dusk";
    if (t >= rise.getTime() && t < set.getTime()) return "day";
    return "night";
  }
  function wxFromCode(c) {   // WMO weather codes used by Open-Meteo
    if (c == null) return "clear";
    if (c <= 1) return "clear";
    if (c <= 3 || c === 45 || c === 48) return "cloudy";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (c >= 95) return "storm";
    return "rain";   // drizzle, rain, freezing rain, showers
  }
  var NAMES = {
    time: { dawn: "Sunrise", day: "Daytime", dusk: "Sunset", night: "Night" },
    wx: { clear: "", cloudy: "cloudy", rain: "rainy", storm: "stormy", snow: "snowy" }
  };
  var ICON = { clear: { dawn: "🌅", day: "☀️", dusk: "🌇", night: "🌙" }, cloudy: "☁️", rain: "🌧️", storm: "⛈️", snow: "🌨️" };

  // ---------- clouds: soft blobs shaped by an SVG noise filter (#sky-cloud-filter in index.html) ----------
  function makeClouds(n, opts) {
    cloudsEl.replaceChildren();
    for (var i = 0; i < n; i++) {
      var c = document.createElement("div");
      c.className = "sf-cloud";
      var w = opts.minW + Math.random() * (opts.maxW - opts.minW);
      var top = opts.top0 + Math.random() * (opts.top1 - opts.top0);
      var dur = (opts.speed * (0.8 + Math.random() * 0.5)) * (w / 400);
      c.style.cssText = "--w:" + w.toFixed(0) + "px;--top:" + top.toFixed(1) + "vh;--dur:" + dur.toFixed(0) + "s;--delay:-" + (Math.random() * dur).toFixed(0) + "s;--op:" +
        (opts.op * (0.7 + Math.random() * 0.3)).toFixed(2) + ";--sx:" + (1 + Math.random() * 0.6).toFixed(2);
      var puff = document.createElement("div"); puff.className = "sf-cloud-puff";
      c.appendChild(puff);
      cloudsEl.appendChild(c);
    }
  }

  // ---------- canvas effects: stars, rain, snow, lightning ----------
  var W = 0, H = 0, dpr = 1, parts = [], stars = [], raf = 0, flash = 0, lastT = 0;
  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seed() {
    stars = []; parts = [];
    if (cur.time === "night" && (cur.wx === "clear" || cur.wx === "cloudy")) {
      var ns = Math.round(W * H / (cur.wx === "clear" ? 2600 : 9000));
      for (var i = 0; i < ns; i++) stars.push({ x: Math.random() * W, y: Math.random() * H * 0.75, r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.7 + 0.3, p: Math.random() * 6.28, s: 0.5 + Math.random() * 1.5 });
    }
    if (cur.wx === "rain" || cur.wx === "storm") {
      var nr = Math.round(W * H / (cur.wx === "storm" ? 2200 : 3200));
      for (var j = 0; j < nr; j++) parts.push({ x: Math.random() * W, y: Math.random() * H, l: 10 + Math.random() * 18, v: 700 + Math.random() * 500, a: 0.12 + Math.random() * 0.3 });
    }
    if (cur.wx === "snow") {
      var nf = Math.round(W * H / 9000);
      for (var k = 0; k < nf; k++) parts.push({ x: Math.random() * W, y: Math.random() * H, r: 0.8 + Math.random() * 2.4, v: 25 + Math.random() * 45, p: Math.random() * 6.28, a: 0.4 + Math.random() * 0.5 });
    }
  }
  function draw(t) {
    var dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
    ctx.clearRect(0, 0, W, H);
    stars.forEach(function (s) {
      var tw = still ? 1 : 0.65 + 0.35 * Math.sin(t / 1000 * s.s + s.p);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = "#fff8ea";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    });
    if (cur.wx === "rain" || cur.wx === "storm") {
      ctx.strokeStyle = "#cfdcf5"; ctx.lineWidth = 1; ctx.lineCap = "round";
      parts.forEach(function (p) {
        if (!still) { p.y += p.v * dt; p.x -= p.v * dt * 0.12; if (p.y > H + 20) { p.y = -20 - Math.random() * 80; p.x = Math.random() * (W + 100); } }
        ctx.globalAlpha = p.a;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * 0.12, p.y - p.l); ctx.stroke();
      });
    }
    if (cur.wx === "snow") {
      ctx.fillStyle = "#ffffff";
      parts.forEach(function (p) {
        if (!still) { p.y += p.v * dt; p.x += Math.sin(t / 1400 + p.p) * 12 * dt; if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W; } }
        ctx.globalAlpha = p.a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      });
    }
    if (cur.wx === "storm" && !still) {
      if (flash <= 0 && Math.random() < dt * 0.08) flash = 1;
      if (flash > 0) {
        ctx.globalAlpha = Math.max(0, flash) * (flash > 0.7 ? 0.35 : 0.18);
        ctx.fillStyle = "#e8ecff"; ctx.fillRect(0, 0, W, H);
        flash -= dt * 2.2;
      }
    }
    ctx.globalAlpha = 1;
    if (!still && !document.hidden) raf = requestAnimationFrame(draw);
  }
  function startFx() {
    cancelAnimationFrame(raf); lastT = 0;
    size(); seed();
    raf = requestAnimationFrame(draw);
  }

  // ---------- apply a scene ----------
  function apply(time, wx, live) {
    var changed = time !== cur.time || wx !== cur.wx;
    cur.time = time; cur.wx = wx;
    sky.dataset.time = time; sky.dataset.wx = wx;
    if (changed) {
      var night = time === "night";
      if (wx === "clear") makeClouds(night ? 2 : 4, { minW: 260, maxW: 520, top0: 4, top1: 38, speed: 260, op: night ? 0.25 : 0.75 });
      else if (wx === "cloudy") makeClouds(9, { minW: 380, maxW: 780, top0: -6, top1: 50, speed: 200, op: 0.9 });
      else if (wx === "snow") makeClouds(7, { minW: 420, maxW: 820, top0: -8, top1: 34, speed: 260, op: 0.85 });
      else makeClouds(10, { minW: 460, maxW: 900, top0: -10, top1: 42, speed: 150, op: 0.95 });   // rain, storm
      startFx();
    }
    var icon = wx === "clear" ? ICON.clear[time] : ICON[wx];
    var words = NAMES.time[time] + (NAMES.wx[wx] ? ", " + NAMES.wx[wx] : "");
    if (chipText) chipText.textContent = icon + " " + words + (live ? " where you are" : "");
    if (wxBtn) wxBtn.hidden = !!live || wxState() === "off";
  }

  // ---------- weather (opt-in) ----------
  function wxState() { try { return localStorage.getItem(WX_KEY) || ""; } catch (e) { return ""; } }
  function setWx(v) { try { localStorage.setItem(WX_KEY, v); } catch (e) {} }
  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(WX_CACHE) || "null"); return c && Date.now() - c.at < 30 * 60e3 ? c : null; } catch (e) { return null; }
  }
  function useWeather(c) {
    sun = { rise: c.rise ? new Date(c.rise) : null, set: c.set ? new Date(c.set) : null };
    apply(timeOfDay(new Date()), wxFromCode(c.code), true);
  }
  function fetchWeather(prompted) {
    var c = readCache();
    if (c) { useWeather(c); return; }
    if (!navigator.geolocation) return;
    if (chipText && prompted) chipText.textContent = "Checking your weather…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      // rounded to ~10 km: enough for weather, not your street
      var lat = pos.coords.latitude.toFixed(1), lon = pos.coords.longitude.toFixed(1);
      fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
            "&current=weather_code&daily=sunrise,sunset&timezone=auto&forecast_days=1")
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var code = d && d.current ? d.current.weather_code : null;
          var off = (d && d.utc_offset_seconds) || 0;
          // sunrise/sunset come as local wall-clock times at that place; turn them into real moments
          var toDate = function (s) { return s ? new Date(Date.parse(s + "Z") - off * 1000) : null; };
          var c2 = { at: Date.now(), code: code, rise: d.daily ? toDate(d.daily.sunrise[0]) : null, set: d.daily ? toDate(d.daily.sunset[0]) : null };
          try { localStorage.setItem(WX_CACHE, JSON.stringify(c2)); } catch (e) {}
          useWeather(c2);
        })
        .catch(function () { apply(timeOfDay(new Date()), "clear", false); });
    }, function () {
      setWx("off");   // they said no: don't ask again, keep the time-only sky
      apply(timeOfDay(new Date()), "clear", false);
    }, { maximumAge: 3600e3, timeout: 15000 });
  }
  if (wxBtn) wxBtn.addEventListener("click", function () { setWx("on"); fetchWeather(true); });

  // ---------- start ----------
  var forced = (location.search.match(/[?&]sky=([a-z]+)-?([a-z]*)/) || []);
  if (forced[1]) apply(forced[1], forced[2] || "clear", false);
  else {
    apply(timeOfDay(new Date()), "clear", false);
    if (wxState() === "on") fetchWeather(false);
    setInterval(function () {   // keep up as the day turns
      var c = wxState() === "on" ? readCache() : null;
      if (wxState() === "on" && !c) fetchWeather(false);
      else apply(timeOfDay(new Date()), c ? wxFromCode(c.code) : cur.wx, !!c);
    }, 5 * 60e3);
  }
  var rt = 0;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(startFx, 200); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !still) { cancelAnimationFrame(raf); lastT = 0; raf = requestAnimationFrame(draw); } });
})();
