// viewer.js — the whole front end. Vanilla DOM, no framework, no build step.
//
// Two views, chosen from the path: "/" is the owner index, "/a/<channel>" is
// one artifact. The artifact itself is never inlined; it loads in an iframe
// whose sandbox omits allow-same-origin, so it cannot reach this document,
// its cookies, or the API.

const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";
const CSRF_HEADERS = { "x-yoki-csrf": "1" };

const main = document.getElementById("main");
const crumb = document.getElementById("crumb");

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { ...CSRF_HEADERS, ...(options.headers ?? {}) },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `The server returned ${response.status}.`);
  }
  return payload ?? {};
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

function replaceMain(...nodes) {
  main.replaceChildren(...nodes);
}

function showStatus(message, isError = false) {
  replaceMain(el("p", { class: isError ? "status error" : "status", text: message }));
}

function localTime(iso) {
  if (!iso) return "";
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

// --- owner index ----------------------------------------------------------

function artifactRow(artifact) {
  const link = el("a", { href: `/a/${encodeURIComponent(artifact.channel)}`, text: artifact.title });
  const unread = artifact.unread_agent_comments ?? 0;
  return el("tr", {}, [
    el("td", {}, [link, el("div", { class: "comment-meta", text: artifact.channel })]),
    el("td", { text: `v${artifact.latest_version}` }),
    el("td", { text: localTime(artifact.updated_at) }),
    el("td", {}, [artifact.revoked ? el("span", { class: "badge revoked", text: "revoked" }) : null]),
    el("td", {}, [unread > 0 ? el("span", { class: "badge", text: `${unread} for agent` }) : null]),
  ]);
}

async function renderIndex() {
  crumb.textContent = "";
  showStatus("Loading channels…");
  const { artifacts } = await api("/api/artifacts");
  if (artifacts.length === 0) {
    showStatus("No artifacts published yet.");
    return;
  }
  const head = el("tr", {}, [
    el("th", { text: "Artifact" }),
    el("th", { text: "Latest" }),
    el("th", { text: "Updated" }),
    el("th", { text: "State" }),
    el("th", { text: "Comments" }),
  ]);
  replaceMain(
    el("table", {}, [el("thead", {}, [head]), el("tbody", {}, artifacts.map(artifactRow))]),
  );
}

// --- artifact view --------------------------------------------------------

function commentNode(comment, { onChanged }) {
  const meta = el("div", { class: "comment-meta" }, [
    el("span", { text: comment.author }),
    el("span", { text: localTime(comment.created_at) }),
    el("span", { text: `v${comment.version}` }),
    comment.to_agent ? el("span", { class: "badge", text: "for agent" }) : null,
    comment.resolved_at ? el("span", { class: "badge", text: `resolved by ${comment.resolved_by}` }) : null,
  ]);
  const actions = el("div", { class: "compose-actions" }, [
    el("button", {
      type: "button",
      text: "Reply",
      onclick: () => openReply(comment, { onChanged }),
    }),
    comment.resolved_at
      ? null
      : el("button", {
          type: "button",
          text: "Resolve",
          onclick: async () => {
            await api(`/api/comments/${encodeURIComponent(comment.id)}/resolve`, { method: "POST" });
            await onChanged();
          },
        }),
  ]);
  return el("div", { class: "comment", "data-id": comment.id }, [
    meta,
    el("p", { class: "comment-body", text: comment.body }),
    actions,
  ]);
}

function openReply(comment, { onChanged }) {
  const host = document.querySelector(`[data-id="${CSS.escape(comment.id)}"]`);
  if (!host || host.querySelector("form.compose")) return;
  const text = el("textarea", { placeholder: "Reply…", required: "required" });
  const form = el("form", {
    class: "compose",
    onsubmit: async (event) => {
      event.preventDefault();
      try {
        await api(`/api/comments/${encodeURIComponent(comment.id)}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text.value }),
        });
        await onChanged();
      } catch (err) {
        form.append(el("p", { class: "status error", text: err.message }));
      }
    },
  });
  form.append(text, el("div", { class: "compose-actions" }, [el("button", { class: "primary", type: "submit", text: "Post reply" })]));
  host.append(form);
  text.focus();
}

function threadNode(root, replies, context) {
  const node = el("div", { class: root.resolved_at ? "thread resolved" : "thread" }, [
    commentNode(root, context),
  ]);
  for (const reply of replies) {
    node.append(el("div", { class: "reply" }, [commentNode(reply, context)]));
  }
  return node;
}

function composeForm({ channel, version, onChanged }) {
  const text = el("textarea", { placeholder: "Add a comment…", required: "required" });
  const toAgent = el("input", { type: "checkbox" });
  const error = el("p", { class: "status error" });
  const form = el("form", {
    class: "compose",
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = "";
      try {
        await api(`/api/artifacts/${encodeURIComponent(channel)}/comments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text.value, version, to_agent: toAgent.checked }),
        });
        text.value = "";
        toAgent.checked = false;
        await onChanged();
      } catch (err) {
        error.textContent = err.message;
      }
    },
  });
  form.append(
    text,
    el("div", { class: "compose-actions" }, [
      el("label", { class: "checkbox" }, [toAgent, el("span", { text: "Send to agent" })]),
      el("button", { class: "primary", type: "submit", text: "Comment" }),
    ]),
    error,
  );
  return form;
}

