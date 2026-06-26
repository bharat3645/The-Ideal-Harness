/**
 * Single source of truth for the version every The Ideal Harness MCP server
 * advertises in its `initialize` serverInfo response.
 *
 * Centralized so a release bump touches one constant instead of four hand-edited
 * string literals scattered across the engine packages' MCP faces. The harness
 * publishes all packages together at the same version, so one constant is correct.
 */

export const HARNESS_VERSION = '0.1.0';
