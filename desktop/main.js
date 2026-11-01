// Dispatch desktop: a window onto your Dispatch server, with what a browser tab can't do:
// a proper screen picker with system audio, unread badges, a tray icon and launch at login.
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const read = () => {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
};
const save = (patch) =>
  fs.writeFileSync(
    settingsFile(),
    JSON.stringify({ ...read(), ...patch }, null, 2),
  );

let lastShare = null,
  win,
  tray,
  picker,
  quitting = false;
// The server comes from DISPATCH_URL, the command line (--server=...) or what you entered the first time.
const argServer = process.argv.find((a) => a.startsWith("--server="))?.slice(9);
const serverUrl = () =>
  process.env.DISPATCH_URL || argServer || read().serverUrl || "";
const origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};
const icon = () =>
  nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));

// Windows lists notifications from this id in Settings > Notifications, under the app name.
app.setAppUserModelId("dev.dispatch.desktop");
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (event, argv) => {
  const link = linkIn(argv);
  if (link) openLink(link);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

function load() {
  const url = serverUrl();
  if (url) win.loadURL(url);
  else win.loadFile(path.join(__dirname, "renderer", "connect.html"));
}

function createWindow() {
  const saved = read().bounds || { width: 1360, height: 860 };
  win = new BrowserWindow({
    ...saved,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "Dispatch",
    icon: icon(),
    autoHideMenuBar: true,
    // No system title bar: the page draws its own, and the system draws only the window buttons over it.
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 14, y: 10 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (read().maximized) win.maximize();
  for (const ev of ["maximize", "unmaximize"])
    win.on(ev, () => win.webContents.send("win-state", win.isMaximized()));
  // The app only ever shows your server. Links to anywhere else open in the normal browser.
  const external = (url) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const ok = origin(url) === origin(serverUrl()) || url.startsWith("file:");
    if (!ok) {
      event.preventDefault();
      external(url);
    }
  });
  win.on("close", (event) => {
    save({
      bounds: win.isMaximized() ? read().bounds : win.getBounds(),
      maximized: win.isMaximized(),
    });
    if (!quitting && read().closeToTray !== false) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => (win = null));
  load();
}

// Microphone, camera, notifications and screen capture are allowed for your server and nowhere else.
function trust() {
  const allowed = new Set([
    "media",
    "notifications",
    "display-capture",
    "clipboard-sanitized-write",
    "fullscreen",
  ]);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(
      allowed.has(permission) &&
        origin(details.requestingUrl) === origin(serverUrl()),
    ),
  );
  ses.setPermissionCheckHandler(
    (wc, permission, requestingOrigin) =>
      allowed.has(permission) &&
      requestingOrigin.startsWith(origin(serverUrl())),
  );
  // Screen sharing: show our own picker (screens and windows with previews) and share system audio too.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 200 },
        fetchWindowIcons: false,
      });
      const choice = await choose(sources);
      if (!choice) return callback({});
      const source = sources.find((s) => s.id === choice.id);
      lastShare = choice.quality;
      callback(
        source
          ? {
              video: source,
              audio:
                choice.audio && process.platform === "win32"
                  ? "loopback"
                  : undefined,
            }
          : {},
      );
    } catch {
      callback({});
    }
  });
}

function choose(sources) {
  return new Promise((resolve) => {
    if (picker && !picker.isDestroyed()) picker.close();
    picker = null;
    picker = new BrowserWindow({
      parent: win,
      modal: true,
      width: 760,
      height: 560,
      resizable: false,
      minimizable: false,
      title: "Share your screen",
      backgroundColor: "#000000",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "picker-preload.js"),
        contextIsolation: true,
        sandbox: true,
      },
    });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      ipcMain.removeListener("picked", onPick);
      resolve(value);
      if (picker && !picker.isDestroyed()) picker.close();
    };
    const onPick = (event, id) => finish(id);
    ipcMain.on("picked", onPick);
    picker.on("closed", () => finish(null));
    picker.loadFile(path.join(__dirname, "renderer", "picker.html"));
    picker.webContents.once("did-finish-load", () =>
      picker.webContents.send(
        "sources",
        sources.map((s) => ({
          id: s.id,
          name: s.name,
          thumb: s.thumbnail.toDataURL(),
          screen: s.id.startsWith("screen"),
        })),
      ),
    );
  });
}

