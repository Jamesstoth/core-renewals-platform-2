/**
 * MCP HTTP client for calling remote MCP servers using the
 * Streamable HTTP transport (JSON-RPC 2.0 over POST).
 *
 * Handles:
 *  - Session initialization (lazy, on first tool call)
 *  - Both JSON and SSE response formats
 *  - Session ID persistence across calls within a request lifecycle
 *  - Robust SSE parsing for Vercel serverless environment
 */

const SALESFORCE_MCP_URL = "https://mcp.csaiautomations.com/salesforce/mcp/";

// Per-request timeout (15s should be enough for a single MCP call)
const REQUEST_TIMEOUT_MS = 15000;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolResult {
  content: { type: string; text: string }[];
}

/**
 * Parse an SSE response body into a JSON-RPC response.
 * Handles \r\n and \n line endings, multiple events, and
 * extracts the last `data:` line containing valid JSON-RPC.
 */
function parseSSE(body: string): JsonRpcResponse | null {
  // Normalize line endings and split
  const lines = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let lastData: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      // Handle both "data: {...}" and "data:{...}"
      lastData = trimmed.slice(5).trim();
    }
  }

  if (!lastData) return null;

  try {
    return JSON.parse(lastData) as JsonRpcResponse;
  } catch {
    console.error("[mcp-client] Failed to parse SSE data:", lastData.slice(0, 200));
    return null;
  }
}

/**
 * Read the full response body, handling both regular and streaming responses.
 * On Vercel, response.text() for SSE streams can sometimes return incomplete
 * data. Reading via the body reader ensures we get everything.
 */
async function readFullBody(response: Response): Promise<string> {
  // Try the reader approach first for SSE responses
  if (
    response.body &&
    (response.headers.get("Content-Type") ?? "").includes("text/event-stream")
  ) {
    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: !done }));
      }
      return chunks.join("");
    } catch {
      // Fall through to .text()
    }
  }
  return response.text();
}

class McpClient {
  private sessionId: string | null = null;
  private requestCounter = 0;
  private initialized = false;

  private getUrl(): string {
    const token = process.env.SALESFORCE_MCP_TOKEN;
    if (!token) {
      throw new Error(
        "SALESFORCE_MCP_TOKEN is not configured. " +
          "Set it in .env.local with your Salesforce MCP server token."
      );
    }
    return `${SALESFORCE_MCP_URL}?token=${encodeURIComponent(token)}`;
  }

  private async post(
    request: JsonRpcRequest,
    label: string
  ): Promise<JsonRpcResponse> {
    const url = this.getUrl();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`MCP ${label} timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    // Capture session ID
    const newSessionId = response.headers.get("Mcp-Session-Id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    const body = await readFullBody(response);

    console.log(
      `[mcp-client] ${label} — status: ${response.status}, content-type: ${contentType}, body length: ${body.length}`
    );

    if (!response.ok) {
      throw new Error(
        `MCP ${label} failed (${response.status}): ${body.slice(0, 300)}`
      );
    }

    if (body.length === 0) {
      throw new Error(`MCP ${label} returned empty body`);
    }

    // Handle SSE responses
    if (contentType.includes("text/event-stream")) {
      const parsed = parseSSE(body);
      if (!parsed) {
        console.error(
          `[mcp-client] SSE parse failed for ${label}. Raw body (first 500 chars):`,
          body.slice(0, 500)
        );
        throw new Error(
          `MCP ${label}: SSE response contained no parseable data. ` +
            `Body starts with: ${body.slice(0, 100)}`
        );
      }
      return parsed;
    }

    // Handle direct JSON responses
    try {
      return JSON.parse(body) as JsonRpcResponse;
    } catch {
      throw new Error(
        `MCP ${label}: Invalid JSON response. Body starts with: ${body.slice(0, 100)}`
      );
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log("[mcp-client] Initializing MCP session...");
    const response = await this.post(
      {
        jsonrpc: "2.0",
        id: ++this.requestCounter,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "renewals-portal",
            version: "1.0.0",
          },
        },
      },
      "initialize"
    );

    if (response.error) {
      throw new Error(
        `MCP initialize failed: ${response.error.message}`
      );
    }

    // Send initialized notification (fire and forget)
    try {
      const notifHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.sessionId) {
        notifHeaders["Mcp-Session-Id"] = this.sessionId;
      }
      await fetch(this.getUrl(), {
        method: "POST",
        headers: notifHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      });
    } catch {
      // Notification failures are non-fatal
    }

    this.initialized = true;
    console.log("[mcp-client] Session initialized, id:", this.sessionId);
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolResult> {
    await this.initialize();

    const response = await this.post(
      {
        jsonrpc: "2.0",
        id: ++this.requestCounter,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      },
      `tools/call(${toolName})`
    );

    if (response.error) {
      throw new Error(
        `MCP tool ${toolName} failed: ${response.error.message}`
      );
    }

    return response.result as McpToolResult;
  }
}

export function createMcpClient(): McpClient {
  return new McpClient();
}

export type { McpToolResult };
