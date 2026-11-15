// Rule 24: every JSON this lab shows goes through the shared JsonPane (Form | JSON, full view, important keys stood out).
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TokenBlock from "./components/TokenBlock";
import WireItem from "./components/WireItem";
import { DecodeProvider } from "./components/DecodeContext";
import { wireMessages } from "./wireHop";
import { setJsonView } from "./components/JsonPane.jsx";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: "https://issuer.example", sub: "u1", act: { sub: "app-1" }, nbf: 1760000000, exp: 1760003600 })}.c2ln`;

beforeEach(() => { setJsonView("form"); });

const ev = { measured: { label: "MEASURED", note: "Run live." } };
const BODY = '{"expRequired":true,"nbfRequired":false}';
const wireItem = {
  n: 1, key: "issuer", label: "POST /trustedIssuers", method: "POST", url: "https://api.pingone.example/trustedIssuers", status: 201, statusText: "Created", evidence: "measured", notes: "",
  curl: "curl -i -X POST 'https://api.pingone.example/trustedIssuers'", requestHeaders: [], requestBody: BODY, responseBody: '{"id":"abc"}',
  requestText: `POST /trustedIssuers HTTP/1.1\nHost: api.pingone.example\n\n${BODY}`,
  responseText: 'HTTP/1.1 201 Created\nContent-Type: application/json\n\n{\n  "id": "abc"\n}',
};

describe("wireMessages: one transcript per message", () => {
  it("splits a request and its response (and the next call), and leaves prose alone", () => {
    expect(wireMessages("POST /a HTTP/1.1\nHost: x\n\ngrant_type=a\n\nHTTP/1.1 200 OK\nDate: d\n\n{\"a\":1}\n\nGET /b HTTP/1.1\nHost: x")).toEqual([
      "POST /a HTTP/1.1\nHost: x\n\ngrant_type=a", 'HTTP/1.1 200 OK\nDate: d\n\n{"a":1}', "GET /b HTTP/1.1\nHost: x",
    ]);
    expect(wireMessages("Step prose.\n\nMore prose.")).toEqual(["Step prose.\n\nMore prose."]);
  });
});

describe("WireItem", () => {
  it("keeps the request line and headers as text and gives the JSON body a Form | JSON pane (the lab's own keys stand out)", async () => {
    render(<DecodeProvider><WireItem item={wireItem} evidence={ev} open /></DecodeProvider>);
    const req = screen.getByTestId("wire-issuer-request");
    expect(within(req).getByLabelText("Request 1 headers").textContent).toBe("POST /trustedIssuers HTTP/1.1\nHost: api.pingone.example");
    expect(within(req).getByRole("button", { name: "Form" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(req).getByRole("button", { name: "JSON" }));
    const pane = within(req).getByLabelText("Request 1 body");
    expect(pane.textContent).toBe(BODY); // exactly as sent
    expect([...pane.querySelectorAll(".jtok--hot")].map((n) => n.textContent)).toEqual(['"expRequired"', '"nbfRequired"']);
    expect(screen.getByTestId("wire-issuer-response")).toHaveTextContent('"id": "abc"'); // the JSON view is the shared choice for every pane
  });
});

describe("TokenBlock", () => {
  it("shows the header, the claims and the raw token as panes: Form first, the JSON text on the toggle, nothing scrolls", async () => {
    render(<TokenBlock label="Issued token" token={TOKEN} testId="issued" />);
    const payload = screen.getByTestId("issued-payload-box");
    expect(payload).toHaveAttribute("data-view", "form");
    expect(within(payload).getByText("nbf").closest("[data-hot]")).toHaveAttribute("data-hot", "true"); // this lab's own hot key
    expect(screen.getByTestId("issued-raw").textContent).toBe(TOKEN); // the raw token is whole, in three colors
    await userEvent.click(within(payload).getByRole("button", { name: "JSON" }));
    expect(screen.getByTestId("issued-payload")).toHaveTextContent('"sub": "u1"');
  });
});

describe("full view: the lab's own CSS never caps a JSON pane", () => {
  it("has no max-height or overflow auto|scroll on a rule that names json or pre", () => {
    const sheets = Object.entries(import.meta.glob(["./**/*.css", "!./standalone-ui.css", "!./**/JsonPane.css", "!./top-menu/*.css"], { query: "?raw", import: "default", eager: true }));
    expect(sheets.length).toBeGreaterThan(3);
    for (const [f, css] of sheets) {
      for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/json|\bpre\b/i.test(sel)) continue;
        expect(body, `${f}: ${sel.trim()}`).not.toMatch(/max-height|overflow(-[xy])?\s*:\s*(auto|scroll)/);
      }
    }
  });
});
