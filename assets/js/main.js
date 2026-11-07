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
})();
