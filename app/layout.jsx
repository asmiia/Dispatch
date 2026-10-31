import "./globals.css";
import "./settings.css";
import "./select.css";
import "./theme.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
export const metadata = {
  title: "Dispatch — Workspace",
  description:
    "Bring your team’s agent conversations and files together in a secure workspace.",
};
// Runs before first paint so there is no flash of the wrong theme.
const themeScript = `(function(){try{var p=localStorage.getItem("dispatch-theme")||"system";var l=p==="light"||(p==="system"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.theme=l?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}})()`;
export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
