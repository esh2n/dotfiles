# litellm-restart — restart the local LiteLLM proxy after a config or key
# change (the running container holds the OLD key until then); launchd or
# systemd is dotctl's business. Readiness is /health/liveliness (the process
# is up): /health would run a real completion against every model, loading
# the Mac's fallback Qwen and evicting the Mac's own model.
litellm-restart() {
    dotctl service restart litellm-proxy --health http://127.0.0.1:4000/health/liveliness
}
