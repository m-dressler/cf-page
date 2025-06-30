/// <reference lib="dom" />
if ("fetch" in window) {
  const refreshCSS = () => {
    const { head } = document;
    document.querySelectorAll("link").forEach((elem) => {
      const parent = elem.parentElement || head;
      elem.remove();
      const { rel, href } = elem;
      if (
        (href && typeof rel != "string") ||
        rel.length == 0 ||
        rel.toLowerCase() == "stylesheet"
      ) {
        const url = new URL(href);
        url.searchParams.set("_cacheOverride", Date.now() + "");
        elem.href = url.href;
      }
      parent.appendChild(elem);
    });
  };
  const listenForNextEvent = async () => {
    const res = await fetch("/-/cf-page/listen").catch((): { ok: false } => ({
      ok: false,
    }));
    if (!res.ok) await new Promise((res) => setTimeout(res, 500));
    else {
      const result = await res.json();
      if (!result || typeof result !== "object" || !("event" in result)) {
        console.error("Invalid event response", result);
      } else if (result.event === "reload") location.reload();
      else if (result.event === "css") refreshCSS();
      else alert("Unknown cf-preview event " + result.event);
    }
  };
  (async () => {
    // Constantly query events
    while (1) await listenForNextEvent();
  })();
} else {
  console.error(
    "Upgrade your browser. This Browser does NOT support fetch for Live-Reloading.",
  );
}
