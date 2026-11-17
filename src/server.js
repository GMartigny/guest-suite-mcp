// Serveur MCP : expose l'Experience API de Guest Suite sous forme d'outils.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createClient, GuestSuiteError } from "./guest-suite.js";

export const SERVER_INFO = { name: "guest-suite-mcp", version: "1.0.0" };

const extraData = z.array(z.object({
    name: z.string().min(1).describe("Field name (matched case- and accent-insensitively by Guest Suite)"),
    value: z.union([z.string(), z.number()]).describe("Value, stored as a string (max 254 characters)"),
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
 * @param {string} options.token - Token Guest Suite de l'utilisateur
 * @param {string} [options.location] - externalLocationId par défaut
 * @param {string} [options.apiUrl] - URL de l'API Guest Suite
 * @param {typeof fetch} [options.fetch] - Implémentation de fetch (tests)
 * @returns {McpServer}
 */
export function buildServer ({ token, location, apiUrl, fetch }) {
    const client = createClient({ token, apiUrl, fetch });
    const server = new McpServer(SERVER_INFO);

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

    return server;
}
