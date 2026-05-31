# brain_llm — LLM client surface routed via the LiteLLM gateway (spec: pylibs/brain_llm).
# Model-agnostic: every call goes through the gateway (small_llm / frontier_llm policy tiers),
# never the raw vendor SDK. The client lands here as intelligence-service (Phase-2 build) is built.

LLM_PACKAGE = "brain_llm"
