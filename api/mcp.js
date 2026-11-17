// Fonction Vercel : point d'entrée MCP (Streamable HTTP, sans session).
//
// Chaque utilisateur passe son propre token Guest Suite, au choix :
// - dans l'URL : /mcp/<token> ou /mcp?token=<token> (pour claude.ai, qui ne permet pas d'en-têtes)
// - dans un en-tête : X-AUTH-TOKEN: <token> ou Authorization: Bearer <token>
// Paramètre facultatif : ?location=<externalLocationId> pour l'établissement par défaut.
//
// Le token n'est jamais enregistré par ce serveur ; il sert uniquement à appeler Guest Suite.

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "../lib/mcp-server.js";

/**
 * Lit le token Guest Suite de la requête.
 * @param {import("http").IncomingMessage & {query?: Object}} req
 * @returns {string|undefined}
 */
export function readToken (req) {
    const header = req.headers["x-auth-token"];
    if (header) {
        return String(header);
    }
    const auth = req.headers.authorization;
    if (auth && /^Bearer\s+/i.test(auth)) {
        return auth.replace(/^Bearer\s+/i, "").trim();
    }
    const query = req.query?.token;
    return query ? String(Array.isArray(query) ? query[0] : query) : undefined;
}

/**
 * Réponse d'erreur au format JSON-RPC.
 */
function jsonRpcError (res, status, message) {
    res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

export default async function handler (req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return jsonRpcError(res, 405, "Method not allowed: this server is stateless, use POST.");
    }

    const token = readToken(req);
    if (!token) {
        return jsonRpcError(res, 401, "Missing Guest Suite token: use /mcp/<token>, ?token=, X-AUTH-TOKEN or Authorization: Bearer.");
    }

    const location = req.query?.location ? String(req.query.location) : undefined;
    const server = buildServer({ token, location, apiUrl: process.env.GUEST_SUITE_API_URL || undefined });
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    res.on("close", () => {
        transport.close();
        server.close();
    });

    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        console.error("MCP request failed:", error?.message);
        if (!res.headersSent) {
            jsonRpcError(res, 500, "Internal server error");
        }
    }
}
