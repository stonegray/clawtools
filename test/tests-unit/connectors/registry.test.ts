import { describe, it, expect, beforeEach } from "vitest";
import { ConnectorRegistry, resolveAuth } from "clawtools/connectors";
import { makeMockConnector } from "../../helpers/index.js";

describe("ConnectorRegistry", () => {
    let registry: ConnectorRegistry;

    beforeEach(() => {
        registry = new ConnectorRegistry();
    });

    // ---------------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------------

    describe("register", () => {
        it("registers a connector", () => {
            registry.register(makeMockConnector());
            expect(registry.has("mock-connector")).toBe(true);
            expect(registry.size).toBe(1);
        });

        it("indexes by provider", () => {
            registry.register(makeMockConnector());
            expect(registry.getByProvider("mock")).toBeDefined();
        });

        it("indexes by api transport", () => {
            registry.register(makeMockConnector());
            expect(registry.getByApi("openai-completions")).toHaveLength(1);
        });

        it("overwrites when the same ID is registered again", () => {
            registry.register(makeMockConnector());
            registry.register(makeMockConnector({ label: "Updated" }));
            expect(registry.size).toBe(1);
            expect(registry.get("mock-connector")!.label).toBe("Updated");
        });

        it("can register multiple connectors with different IDs", () => {
            registry.register(makeMockConnector({ id: "a", provider: "provA" }));
            registry.register(makeMockConnector({ id: "b", provider: "provB" }));
            expect(registry.size).toBe(2);
        });

        it("re-registering with the same ID but a different api transport clears the stale apiIndex (bug #2 fix)", () => {
            // Register with one api transport, then overwrite with a different one.
            // The old api slot must be cleaned up so getByApi doesn't return a
            // connector that no longer uses that transport.
            registry.register(makeMockConnector({ api: "openai-completions" }));
            expect(registry.getByApi("openai-completions")).toHaveLength(1);
            expect(registry.getByApi("anthropic-messages")).toHaveLength(0);

            // Overwrite with the same ID but a different api
            registry.register(makeMockConnector({ api: "anthropic-messages" }));

            // Old api entry must be gone
            expect(registry.getByApi("openai-completions")).toHaveLength(0);
            // New api entry must be present
            expect(registry.getByApi("anthropic-messages")).toHaveLength(1);
            // Size is still 1 — same ID, just overwritten
            expect(registry.size).toBe(1);
        });

        it("re-registering with the same ID but a different provider clears the stale providerIndex (bug #3 fix)", () => {
            // Register with one provider, then overwrite with a different provider name.
            // The old provider slot must be removed so getByProvider doesn't return
            // a connector that is no longer registered under that provider.
            registry.register(makeMockConnector({ provider: "provider-alpha" }));
            expect(registry.getByProvider("provider-alpha")).toBeDefined();

            // Overwrite with the same ID but a different provider
            registry.register(makeMockConnector({ provider: "provider-beta" }));

            // Old provider entry must be gone
            expect(registry.getByProvider("provider-alpha")).toBeUndefined();
            // New provider entry must be present and point to the connector
            expect(registry.getByProvider("provider-beta")).toBeDefined();
            expect(registry.getByProvider("provider-beta")?.id).toBe("mock-connector");
            // Size is still 1 — same ID, just overwritten
            expect(registry.size).toBe(1);
        });
    });

    // ---------------------------------------------------------------------------
    // Lookup
    // ---------------------------------------------------------------------------

    describe("get", () => {
        it("retrieves by ID", () => {
            const c = makeMockConnector();
            registry.register(c);
            expect(registry.get("mock-connector")).toStrictEqual(c);
        });

        it("returns undefined for unknown ID", () => {
            expect(registry.get("nope")).toBeUndefined();
        });
    });

    describe("getByProvider", () => {
        it("retrieves the connector for a provider", () => {
            registry.register(makeMockConnector());
            const c = registry.getByProvider("mock");
            expect(c?.id).toBe("mock-connector");
        });

        it("returns undefined for an unregistered provider", () => {
            expect(registry.getByProvider("anthropic")).toBeUndefined();
        });

        it("returns the most-recently-registered connector when same provider re-registered", () => {
            registry.register(makeMockConnector({ id: "old-mock" }));
            registry.register(makeMockConnector({ id: "new-mock" }));
            expect(registry.getByProvider("mock")?.id).toBe("new-mock");
        });
    });

    describe("getByApi", () => {
        it("returns all connectors for a transport", () => {
            registry.register(makeMockConnector({ id: "a", provider: "p1" }));
            registry.register(makeMockConnector({ id: "b", provider: "p2" }));
            expect(registry.getByApi("openai-completions")).toHaveLength(2);
        });

        it("returns empty array for unknown transport", () => {
            expect(registry.getByApi("anthropic-messages")).toHaveLength(0);
        });
    });

    describe("list", () => {
        it("returns all connectors", () => {
            registry.register(makeMockConnector({ id: "a", provider: "p1" }));
            registry.register(makeMockConnector({ id: "b", provider: "p2" }));
            expect(registry.list()).toHaveLength(2);
        });
    });

    describe("listProviders", () => {
        it("returns registered provider names", () => {
            registry.register(makeMockConnector({ id: "a", provider: "anthropic" }));
            registry.register(makeMockConnector({ id: "b", provider: "openai" }));
            const providers = registry.listProviders();
            expect(providers).toContain("anthropic");
            expect(providers).toContain("openai");
        });
    });

    // ---------------------------------------------------------------------------
    // Mutation
    // ---------------------------------------------------------------------------

    describe("unregister", () => {
        it("removes connector by ID", () => {
            registry.register(makeMockConnector());
            expect(registry.unregister("mock-connector")).toBe(true);
            expect(registry.has("mock-connector")).toBe(false);
            expect(registry.size).toBe(0);
        });

        it("cleans up provider index", () => {
            registry.register(makeMockConnector());
            registry.unregister("mock-connector");
            expect(registry.getByProvider("mock")).toBeUndefined();
        });

        it("cleans up api index", () => {
            registry.register(makeMockConnector());
            registry.unregister("mock-connector");
            expect(registry.getByApi("openai-completions")).toHaveLength(0);
        });

        it("returns false for unknown ID", () => {
            expect(registry.unregister("nope")).toBe(false);
        });
    });

    describe("clear", () => {
        it("empties all indexes", () => {
            registry.register(makeMockConnector({ id: "a", provider: "p1" }));
            registry.register(makeMockConnector({ id: "b", provider: "p2" }));
            registry.clear();
            expect(registry.size).toBe(0);
            expect(registry.list()).toHaveLength(0);
            expect(registry.listProviders()).toHaveLength(0);
            expect(registry.getByApi("openai-completions")).toHaveLength(0);
        });
    });
});

