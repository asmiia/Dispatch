"use client";
import Select from "./select";
import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import {
  Mail,
  Inbox,
  Send,
  Paperclip,
  PanelLeft,
  Plus,
  Search,
  ChevronDown,
  Folder,
  Terminal,
  ArrowUpRight,
  Settings as Gear,
  Settings2,
  RefreshCw,
  Loader2,
  X,
  Check,
  Trash2,
  Pin,
  Reply,
  Copy,
  MailOpen,
  MonitorDown,
  Scissors,
  ClipboardPaste,
  TextSelect,
  ExternalLink,
  IdCard,
  UserRound,
  Users,
  Hash,
  Pencil,
} from "lucide-react";
import Settings from "./settings";
import Login from "./login";
import AgentAvatar, { logoFor, photoOf } from "./agent-avatar";
import { emojify } from "node-emoji";
import Connect from "./connect";
import DesktopApp from "./desktop-app";
import Conversation from "./conversation";
import Composer from "./composer";
import ContextMenu from "./context-menu";
import Profile from "./profile";
import Resizer, { useSize } from "./resizer";
import Toasts from "./toasts";
import Call from "./call";
import Fluid from "./fluid";
import Feed from "./feed";
import RingModal from "./ring-modal";
import { PluginsList, PluginsPage } from "./plugins";
import Spaces, { NavRail, MeCard, QuickLinks } from "./spaces";
import { TeamList, TeamPage } from "./team";
import InboxPage, { InboxList, keep } from "./inbox";
import { gradientFor } from "./gradient";
import { blip, ring } from "./sounds";
function DispatchMark({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 11 21 3l-8 18-2-8-8-2Z" fill="currentColor" />
      <path
        className="mark-cut"
        d="m11 13 10-10"
        stroke="#f2f2f2"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
const root = (subject) => subject.replace(/^((re|fwd?):\s*)+/i, "") || subject;
// Short relative time for the message list: now, 5m, 3h, 2d, then the date.
const when = (iso) => {
  const t = (Date.now() - Date.parse(iso)) / 1000;
  if (t < 60) return "now";
  if (t < 3600) return `${Math.round(t / 60)}m`;
  if (t < 86400) return `${Math.round(t / 3600)}h`;
  if (t < 604800) return `${Math.round(t / 86400)}d`;
  return new Date(iso).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
};
// One-line plain-text preview of a Markdown body.
const preview = (md) =>
  emojify(md)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/[#>*`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 125);
const date = (value) =>
  new Date(value).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const size = (value) =>
  value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(1)} MB`;
// A page left open across an update asks for things that moved and gets a web page back instead of data.
// Reload once, with a guard so a real fault can never loop.
function reloadForUpdate() {
  try {
    const last = Number(sessionStorage.getItem("dispatch-reloaded") || 0);
    if (Date.now() - last < 20000) return false;
    sessionStorage.setItem("dispatch-reloaded", String(Date.now()));
  } catch {}
  // Only reload once the server is answering again: reloading while it restarts shows an error page.
  (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    window.location.reload();
  })();
  return true;
}
async function api(path, body) {
  const response = await fetch("/api/" + path, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  let value;
  try {
    value = await response.json();
  } catch {
    // A 502 or 503 web page means the server is restarting for an update. Wait: the page reloads itself once the
    // new version answers.
    if (response.status >= 500) throw new Error("The server is restarting. Try again in a moment.");
    if (reloadForUpdate()) throw new Error("Updating Dispatch...");
    throw new Error("Unexpected response from the server.");
  }
  if (!response.ok) {
    const error = new Error(value.error || "Request failed");
    error.status = response.status;
    throw error;
  }
  return value;
}
export default function Workspace() {
  const [authenticated, setAuthenticated] = useState(null),
    [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]),
    [project, setProject] = useState(""),
    [projectTeam, setProjectTeam] = useState(""),
    [agents, setAgents] = useState([]),
    [agent, setAgent] = useState(""),
    [compact, setCompact] = useState(false),
    [sort, setSort] = useState("recent");
  const [messages, setMessages] = useState([]),
    [selected, setSelected] = useState(""),
    [thread, setThread] = useState([]),
    [query, setQuery] = useState(""),
    [folder, setFolder] = useState("inbox"),
    [view, setView] = useState({ kind: "channel" }),
    [searchTick, setSearchTick] = useState(0),
    [section, setSection] = useState("chats"),
    [teamQ, setTeamQ] = useState(""),
    [inboxTab, setInboxTab] = useState("all"),
    [renameId, setRenameId] = useState(""),
    [mood, setMood] = useState("online"),
    [away, setAway] = useState(false);
  const effective = mood === "online" ? (away ? "idle" : "online") : mood,
    statusRef = useRef("online");
  statusRef.current = effective;
  const refreshRef = useRef(null);
  const chooseMood = (m) => {
    setMood(m);
    try {
      localStorage.setItem("dispatch-status", m);
    } catch {}
    // Tell the server now rather than at the next check-in.
    api("calls/active?status=" + (m === "online" ? "online" : m))
      .then(() => setTimeout(() => refreshRef.current?.(), 300))
      .catch(() => {});
  };
  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(() => {
    try {
      const m = localStorage.getItem("dispatch-status");
      if (["online", "idle", "dnd", "invisible"].includes(m)) setMood(m);
    } catch {}
    // Idle after five quiet minutes, online again as soon as you move.
    let timer;
    const wake = () => {
      setAway(false);
      clearTimeout(timer);
      timer = setTimeout(() => setAway(true), 300000);
    };
    wake();
    const evs = ["mousemove", "keydown", "pointerdown", "focus"];
    evs.forEach((e) => window.addEventListener(e, wake));
    return () => {
      clearTimeout(timer);
      evs.forEach((e) => window.removeEventListener(e, wake));
    };
  }, []);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [menu, setMenu] = useState(null),
    [toasts, setToasts] = useState([]),
    [liveCalls, setLiveCalls] = useState([]),
    [call, setCall] = useState(null),
    [settingsTab, setSettingsTab] = useState("account"),
    [navW, setNavW, resetNavW] = useSize("nav", 226, 170, 380),
    [listW, setListW, resetListW] = useSize("list", 345, 260, 620),
    [profile, setProfile] = useState(null),
    [activeTeam, setActiveTeam] = useState(""),
    [newName, setNewName] = useState(""),
    [draft, setDraft] = useState({
      to: [],
      subject: "",
      body_md: "",
      attachment_paths: [],
    }),
    [uploads, setUploads] = useState([]),
    [uploading, setUploading] = useState(false);
  const fileInput = useRef(null),
    searchInput = useRef(null);
  const [starred, setStarred] = useState(() => new Set());
  const identity = useRef({});
  const refreshProjects = useCallback(async () => {
    try {
      const [list, me] = await Promise.all([api("projects"), api("me")]);
      setProjects(list);
      setUser(me);
      setAuthenticated(true);
      setProject((current) =>
        list.some((p) => p.id === current) ? current : list[0]?.id || "",
      );
    } catch (e) {
      if (e.status === 401) setAuthenticated(false);
      else setError(e.message);
    }
  }, []);
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const turn = ++latest.current;
    if (!project) {
      setAgents([]);
      setMessages([]);
      api("projects").then((list) => turn === latest.current && setProjects(list)).catch(() => {});
      return;
    }
    try {
      // The web app writes as the signed-in person, not as an agent.
      identity.current[project] ||= await api("me/identity", {
        project_key: project,
      });
      const me = identity.current[project];
      const [people, mail, list, stars] = await Promise.all([
        api("agents?project=" + project),
        api("messages?project=" + project),
        api("projects"),
        api("starred?project=" + project),
      ]);
      // A slower answer for a channel you have already left must not replace the one you are looking at.
      if (turn !== latest.current) return;
      setStarred(new Set(stars.threads));
      setProjects(list);
      setAgents(people);
      setAgent(me.name);
      setMessages(mail);
    } catch (e) {
      if (e.status === 401) setAuthenticated(false);
      else setError(e.message);
    }
  }, [project]);
  useEffect(() => {
    try {
      setCompact(localStorage.getItem("dispatch-compact") === "1");
      setActiveTeam(localStorage.getItem("dispatch-team") || "");
    } catch {}
  }, []);
  // The team you switch to in Settings is the one you work in: its projects show, new projects land in it.
  const changeTeam = (id) => {
    setActiveTeam(id);
    setProjectTeam(id);
    try {
      localStorage.setItem("dispatch-team", id);
    } catch {}
  };
  useEffect(() => {
    if (user?.teams?.length && !user.teams.some((t) => t.id === activeTeam))
      changeTeam(user.teams[0].id);
  }, [user, activeTeam]);
  const teamKnown = user?.teams?.some((t) => t.id === activeTeam),
    teamProjects = projects.filter(
      (p) => !teamKnown || p.team_id === activeTeam,
    );
  useEffect(() => {
    if (teamKnown) setProjectTeam(activeTeam);
    setProject((cur) =>
      teamProjects.some((p) => p.id === cur) ? cur : teamProjects[0]?.id || "",
    );
  }, [activeTeam, projects, user]);
  useEffect(() => {
    setSelected("");
    setThread([]);
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  // Live updates: the server pings this stream whenever something changes.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource("/api/stream");
    let timer;
    // Several events in a burst become one refresh.
    stream.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    };
    return () => {
      clearTimeout(timer);
      stream.close();
    };
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    api("messages/" + selected)
      .then((t) => {
        if (active) setThread(t);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [selected, messages]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchTick((n) => n + 1);
      }
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const current = projects.find((p) => p.id === project),
    role = user?.teams?.find((t) => t.id === current?.team_id)?.role;
  const canWrite =
      !!user?.site_admin || ["owner", "admin", "member"].includes(role),
    canDelete = !!user?.site_admin || ["owner", "admin"].includes(role),
    canManage =
      !!user?.site_admin ||
      user?.teams?.some((t) => ["owner", "admin"].includes(t.role));
  const agentOf = (name) => agents.find((a) => a.name === name);
  async function toggleStar(threadId) {
    const on = !starred.has(threadId);
    setStarred((cur) => {
      const next = new Set(cur);
      on ? next.add(threadId) : next.delete(threadId);
      return next;
    });
    try {
      await api("messages/star", { thread_id: threadId, starred: on });
    } catch (e) {
      setError(e.message);
      refresh();
    }
  }
  const unread = (m) => m.recipients.some((r) => !r.read_at);
  const visible = messages.filter(
    (m) =>
      (folder === "starred"
        ? starred.has(m.thread_id)
        : folder === "files"
          ? m.attachments.length
          : folder !== "unread" || unread(m)) &&
      `${m.subject} ${m.body} ${m.sender_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  // One row per conversation: the newest message stands for its thread.
  const people = new Map();
  for (const m of messages) {
    const set = people.get(m.thread_id) || new Set();
    set.add(m.sender_name);
    m.recipients.forEach((r) => set.add(r.name));
    people.set(m.thread_id, set);
  }
  const seen = new Set(),
    unique =
      folder === "files"
        ? visible
        : visible.filter(
            (m) => !seen.has(m.thread_id) && seen.add(m.thread_id),
          ),
    isGroup = (m) => (people.get(m.thread_id)?.size || 0) > 2,
    // Pinned conversations stay on top, then direct messages, then group chats.
    pinnedFirst = folder === "inbox" || folder === "unread",
    pinned = pinnedFirst ? unique.filter((m) => starred.has(m.thread_id)) : [],
    rest = pinnedFirst
      ? unique.filter((m) => !starred.has(m.thread_id))
      : unique,
    groups = pinnedFirst
      ? [
          ["Pinned", pinned],
          ["Direct messages", rest.filter((m) => !isGroup(m))],
          ["Group chats", rest.filter(isGroup)],
        ]
      : [["", unique]],
    rows = groups.flatMap(([, items]) => items),
    labelAt = new Map();
  let at = 0;
  for (const [label, items] of groups) {
    if (items.length && label) labelAt.set(at, label);
    at += items.length;
  }
  const threadSize = (m) =>
      messages.filter((x) => x.thread_id === m.thread_id).length,
    threadCount = new Set(messages.map((m) => m.thread_id)).size,
    unreadRows = rows.filter(unread).length;
  // Unread count for the taskbar badge, and a notification when something arrives while you are elsewhere.
  const unreadThreads = new Set(messages.filter(unread).map((m) => m.thread_id))
    .size;
  const seenMessages = useRef(null);
  useEffect(() => {
    window.dispatchDesktop?.setBadge(unreadThreads);
    document.title = unreadThreads ? `(${unreadThreads}) Dispatch` : "Dispatch";
  }, [unreadThreads]);
  const toast = (t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((l) => [...l.slice(-3), { ...t, id }]);
    if (!t.sticky) setTimeout(() => closeToast(id), 6500);
    return id;
  };
  const closeToast = (id) => setToasts((l) => l.filter((t) => t.id !== id));
  const who = (n) =>
    agentOf(n)?.program === "human" ? agentOf(n).owner_name || n : n;
  // Tell the person in the way that fits: a corner toast while the app is open, a system
  // notification when it is in the background.
  const alert = (title, body) => {
    if (window.dispatchDesktop) window.dispatchDesktop.notify(title, body);
    else if (window.Notification?.permission === "granted")
      new Notification(title, { body });
  };
  useEffect(() => {
    if (!messages.length) return;
    const ids = new Set(messages.map((m) => m.id)),
      before = seenMessages.project === project ? seenMessages.current : null;
    seenMessages.current = ids;
    seenMessages.project = project;
    if (!before) return;
    const fresh = messages.filter(
      (m) => !before.has(m.id) && m.sender_name !== agent,
    );
    if (!fresh.length) return;
    const m = fresh[0],
      body =
        fresh.length > 1 ? `${fresh.length} new messages` : preview(m.body);
    if (statusRef.current === "dnd") return;
    blip();
    if (!document.hasFocus()) return alert(who(m.sender_name), body);
    // Focused: only tell them about conversations they are not looking at.
    if (m.thread_id === scopeThread) return;
    toast({
      title: who(m.sender_name),
      body: m.subject.replace(/^((re|fwd?):\s*)+/i, "") + ": " + body,
      onClick: () => {
        setFolder("inbox");
        openMessage(m);
      },
    });
  }, [messages]);

  // Calls: look for ones you are not in, show a toast, ring until you answer or dismiss.
  useEffect(() => {
    if (!authenticated || !user) return;
    let live = true;
    const look = () =>
      api("calls/active?status=" + statusRef.current)
        .then((r) => live && setLiveCalls(r.calls))
        .catch(() => {});
    look();
    const t = setInterval(look, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [authenticated, user?.id]);
  const dismissedCalls = useRef(new Set()),
    announced = useRef(new Set()),
    stopRing = useRef(null),
    ringTimer = useRef(null),
    [ringModal, setRingModal] = useState(null);
  useEffect(() => {
    // After a reload the call is rejoined in a moment, so it is not one that is waiting for you.
    let savedThread = "";
    try {
      const s = JSON.parse(sessionStorage.getItem("dispatch-call") || "null");
      if (s && Date.now() - s.at < 600000) savedThread = s.threadId;
    } catch {}
    const mineIn = (c) => c.people.some((p) => p.uid === user?.id) || c.thread_id === savedThread || c.thread_id === callRef.current?.threadId,
      incoming = liveCalls.filter(
        (c) =>
          !mineIn(c) &&
          !dismissedCalls.current.has(c.thread_id) &&
          statusRef.current !== "dnd",
      );
    const gone = new Set(liveCalls.map((c) => c.thread_id));
    for (const id of [...announced.current, ...dismissedCalls.current])
      if (!gone.has(id)) {
        announced.current.delete(id);
        dismissedCalls.current.delete(id);
      }
    // A page only rings for a call that has just started or when someone rings you on purpose, and only once
    // per call or ring, even across a reload.
    const rung = (() => {
        try {
          return new Set(JSON.parse(sessionStorage.getItem("dispatch-rung") || "[]"));
        } catch {
          return new Set();
        }
      })(),
      remember = (key) => {
        rung.add(key);
        try {
          sessionStorage.setItem("dispatch-rung", JSON.stringify([...rung].slice(-40)));
        } catch {}
      };
    let ringFor = null;
    for (const c of incoming) {
      const join = () => {
        dismissedCalls.current.add(c.thread_id);
        setRingModal(null);
        setFolder("inbox");
        setCall({ messageId: c.message_id, threadId: c.thread_id, withVideo: false });
        openThread(c.thread_id);
      };
      const names = c.people.map((p) => p.name).join(", "),
        on = c.ringing?.find((r) => r.uid === user?.id),
        key = on ? `${c.thread_id}:ring:${on.at}` : `${c.thread_id}:${c.started_at}`,
        fresh = on || Date.now() - c.started_at < 30000;
      if (fresh && !rung.has(key)) {
        remember(key);
        ringFor = { ...c, names, join, key };
        alert(on ? "Calling you" : "Incoming call", `${names} in ${c.subject}`);
      }
      if (announced.current.has(c.thread_id)) continue;
      announced.current.add(c.thread_id);
      if (fresh) continue;
      toast({
        kind: "call",
        sticky: true,
        title: "Call in progress",
        body: `${names} · ${c.subject}`,
        onClick: join,
        actions: [
          { label: "Join", primary: true, onClick: join },
          {
            label: "Dismiss",
            onClick: () => {
              dismissedCalls.current.add(c.thread_id);
              setLiveCalls((l) => [...l]);
            },
          },
        ],
      });
    }
    if (ringFor) {
      stopRing.current?.();
      stopRing.current = ring();
      setRingModal(ringFor);
      clearTimeout(ringTimer.current);
      ringTimer.current = setTimeout(() => {
        stopRing.current?.();
        stopRing.current = null;
        setRingModal(null);
      }, 30000);
    }
    // Stop ringing as soon as you join, decline or the call ends.
    if (!incoming.length && stopRing.current) {
      stopRing.current();
      stopRing.current = null;
    }
    if (!incoming.length) setRingModal(null);
    setToasts((l) =>
      l.filter(
        (t) =>
          t.kind !== "call" ||
          incoming.some((c) => t.body?.endsWith(c.subject)),
      ),
    );
  }, [liveCalls, user?.id]);
  useEffect(() => () => stopRing.current?.(), []);
  const callRef = useRef(null);
  callRef.current = call;
  // A call survives a reload (including the automatic one after an update): the tab remembers it and joins again.
  const restored = useRef(false);
  useEffect(() => {
    if (!authenticated || !user || restored.current) return;
    restored.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem("dispatch-call") || "null");
      if (saved && Date.now() - saved.at < 600000) {
        setCall({ messageId: saved.messageId, threadId: saved.threadId, withVideo: false });
        toast({ title: "Rejoined the call", body: "The page was reloaded." });
      }
    } catch {}
  }, [authenticated, user?.id]);
  useEffect(() => {
    if (!restored.current) return;
    const save = () => {
      try {
        if (call)
          sessionStorage.setItem(
            "dispatch-call",
            JSON.stringify({ messageId: call.messageId, threadId: call.threadId, at: Date.now() }),
          );
        else sessionStorage.removeItem("dispatch-call");
      } catch {}
    };
    save();
    const t = call ? setInterval(save, 30000) : null;
    return () => t && clearInterval(t);
  }, [call]);
  // New version deployed: reload when nobody is looking, or after a short notice. Never in the middle of a call.
  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD;
    if (!mine) return;
    let told = false;
    const look = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { build } = await r.json();
        if (!build || build === mine || told) return;
        if (document.hidden && !callRef.current) return void reloadForUpdate();
        told = true;
        toast({
          title: "Dispatch was updated",
          body: callRef.current ? "Reload when you leave the call." : "Reloading in a few seconds.",
          sticky: !!callRef.current,
          actions: [{ label: "Reload now", primary: true, onClick: () => window.location.reload() }],
        });
        if (!callRef.current) setTimeout(() => !callRef.current && reloadForUpdate(), 5000);
      } catch {}
    };
    const t = setInterval(look, 20000);
    const stale = (e) => {
      const msg = String(e?.reason?.message || e?.message || "");
      if (/ChunkLoadError|Loading chunk|Unexpected token '<'|is not valid JSON/i.test(msg)) reloadForUpdate();
    };
    window.addEventListener("unhandledrejection", stale);
    window.addEventListener("error", stale);
    return () => {
      clearInterval(t);
      window.removeEventListener("unhandledrejection", stale);
      window.removeEventListener("error", stale);
    };
  }, []);
  // Hidden inside the desktop app itself.
  const [desktop, setDesktop] = useState(true);
  useEffect(() => setDesktop(!!window.dispatchDesktop), []);
  const chrono = [...messages].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    ),
    lastOf = new Map(chrono.map((m) => [m.thread_id, m])),
    everyone = agents.length,
    allThreads = [...lastOf.keys()],
    channelThreads = new Set(
      allThreads.filter(
        (t) => everyone <= 2 || (people.get(t)?.size || 0) >= everyone,
      ),
    ),
    mineUnread = (m) =>
      m.recipients.some((r) => r.name === agent && !r.read_at),
    others = (t) => [...(people.get(t) || [])].filter((n) => n !== agent),
    // Conversations with the same people are one chat, however many threads they started.
    gk = (t) => [...(people.get(t) || [])].sort().join("|"),
    sideThreads = allThreads
      .filter((t) => !channelThreads.has(t))
      .sort(
        (a, b) =>
          Date.parse(lastOf.get(b).created_at) -
          Date.parse(lastOf.get(a).created_at),
      ),
    threadUnread = (t) =>
      messages.some((m) => gk(m.thread_id) === gk(t) && mineUnread(m)),
    entry = (t, group) => {
      const o = others(t),
        first = agentOf(o[0]);
      return {
        key: t,
        label: o.length ? o.map(who).join(", ") : who(agent),
        status: threadUnread(t) ? "unread" : "idle",
        selected:
          view.kind === "thread" &&
          (view.set ? view.set === gk(t) : view.id === t),
        lead: group ? (
          <Users size={16} />
        ) : (
          <AgentAvatar
            name={o[0] || agent}
            photo={photoOf(first)}
            program={first?.program}
            model={first?.model}
            className="avatar nav-av"
          />
        ),
      };
    },
    asEntry = (t, group) => ({
      ...entry(t, group),
      open: () => setView({ kind: "thread", id: t, set: gk(t) }),
    });
  const pinnedEntries = allThreads
      .filter((t) => starred.has(t))
      .map((t) =>
        channelThreads.has(t) || !others(t).length
          ? {
              key: "p" + t,
              label: root(lastOf.get(t).subject),
              lead: <Hash size={16} />,
              selected: false,
              open: () => setView({ kind: "channel" }),
            }
          : { ...asEntry(t, others(t).length >= 2), key: "p" + t },
      ),
    recentEntries = sideThreads
      .filter((t) => !starred.has(t))
      // sideThreads is newest first, so the first thread of each set stands for the chat.
      .filter((t, i, all) => all.findIndex((x) => gk(x) === gk(t)) === i)
      .map((t) => asEntry(t, others(t).length >= 2));
  const readOnly = ["unread", "pinned", "files"].includes(view.kind),
    scopeMsgs =
      view.kind === "channel"
        ? chrono
        : view.kind === "thread"
          ? view.set
            ? chrono.filter((m) => gk(m.thread_id) === view.set)
            : chrono.filter((m) => m.thread_id === view.id)
          : view.kind === "unread"
            ? chrono.filter(mineUnread)
            : view.kind === "pinned"
              ? chrono.filter((m) => starred.has(m.thread_id))
              : chrono.filter((m) => m.attachments.length),
    scopeFirst = readOnly ? null : scopeMsgs[0],
    scopeThread = scopeFirst?.thread_id || null,
    scopeEntry =
      view.kind === "thread" && lastOf.has(view.id)
        ? entry(view.id, others(view.id).length >= 2)
        : null,
    scope = {
      kind:
        view.kind === "channel"
          ? "channel"
          : view.kind === "thread"
            ? "thread"
            : "list",
      key: view.kind + (view.set || view.id || "") + project,
      title:
        view.kind === "channel"
          ? current?.name || "channel"
          : view.kind === "thread"
            ? scopeEntry?.label || "Conversation"
            : { unread: "Unread", pinned: "Pinned", files: "Files" }[view.kind],
      subtitle:
        view.kind === "channel"
          ? `${everyone} ${everyone === 1 ? "member" : "members"}`
          : "",
      lead: scopeEntry?.lead || null,
    };
  // Who is online changes without any message, so look again now and then on the People page.
  useEffect(() => {
    if (section !== "people") return;
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [section, refresh]);
  const marked = useRef(new Set());
  useEffect(() => {
    if (!agent || !canWrite || readOnly) return;
    const todo = scopeMsgs.filter(
      (m) => mineUnread(m) && !marked.current.has(m.id),
    );
    if (!todo.length) return;
    todo.forEach((m) => marked.current.add(m.id));
    Promise.all(
      todo.map((m) => api(`messages/${m.id}/read`, { agent_name: agent })),
    )
      .then(refresh)
      .catch((e) => setError(e.message));
  }, [messages, view]);
  async function post({ text, files, reply, mentions = [] }) {
    const ids = [];
    for (const file of files) {
      if (file.size > 6 * 1024 * 1024)
        throw new Error("Each file must be smaller than 6 MB");
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      ids.push(
        (
          await api("files", {
            project_key: project,
            filename: file.name,
            data_base64: data,
          })
        ).id,
      );
    }
    // A chat with several threads: new messages continue the newest one.
    const newest =
        view.kind === "thread" && view.set
          ? allThreads
              .filter((t) => gk(t) === view.set)
              .sort(
                (a, b) =>
                  Date.parse(lastOf.get(b).created_at) -
                  Date.parse(lastOf.get(a).created_at),
              )[0]
          : view.id,
      tid = reply?.thread_id || (view.kind === "thread" ? newest : null),
      base = tid
        ? others(tid)
        : agents.map((a) => a.name).filter((n) => n !== agent),
      to = [...new Set([...base, ...mentions.filter((n) => n !== agent)])],
      line = text
        .split("\n")[0]
        .replace(/[#>*`_]/g, "")
        .trim()
        .slice(0, 80);
    await api("messages", {
      to: to.length ? to : [agent],
      subject: tid
        ? lastOf.get(tid).subject
        : line || files[0]?.name || "Message",
      body_md: text,
      thread_id: tid || undefined,
      attachment_paths: ids,
      project_key: project,
      sender_name: agent,
    });
    await refresh();
  }
  async function markRead(ids) {
    if (!ids.length) return;
    try {
      await Promise.all(
        ids.map((id) => api(`messages/${id}/read`, { agent_name: agent })),
      );
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  const inboxItems = allThreads
    .map((t) => {
      const got = chrono.filter(
        (m) =>
          m.thread_id === t &&
          m.sender_name !== agent &&
          m.recipients.some((r) => r.name === agent),
      );
      const m = got[got.length - 1];
      if (!m) return null;
      const ids = got.filter(mineUnread).map((x) => x.id),
        mention = got.some(
          (x) =>
            x.body.includes("@" + who(agent)) || x.body.includes("@" + agent),
        );
      return {
        key: t,
        thread: t,
        ids,
        unread: ids.length > 0,
        mention,
        files: got.some((x) => x.attachments.length),
        fromAgent: agentOf(m.sender_name)?.program !== "human",
        channel: channelThreads.has(t),
        replied: chrono.some((x) => x.thread_id === t && x.sender_name === agent),
        pinned: starred.has(t),
        today: new Date(m.created_at).toDateString() === new Date().toDateString(),
        title: mention
          ? `${who(m.sender_name)} mentioned you`
          : `${who(m.sender_name)} in ${root(m.subject)}`,
        body: preview(m.body),
        where: channelThreads.has(t)
          ? current?.name || "Channel"
          : "Direct message",
        date: new Date(m.created_at).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
        }),
        at: Date.parse(m.created_at),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at);
  const deleteThread = async (tid) => {
    try {
      await api("messages/delete", {
        ids: messages.filter((x) => x.thread_id === tid).map((x) => x.id),
      });
      if (view.kind === "thread" && view.id === tid)
        setView({ kind: "channel" });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };
  const myHistory = chrono
    .filter((m) => m.sender_name === agent)
    .map((m) => m.body)
    .slice(-20)
    .reverse();
  const showMenu = (e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const openProfile = (kind, key) => {
    setMenu(null);
    setProfile({ kind, key });
  };
  const messageTo = (name) => {
    setProfile(null);
    // Agents are reached in channel threads with @mentions, not by direct message.
    if (agentOf(name)?.program !== "human") return setView({ kind: "channel" });
    compose();
    setDraft((d) => ({ ...d, to: [name] }));
  };
  // Anywhere without its own menu gets this one, so the browser's menu never shows.
  const fallbackMenu = (e) => {
    const t = e.target,
      field = t.closest?.("input, textarea, [contenteditable='true']"),
      link = t.closest?.("a[href]"),
      picked = String(window.getSelection() || ""),
      clip = (cmd) => () => {
        field?.focus();
        document.execCommand(cmd);
      },
      items = [];
    if (field) {
      const ro = field.readOnly || field.disabled;
      items.push(
        {
          label: "Cut",
          icon: <Scissors size={14} />,
          disabled: ro || !picked,
          onClick: clip("cut"),
        },
        {
          label: "Copy",
          icon: <Copy size={14} />,
          disabled: !picked,
          onClick: clip("copy"),
        },
        {
          label: "Paste",
          icon: <ClipboardPaste size={14} />,
          disabled: ro,
          onClick: async () => {
            field.focus();
            try {
              document.execCommand(
                "insertText",
                false,
                await navigator.clipboard.readText(),
              );
            } catch {}
          },
        },
        "-",
        {
          label: "Select all",
          icon: <TextSelect size={14} />,
          onClick: () => {
            field.focus();
            field.select?.();
          },
        },
      );
    } else {
      if (picked)
        items.push({
          label: "Copy",
          icon: <Copy size={14} />,
          onClick: () => navigator.clipboard.writeText(picked),
        });
      if (link?.href)
        items.push(
          {
            label: "Open link",
            icon: <ExternalLink size={14} />,
            onClick: () => window.open(link.href, "_blank", "noopener"),
          },
          {
            label: "Copy link",
            icon: <Copy size={14} />,
            onClick: () => navigator.clipboard.writeText(link.href),
          },
        );
      if (items.length) items.push("-");
      items.push(
        {
          label: "New message",
          icon: <Plus size={14} />,
          disabled: !canWrite,
          onClick: () => compose(),
        },
        {
          label: "Refresh",
          icon: <RefreshCw size={14} />,
          onClick: () => refresh(),
        },
        {
          label: "Settings",
          icon: <Settings2 size={14} />,
          onClick: () => setModal("settings"),
        },
      );
    }
    showMenu(e, items);
  };
  const rowMenu = (e, m) =>
    showMenu(e, [
      {
        label: "Open",
        icon: <MailOpen size={14} />,
        onClick: () => openMessage(m),
      },
      {
        label: "Reply",
        icon: <Reply size={14} />,
        disabled: !canWrite,
        onClick: () => compose(m),
      },
      {
        label: starred.has(m.thread_id) ? "Unpin" : "Pin to the top",
        icon: <Pin size={14} />,
        onClick: () => toggleStar(m.thread_id),
      },
      {
        label: "View conversation profile",
        icon: <IdCard size={14} />,
        onClick: () => openProfile("thread", m.thread_id),
      },
      {
        label: "View " + m.sender_name + " profile",
        icon: <UserRound size={14} />,
        onClick: () =>
          openProfile(
            agentOf(m.sender_name)?.program === "human" ? "person" : "agent",
            m.sender_name,
          ),
      },
      {
        label: "Copy subject",
        icon: <Copy size={14} />,
        onClick: () => navigator.clipboard.writeText(m.subject),
      },
      ...(canDelete
        ? [
            "-",
            {
              label: "Delete conversation",
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: async () => {
                try {
                  await api("messages/delete", {
                    ids: messages
                      .filter((x) => x.thread_id === m.thread_id)
                      .map((x) => x.id),
                  });
                  if (false) {
                    setSelected("");
                    setThread([]);
                  }
                  refresh();
                } catch (err) {
                  setError(err.message);
                }
              },
            },
          ]
        : []),
    ]);
  const chosen = thread.find((m) => m.id === selected) || thread[0];
  function openThread(tid) {
    setMenu(null);
    setSection("chats");
    setView(
      channelThreads.has(tid)
        ? { kind: "channel" }
        : { kind: "thread", id: tid, set: gk(tid) },
    );
  }
  const openMessage = (m) => openThread(m.thread_id);
  async function quickReply(reply, body_md) {
    const others = [
      ...new Set([reply.sender_name, ...reply.recipients.map((r) => r.name)]),
    ].filter((n) => n !== agent);
    await api("messages", {
      to: others.length ? others : [agent],
      subject: reply.subject,
      body_md,
      thread_id: reply.thread_id,
      project_key: project,
      sender_name: agent,
    });
    setThread(await api("messages/" + selected));
    await refresh();
  }
  function compose(reply, body = "") {
    const to = reply
      ? [
          ...new Set([
            reply.sender_name,
            ...reply.recipients.map((r) => r.name),
          ]),
        ].filter((n) => n !== agent)
      : [];
    setDraft({
      to: reply && !to.length ? [agent] : to,
      subject: reply?.subject || "",
      body_md: body,
      attachment_paths: [],
      ...(reply ? { thread_id: reply.thread_id } : {}),
    });
    setUploads([]);
    setModal("compose");
    setError("");
  }
  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const m = await api("messages", {
        ...draft,
        project_key: project,
        sender_name: agent,
      });
      setModal(null);
      const set = new Set([agent, ...draft.to]);
      setView(
        !draft.thread_id && agents.length > 2 && set.size >= agents.length
          ? { kind: "channel" }
          : { kind: "thread", id: m.thread_id },
      );
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function addFiles(e) {
    setUploading(true);
    try {
      for (const file of [...e.target.files]) {
        if (file.size > 6 * 1024 * 1024)
          throw new Error("Each file must be smaller than 6 MB");
        const encoded = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const f = await api("files", {
          project_key: project,
          filename: file.name,
          data_base64: encoded,
        });
        setUploads((old) => [...old, f]);
        setDraft((old) => ({
          ...old,
          attachment_paths: [...old.attachment_paths, f.id],
        }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (modal === "rename") {
        await api("projects/rename", { id: renameId, name: newName });
        await refreshProjects();
      } else if (modal === "project") {
        const p = await api("projects", {
          name: newName,
          team_id:
            projectTeam ||
            user?.teams?.find((t) => ["owner", "admin"].includes(t.role))?.id,
        });
        await refreshProjects();
        setProject(p.id);
      } else {
        const a = await api("agents", {
          project_key: project,
          name: newName,
          program: "browser",
          model: "operator",
        });
        setAgent(a.name);
        await refresh();
      }
      setNewName("");
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (authenticated === null)
    return (
      <main className="boot">
        <Loader2 className="spin" size={20} />
        Opening Dispatch
      </main>
    );
  if (!authenticated) return <Login onAuthed={refreshProjects} />;
  const teamName =
    user?.teams?.find((t) => t.id === activeTeam)?.name || "Dispatch";
  const openServers = () => {
    setSettingsTab("team");
    setModal("settings");
  };
  return (
    <div className="workspace fluid-shell" onContextMenu={fallbackMenu}>
      <div className="left-col">
        <div className="left-row">
      <NavRail
        logo={<DispatchMark size={20} />}
        unread={messages.filter(mineUnread).length}
        view={view.kind}
        section={section}
        onInbox={() => setSection("inbox")}
        onChats={() => {
          setSection("chats");
          setView({ kind: "channel" });
        }}
        onPeople={() => setSection("people")}
        onPlugins={() => setSection("plugins")}
        onProfile={() => openProfile("person", agent)}
        avatar={
          <AgentAvatar
            name={agent || "You"}
            photo={photoOf(agentOf(agent))}
            program="human"
            className="avatar"
          />
        }
      />
      {section === "inbox" ? (
        <InboxList items={inboxItems} tab={inboxTab} onTab={setInboxTab} />
      ) : section === "plugins" ? (
        <PluginsList />
      ) : section === "people" ? (
        <TeamList
          agents={agents}
          me={agent}
          shown={who}
          q={teamQ}
          onQ={setTeamQ}
          onOpen={(a) =>
            openProfile(a.program === "human" ? "person" : "agent", a.name)
          }
        />
      ) : (
      <Spaces
        title={teamName}
        teams={user?.teams || []}
        activeTeam={activeTeam}
        onTeam={changeTeam}
        onNewTeam={openServers}
        pinned={pinnedEntries}
        channels={teamProjects.map((p) => ({
          key: p.id,
          label: p.name,
          lead: <Hash size={16} />,
          selected: p.id === project && view.kind === "channel",
          onContextMenu: (e) =>
            showMenu(e, [
              ...(canManage
                ? [
                    {
                      label: "Rename channel",
                      icon: <Pencil size={14} />,
                      onClick: () => {
                        setNewName(p.name);
                        setRenameId(p.id);
                        setModal("rename");
                      },
                    },
                  ]
                : []),
              {
                label: "Copy name",
                icon: <Copy size={14} />,
                onClick: () => navigator.clipboard.writeText(p.name),
              },
            ]),
          open: () => {
            setProject(p.id);
            setView({ kind: "channel" });
          },
        }))}
        recent={recentEntries}
        onOpen={(e) => e.open()}
        onNewChannel={() => {
          setNewName("");
          setModal("project");
        }}
        onNewMessage={() => compose()}
        canCreate={canManage}
        canWrite={!!agent && canWrite}
        onSettings={() => setModal("settings")}
      />
      )}
        </div>
        <QuickLinks
          desktop={desktop}
          onConnect={() => setModal("connect")}
          onDesktop={() => setModal("desktop")}
        />
        <div className="me-dock">
        <div id="call-mini" className="call-dock-slot" />
        <MeCard
          lead={
            <span className={"face" + (effective === "invisible" ? "" : " s-" + effective)}>
              <AgentAvatar
                name={agent || "You"}
                photo={photoOf(agentOf(agent))}
                program="human"
                className="avatar"
              />
            </span>
          }
          me={{
            name: who(agent) || "You",
            sub: { online: "Online", idle: "Idle", dnd: "Do not disturb", invisible: "Invisible" }[effective],
            avatar: (
              <AgentAvatar
                name={agent || "You"}
                photo={photoOf(agentOf(agent))}
                program="human"
                className="avatar"
              />
            ),
          }}
          onMe={(e) =>
            showMenu(e, [
              ...[
                ["online", "Online"],
                ["idle", "Idle"],
                ["dnd", "Do not disturb"],
                ["invisible", "Invisible"],
              ].map(([k, label]) => ({
                label: label + (mood === k ? "   ✓" : ""),
                icon: <i className={"st-dot s-" + k} />,
                onClick: () => chooseMood(k),
              })),
              "-",
              {
                label: "View profile",
                icon: <UserRound size={14} />,
                onClick: () => openProfile("person", agent),
              },
            ])
          }
          onSettings={() => setModal("settings")}
          onTheme={() => {
          const root = document.documentElement,
            light = root.dataset.theme === "light";
          root.dataset.theme = light ? "dark" : "light";
          root.classList.toggle("dark", light);
          try {
            localStorage.setItem("dispatch-theme", light ? "dark" : "light");
          } catch {}
        }}
        />
        </div>
      </div>
      <div className="main-card">
        <div className="main-inner">
          {error && !modal && (
            <div className="error inline-error" role="alert">
              {error}
              <button onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          {section === "inbox" ? (
            <InboxPage
              teamName={teamName}
              items={inboxItems}
              tab={inboxTab}
              onTab={setInboxTab}
              onOpen={(i) => {
                markRead(i.ids);
                openThread(i.thread);
              }}
              onRead={(i) => markRead(i.ids)}
              onReadAll={(list) => markRead(list.flatMap((i) => i.ids))}
              onMenu={(e, i) =>
                showMenu(e, [
                  {
                    label: "Open",
                    icon: <MailOpen size={14} />,
                    onClick: () => {
                      markRead(i.ids);
                      openThread(i.thread);
                    },
                  },
                  {
                    label: "Mark as read",
                    icon: <Check size={14} />,
                    disabled: !i.unread,
                    onClick: () => markRead(i.ids),
                  },
                  {
                    label: starred.has(i.thread) ? "Unpin" : "Pin conversation",
                    icon: <Pin size={14} />,
                    onClick: () => toggleStar(i.thread),
                  },
                ])
              }
            />
          ) : section === "plugins" ? (
            <PluginsPage teamName={teamName} />
          ) : section === "people" ? (
            <TeamPage
              agents={agents}
              me={agent}
              shown={who}
              q={teamQ}
              teamName={teamName}
              canWrite={canWrite}
              canManage={canManage}
              files={chrono.flatMap((m) =>
                m.attachments.map((f) => ({
                  ...f,
                  from: m.sender_name,
                  at: m.created_at,
                })),
              )}
              onConnect={() => setModal("connect")}
              onInvite={() => {
                setSettingsTab("members");
                setModal("settings");
              }}
              onProfile={openProfile}
              onMessage={(n) => {
                setSection("chats");
                compose();
                setDraft((d) => ({ ...d, to: [n] }));
              }}
            />
          ) : !project ? (
            <div className="reader-empty">
              <div className="empty-orbit">
                <DispatchMark size={30} />
              </div>
              <h2>Your server is empty.</h2>
              <p>Create a channel to get your agents talking.</p>
              {canManage && (
                <button
                  className="subtle-button"
                  onClick={() => setModal("project")}
                >
                  Create channel
                </button>
              )}
            </div>
          ) : (
            <Feed
              scope={scope}
              messages={scopeMsgs}
              me={agent}
              agents={agents}
              agentOf={agentOf}
              shown={who}
              canWrite={canWrite && !readOnly && !!agent}
              canDelete={canDelete}
              pinnedThreads={starred}
              onPin={toggleStar}
              onSend={post}
              onProfile={openProfile}
              onMenu={showMenu}
              onDeleteThread={deleteThread}
              callActive={!!scopeThread && call?.threadId === scopeThread}
              onStartCall={(withVideo) =>
                setCall({
                  messageId: scopeFirst.id,
                  threadId: scopeThread,
                  withVideo,
                })
              }
              onLeaveCall={() => setCall(null)}
              onRing={(t) => api("calls/ring", { ...t, project_key: project, sender_name: agent }).catch(() => {})}
              api={api}
              firstMessageId={scopeFirst?.id}
              disabledReason={
                readOnly ? "Open a conversation to reply." : undefined
              }
              history={myHistory}
              searchTick={searchTick}
            />
          )}
        </div>
      </div>
      {profile && (
        <Profile
          target={profile}
          messages={messages}
          agents={agents}
          agentOf={agentOf}
          shown={(n) =>
            agentOf(n)?.program === "human" ? agentOf(n).owner_name || n : n
          }
          onClose={() => setProfile(null)}
          onOpen={(m) => {
            setProfile(null);
            openThread(m.thread_id);
          }}
          onMessage={messageTo}
          onProfile={openProfile}
        />
      )}
      {call && (
        <Call
          key={call.threadId}
          api={api}
          messageId={call.messageId}
          withVideo={call.withVideo}
          myId={user?.id}
          here={scopeThread === call.threadId}
          onReturn={() => {
            openThread(call.threadId);
          }}
          onLeave={() => setCall(null)}
          agentOf={agentOf}
          onMenu={showMenu}
          onProfile={openProfile}
        />
      )}
      <RingModal
        call={ringModal}
        onJoin={() => (stopRing.current?.(), (stopRing.current = null), ringModal?.join())}
        onDecline={() => {
          dismissedCalls.current.add(ringModal.thread_id);
          stopRing.current?.();
          stopRing.current = null;
          setRingModal(null);
          setLiveCalls((l) => [...l]);
        }}
      />
      <Toasts list={toasts} onClose={closeToast} />
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {modal === "settings" && (
        <Settings
          onClose={() => setModal(null)}
          onChanged={refreshProjects}
          startTab={settingsTab}
          team={activeTeam}
          onTeam={changeTeam}
          project={project}
          agents={agents}
        />
      )}
      {modal && modal !== "settings" && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy && !uploading)
              setModal(null);
          }}
        >
          <section
            className={"modal " + (modal === "compose" ? "compose-modal" : "")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <header>
              <div>
                <h2 id="dialog-title">
                  {modal === "compose"
                    ? draft.thread_id
                      ? "Reply to conversation"
                      : "Message a person"
                    : modal === "rename"
                      ? "Rename channel"
                      : modal === "project"
                      ? "Create a channel"
                      : modal === "agent"
                        ? "Register an agent"
                        : modal === "desktop"
                          ? "Get the desktop app"
                          : "Connect your agents"}
                </h2>
              </div>
              <button
                className="icon-button"
                title="Close"
                onClick={() => setModal(null)}
              >
                <X size={17} />
              </button>
            </header>
            {modal === "compose" ? (
              <form
                className="dm-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setDraft((d) => d);
                  send({
                    preventDefault() {},
                  });
                }}
              >
                <div className="dm-to">
                  <span>To</span>
                  <div className="dm-people">
                    {agents
                      .filter((a) => a.program === "human" && a.name !== agent)
                      .map((a) => {
                        const on = draft.to.includes(a.name);
                        return (
                          <button
                            type="button"
                            key={a.id}
                            className={on ? "chosen" : ""}
                            aria-pressed={on}
                            onClick={() =>
                              setDraft((old) => ({
                                ...old,
                                to: old.to.includes(a.name)
                                  ? old.to.filter((n) => n !== a.name)
                                  : [...old.to, a.name],
                              }))
                            }
                          >
                            <AgentAvatar
                              name={a.name}
                              photo={photoOf(a)}
                              program="human"
                              className="avatar"
                            />
                            {who(a.name)}
                            {on && <Check size={13} />}
                          </button>
                        );
                      })}
                    {!agents.some(
                      (a) => a.program === "human" && a.name !== agent,
                    ) && (
                      <p className="muted small">
                        Nobody else is in this channel yet. To work with an
                        agent, @mention it in the channel.
                      </p>
                    )}
                  </div>
                </div>
                <textarea
                  className="dm-body"
                  autoFocus
                  rows={4}
                  placeholder="Write a message…"
                  value={draft.body_md}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      body_md: e.target.value,
                      subject:
                        e.target.value
                          .split("\n")[0]
                          .replace(/[#>*`_]/g, "")
                          .trim()
                          .slice(0, 80) || "Message",
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form.requestSubmit();
                    }
                  }}
                />
                <div className="compose-actions">
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    multiple
                    onChange={addFiles}
                  />
                  <button
                    type="button"
                    className="subtle-button"
                    disabled={uploading || draft.attachment_paths.length >= 10}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Paperclip size={14} />
                    )}
                    {uploads.length ? `${uploads.length} attached` : "Attach"}
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      uploading ||
                      !draft.to.length ||
                      !draft.body_md.trim()
                    }
                  >
                    <Send size={14} />
                    Send
                  </button>
                </div>
              </form>
            ) : modal === "desktop" ? (
              <DesktopApp api={api} />
            ) : modal === "connect" ? (
              <Connect
                api={api}
                project={project}
                projectName={current?.name}
                onChanged={refresh}
              />
            ) : (
              <form onSubmit={create}>
                <label htmlFor="new-name">
                  {modal === "project" || modal === "rename" ? "Channel name" : "Agent name"}
                </label>
                <input
                  id="new-name"
                  autoFocus
                  required={modal === "project" || modal === "rename"}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={
                    modal === "project" || modal === "rename"
                      ? "e.g. Website"
                      : "Leave blank for a random name"
                  }
                />
                {modal === "project" && (
                  <>
                    <label htmlFor="project-team">Server</label>
                    <Select
                      id="project-team"
                      value={
                        projectTeam ||
                        user?.teams?.find((t) =>
                          ["owner", "admin"].includes(t.role),
                        )?.id ||
                        ""
                      }
                      onChange={(e) => setProjectTeam(e.target.value)}
                    >
                      {user?.teams
                        ?.filter((t) => ["owner", "admin"].includes(t.role))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </Select>
                  </>
                )}
                <p className="muted">
                  {modal === "project" || modal === "rename"
                    ? "Keep related conversations, agents and files together."
                    : "Leave it blank for a random name like CopperGrove, or use letters, numbers, underscores or hyphens."}
                </p>
                <button className="primary" disabled={busy}>
                  <Plus size={14} />
                  {modal === "rename" ? "Save name" : modal === "project" ? "Create channel" : "Register agent"}
                </button>
              </form>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
