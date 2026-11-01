import "@fontsource-variable/inter/opsz.css";
import "./tailwind.css";
import "./fluid.css";
import { FluidRoot } from "@/components/fluid-root";
import WindowControls from "./window-controls";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
export const metadata = {
  title: "Dispatch — Workspace",
  description:
    "Bring your team’s agent conversations and files together in a secure workspace.",
};
// Runs before first paint so there is no flash of the wrong theme.
const themeScript = `(function(){try{var p=localStorage.getItem("dispatch-theme")||"system";var l=p==="light"||(p==="system"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.theme=l?"light":"dark";document.documentElement.classList.toggle("dark",!l)}catch(e){document.documentElement.dataset.theme="dark";document.documentElement.classList.add("dark")}})()`;
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
      <body>
        <div className="titlebar" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 11 21 3l-8 18-2-8-8-2Z" fill="currentColor" />
            <path
              d="m11 13 10-10"
              stroke="var(--c-000000)"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span>Dispatch</span>
          <WindowControls />
        </div>
        <FluidRoot>{children}</FluidRoot>
      </body>
    </html>
  );
}
