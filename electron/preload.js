const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("margin", {
  onMenu: (channel, cb) => ipcRenderer.on(channel, (_e, arg) => cb(arg)),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
