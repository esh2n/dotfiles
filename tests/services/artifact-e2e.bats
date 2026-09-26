#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# The artifact CLI the way a caller reaches it — through links to its
# launcher, as ~/bin/artifact is — against the skill's own fake Worker on
# 127.0.0.1 (harness/skills/artifact/test/fixtures/api-server.mjs): publish
# -> versions -> comments -> watch -> revoke as one sequence, and the secret
# gate refusing before anything is uploaded. Nothing reaches the network, the
# user's ~/.config or a real deployment. Ported from the old layout's
# core/validation/test-artifact.sh.
#
# Needs node 22+, jq and a local port; without them every case is skipped
# with the reason (an agent sandbox cannot open a port).

ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
SKILL="${ROOT}/harness/skills/artifact"
CHANNEL="e2e"
SECRET_CHANNEL="e2e-secret"

setup_file() {
	export SKIP_REASON=""
	if ! command -v node >/dev/null 2>&1; then
		SKIP_REASON="node is not installed"
	elif [ "$(node --version | sed 's/^v//' | cut -d. -f1)" -lt 22 ]; then
		SKIP_REASON="node $(node --version) is below the CLI's floor of 22"
	elif ! command -v jq >/dev/null 2>&1; then
		SKIP_REASON="jq is not installed"
	fi
	[ -z "${SKIP_REASON}" ] || return 0

	export FAKE_HOME="${BATS_FILE_TMPDIR}/home"
	mkdir -p "${FAKE_HOME}" "${BATS_FILE_TMPDIR}/bin"
	cat >"${BATS_FILE_TMPDIR}/driver.mjs" <<'DRIVER'
// Runs the CLI's own fake Worker in its own process, writes one JSON line of
// connection details, then waits for SIGTERM.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const fixture = await import(pathToFileURL(process.env.ARTIFACT_FIXTURE).href);
const channel = process.env.ARTIFACT_CHANNEL;
// one unseen agent comment, one already picked up, one written to a human
const server = await fixture.startApiServer({
  comments: [
    fixture.makeComment({ id: "w-new", channel, body: "the legend overlaps" }),
    fixture.makeComment({ id: "w-seen", channel, agent_seen_at: "2026-08-30T11:00:00.000Z" }),
    fixture.makeComment({ id: "w-human", channel, to_agent: false }),
  ],
});
writeFileSync(
  process.env.ARTIFACT_HANDSHAKE,
  `${JSON.stringify({ baseUrl: server.baseUrl, clientId: fixture.CLIENT_ID, clientSecret: fixture.CLIENT_SECRET })}\n`,
);
const shutdown = () => server.close().then(() => process.exit(0), () => process.exit(1));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
DRIVER
	local handshake="${BATS_FILE_TMPDIR}/handshake.json"
	ARTIFACT_FIXTURE="${SKILL}/test/fixtures/api-server.mjs" ARTIFACT_CHANNEL="${CHANNEL}" \
		ARTIFACT_HANDSHAKE="${handshake}" \
		node "${BATS_FILE_TMPDIR}/driver.mjs" >"${BATS_FILE_TMPDIR}/driver.log" 2>&1 3>&- &
	echo $! >"${BATS_FILE_TMPDIR}/driver.pid"
	for _ in $(seq 1 150); do
		[ -s "${handshake}" ] && break
		kill -0 "$(cat "${BATS_FILE_TMPDIR}/driver.pid")" 2>/dev/null || break
		sleep 0.1
	done
	if [ ! -s "${handshake}" ]; then
		SKIP_REASON="the fake API could not start: $(grep -m1 '^Error' "${BATS_FILE_TMPDIR}/driver.log" || echo 'no handshake within 15s')"
		return 0
	fi
	export API_URL API_CLIENT_ID API_CLIENT_SECRET
	API_URL="$(jq -r .baseUrl "${handshake}")"
	API_CLIENT_ID="$(jq -r .clientId "${handshake}")"
	API_CLIENT_SECRET="$(jq -r .clientSecret "${handshake}")"

	# ~/bin/artifact is a link to the launcher; a second hop is the shape
	# that breaks a launcher resolving only `dirname "$0"`
	ln -s "${SKILL}/bin/artifact" "${BATS_FILE_TMPDIR}/launcher"
	ln -s "${BATS_FILE_TMPDIR}/launcher" "${BATS_FILE_TMPDIR}/bin/artifact"
}

teardown_file() {
	if [ -f "${BATS_FILE_TMPDIR}/driver.pid" ]; then
		kill "$(cat "${BATS_FILE_TMPDIR}/driver.pid")" 2>/dev/null || true
	fi
}