function makeTray() {
  tray = new Tray(icon().resize({ width: 18, height: 18 }));
  tray.setToolTip("Dispatch");
  const show = () => {
    win?.show();
    win?.focus();
  };
  const build = () =>
    Menu.buildFromTemplate([
      { label: "Open Dispatch", click: show },
      { type: "separator" },
      {
        label: "Launch at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) =>
          app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      {
        label: "Keep running in the tray when closed",
        type: "checkbox",
        checked: read().closeToTray !== false,
        click: (item) => save({ closeToTray: item.checked }),
      },
      updateReady
        ? {
            label: `Restart to update to ${updateReady}`,
            click: () => {
              quitting = true;
              updater.quitAndInstall();
            },
          }
        : {
            label: `Check for updates (version ${app.getVersion()})`,
            enabled: !!updater,
            click: () => updater?.checkForUpdates().catch(() => {}),
          },
      {
        label: "Change server...",
        click: () => {
          save({ serverUrl: "" });
          delete process.env.DISPATCH_URL;
          show();
          win.loadFile(path.join(__dirname, "renderer", "connect.html"));
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]);
  tray.on("click", show);
  tray.on("right-click", () => tray.popUpContextMenu(build()));
}

// The page tells us how many conversations are unread and when a message arrives while it is in the background.
ipcMain.on("badge", (event, count) => {
  const n = Math.max(0, Number(count) || 0);
  app.setBadgeCount?.(n);
  if (process.platform === "win32" && win)
    win.setOverlayIcon(
      n ? icon().resize({ width: 16, height: 16 }) : null,
      n ? `${n} unread` : "",
    );
  tray?.setToolTip(n ? `Dispatch · ${n} unread` : "Dispatch");
});
ipcMain.on("notify", (event, { title, body }) => {
  if (!Notification.isSupported() || win?.isFocused()) return;
  const n = new Notification({
    title: String(title || "Dispatch"),
    body: String(body || ""),
    icon: icon(),
  });
  n.on("click", () => {
    win?.show();
    win?.focus();
  });
  n.show();
  win?.flashFrame(true);
  win?.once("focus", () => win.flashFrame(false));
});
// Checks that a Dispatch server answers at that address, remembers it and opens it.
async function connectTo(raw) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    return { ok: false, error: "That is not a valid address." };
  }
  try {
    const res = await fetch(url.origin + "/health", {
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json();
    if (!res.ok || body.status !== "ok") throw new Error();
  } catch {
    return { ok: false, error: "No Dispatch server answered at that address." };
  }
  save({ serverUrl: url.origin });
  win.loadURL(url.origin);
  return { ok: true };
}
// The page draws minimise, maximise and close itself.
ipcMain.on("win", (event, action) => {
  if (!win) return;
  if (action === "minimize") win.minimize();
  else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === "close") win.close();
});
ipcMain.handle("win-maximized", () => !!win?.isMaximized());
ipcMain.on("theme", () => {});
ipcMain.handle("share-quality", () => lastShare);
ipcMain.handle("connect", (event, raw) => connectTo(raw));

// Speech to text for call captions. The speech service the browser engine normally uses is not in this app, so
// on Windows the system's own recogniser listens to the default microphone and sends each sentence to the page.
let stt = null;
function stopStt() {
  try {
    stt?.kill();
  } catch {}
  stt = null;
}
function startStt() {
  if (stt) return;
  if (process.platform !== "win32")
    return win?.webContents.send("stt", { error: "unsupported" });
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$e = New-Object System.Speech.Recognition.SpeechRecognitionEngine",
    "$e.SetInputToDefaultAudioDevice()",
    "$e.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))",
    "[Console]::Out.WriteLine('READY')",
    "while ($true) { $r = $e.Recognize([TimeSpan]::FromSeconds(30)); if ($r -and $r.Text) { [Console]::Out.WriteLine('SAID:' + $r.Text) } }",
  ].join("; ");
  const child = require("node:child_process").spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true },
  );
  stt = child;
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line.startsWith("SAID:"))
        win?.webContents.send("stt", { text: line.slice(5), final: true });
      else if (line === "READY") win?.webContents.send("stt", { ready: true });
    }
  });
  let err = "";
  child.stderr.on("data", (d) => (err += d.toString()));
  child.on("exit", () => {
    if (stt === child) {
      stt = null;
      if (err.trim()) win?.webContents.send("stt", { error: err.trim().slice(0, 200) });
    }
  });
}
ipcMain.on("stt-start", startStt);
ipcMain.on("stt-stop", stopStt);
app.on("before-quit", stopStt);

