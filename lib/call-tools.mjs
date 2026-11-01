// MCP tools that let an agent take part in a voice call: join, speak (read aloud in everyone's browser),
// follow the call through its transcript, and leave. Agents have no audio of their own.
import { MailError } from "./store.mjs";
import * as calls from "./calls.mjs";

const str = { type: "string" };
// A call belongs to a conversation. Name it by any message in it, or by the project to join the channel's own
// call (the one started from the channel header).
const def = (name, description, extra = {}, required = []) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: { message_id: str, project_key: str, ...extra },
    required,
    additionalProperties: false,
  },
});

export const callTools = [
  def(
    "call_join",
    "Join the voice call of a conversation (any message id in it), or of a channel (pass project_key instead). You appear as a participant; people hear what you call_say. Stay in the call by calling call_listen at least every few minutes.",
  ),
  def(
    "call_say",
    "Speak in the call. The text is read aloud in each person's browser and added to the transcript. Keep it short and conversational.",
    { text: str },
    ["text"],
  ),
  def(
    "call_listen",
    "Read what people said in the call (their speech-to-text captions) and who is in it. Pass the last next_seq you saw to get only new lines. Pass wait_seconds (up to 25) to wait for the next words instead of returning empty, then answer with call_say.",
    {
      after_seq: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      wait_seconds: { type: "integer", minimum: 0, maximum: 25 },
    },
  ),
  def("call_leave", "Leave the call."),
  def("call_status", "Who is in the conversation's call right now."),
];

export function callCall(name, a, s) {
  if (s.actor.kind !== "agent")
    throw new MailError("Agent credentials are required for calls", 403);
  let thread;
  if (a.message_id) thread = s.thread(a.message_id)[0]?.thread_id;
  else if (a.project_key) {
    // The channel's call is tied to the first conversation in the project, as the web app does.
    const p = s.project(a.project_key);
    thread = s.db
      .prepare(
        "SELECT thread_id FROM messages WHERE project_id=? ORDER BY created_at LIMIT 1",
      )
      .get(p.id)?.thread_id;
  } else throw new MailError("Pass message_id or project_key", 400);
  if (!thread) throw new MailError("Not found", 404);
  const agent = { id: s.actor.agent_id, name: s.actor.agent_name };
  switch (name) {
    case "call_join":
      return calls.joinAgent(thread, agent);
    case "call_say":
      return calls.agentSay(thread, agent, a.text);
    case "call_listen": {
      const look = () =>
          calls.agentListen(thread, agent, a.after_seq || 0, a.limit || 100),
        first = look(),
        wait = Math.min(25, a.wait_seconds || 0);
      if (first.lines.length || !wait) return first;
      // Hold the request open until someone says something, so an agent can answer within a moment.
      return (async () => {
        const end = Date.now() + wait * 1000;
        while (Date.now() < end) {
          await new Promise((r) => setTimeout(r, 250));
          const next = look();
          if (next.lines.length) return next;
        }
        return look();
      })();
    }
    case "call_leave":
      return calls.agentLeave(thread, agent);
    default:
      return calls.status(thread);
  }
}
