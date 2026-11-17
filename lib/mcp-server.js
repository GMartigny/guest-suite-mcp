// Serveur MCP : expose l'Experience API (demandes d'avis) et la Widget Reviews API (lecture des avis)
// de Guest Suite sous forme d'outils. Chaque groupe d'outils n'apparaît que si son token est fourni.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient, GuestSuiteError } from "./guest-suite.js";
import { createWidgetClient } from "./widget.js";

export const SERVER_INFO = { name: "guest-suite-mcp", version: "1.1.1" };

const extraData = z.array(z.object({
    name: z.string().min(1).describe("Field name (matched case- and accent-insensitively by Guest Suite)"),
    value: z.union([z.string().max(254), z.number()]).describe("Value, stored as a string (max 254 characters, booleans are rejected)"),
})).optional();

const dateTime = z.string().describe("ISO 8601 date-time, ideally with a timezone (e.g. 2026-11-17T14:00:00+01:00)");

/**
 * Résultat d'outil au format MCP, avec une version texte et une version structurée.
 * @param {Object} data
 */
function ok (data) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
    };
}

/**
 * Transforme une erreur en résultat d'outil lisible par le client.
 * @param {unknown} error
 */
function toolError (error) {
    const message = error instanceof GuestSuiteError ? error.message : `Erreur inattendue : ${error?.message ?? error}`;
    return {
        isError: true,
        content: [{ type: "text", text: message }],
    };
}

/**
 * Construit un serveur MCP pour un utilisateur.
 * @param {Object} options
 * @param {string} [options.token] - Token de l'Experience API (outils de demande d'avis)
 * @param {string} [options.widgetToken] - Token de la Widget Reviews API (outils de lecture des avis)
 * @param {string} [options.location] - externalLocationId par défaut
 * @param {string} [options.apiUrl] - URL de l'Experience API
 * @param {string} [options.widgetApiUrl] - URL de la Widget Reviews API
 * @param {typeof fetch} [options.fetch] - Implémentation de fetch (tests)
 * @returns {McpServer}
 */
export function buildServer ({ token, widgetToken, location, apiUrl, widgetApiUrl, fetch }) {
    const server = new McpServer(SERVER_INFO);
    if (token) {
        registerExperienceTools(server, createClient({ token, apiUrl, fetch }), location);
    }
    if (widgetToken) {
        registerWidgetTools(server, createWidgetClient({ token: widgetToken, apiUrl: widgetApiUrl, fetch }));
    }
    return server;
}

/**
 * Outils de l'Experience API (demandes d'avis).
 * @param {McpServer} server
 * @param {ReturnType<typeof createClient>} client
 * @param {string} [location] - externalLocationId par défaut
 */
