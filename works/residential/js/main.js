(function () {
  var root = document.documentElement;

  // Language: the inline script in <head> already picked it; the button switches and remembers.
  // The key "lang" is shared with the portfolio on the same domain.
  var langBtn = document.getElementById("lang");
  if (langBtn) {
    langBtn.addEventListener("click", function () {
      var lang = root.dataset.lang === "ru" ? "en" : "ru";
      root.dataset.lang = lang;
      root.lang = lang;
      try { localStorage.setItem("lang", lang); } catch (e) {}
    });
  }

  // Scroll reveal, once per element; skipped when the visitor asks for less motion.
  // A clipped photo has no visible area, so .reveal-img is watched through its parent.
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ("IntersectionObserver" in window && !reduce) {
    root.classList.add("js-reveal");
    var photos = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var cl = e.target.classList;
        if (cl.contains("reveal") || cl.contains("reveal-drop")) cl.add("is-in");
        (photos.get(e.target) || []).forEach(function (img) { img.classList.add("is-in"); });
        io.unobserve(e.target);
      });
    }, { threshold: 0.08 });
    document.querySelectorAll(".reveal, .reveal-drop").forEach(function (el) { io.observe(el); });
    document.querySelectorAll(".reveal-img").forEach(function (el) {
      var parent = el.parentElement;
      if (!photos.has(parent)) photos.set(parent, []);
      photos.get(parent).push(el);
      io.observe(parent);
    });
  }

  // Price calculator (services.html). Every number is written into both language copies.
  var calc = document.getElementById("calc");
  if (calc) {
    var area = calc.querySelector("#area");
    var sup = calc.querySelector("#sup");
    var put = function (key, n) {
      calc.querySelectorAll('[data-v="' + key + '"]').forEach(function (el) {
        el.textContent = new Intl.NumberFormat(el.closest(".en") ? "en-US" : "ru-RU").format(n);
      });
    };
    var show = function (key, on) {
      calc.querySelectorAll('[data-row="' + key + '"]').forEach(function (el) { el.hidden = !on; });
    };
    var update = function () {
      var a = Number(area.value);
      var turnkey = calc.querySelector('input[name="svc"]:checked').value === "turnkey";
      var months = a <= 80 ? 4 : a <= 150 ? 6 : 8;
      var withSup = !turnkey && sup.checked;
      sup.disabled = turnkey;
      area.style.setProperty("--p", ((a - area.min) / (area.max - area.min)) * 100 + "%");
      put("area", a);
      put("months", months);
      put("design", a * 3500);
      put("sup", months * 40000);
      put("turnkey", a * 25000);
      put("total", turnkey ? a * 25000 : a * 3500 + (withSup ? months * 40000 : 0));
      show("design", !turnkey);
      show("sup", withSup);
      show("turnkey", turnkey);
    };
    calc.addEventListener("input", update);
    calc.addEventListener("change", update);
    update();
  }

  // Step-by-step enquiry (contact.html). Demo only: checks the answers, sends nothing.
  var form = document.getElementById("wizard");
  if (form) {
    root.classList.add("js-form");
    var steps = [].slice.call(form.querySelectorAll(".wizard__step"));
    var cur = 0;
    var go = function (i, focus) {
      cur = i;
      steps.forEach(function (s, k) { s.classList.toggle("is-active", k === i); });
      form.style.setProperty("--step", i + 1);
      form.querySelectorAll("[data-cur]").forEach(function (el) { el.textContent = i + 1; });
      form.toggleAttribute("data-first", i === 0);
      form.toggleAttribute("data-last", i === steps.length - 1);
      if (focus) steps[i].querySelector(".wizard__q").focus();
    };
    var valid = {
      choice: function (step) { return !!step.querySelector("input:checked"); },
      area: function (el) { var n = Number(el.value.replace(",", ".").replace(/\s/g, "")); return el.value.trim() !== "" && n >= 10 && n <= 2000; },
      name: function (el) { return el.value.trim().length > 0; },
      phone: function (el) { return el.value.replace(/\D/g, "").length === 11; }
    };
    var check = function (step) {
      var ok = true;
      step.querySelectorAll("[data-check]").forEach(function (el) {
        var kind = el.getAttribute("data-check");
        var good = kind === "choice" ? valid.choice(step) : valid[kind](el);
        var err = step.querySelector('[data-err="' + (el.getAttribute("data-errkey") || kind) + '"]');
        if (err) err.hidden = good;
        if (kind !== "choice") el.setAttribute("aria-invalid", String(!good));
        if (!good && ok) { ok = false; if (kind !== "choice") el.focus(); }
      });
      return ok;
    };
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!check(steps[cur])) return;
      if (cur < steps.length - 1) { go(cur + 1, true); return; }
      form.setAttribute("data-done", "");
      steps.forEach(function (s) { s.hidden = true; });
      form.querySelector(".wizard__progress").hidden = true;
      form.querySelector(".wizard__nav").hidden = true;
      var done = form.querySelector(".wizard__done");
      done.hidden = false;
      done.querySelector(".wizard__q").focus();
    });
    form.querySelector(".wizard__back").addEventListener("click", function () { if (cur > 0) go(cur - 1, true); });
    // A chosen option clears its error right away
    form.addEventListener("change", function (e) {
      if (e.target.type === "radio") {
        var err = e.target.closest(".wizard__step").querySelector('[data-err="choice"]');
        if (err) err.hidden = true;
      }
    });
    go(0, false);
  }

  // Mobile menu
  var header = document.querySelector(".header");
  var menuBtn = document.getElementById("menu-btn");
  if (header && menuBtn) {
    menuBtn.addEventListener("click", function () {
      var open = !header.hasAttribute("data-open");
      header.toggleAttribute("data-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
    });
  }
})();