// On Windows a browser marks what it downloads with the page it came from. If you got this app from your own
// Dispatch server, that mark names the server, so the first launch can offer to connect without typing anything.
function downloadedFrom() {
  if (process.platform !== "win32") return "";
  try {
    const dir = app.getPath("downloads"),
      files = fs
        .readdirSync(dir)
        .filter((f) => /^Dispatch-(Setup|Portable)/i.test(f) && f.endsWith(".exe"))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    for (const { f } of files) {
      try {
        const mark = fs.readFileSync(path.join(dir, f) + ":Zone.Identifier", "utf8"),
          from = /(?:HostUrl|ReferrerUrl)=(\S+)/g;
        for (const m of mark.matchAll(from)) {
          const o = origin(m[1]);
          if (o.startsWith("https://") || /^http:\/\/(localhost|127\.)/.test(o)) return o;
        }
      } catch {}
    }
  } catch {}
  return "";
}
async function offerDownloadedServer() {
  if (serverUrl() || !win) return;
  const server = downloadedFrom();
  if (!server) return;
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Connect", "Not now"],
    defaultId: 0,
    cancelId: 1,
    title: "Connect to your server?",
    message: "You downloaded this app from " + new URL(server).host,
    detail: "Connect Dispatch to " + server + "?",
  });
  if (response === 0) await connectTo(server);
}

// dispatch://connect?server=https://... is what the "Open in the desktop app" button in a Dispatch server uses.
// Because any web page can link to it, the app asks before it points itself somewhere.
async function openLink(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return;
  }
  if (u.protocol !== "dispatch:" || u.hostname !== "connect") return;
  const server = origin(u.searchParams.get("server") || "");
  if (!server || !win) return;
  win.show();
  win.focus();
  if (server !== origin(serverUrl())) {
    const { response } = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["Connect", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Connect to this server?",
      message: "Connect Dispatch to this server?",
      detail: server + "\n\nOnly continue if you trust it.",
    });
    if (response !== 0) return;
  }
  const result = await connectTo(server);
  if (!result.ok) dialog.showErrorBox("Could not connect", result.error);
}
const linkIn = (argv) => argv.find((a) => a.startsWith("dispatch://"));
if (process.defaultApp) {
  if (process.argv.length >= 2)
    app.setAsDefaultProtocolClient("dispatch", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
} else app.setAsDefaultProtocolClient("dispatch");
app.on("open-url", (event, link) => {
  event.preventDefault();
  app.whenReady().then(() => openLink(link));
});

// Self-update: the app checks the server it is connected to (the installers it hands out) and installs a newer
// version in the background. Only the installed build can do this; the portable one cannot replace itself.
let updater = null,
  updateReady = "";
function setupUpdates() {
  if (!app.isPackaged || !serverUrl()) return;
  try {
    updater = require("electron-updater").autoUpdater;
  } catch {
    return;
  }
  updater.setFeedURL({
    provider: "generic",
    url: origin(serverUrl()) + "/api/desktop-updates",
  });
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("error", () => {});
  updater.on("update-downloaded", (info) => {
    updateReady = info.version;
    new Notification({
      title: "Dispatch update ready",
      body: `Version ${info.version} will install when you restart.`,
      icon: icon(),
    }).show();
    if (tray) tray.setToolTip(`Dispatch · update ${info.version} ready`);
  });
  const check = () => updater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu", visible: process.platform === "darwin" },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "togglefullscreen" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "resetZoom" },
          ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
        ],
      },
    ]),
  );
  trust();
  createWindow();
  makeTray();
  setupUpdates();
  const first = linkIn(process.argv);
  if (first) win.webContents.once("did-finish-load", () => openLink(first));
  else offerDownloadedServer();
  app.on("activate", () => (win ? win.show() : createWindow()));
});
app.on("before-quit", () => (quitting = true));
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && quitting) app.quit();
});
