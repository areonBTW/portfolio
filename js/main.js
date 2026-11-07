(function () {
  var root = document.documentElement;

  // Language: the inline script in <head> already picked it; the button switches and remembers.
  // The key "lang" is shared with the works on the same domain, so the choice carries over.
  document.getElementById("lang").addEventListener("click", function () {
    var lang = root.dataset.lang === "ru" ? "en" : "ru";
    root.dataset.lang = lang;
    root.lang = lang;
    try { localStorage.setItem("lang", lang); } catch (e) {}
  });

  var items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("is-in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      io.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  items.forEach(function (el, i) {
    el.style.transitionDelay = Math.min(i, 3) * 80 + "ms";
    io.observe(el);
  });
})();