async function renderComments(host, { channel, version, onChanged }) {
  host.replaceChildren(el("p", { class: "status", text: "Loading comments…" }));
  const { comments } = await api(`/api/artifacts/${encodeURIComponent(channel)}/comments`);
  const roots = comments.filter((comment) => comment.parent_id === null);
  const repliesOf = (id) => comments.filter((comment) => comment.parent_id === id);
  const context = { channel, version, onChanged };
  host.replaceChildren(
    el("h2", { text: `Comments (${comments.length})` }),
    ...(roots.length === 0 ? [el("p", { class: "status", text: "No comments yet." })] : []),
    ...roots.map((root) => threadNode(root, repliesOf(root.id), context)),
    composeForm(context),
  );
}

function versionPicker(versions, current, onPick) {
  const select = el("select", {
    "aria-label": "Version",
    onchange: (event) => onPick(Number(event.target.value)),
  });
  for (const version of versions) {
    const option = el("option", { value: String(version.version), text: `v${version.version}${version.label ? ` — ${version.label}` : ""}` });
    if (version.version === current) option.selected = true;
    select.append(option);
  }
  return select;
}

async function renderArtifact(channel) {
  crumb.textContent = channel;
  showStatus("Loading artifact…");
  const { artifact, versions } = await api(`/api/artifacts/${encodeURIComponent(channel)}`);
  const wanted = Number(new URL(window.location.href).searchParams.get("v"));
  const current = versions.some((version) => version.version === wanted) ? wanted : artifact.latest_version;

  const frame = el("iframe", {
    class: "artifact",
    src: `/r/${encodeURIComponent(channel)}/${current}`,
    sandbox: SANDBOX,
    referrerpolicy: "no-referrer",
    title: artifact.title,
  });
  const commentsHost = el("section", { class: "comments" });
  const reload = () => renderComments(commentsHost, { channel, version: current, onChanged: reload });

  const picker = versionPicker(versions, current, (version) => {
    const next = new URL(window.location.href);
    next.searchParams.set("v", String(version));
    window.history.replaceState(null, "", next);
    frame.src = `/r/${encodeURIComponent(channel)}/${version}`;
  });

  replaceMain(
    el("div", { class: "artifact-head" }, [
      el("h1", { text: artifact.title }),
      picker,
      artifact.revoked ? el("span", { class: "badge revoked", text: "revoked" }) : null,
      el("span", { class: "comment-meta", text: `updated ${localTime(artifact.updated_at)}` }),
    ]),
    el("div", { class: "frame-wrap" }, [frame]),
    commentsHost,
  );
  await reload();
}

// --- entry ----------------------------------------------------------------

async function start() {
  const path = window.location.pathname;
  try {
    const match = /^\/a\/([^/]+)\/?$/.exec(path);
    if (match) {
      await renderArtifact(decodeURIComponent(match[1]));
      return;
    }
    await renderIndex();
  } catch (err) {
    showStatus(err.message, true);
  }
}

start();
