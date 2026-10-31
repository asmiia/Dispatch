"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Github, Loader2 } from "lucide-react";
import { ThemeButton } from "./theme-toggle";

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
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed");
  return value;
}

// auth_error comes from the URL, so only these fixed messages are ever displayed.
const knownErrors = [
  "Sign-in expired. Try again.",
  "No account or invitation exists for this email",
  "This account is disabled",
  "This account has two-factor authentication. Sign in with your password first.",
  "GitHub has no verified primary email",
  "Google has no verified email for this account",
  "GitHub sign-in failed",
  "Google sign-in failed",
  "The provider rejected the request",
];
const copy = {
  signin: ["Log in to Dispatch", "Sign in to your team, or use an invitation to join."],
  register: ["Create your account", "Use the invitation code you were sent."],
  setup: ["Set up Dispatch", "Create the administrator account for this instance."],
  mfa: ["Two-factor authentication", "Enter the 6-digit code from your authenticator app, or a recovery code."],
  forgot: ["Reset your password", "We'll email you a link to choose a new one."],
  reset: ["Choose a new password", "Use at least 12 characters."],
};

function DispatchMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 11 21 3l-8 18-2-8-8-2Z" fill="currentColor" />
      <path className="mark-cut" d="m11 13 10-10" stroke="#f2f2f2" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function Login({ onAuthed }) {
  const [status, setStatus] = useState(null),
    [mode, setMode] = useState("signin"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [setupKey, setSetupKey] = useState(""),
    [inviteCode, setInviteCode] = useState(""),
    [resetCode, setResetCode] = useState(""),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite"),
      reset = params.get("reset"),
      failed = params.get("auth_error");
    // Codes in the URL are moved into state and removed from the address bar.
    if (invite || reset || failed)
      window.history.replaceState(null, "", window.location.pathname);
    if (failed)
      setError(knownErrors.includes(failed) ? failed : "Sign-in failed. Try again.");
    if (params.get("email")) setEmail(params.get("email").slice(0, 254));
    api("auth/status")
      .then((s) => {
        setStatus(s);
        if (reset) {
          setResetCode(reset);
          setMode("reset");
        } else if (s.needs_setup) setMode("setup");
        else if (invite) {
          setInviteCode(invite);
          setMode("register");
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  const go = (next) => {
    setMode(next);
    setError("");
    setNotice("");
  };
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "forgot") {
        const r = await api("auth/forgot", { email });
        setNotice(
          r.email_enabled
            ? "If an account exists for that email, a reset link is on its way."
            : "Email isn't set up on this server. Ask an administrator for a reset link.",
        );
      } else if (mode === "reset") {
        await api("auth/reset", { code: resetCode, password });
        setPassword("");
        setResetCode("");
        go("signin");
        setNotice("Password changed. Sign in with your new password.");
      } else if (mode === "mfa") {
        await api("auth/mfa", { challenge, code });
        await onAuthed();
      } else {
        const result = await api(
          mode === "signin" ? "auth" : "auth/register",
          mode === "signin"
            ? { email, password }
            : { email, password, name, setup_key: setupKey, invite_code: inviteCode },
        );
        if (result.mfa_required) {
          setChallenge(result.challenge);
          setPassword("");
          setCode("");
          go("mfa");
        } else {
          setPassword("");
          setSetupKey("");
          await onAuthed();
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const [title, subtitle] = copy[mode];
  const signup = mode === "register" || mode === "setup";
  const providers = status?.oauth || [];
  const label = {
    signin: "Open Dispatch",
    register: "Create account",
    setup: "Create account",
    mfa: "Verify",
    forgot: "Send reset link",
    reset: "Change password",
  }[mode];

  return (
    <main className="login">
      <div className="theme-corner">
        <ThemeButton />
      </div>
      <div className="login-card">
        <span className="brandmark login-mark">
          <DispatchMark size={22} />
        </span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <form onSubmit={submit}>
          {signup && (
            <>
              <label htmlFor="full-name">Your name</label>
              <input
                id="full-name"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </>
          )}
          {(mode === "signin" || signup || mode === "forgot") && (
            <>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </>
          )}
          {(mode === "signin" || signup || mode === "reset") && (
            <>
              <div className="login-row">
                <label htmlFor="password">
                  {mode === "reset" ? "New password" : "Password"}
                </label>
                {mode === "signin" && (
                  <button type="button" className="login-link" onClick={() => go("forgot")}>
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="password"
                type="password"
                required
                minLength={signup || mode === "reset" ? 12 : undefined}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}
          {mode === "setup" && (
            <>
              <label htmlFor="token">Setup key</label>
              <input
                id="token"
                type="password"
                required
                value={setupKey}
                onChange={(e) => setSetupKey(e.target.value)}
                placeholder="DISPATCH_SETUP_KEY from .env.local"
              />
              <p className="muted">The first account becomes the instance administrator.</p>
            </>
          )}
          {mode === "register" && (
            <>
              <label htmlFor="invitation">Invitation code</label>
              <input
                id="invitation"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            </>
          )}
          {mode === "mfa" && (
            <>
              <label htmlFor="otp">Authentication code</label>
              <input
                id="otp"
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy && <Loader2 size={14} className="spin" />}
            {label}
            <ArrowUpRight size={15} />
          </button>
        </form>
        {mode === "signin" && providers.length > 0 && (
          <>
            <div className="login-divider">or</div>
            <div className="login-providers">
              {providers.includes("github") && (
                <a className="login-mode" href="/api/auth/oauth/github/start">
                  <Github size={16} /> Continue with GitHub
                </a>
              )}
              {providers.includes("google") && (
                <a className="login-mode" href="/api/auth/oauth/google/start">
                  <span className="g-mark" aria-hidden="true">G</span> Continue with Google
                </a>
              )}
            </div>
          </>
        )}
        {mode === "signin" && !status?.needs_setup && (
          <button className="login-mode" onClick={() => go("register")}>
            Have an invitation? Create an account
          </button>
        )}
        {(signup && !status?.needs_setup) || ["mfa", "forgot", "reset"].includes(mode) ? (
          <button className="login-mode" onClick={() => go("signin")}>
            Back to sign in
          </button>
        ) : null}
        {notice && (
          <div className="login-notice" role="status">
            {notice}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
