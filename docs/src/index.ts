import onDomReady from "jsr:@md/on-dom-ready";

onDomReady(() => {
  const copyButtons = document.querySelectorAll(".copy-button");
  const copySuccessClass = "bg-emerald-500";
  copyButtons.forEach((copyButton) => {
    copyButton.addEventListener("click", () => {
      const text = copyButton.previousElementSibling?.textContent;
      if (!text) return;

      navigator.clipboard.writeText(text);
      copyButton.classList.add(copySuccessClass);
      setTimeout(() => {
        copyButton.classList.remove(copySuccessClass);
      }, 1000);
    });
  });

  // Auto-open features when targeted by hash links
  const openTargetedFeature = () => {
    if (!location.hash) return;

    // Remove the # prefix and get the h3 element targeted
    const targetHeader = document.getElementById(location.hash.substring(1));
    const details = targetHeader?.parentElement?.parentElement;
    if (details?.tagName === "DETAILS") {
      (details as HTMLDetailsElement).open = true;
    }
  };

  // Open feature on page load and when hash changes
  openTargetedFeature();
  addEventListener("hashchange", openTargetedFeature);
});
