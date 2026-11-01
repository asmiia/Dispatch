// Compiles the program-sound helper with the C# compiler that ships with Windows. Other systems skip it.
const { execFileSync } = require("node:child_process"), fs = require("node:fs"), path = require("node:path");
if (process.platform !== "win32") process.exit(0);
const csc = path.join(process.env.WINDIR || "C:\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
execFileSync(csc, ["-nologo", "-optimize", "-platform:x64", "-target:exe", "-out:" + path.join(__dirname, "build", "app-audio.exe"), path.join(__dirname, "app-audio.cs")], { stdio: "inherit" });
