const { contextBridge, ipcRenderer } = require("electron");
// What the Dispatch page can ask of the desktop app. Nothing else from Node is exposed.
contextBridge.exposeInMainWorld("dispatchDesktop", {
  isDesktop: true,
  platform: process.platform,
  setBadge: (count) => ipcRenderer.send("badge", count),
  notify: (title, body) => ipcRenderer.send("notify", { title, body }),
  connect: (address) => ipcRenderer.invoke("connect", address),
  setTheme: (light) => ipcRenderer.send("theme", !!light),
  shareQuality: () => ipcRenderer.invoke("share-quality"),
  win: {
    act: (action) => ipcRenderer.send("win", action),
    maximized: () => ipcRenderer.invoke("win-maximized"),
    onState: (cb) => ipcRenderer.on("win-state", (e, max) => cb(!!max)),
  },
});

// The page draws the window bar itself in the desktop app (the system one is hidden), so it needs to know.
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.desktop = "1";
});
