// Fonction Vercel : point d'entrée MCP (Streamable HTTP, sans session).
//
// Chaque utilisateur passe ses propres tokens Guest Suite dans des en-têtes (au moins l'un des deux) :
// - Experience API (demandes d'avis) : X-AUTH-TOKEN: <token> ou Authorization: Bearer <token> ;
// - Widget Reviews API (lecture des avis) : X-ACCESS-TOKEN: <token> (ou X-WIDGET-TOKEN: <token>).
// Ils ne sont jamais acceptés dans l'URL, pour ne pas finir dans les journaux d'accès.
// Paramètre facultatif : ?location=<externalLocationId> pour l'établissement par défaut.
//
// Les tokens ne sont jamais enregistrés par ce serveur ; ils servent uniquement à appeler Guest Suite.

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
    return undefined;
}

/**
 * Lit le token de la Widget Reviews API.
 * @param {import("http").IncomingMessage} req
 * @returns {string|undefined}
 */
export function readWidgetToken (req) {
    // x-access-token reprend le nom du paramètre de la Widget API (access_token)
    // et fait partie des en-têtes acceptés par les connecteurs personnalisés de claude.ai.
    const header = req.headers["x-access-token"] || req.headers["x-widget-token"];
    return header ? String(header) : undefined;
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
    const widgetToken = readWidgetToken(req);
    if (!token && !widgetToken) {
        return jsonRpcError(res, 401, "Missing Guest Suite token: send the Experience API token in the X-AUTH-TOKEN header "
            + "(or Authorization: Bearer) and/or the Widget API token in the X-ACCESS-TOKEN header.");
    }

    const location = req.query?.location ? String(req.query.location) : undefined;
    const server = buildServer({
        token,
        widgetToken,
        location,
        apiUrl: process.env.GUEST_SUITE_API_URL || undefined,
        widgetApiUrl: process.env.GUEST_SUITE_WIDGET_API_URL || undefined,
    });
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
