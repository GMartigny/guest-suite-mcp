// Client minimal de la Widget Reviews API de Guest Suite (lecture des avis publiés vers le widget).
// Doc : https://widget.guest-suite.com/docs

import { GuestSuiteError } from "./guest-suite.js";

export const DEFAULT_WIDGET_API_URL = "https://widget.guest-suite.com";

const STATUS_HINTS = {
    400: "requête refusée : paramètre invalide",
    401: "token widget manquant, invalide ou sans accès à cette ressource",
    403: "ressource réservée ou établissement hors du périmètre de ce token",
    404: "établissement introuvable",
    429: "trop de requêtes, réessayez dans un moment",
    500: "erreur interne Guest Suite, réessayez plus tard",
    502: "Guest Suite est momentanément indisponible, réessayez plus tard",
    503: "Guest Suite est en maintenance ou limite les requêtes, réessayez plus tard",
    504: "Guest Suite ne répond pas, réessayez plus tard",
};

/**
 * Crée un client pour un token widget donné.
 * L'API n'accepte le token qu'en paramètre d'URL (access_token) : il n'apparaît jamais dans les messages d'erreur.
 * @param {Object} options
 * @param {string} options.token - Token widget (organisation ou établissement)
 * @param {string} [options.apiUrl] - URL de base de l'API
 * @param {typeof fetch} [options.fetch] - Implémentation de fetch (tests)
 */
export function createWidgetClient ({ token, apiUrl = DEFAULT_WIDGET_API_URL, fetch: fetchImpl = globalThis.fetch }) {
    if (!token) {
        throw new GuestSuiteError("Token widget Guest Suite manquant", 401);
    }

    /**
     * @param {string} path
     * @param {Object<string, string|number|undefined>} [query]
     */
    async function get (path, query = {}) {
        const url = new URL(path, apiUrl);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null && value !== "") {
                url.searchParams.set(key, String(value));
            }
        }
        url.searchParams.set("access_token", token);
        let response;
        try {
            response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
        }
        catch {
            throw new GuestSuiteError("Impossible de joindre la Widget API de Guest Suite", 0);
        }
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch {
            data = null;
        }
        if (response.status === 200) {
            return data;
        }
        const detail = (data && typeof data === "object" && (data.message || data.detail)) || "";
        const hint = STATUS_HINTS[response.status] ?? "réponse inattendue";
        throw new GuestSuiteError(`Guest Suite widget ${response.status} : ${hint}${detail ? ` (${detail})` : ""}`, response.status);
    }

    return {
        /**
         * Avis publiés vers le widget.
         * @param {Object} filters - location, from, to, fromId, toId, page (à partir de 0), pageSize, language, surveys
         */
        listReviews (filters) {
            return get("/api/v1/reviews", filters);
        },

        /** Note moyenne et nombre d'avis de tous les établissements du token. */
        getStatistics () {
            return get("/api/v1/locations/statistics");
        },

        /**
         * Détail d'un établissement, avec sa note moyenne et son nombre d'avis.
         * @param {string} identifier - UUID ou identifiant client de l'établissement
         */
        getLocation (identifier) {
            if (/[/.]/.test(identifier)) {
                throw new GuestSuiteError("Identifiant d'établissement invalide (« / » et « . » interdits)", 400);
            }
            return get(`/api/v1/locations/${encodeURIComponent(identifier)}`);
        },
    };
}
