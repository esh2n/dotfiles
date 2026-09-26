# litellm-restart — restart the local LiteLLM proxy after a config or key
# change (the running container holds the OLD key until then); launchd or
# systemd is dotctl's business
litellm-restart() {
    dotctl service restart litellm-proxy --health http://127.0.0.1:4000/health
}
