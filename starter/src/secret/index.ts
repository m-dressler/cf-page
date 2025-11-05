import { $ } from "@lib/client/utils.ts";
import { decrypt } from "@lib/common/crypto.ts";
import onDomReady from "@md/on-dom-ready";

const encryptedPromise = fetch("/secret/index.json").then((res) => {
  if (!res.ok) throw new Error("Failed to fetch secret json", { cause: res });
  else return res.arrayBuffer();
});

onDomReady(() => {
  $("button[type=submit]")?.addEventListener("click", async () => {
    const secret = $<HTMLInputElement>("input[type=password]")?.value;
    if (!secret) return alert("Please enter a password first");

    const encrypted = await encryptedPromise;
    try {
      const decrypted = await decrypt({
        value: new Uint8Array(encrypted),
        secret,
      });

      const main = $("main");
      if (main) {
        main.innerHTML = `<pre>${new TextDecoder().decode(decrypted)}</pre>`;
      }
    } catch {
      alert("Invalid secret");
    }
  });
});
