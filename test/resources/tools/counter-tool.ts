/**
 * A stateful counter tool fixture.
 *
 * Useful for testing that tools actually execute and that call counts can be
 * verified. Call `resetCallCount()` in `beforeEach` to keep tests isolated.
 */

import type { Tool } from "clawtools";

let _callCount = 0;

export const counterTool: Tool = {
    name: "counter",
    label: "Counter",
    description: "Counts how many times it has been called. Optionally resets the count.",
    parameters: {
        type: "object",
        properties: {
            reset: { type: "boolean", description: "If true, reset the counter before incrementing" },
        },
    },
    execute: async (_id, params) => {
        if (params.reset === true) _callCount = 0;
        _callCount++;
        return {
            content: [{ type: "text" as const, text: `Call #${_callCount}` }],
            details: { count: _callCount },
        };
    },
};

/** Return the current call count (does not increment). */
export function getCallCount(): number {
    return _callCount;
}

/** Reset the call count to zero. */
export function resetCallCount(): void {
    _callCount = 0;
}
