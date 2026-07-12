(() => {
  var script = document.currentScript;
  if (!script) return;

  var token = script.getAttribute("data-token");
  if (!token) {
    console.error("Widget token missing. Add data-token attribute.");
    return;
  }

  var baseUrl =
    script.getAttribute("data-base-url") ||
    script.src.replace(/\/widget\.js(\?.*)?$/, "");

  var container = document.createElement("div");
  container.style.position = "fixed";
  container.style.right = "24px";
  container.style.bottom = "24px";
  container.style.zIndex = "2147483000";
  container.style.fontFamily =
    "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

  var button = document.createElement("button");
  button.type = "button";
  button.textContent = "RAG Chat";
  button.style.background = "#111";
  button.style.color = "#fff";
  button.style.border = "0";
  button.style.borderRadius = "999px";
  button.style.padding = "10px 16px";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
  button.style.fontWeight = "600";

  var iframe = document.createElement("iframe");
  iframe.src = `${baseUrl}/widget/embed?token=${encodeURIComponent(token)}`;
  iframe.style.display = "none";
  iframe.style.width = "360px";
  iframe.style.height = "560px";
  iframe.style.border = "1px solid #ddd";
  iframe.style.borderRadius = "12px";
  iframe.style.background = "#fff";
  iframe.style.boxShadow = "0 16px 48px rgba(0,0,0,0.2)";
  iframe.setAttribute("title", "AI Chat Widget");
  iframe.style.overflow = "hidden";

  function setOpen(open) {
    iframe.style.display = open ? "block" : "none";
    button.style.display = open ? "none" : "inline-block";
  }

  button.addEventListener("click", () => {
    setOpen(iframe.style.display === "none");
  });

  window.addEventListener("message", (event) => {
    if (!event || !event.data || event.data.type !== "RAG_WIDGET_CLOSE") return;
    setOpen(false);
  });

  container.appendChild(iframe);
  container.appendChild(button);
  document.body.appendChild(container);
})();
