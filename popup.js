async function render() {
  const { enabled, lastStatus, lastAt } = await chrome.storage.local.get({
    enabled: true,
    lastStatus: "idle",
    lastAt: 0,
  });
  document.getElementById("enabled").checked = enabled;
  const when = lastAt ? new Date(lastAt).toLocaleTimeString() : "";
  document.getElementById("status").textContent = when ? `${lastStatus} (${when})` : lastStatus;
}

document.getElementById("enabled").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
});

chrome.storage.onChanged.addListener(render);
render();
