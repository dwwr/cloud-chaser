const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cloudChaser", {
  setContentSize: (width, height) => {
    ipcRenderer.send("content-size", { width, height });
  },
});
