"""Carry a request's reasoning_effort to the provider inside extra_body.

LiteLLM's DeepSeek transformation turns any reasoning_effort into
`thinking: enabled` and drops the level, so every call ran at DeepSeek's
default (high). Inside extra_body the level reaches the API: measured
2026-10-19 on the main tier, three runs each, reasoning tokens low 2.2k-3.1k
against max 6.0k-8.5k, while the top-level field gave the same spread for
both. rules/decisions/2026-10-19-model-assignment.md asks for the level to
arrive. `none` stays where it is: LiteLLM reads it as "thinking off".
"""

from litellm.integrations.custom_logger import CustomLogger


class EffortPassthrough(CustomLogger):
    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        effort = data.get("reasoning_effort")
        if isinstance(effort, str) and effort not in ("", "none"):
            extra = data.get("extra_body")
            data["extra_body"] = {**(extra if isinstance(extra, dict) else {}), "reasoning_effort": effort}
            data.pop("reasoning_effort", None)
        return data


proxy_handler_instance = EffortPassthrough()
