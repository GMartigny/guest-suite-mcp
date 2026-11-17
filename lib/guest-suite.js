// Client minimal de l'Experience API de Guest Suite.
// Doc : https://experience.guest-suite.com/docs

export const DEFAULT_API_URL = "https://experience.guest-suite.com";

/** Trace jointe à chaque enregistrement pour savoir d'où il vient. */
export const TRACE = { source: "guest-suite-mcp" };

export class GuestSuiteError extends Error {
    /**
     * @param {string} message - Message lisible
     * @param {number} status - Code HTTP renvoyé par Guest Suite (0 si pas de réponse)
     * @param {unknown} [body] - Corps de la réponse
     */
    constructor (message, status, body) {
        super(message);
        this.name = "GuestSuiteError";
        this.status = status;
        this.body = body;
    }
}

const STATUS_HINTS = {
    400: "requête refusée : données invalides ou établissement (externalLocationId) inconnu pour ce token",
    401: "token manquant",
    403: "token absent, invalide ou sans accès à cette ressource",
    404: "contact ou expérience introuvable",
    500: "erreur interne Guest Suite, réessayez plus tard",
    502: "Guest Suite est momentanément indisponible, réessayez plus tard",
    503: "Guest Suite est en maintenance, réessayez plus tard",
    504: "Guest Suite ne répond pas, réessayez plus tard",
};

/**
 * Crée un client pour un token donné.
 * @param {Object} options
 * @param {string} options.token - Token Guest Suite (en-tête X-AUTH-TOKEN)
 * @param {string} [options.apiUrl] - URL de base de l'API
 * @param {typeof fetch} [options.fetch] - Implémentation de fetch (tests)
 */
export function createClient ({ token, apiUrl = DEFAULT_API_URL, fetch: fetchImpl = globalThis.fetch }) {
    if (!token) {
        throw new GuestSuiteError("Token Guest Suite manquant", 401);
    }

    /**
     * @param {string} method
     * @param {string} path
     * @param {Object} [body]
     * @returns {Promise<{status: number, data: any}>}
     */
    async function request (method, path, body) {
        let response;
        try {
            response = await fetchImpl(new URL(path, apiUrl), {
                method,
                headers: {
                    "X-AUTH-TOKEN": token,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
        }
        catch (error) {
            throw new GuestSuiteError(`Impossible de joindre Guest Suite (${error.message})`, 0);
        }
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch {
            data = text;
        }
        return { status: response.status, data };
    }

    /**
     * Lève une erreur lisible pour une réponse non attendue.
     * @param {{status: number, data: any}} result
     */
    function fail ({ status, data }) {
        const detail = (data && typeof data === "object" && (data.message || data.detail)) || "";
        const hint = STATUS_HINTS[status] ?? "réponse inattendue";
        throw new GuestSuiteError(`Guest Suite ${status} : ${hint}${detail ? ` (${detail})` : ""}`, status, data);
    }

    return {
        /**
         * Liste les établissements autorisés pour ce token.
         * @param {boolean} [isLicensed] - Filtre sur la licence du module d'enquête
         * @returns {Promise<Array<Object>>}
         */
        async listLocations (isLicensed) {
            const query = isLicensed === undefined ? "" : `?isLicensed=${isLicensed ? "true" : "false"}`;
            const result = await request("GET", `/api/locations${query}`);
            if (result.status === 200) {
                return Array.isArray(result.data) ? result.data : [];
            }
            return fail(result);
        },

        /**
         * Crée un contact, ou renvoie l'existant (409) pour le même couple e-mail / téléphone / établissement.
         * @param {Object} contact - Champs du contact (voir doc)
         * @returns {Promise<{contact: Object, created: boolean}>}
         */
        async createContact (contact) {
            const result = await request("POST", "/api/contacts", { ...contact, trace: TRACE });
            if (result.status === 201 || result.status === 409) {
                return { contact: result.data, created: result.status === 201 };
            }
            return fail(result);
        },

        /**
         * Rattache une expérience à un contact, ou renvoie l'existante (409) pour le même jour.
         * @param {Object} experience - Champs de l'expérience (voir doc)
         * @returns {Promise<{experience: Object, created: boolean}>}
         */
        async createExperience (experience) {
            const result = await request("POST", "/api/experiences", { ...experience, trace: TRACE });
            if (result.status === 201 || result.status === 409) {
                return { experience: result.data, created: result.status === 201 };
            }
            return fail(result);
        },

        /**
         * Met à jour un contact (seuls les champs présents sont modifiés).
         * @param {string} uuid
         * @param {Object} fields
         */
        async updateContact (uuid, fields) {
            const result = await request("PATCH", `/api/contacts/${encodeURIComponent(uuid)}`, { ...fields, trace: TRACE });
            if (result.status === 200) {
                return result.data;
            }
            return fail(result);
        },

        /**
         * Met à jour une expérience (données complémentaires). Rejoue une fois en cas de conflit (409).
         * @param {string} uuid
         * @param {Object} fields
         */
        async updateExperience (uuid, fields) {
            const path = `/api/experiences/${encodeURIComponent(uuid)}`;
            let result = await request("PATCH", path, { ...fields, trace: TRACE });
            if (result.status === 409) {
                result = await request("PATCH", path, { ...fields, trace: TRACE });
            }
            if (result.status === 200) {
                return result.data;
            }
            return fail(result);
        },
    };
}
