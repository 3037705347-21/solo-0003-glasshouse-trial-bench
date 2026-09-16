/**
 * Minimal render harness: mounts the new roster components to static markup
 * inside the real WorkspaceProvider to catch runtime errors the type checker
 * cannot (Playwright's browser binaries are unavailable in this sandbox).
 * Not shipped.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { createSampleWorkspaceState } from "../src/state/sampleData";
import { WorkspaceProvider } from "../src/state/store";
import { NumberRulesDialog } from "../src/features/roster/NumberRulesDialog";
import { ImportAccessionsDialog } from "../src/features/roster/ImportAccessionsDialog";
import { CopyTrialDialog } from "../src/features/roster/CopyTrialDialog";
import { RosterForm } from "../src/features/roster/RosterForm";

const sample = createSampleWorkspaceState();

const store = new Map<string, string>();
store.set(
  "glasshouse-trial-bench:workspace:v1",
  JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    state: {
      ...sample,
      numberRules: [
        {
          id: "rule-ssr",
          name: "SSR 规则",
          scopeType: "trial",
          scopeValue: sample.trials[0].id,
          prefix: "SSR",
          datePart: "yearMonthDay",
          sequencePadding: 3,
          sequenceScope: "global",
          nextSequence: 1,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  }),
);
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  },
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: { localStorage: globalThis.localStorage },
  configurable: true,
});

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(WorkspaceProvider, null, node),
    ),
  );
}

const outputs: Array<[string, string]> = [
  [
    "NumberRulesDialog",
    render(
      createElement(NumberRulesDialog, {
        open: true,
        trialId: sample.trials[0].id,
        onClose: () => {},
      }),
    ),
  ],
  [
    "ImportAccessionsDialog",
    render(
      createElement(ImportAccessionsDialog, {
        open: true,
        trialId: sample.trials[0].id,
        onClose: () => {},
        onImported: () => {},
      }),
    ),
  ],
  [
    "CopyTrialDialog",
    render(
      createElement(CopyTrialDialog, {
        open: true,
        sourceTrialId: sample.trials[0].id,
        onClose: () => {},
        onCopied: () => {},
      }),
    ),
  ],
  [
    "RosterForm",
    render(
      createElement(RosterForm, {
        trialId: sample.trials[0].id,
        onSaved: () => {},
        onCancel: () => {},
      }),
    ),
  ],
];

for (const [name, markup] of outputs) {
  if (!markup.includes("dialog-panel") && name !== "RosterForm") {
    throw new Error(`${name} did not render its dialog`);
  }
  console.log(`ok: ${name} rendered (${markup.length} chars)`);
}

const rosterMarkup = outputs[3][1];
if (!rosterMarkup.includes("SSR 规则")) {
  throw new Error("RosterForm did not surface the matched rule name");
}
if (!rosterMarkup.includes("由规则")) {
  throw new Error("RosterForm did not surface the matched rule hint");
}
console.log("ok: RosterForm defaults to rule-generated number");

const rulesMarkup = outputs[0][1];
if (!rulesMarkup.includes("SSR 规则")) {
  throw new Error("NumberRulesDialog did not list seeded rule");
}
console.log("ok: NumberRulesDialog lists seeded rule");

console.log("\nAll render checks passed");
