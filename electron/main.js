const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = 5151;
let server = null;
let win = null;

function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
}

function waitForServer(cb, tries = 0) {
  http.get(`http://localhost:${PORT}/`, () => cb()).on("error", () => {
    if (tries > 50) return cb();
    setTimeout(() => waitForServer(cb, tries + 1), 100);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#fbf7ee",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`http://localhost:${PORT}/`);
}

function send(channel) {
  if (win) win.webContents.send(channel);
}

function buildMenu() {
  const template = [
    { label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "quit" }] },
    {
      label: "File",
      submenu: [
        { label: "New Document", accelerator: "CmdOrCtrl+N", click: () => send("menu:new") },
        {
          label: "Open Folder…", accelerator: "CmdOrCtrl+O",
          click: async () => {
            const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
            if (!r.canceled && r.filePaths[0]) {
              await fetch(`http://localhost:${PORT}/api/workspace`, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ dir: r.filePaths[0] }),
              });
              send("menu:workspace-changed");
            }
          },
        },
        {
          label: "Import External Document…", accelerator: "CmdOrCtrl+Shift+I",
          click: async () => {
            const r = await dialog.showOpenDialog(win, {
              properties: ["openFile"],
              filters: [{ name: "Text", extensions: ["md", "markdown", "txt", "text"] }],
            });
            if (r.canceled || !r.filePaths[0]) return;
            const p = r.filePaths[0];
            const text = fs.readFileSync(p, "utf-8");
            const resp = await fetch(`http://localhost:${PORT}/api/import`, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ text, title: path.basename(p).replace(/\.[^.]+$/, ""), source: path.basename(p) }),
            });
            const out = await resp.json();
            if (out.slug && win) win.webContents.send("menu:loaded", out.slug);
          },
        },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => send("menu:save") },
        { type: "separator" },
        { label: "Export Authorship Record", accelerator: "CmdOrCtrl+Shift+E", click: () => send("menu:record") },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    {
      label: "Format",
      submenu: [
        { label: "Bold", accelerator: "CmdOrCtrl+B", click: () => send("fmt:bold") },
        { label: "Italic", accelerator: "CmdOrCtrl+I", click: () => send("fmt:italic") },
        { label: "Underline", accelerator: "CmdOrCtrl+U", click: () => send("fmt:underline") },
      ],
    },
    {
      label: "Paragraph",
      submenu: [
        { label: "Heading 1", accelerator: "CmdOrCtrl+1", click: () => send("fmt:h1") },
        { label: "Heading 2", accelerator: "CmdOrCtrl+2", click: () => send("fmt:h2") },
        { label: "Heading 3", accelerator: "CmdOrCtrl+3", click: () => send("fmt:h3") },
        { label: "Heading 4", accelerator: "CmdOrCtrl+4", click: () => send("fmt:h4") },
        { label: "Heading 5", accelerator: "CmdOrCtrl+5", click: () => send("fmt:h5") },
        { label: "Heading 6", accelerator: "CmdOrCtrl+6", click: () => send("fmt:h6") },
        { label: "Paragraph", accelerator: "CmdOrCtrl+0", click: () => send("fmt:paragraph") },
        { type: "separator" },
        { label: "Increase Heading Level", accelerator: "CmdOrCtrl+Plus", click: () => send("fmt:headingInc") },
        { label: "Decrease Heading Level", accelerator: "CmdOrCtrl+-", click: () => send("fmt:headingDec") },
        { type: "separator" },
        { label: "Quote", accelerator: "Alt+CmdOrCtrl+Q", click: () => send("fmt:quote") },
        { label: "Ordered List", accelerator: "Alt+CmdOrCtrl+O", click: () => send("fmt:ol") },
        { label: "Unordered List", accelerator: "Alt+CmdOrCtrl+U", click: () => send("fmt:ul") },
        { label: "Code Fences", accelerator: "Alt+CmdOrCtrl+C", click: () => send("fmt:code") },
        { label: "Horizontal Line", accelerator: "Alt+CmdOrCtrl+-", click: () => send("fmt:hr") },
      ],
    },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("open-external", (_e, url) => shell.openExternal(url));

app.whenReady().then(() => {
  startServer();
  buildMenu();
  waitForServer(createWindow);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("quit", () => { if (server) server.kill(); });
