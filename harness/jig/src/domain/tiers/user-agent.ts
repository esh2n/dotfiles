/**
 * The `User-Agent` each harness sends the LiteLLM proxy.
 *
 * LiteLLM labels every request-level metric with `user_agent` taken from the
 * HTTP header (https://docs.litellm.ai/docs/proxy/prometheus — the label list
 * of `litellm_proxy_total_requests_metric` / `litellm_deployment_success_responses`,
 * and its own `custom_prometheus_tags` example `User-Agent: RooCode/*`). Left
 * to the runtime, the header says nothing useful: Bun's fetch sends
 * `Bun/1.4.0`, Node's sends nothing (LiteLLM labels it `None`), aiohttp sends
 * `Python/3.11 aiohttp/…` — measured on the gateway dashboard 2026-09-24,
 * where `None` was the majority series and no harness was tellable apart.
 * pi (models.json `headers`), DSH (route `headers`) and omp (provider
 * `headers`) all let a config set the header, so each writer stamps its own
 * harness name here and the dashboard's "by harness" panel works as named.
 */
export const HARNESS_USER_AGENT = {
  pi: "pi",
  dsh: "dsh",
  omp: "omp",
} as const;