setup() {
	[ -z "${SKIP_REASON}" ] || skip "${SKIP_REASON}"
}

# the CLI in a scrubbed environment: a throwaway HOME and XDG dirs, and a
# self-check hook that does not exist, so no real installation takes part
cli() {
	env -i PATH="${PATH}" HOME="${FAKE_HOME}" \
		XDG_CONFIG_HOME="${FAKE_HOME}/.config" XDG_STATE_HOME="${FAKE_HOME}/.local/state" \
		ARTIFACT_SELF_CHECK="${FAKE_HOME}/no-such-self-check.mjs" \
		ARTIFACT_URL="${API_URL}" ARTIFACT_CLIENT_ID="${API_CLIENT_ID}" ARTIFACT_CLIENT_SECRET="${API_CLIENT_SECRET}" \
		"${BATS_FILE_TMPDIR}/bin/artifact" "$@"
}

page() { # page <file> <body>: a minimal HTML page, its path printed
	printf '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>e2e</title></head>\n<body>%s</body></html>\n' "$2" >"${FAKE_HOME}/$1"
	printf '%s' "${FAKE_HOME}/$1"
}

@test "artifact: two links deep, the launcher still finds the CLI" {
	run cli --help
	[[ "$output" == *"artifact — publish and manage artifacts."* ]]
}

@test "artifact: publish, and republishing the same bytes is a dedupe" {
	p="$(page page.html '<h1>hello</h1>')"
	run --separate-stderr cli publish "$p" --channel "${CHANNEL}" --title E2E --json
	[ "$status" -eq 0 ]
	[ "$(jq -r '[.ok, .channel, .version, .unchanged, .url] | join(" ")' <<<"$output")" = "true ${CHANNEL} 1 false ${API_URL}/a/${CHANNEL}" ]
	run --separate-stderr cli publish "$p" --channel "${CHANNEL}" --json
	[ "$status" -eq 0 ]
	[ "$(jq -r '[.unchanged, .version] | join(" ")' <<<"$output")" = "true 1" ]
}

@test "artifact: versions lists one; comments --to-agent leaves the human's out" {
	run --separate-stderr cli versions "${CHANNEL}" --json
	[ "$status" -eq 0 ]
	[ "$(jq -r '[(.versions | length), .channel] | join(" ")' <<<"$output")" = "1 ${CHANNEL}" ]
	run --separate-stderr cli comments "${CHANNEL}" --to-agent --json
	[ "$status" -eq 0 ]
	[ "$(jq -r '[.comments[].id] | sort | join(" ")' <<<"$output")" = "w-new w-seen" ]
}

@test "artifact: watch --once hands over the unseen comment once" {
	inbox="${FAKE_HOME}/.local/state/yoki/artifact/inbox.jsonl"
	run --separate-stderr cli watch "${CHANNEL}" --once --json
	[ "$status" -eq 0 ]
	[ "$(jq -r '[(.entries | length), .inbox] | join(" ")' <<<"$output")" = "1 ${inbox}" ]
	[ "$(wc -l <"${inbox}" | tr -d ' ')" = 1 ]
	[ "$(jq -r .comment.id "${inbox}")" = "w-new" ]
	before="$(cat "${inbox}")"
	run cli watch "${CHANNEL}" --once
	[ "$status" -eq 0 ]
	[ "$(cat "${inbox}")" = "${before}" ]
}

@test "artifact: revoke stamps revoked_at" {
	run --separate-stderr cli revoke "${CHANNEL}" --json
	[ "$status" -eq 0 ]
	[ "$(jq -r .channel <<<"$output")" = "${CHANNEL}" ]
	[ -n "$(jq -r '.revoked_at // ""' <<<"$output")" ]
}

@test "artifact: a page with a credential is refused before any upload" {
	# assembled from fragments so this repository never holds a key-shaped string
	key="sk-"
	for _ in 1 2 3 4 5 6 7 8; do key="${key}FAKE"; done
	p="$(page leaky.html "<code>${key}</code>")"
	run --separate-stderr cli publish "$p" --channel "${SECRET_CHANNEL}"
	[ "$status" -eq 4 ]
	[[ "$stderr" == *"looks like it contains a credential"* ]]
	[[ "$stderr" != *"${key}"* ]]
	run --separate-stderr cli versions "${SECRET_CHANNEL}"
	[ "$status" -eq 2 ]
	[[ "$stderr" == *"no such artifact"* ]]
}
