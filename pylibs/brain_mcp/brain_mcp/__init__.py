# brain_mcp — MCP server primitives + tool helpers (spec: pylibs/brain_mcp).
# MCP tool schemas generate from protos/ (single source of truth, no drift); writes are
# auto-logged to the Decision Log. The api-gateway exposes the MCP surface; Python agents
# register tools through this package (Phase-2 build).

MCP_PACKAGE = "brain_mcp"
