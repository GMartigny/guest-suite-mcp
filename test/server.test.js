import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { readToken } from "../api/mcp.js";

const CONTACT = "8f3b2c1a-4d5e-4f6a-9b8c-0d1e2f3a4b5c";
const EXPERIENCE = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

/**
 * Faux Guest Suite : enregistre les appels et renvoie les réponses prévues.
 * @param {Object<string, {status: number, body: any}|Array>} routes - "METHOD /path" → réponse(s)
 */
function fakeFetch (routes) {
    const calls = [];
    const fetch = async (url, init) => {
        const key = `${init.method} ${new URL(url).pathname}`;
        calls.push({ key, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
        let reply = routes[key];
        if (Array.isArray(reply)) {
            reply = reply.shift();
        }
        if (!reply) {
            return new Response(JSON.stringify({ message: "not mocked" }), { status: 500 });
        }
        return new Response(JSON.stringify(reply.body), { status: reply.status });
    };
    return { fetch, calls };
}

async function connect (options) {
    const server = buildServer({ token: "secret-token", ...options });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
}

test("expose les outils de demande d'avis et de mise à jour", async () => {
    const client = await connect({ fetch: fakeFetch({}).fetch });
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ["list_locations", "request_review", "update_contact", "update_experience"]);
});

test("request_review crée le contact puis l'expérience", async () => {
    const { fetch, calls } = fakeFetch({
        "POST /api/contacts": { status: 201, body: { uuid: CONTACT } },
        "POST /api/experiences": { status: 201, body: { uuid: EXPERIENCE, status: "created", completedAt: "2026-11-17T13:00:00+00:00" } },
    });
    const client = await connect({ fetch, location: "SAPIN" });
    const result = await client.callTool({
        name: "request_review",
        arguments: { email: "client@example.com", firstName: "Jeanne", lastName: "Dupont", completedAt: "2026-11-17T14:00:00+01:00" },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, {
        contactUuid: CONTACT,
        contactCreated: true,
        experienceUuid: EXPERIENCE,
        experienceCreated: true,
        experienceStatus: "created",
        completedAt: "2026-11-17T13:00:00+00:00",
    });
    assert.equal(calls[0].headers["X-AUTH-TOKEN"], "secret-token");
    assert.equal(calls[0].body.externalLocationId, "SAPIN");
    assert.equal(calls[0].body.language, "fr");
    assert.ok(calls[0].body.trace, "trace obligatoire");
    assert.equal(calls[1].body.contactUuid, CONTACT);
    assert.equal(calls[1].body.completedAt, "2026-11-17T14:00:00+01:00");
});

test("request_review réutilise le contact et l'expérience existants (409)", async () => {
    const { fetch } = fakeFetch({
        "POST /api/contacts": { status: 409, body: { uuid: CONTACT } },
        "POST /api/experiences": { status: 409, body: { uuid: EXPERIENCE, status: "processed" } },
    });
    const client = await connect({ fetch, location: "SAPIN" });
    const result = await client.callTool({ name: "request_review", arguments: { email: "client@example.com" } });
    assert.equal(result.structuredContent.contactCreated, false);
    assert.equal(result.structuredContent.experienceCreated, false);
    assert.equal(result.structuredContent.experienceUuid, EXPERIENCE);
});

test("request_review exige un e-mail ou un téléphone, et un établissement", async () => {
    const { fetch, calls } = fakeFetch({});
    const client = await connect({ fetch });
    let result = await client.callTool({ name: "request_review", arguments: { firstName: "Jeanne" } });
    assert.equal(result.isError, true);
    result = await client.callTool({ name: "request_review", arguments: { email: "client@example.com" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /location/);
    assert.equal(calls.length, 0);
});

test("les erreurs Guest Suite sont renvoyées lisiblement", async () => {
    const { fetch } = fakeFetch({ "POST /api/contacts": { status: 403, body: { message: "Invalid token" } } });
    const client = await connect({ fetch, location: "SAPIN" });
    const result = await client.callTool({ name: "request_review", arguments: { email: "client@example.com" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /403.*Invalid token/);
});

test("update_experience rejoue une fois en cas de conflit", async () => {
    const { fetch, calls } = fakeFetch({
        [`PATCH /api/experiences/${EXPERIENCE}`]: [{ status: 409, body: { message: "conflict" } }, { status: 200, body: { uuid: EXPERIENCE } }],
    });
    const client = await connect({ fetch });
    const result = await client.callTool({ name: "update_experience", arguments: { uuid: EXPERIENCE, extraData: [{ name: "commande", value: "42" }] } });
    assert.equal(result.isError, undefined);
    assert.equal(calls.length, 2);
});

test("update_contact n'envoie que les champs fournis", async () => {
    const { fetch, calls } = fakeFetch({ [`PATCH /api/contacts/${CONTACT}`]: { status: 200, body: { uuid: CONTACT } } });
    const client = await connect({ fetch });
    await client.callTool({ name: "update_contact", arguments: { uuid: CONTACT, lastName: null } });
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["lastName", "trace"]);
    assert.equal(calls[0].body.lastName, null);
});

test("list_locations renvoie les externalLocationId du token", async () => {
    const { fetch, calls } = fakeFetch({
        "GET /api/locations": { status: 200, body: [{ uuid: CONTACT, name: "Mon Sapin de Bois", address: "Rezé", createdAt: "2026-01-01T00:00:00Z", externalLocationId: "SAPIN", isLicensed: true }] },
    });
    const client = await connect({ fetch, location: "SAPIN" });
    const result = await client.callTool({ name: "list_locations", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.locations[0].externalLocationId, "SAPIN");
    assert.equal(result.structuredContent.defaultLocation, "SAPIN");
    assert.equal(calls[0].body, undefined);
});

test("le token est lu dans l'en-tête, le Bearer ou l'URL", () => {
    assert.equal(readToken({ headers: { "x-auth-token": "a" }, query: { token: "z" } }), "a");
    assert.equal(readToken({ headers: { authorization: "Bearer b" } }), "b");
    assert.equal(readToken({ headers: {}, query: { token: "c" } }), "c");
    assert.equal(readToken({ headers: {}, query: {} }), undefined);
});