function registerExperienceTools (server, client, location) {
    server.registerTool("list_locations", {
        title: "List my locations",
        description: "List the locations your Guest Suite token can send customers to, "
            + "with the externalLocationId to use in request_review (or in the connector URL as ?location=).",
        inputSchema: {
            isLicensed: z.boolean().optional()
                .describe("Only return locations with (true) or without (false) an active survey-module license"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ isLicensed }) => {
        try {
            const locations = (await client.listLocations(isLicensed)).map(l => ({
                externalLocationId: l.externalLocationId,
                name: l.name,
                address: l.address,
                isLicensed: l.isLicensed,
                uuid: l.uuid,
            }));
            return ok({ defaultLocation: location ?? null, locations });
        }
        catch (error) {
            return toolError(error);
        }
    });

    server.registerTool("request_review", {
        title: "Request a review",
        description: "Send a customer to Guest Suite so they receive a review request. "
            + "Creates the contact (or reuses the existing one for the same email / phone / location), "
            + "then attaches an experience, which triggers the review request. "
            + "Calling it twice for the same contact on the same day returns the existing experience.",
        inputSchema: {
            email: z.string().email().optional().describe("Customer email. Email or phone is required."),
            phoneNumber: z.string().optional().describe("Customer phone, E.164 (+33612345678) or French national format"),
            firstName: z.string().max(100).optional(),
            lastName: z.string().max(100).optional(),
            language: z.string().max(10).optional().describe("ISO 639-1 code, default: fr"),
            completedAt: dateTime.optional().describe("When the customer was served. Default: now."),
            startedAt: dateTime.optional(),
            externalLocationId: z.string().optional()
                .describe("Your location identifier. Default: the one given in the connector URL."),
            contactExtraData: extraData.describe("Extra fields stored on the contact"),
            experienceExtraData: extraData.describe("Extra fields stored on the experience (e.g. order number)"),
        },
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async (input) => {
        try {
            if (!input.email && !input.phoneNumber) {
                return toolError(new GuestSuiteError("Indiquez au moins un e-mail ou un numéro de téléphone.", 400));
            }
            const externalLocationId = input.externalLocationId || location;
            if (!externalLocationId) {
                return toolError(new GuestSuiteError(
                    "Établissement manquant : passez externalLocationId, ou ajoutez ?location=... à l'URL du connecteur.", 400,
                ));
            }
            const { contact, created: contactCreated } = await client.createContact({
                email: input.email ?? null,
                phoneNumber: input.phoneNumber ?? null,
                firstName: input.firstName ?? null,
                lastName: input.lastName ?? null,
                language: input.language ?? "fr",
                externalLocationId,
                extraData: input.contactExtraData ?? [],
            });
            const { experience, created: experienceCreated } = await client.createExperience({
                contactUuid: contact.uuid,
                completedAt: input.completedAt ?? new Date().toISOString(),
                startedAt: input.startedAt ?? null,
                extraData: input.experienceExtraData ?? [],
            });
            return ok({
                contactUuid: contact.uuid,
                contactCreated,
                experienceUuid: experience.uuid,
                experienceCreated,
                experienceStatus: experience.status ?? null,
                completedAt: experience.completedAt ?? null,
            });
        }
        catch (error) {
            return toolError(error);
        }
    });

    server.registerTool("update_contact", {
        title: "Update a contact",
        description: "Update a contact already sent to Guest Suite. Only the fields you pass are changed; "
            + "pass null to clear a field.",
        inputSchema: {
            uuid: z.string().uuid().describe("Contact UUID returned by request_review"),
            firstName: z.string().max(255).nullable().optional(),
            lastName: z.string().max(255).nullable().optional(),
            language: z.string().max(10).nullable().optional(),
            extraData: extraData,
        },
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ uuid, ...fields }) => {
        try {
            const contact = await client.updateContact(uuid, fields);
            return ok({ contactUuid: contact?.uuid ?? uuid, updated: true });
        }
        catch (error) {
            return toolError(error);
        }
    });

    server.registerTool("update_experience", {
        title: "Update an experience",
        description: "Update the extra data of an experience already sent to Guest Suite. "
            + "Its date and status cannot be changed.",
        inputSchema: {
            uuid: z.string().uuid().describe("Experience UUID returned by request_review"),
            extraData: extraData,
        },
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, async ({ uuid, ...fields }) => {
        try {
            const experience = await client.updateExperience(uuid, fields);
            return ok({ experienceUuid: experience?.uuid ?? uuid, updated: true });
        }
        catch (error) {
            return toolError(error);
        }
    });
}

/**
 * Version compacte d'un avis de la Widget API.
 * @param {Object} r - ReviewIndexDTO
 */
function toReview (r) {
    return {
        uuid: r.reviewUuid,
        id: r.id,
        rating: r.global_rate ?? null,
        title: r.title ?? null,
        comment: r.comment ?? null,
        author: r.user_name ?? null,
        language: r.language_code ?? null,
        experienceDate: r.experience_date ?? null,
        createdAt: r.creation_date ?? null,
        publishedAt: r.publication_date ?? null,
        ratings: r.ratings ?? [],
        responses: r.responses ?? [],
        authenticityUrl: r.authenticity_url ?? null,
        location: {
            uuid: r.locationUuid ?? null,
            id: r.establishment_id ?? null,
            name: r.establishment_name ?? null,
        },
        experienceExtraData: r.experience_extra_data ?? {},
        contactExtraData: r.contact_extra_data ?? {},
    };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format attendu : AAAA-MM-JJ");

/**
 * Outils de la Widget Reviews API (lecture des avis publiés vers le widget).
 * @param {McpServer} server
 * @param {ReturnType<typeof createWidgetClient>} client
 */
function registerWidgetTools (server, client) {
    server.registerTool("list_reviews", {
        title: "List published reviews",
        description: "List the reviews published to your Guest Suite widget (your website), most recent first, "
            + "with rating (out of 10), comment, author, owner responses and the extra data sent with the review request.",
        inputSchema: {
            location: z.string().optional().describe("Location UUID or your client identifier. Default: every location of the token."),
            from: day.optional().describe("Start date (YYYY-MM-DD)"),
            to: day.optional().describe("End date (YYYY-MM-DD)"),
            language: z.string().length(2).optional().describe("ISO 639-1 language code"),
            page: z.number().int().min(0).optional().describe("Page number, starting at 0. Default: 0"),
            pageSize: z.number().int().min(1).max(2000).optional().describe("Reviews per page (max 2000). Default: 50"),
            fromId: z.number().int().optional().describe("Only reviews from this review id (incremental sync)"),
            toId: z.number().int().optional().describe("Only reviews up to this review id"),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ page = 0, pageSize = 50, ...filters }) => {
        try {
            const data = await client.listReviews({ ...filters, page, pageSize });
            const reviews = (data?.reviews ?? []).map(toReview);
            return ok({ page: data?.page ?? page, count: reviews.length, pageSize: data?.max_count ?? pageSize, reviews });
        }
        catch (error) {
            return toolError(error);
        }
    });

    server.registerTool("get_review_stats", {
        title: "Get review statistics",
        description: "Average rating (out of 10) and number of reviews published to your widget, "
            + "for one location or for every location of the token.",
        inputSchema: {
            location: z.string().optional().describe("Location UUID or your client identifier. Default: every location of the token."),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ location }) => {
        try {
            if (!location) {
                const s = await client.getStatistics();
                return ok({ location: null, averageRate: s?.average_rate ?? null, total: s?.total ?? 0 });
            }
            const l = await client.getLocation(location);
            return ok({
                location: { uuid: l?.locationUuid ?? null, id: l?.establishment_id ?? null, name: l?.establishment_name ?? null },
                averageRate: l?.average_rate ?? null,
                total: l?.total_reviews ?? 0,
            });
        }
        catch (error) {
            return toolError(error);
        }
    });
}
