const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("picker", {
  onSources: (fn) => ipcRenderer.on("sources", (e, list) => fn(list)),
  pick: (id) => ipcRenderer.send("picked", id),
});
