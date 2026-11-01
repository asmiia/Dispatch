"use client";
import { useState, useEffect } from "react";
import Select from "./select";
export default function Coordination({ project, agents }) {
  const [view, setView] = useState("activity"),
    [agent, setAgent] = useState(agents[0]?.name || ""),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [value, setValue] = useState(""),
    [target, setTarget] = useState(""),
    [policy, setPolicy] = useState("open");
  const data = result?.view === view ? result.value : null;
  const setData = (value) => setResult({ view, value });
  async function call(tool, args = {}) {
    const r = await fetch("/api/coordination", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool,
        args: {
          project_key: project,
          ...(agent && tool !== "list_file_reservations"
            ? { agent_name: agent }
            : {}),
          ...args,
        },
      }),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function load() {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      let d;
      if (view === "activity") d = await call("list_activity");
      else if (view === "agents")
        d = await Promise.all(
          agents.map((a) => call("whois", { agent_name: a.name })),
        );
      else if (view === "leases")
        d = {
          builds: await call("list_build_slots"),
          files: await call("list_file_reservations"),
        };
      else if (view === "contacts") {
        d = await call("list_contacts");
        setPolicy((await call("whois", { agent_name: agent })).policy);
      } else if (view === "projects")
        d = { groups: await call("list_products") };
      else d = null;
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    load();
  }, [view, project, agent]);
  async function mutate(tool, args) {
    setBusy(true);
    setError("");
    try {
      await call(tool, args);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="coordination">
      <h3>Coordination</h3>
      <p className="muted">
        Agent identities, delivery confirmations, and shared work leases.
      </p>
      <div className="coord-tabs">
        {[
          "activity",
          "agents",
          "leases",
          "contacts",
          "threads",
          "projects",
        ].map((v) => (
          <button
            key={v}
            className={view === v ? "active" : ""}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <label>
        Acting agent
        <Select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Select an agent</option>
          {agents.map((a) => (
            <option key={a.id} value={a.name}>
              {a.name}
            </option>
          ))}
        </Select>
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && <p className="muted">Working…</p>}
      {view === "activity" && Array.isArray(data) && (
        <div>
          {data.map((a, i) => (
            <div className="settings-row" key={i}>
              <div>
                <strong>{a.action}</strong>
                <span>{new Date(a.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
          {!data.length && <p className="muted">No project activity yet.</p>}
        </div>
      )}
      {view === "agents" &&
        Array.isArray(data) &&
        data.map((a) => (
          <div className="settings-row" key={a.id}>
            <div>
              <strong>
                {a.name}
                {a.retired ? " · Retired" : ""}
              </strong>
              <span>
                {a.program} · {a.model} · {a.purpose || "No purpose set"}
                <br />
                Last active: {new Date(a.last_active).toLocaleString()}
              </span>
            </div>
            <button
              disabled={busy}
              className="subtle-button"
              onClick={() =>
                mutate(a.retired ? "unretire_agent" : "retire_agent", {
                  agent_name: a.name,
                })
              }
            >
              {a.retired ? "Reactivate" : "Retire"}
            </button>
          </div>
        ))}
      {view === "agents" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutate("update_agent_profile", { purpose: value });
          }}
        >
          <label>
            Agent purpose
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              maxLength={1000}
            />
          </label>
          <button className="subtle-button" disabled={busy || !agent}>
            Save purpose
          </button>
        </form>
      )}
      {view === "leases" && data && (
        <>
          <h4>Build leases</h4>
          {data.builds.map((b) => (
            <div className="settings-row" key={b.id}>
              <div>
                <strong>{b.name}</strong>
                <span>
                  {b.agent_name} · expires{" "}
                  {new Date(b.expires_at).toLocaleTimeString()}
                </span>
              </div>
              {b.agent_name === agent && (
                <button
                  className="subtle-button"
                  onClick={() =>
                    mutate("release_build_slot", { slot_id: b.id })
                  }
                >
                  Release
                </button>
              )}
            </div>
          ))}
          {!data.builds.length && <p className="muted">No active builds.</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutate("acquire_build_slot", { name: value });
            }}
          >
            <label>
              Build name
              <input
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={120}
              />
            </label>
            <button className="subtle-button" disabled={busy || !agent}>
              Acquire lease
            </button>
          </form>
          <h4>File reservations</h4>
          {data.files.map((f) => (
            <div className="settings-row" key={f.id}>
              <div>
                <strong>{f.path}</strong>
                <span>{f.agent_name}</span>
              </div>
              {f.agent_name === agent && (
                <button
                  className="subtle-button"
                  onClick={() =>
                    mutate("release_file_reservations", {
                      reservation_ids: [f.id],
                    })
                  }
                >
                  Release
                </button>
              )}
            </div>
          ))}
          {!data.files.length && <p className="muted">No reserved paths.</p>}
        </>
      )}
      {view === "contacts" && (
        <>
          <label>
            Inbound policy
            <Select
              value={policy}
              onChange={(e) =>
                mutate("set_contact_policy", { policy: e.target.value })
              }
            >
              <option value="open">Open</option>
              <option value="approval">Approval required</option>
              <option value="closed">Closed</option>
            </Select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutate("request_contact", { to_agent: target });
            }}
          >
            <label>
              Request contact
              <Select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Select recipient</option>
                {agents
                  .filter((a) => a.name !== agent)
                  .map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </label>
            <button
              className="subtle-button"
              disabled={busy || !agent || !target}
            >
              Request
            </button>
          </form>
          {Array.isArray(data) &&
            data.map((c) => (
              <div className="settings-row" key={c.sender_id + c.recipient_id}>
                <div>
                  <strong>
                    {c.sender} → {c.recipient}
                  </strong>
                  <span>{c.status}</span>
                </div>
                {c.recipient === agent && c.status === "pending" && (
                  <>
                    <button
                      className="subtle-button"
                      onClick={() =>
                        mutate("respond_contact", {
                          from_agent: c.sender,
                          accept: true,
                        })
                      }
                    >
                      Accept
                    </button>
                    <button
                      className="subtle-button"
                      onClick={() =>
                        mutate("respond_contact", {
                          from_agent: c.sender,
                          accept: false,
                        })
                      }
                    >
                      Decline
                    </button>
                  </>
                )}
              </div>
            ))}
        </>
      )}
      {view === "threads" && (
        <>
          <p className="muted">
            Digests quote message excerpts and link their sources. No model
            connection is needed.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                setData(await call("summarize_thread", { message_id: value }));
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <label>
              Message ID
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </label>
            <button className="subtle-button">Read thread digest</button>
            <button
              type="button"
              className="subtle-button"
              onClick={async () => {
                setError("");
                try {
                  setData({
                    receipts: await call("get_message_delivery_receipt", {
                      message_id: value,
                    }),
                  });
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Delivery receipts
            </button>
            <button
              type="button"
              className="subtle-button"
              disabled={!agent}
              onClick={async () => {
                setError("");
                try {
                  await call("acknowledge_message", { message_id: value });
                  setData({
                    receipts: await call("get_message_delivery_receipt", {
                      message_id: value,
                    }),
                  });
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Acknowledge
            </button>
          </form>
          {data?.receipts?.map((r) => (
            <div className="settings-row" key={r.name}>
              <div>
                <strong>{r.name}</strong>
                <span>
                  {r.acknowledged_at
                    ? "Acknowledged"
                    : r.read_at
                      ? "Read"
                      : "Delivered"}
                  {r.acknowledged_at
                    ? " · " + new Date(r.acknowledged_at).toLocaleString()
                    : ""}
                </span>
              </div>
            </div>
          ))}
          {data?.messages?.map((m) => (
            <div className="settings-row" key={m.id}>
              <div>
                <strong>{m.sender}</strong>
                <p>{m.excerpt}</p>
                <span>Source: {m.id}</span>
              </div>
            </div>
          ))}
        </>
      )}
      {view === "projects" && (
        <>
          <p className="muted">
            Group team projects for coordination. Agent credentials retain their
            single-project scope.
          </p>
          {data?.groups?.map((g) => (
            <div className="settings-row" key={g.id}>
              <div>
                <strong>{g.name}</strong>
                <span>Group ID: {g.id}</span>
              </div>
            </div>
          ))}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                const group = await call("ensure_product", { name: value });
                await call("products_link", { product_id: group.id });
                await load();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <label>
              Project group name
              <input
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <button className="subtle-button">Create and link group</button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutate("products_link", { product_id: target });
            }}
          >
            <label>
              Link an existing group ID
              <input
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <button className="subtle-button">Link project</button>
          </form>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                setData({
                  ...data,
                  results: await call("search_messages_product", {
                    query: value,
                  }),
                });
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <label>
              Search team projects
              <input
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <button className="subtle-button">Search</button>
          </form>
          {data?.results?.projects?.map((p) => (
            <div key={p.project}>
              <h4>{p.project}</h4>
              {p.messages.map((m) => (
                <div className="settings-row" key={m.id}>
                  <div>
                    <strong>{m.subject}</strong>
                    <p>{m.body.slice(0, 300)}</p>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      <button className="subtle-button" disabled={busy} onClick={load}>
        Refresh activity
      </button>
    </div>
  );
}
