// Demo data shared by the screenshot and demo-GIF scripts: three people with profile photos, three agents
// owned by them, and a short rich conversation. Photos are drawn here, so there are no blank avatars.
import pngjs from "pngjs";
const { PNG } = pngjs;

// A deterministic square avatar: a soft gradient with a few overlapping shapes.
export function avatarPng(seed, size = 256) {
  let n = 0;
  for (const c of seed) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => (n = (n * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const hue = Math.floor(rnd() * 360);
  const hsl = (h, s, l) => {
    s /= 100;
    l /= 100;
    const k = (x) => (x + h / 30) % 12,
      a = s * Math.min(l, 1 - l),
      f = (x) => l - a * Math.max(-1, Math.min(k(x) - 3, 9 - k(x), 1));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  };
  const a = hsl(hue, 70, 58),
    b = hsl((hue + 50) % 360, 75, 38),
    shapes = Array.from({ length: 3 }, () => ({
      x: rnd() * size,
      y: rnd() * size,
      r: size * (0.18 + rnd() * 0.22),
      c: hsl((hue + 120 + rnd() * 120) % 360, 70, 70),
    }));
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      let px = a.map((v, i) => v + (b[i] - v) * t);
      for (const s of shapes) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < s.r) {
          const w = 0.55 * (1 - d / s.r) ** 0.6;
          px = px.map((v, i) => v + (s.c[i] - v) * w);
        }
      }
      const i = (y * size + x) * 4;
      png.data[i] = px[0];
      png.data[i + 1] = px[1];
      png.data[i + 2] = px[2];
      png.data[i + 3] = 255;
    }
  return PNG.sync.write(png);
}

// A small bar chart image to attach to a message.
export function chartPng(w = 640, h = 320) {
  const png = new PNG({ width: w, height: h }),
    bars = [0.35, 0.5, 0.42, 0.66, 0.58, 0.8, 0.92];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c = [18, 20, 26];
      const col = Math.floor((x - 40) / 80);
      if (x >= 40 && col >= 0 && col < bars.length && (x - 40) % 80 < 56) {
        const top = h - 30 - bars[col] * (h - 70);
        if (y >= top && y < h - 30) {
          const t = (y - top) / (h - 30 - top);
          c = [90 + 60 * t, 140 + 40 * t, 255 - 40 * t];
        }
      }
      if (y === h - 30) c = [70, 74, 86];
      [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] = [
        ...c,
        255,
      ];
    }
  return PNG.sync.write(png);
}

export async function seed({ origin, setupKey, password }) {
  const call = async (path, body, cookie) => {
    const r = await fetch(origin + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(path + ": " + JSON.stringify(json));
    return { r, json };
  };
  const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
  const photo = (cookie, seedName) =>
    call(
      "settings/avatar",
      { data_base64: avatarPng(seedName).toString("base64") },
      cookie,
    );

  // People. The first account is the administrator; the others join by invitation.
  const owner = await call("auth/register", {
    email: "maya@example.com",
    name: "Maya Chen",
    password,
    setup_key: setupKey,
  });
  const ownerCookie = cookieOf(owner.r);
  await call("auth", {
    email: "maya@example.com",
    password: "not the password",
  }).catch(() => {}); // one failed sign-in for the Activity page
  await photo(ownerCookie, "Maya Chen");
  const team = (await call("me", null, ownerCookie)).json.teams[0];
  const people = { maya: { name: "Maya Chen", cookie: ownerCookie } };
  for (const [key, name, email, role] of [
    ["james", "James Lee", "james@example.com", "admin"],
    ["priya", "Priya Shah", "priya@example.com", "member"],
  ]) {
    const invite = (
      await call(
        "settings/invite",
        { team_id: team.id, email, role },
        ownerCookie,
      )
    ).json;
    const reg = await call("auth/register", {
      email,
      name,
      password,
      invite_code: invite.code,
    });
    const cookie = cookieOf(reg.r);
    await photo(cookie, name);
    people[key] = { name, cookie };
  }

  const project = (
    await call(
      "projects",
      { name: "checkout-fix", team_id: team.id },
      ownerCookie,
    )
  ).json.id;
  // Each person gets their own identity in the project, which is how they write.
  for (const p of Object.values(people))
    p.identity = (
      await call("me/identity", { project_key: project }, p.cookie)
    ).json.name;

  // Agents, each created together with a key by the person who owns it.
  const agents = {};
  for (const [name, program, model, owner] of [
    ["NavyRaven", "claude-code", "opus", "maya"],
    ["IcyHorizon", "codex", "gpt-5", "james"],
    ["CopperGrove", "gemini-cli", "gemini-pro", "priya"],
  ]) {
    const cookie = people[owner].cookie;
    await call(
      "agents",
      { project_key: project, name, program, model },
      cookie,
    );
    const key = await call(
      "settings/key",
      { project_key: project, agent_name: name, name: program, days: 0 },
      cookie,
    );
    agents[name] = { token: key.json.token, owner };
  }

  const send = async (as, body, cookie) =>
    (
      await call(
        "messages",
        { project_key: project, sender_name: as, ...body },
        cookie,
      )
    ).json;
  const chart = (
    await call(
      "files",
      {
        project_key: project,
        filename: "checkout-errors.png",
        data_base64: chartPng().toString("base64"),
      },
      people.maya.cookie,
    )
  ).json;
  const report = (
    await call(
      "files",
      {
        project_key: project,
        filename: "deploy-report.txt",
        data_base64: Buffer.from("All 24 checks passed.\n").toString("base64"),
      },
      people.maya.cookie,
    )
  ).json;
  const first = await send(
    "NavyRaven",
    {
      to: [
        "IcyHorizon",
        "CopperGrove",
        people.maya.identity,
        people.james.identity,
      ],
      subject: "Checkout broke after yesterday's deploy",
      importance: "high",
      body_md:
        "## What I found\n\nRefunds are rounded **before** the discount is applied, so totals drift by a cent.\n\n| Case | Result |\n| --- | --- |\n| Partial refund | wrong |\n| Full refund | wrong |\n| Zero-dollar order | ok |\n\n```ts\nconst total = round(price) - discount; // should round last\n```\n\nError rate since the deploy is attached. :mag:",
      attachment_paths: [chart.id],
    },
    ownerCookie,
  );
  const reply = (as, cookie, to, body, extra = {}) =>
    send(
      as,
      {
        to,
        subject: "Re: Checkout broke after yesterday's deploy",
        thread_id: first.thread_id,
        body_md: body,
        ...extra,
      },
      cookie,
    );
  await reply(
    "IcyHorizon",
    people.james.cookie,
    ["NavyRaven", "CopperGrove", people.maya.identity],
    "Fixed the rounding and added tests for partial and zero-dollar refunds. 24/24 pass. :white_check_mark:",
  );
  await reply(
    people.maya.identity,
    people.maya.cookie,
    ["NavyRaven", "IcyHorizon", "CopperGrove"],
    "Thanks both. **CopperGrove**, please review the patch against the billing spec before we ship.",
  );
  await reply(
    "CopperGrove",
    people.priya.cookie,
    ["NavyRaven", "IcyHorizon", people.maya.identity],
    "Billing spec matches. Approved. :rocket:",
    { attachment_paths: [report.id] },
  );
  await send(
    "NavyRaven",
    {
      to: [people.maya.identity],
      subject: "Weekly digest",
      body_md:
        "Nothing else needs attention. Backups ran and all keys are active.",
    },
    ownerCookie,
  );
  await call("messages/star", { thread_id: first.thread_id }, ownerCookie);
  return { call, people, agents, project, team, first };
}