// =============================================================================
// resolveAuth
// =============================================================================

describe("resolveAuth", () => {
    it("returns undefined when nothing is available", () => {
        expect(resolveAuth("totally-unknown-provider-xyz")).toBeUndefined();
    });

    it("uses an explicit key at highest priority", () => {
        const auth = resolveAuth("anthropic", [], "explicit-key");
        expect(auth?.apiKey).toBe("explicit-key");
        expect(auth?.source).toBe("explicit");
        expect(auth?.mode).toBe("api-key");
    });

    it("reads from a named env var", () => {
        process.env._TEST_CONNECTOR_KEY = "env-key";
        try {
            const auth = resolveAuth("test", ["_TEST_CONNECTOR_KEY"]);
            expect(auth?.apiKey).toBe("env-key");
            expect(auth?.source).toBe("env:_TEST_CONNECTOR_KEY");
        } finally {
            delete process.env._TEST_CONNECTOR_KEY;
        }
    });

    it("falls back to the convention <PROVIDER>_API_KEY", () => {
        process.env._TESTPROVIDER_API_KEY = "convention-key";
        try {
            const auth = resolveAuth("_testprovider");
            expect(auth?.apiKey).toBe("convention-key");
            expect(auth?.source).toMatch(/_TESTPROVIDER_API_KEY/);
        } finally {
            delete process.env._TESTPROVIDER_API_KEY;
        }
    });

    it("prefers explicit key over env var", () => {
        process.env._TEST_KEY_PRIO = "env-value";
        try {
            const auth = resolveAuth("test", ["_TEST_KEY_PRIO"], "explicit");
            expect(auth?.apiKey).toBe("explicit");
        } finally {
            delete process.env._TEST_KEY_PRIO;
        }
    });

    it("returns mode=api-key for all code paths", () => {
        const auth1 = resolveAuth("test", [], "k");
        expect(auth1?.mode).toBe("api-key");

        process.env._MODE_TEST_API_KEY = "x";
        try {
            expect(resolveAuth("_mode_test")?.mode).toBe("api-key");
        } finally {
            delete process.env._MODE_TEST_API_KEY;
        }
    });
});
