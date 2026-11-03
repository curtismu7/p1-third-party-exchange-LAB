import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ModeToggle from "./ModeToggle.jsx";

afterEach(cleanup);

describe("ModeToggle (rule 19)", () => {
  it("gate not passed: Mock is pressed and Real is disabled with the gate reasons", () => {
    render(<ModeToggle info={{ source: "mock", realAvailable: false, live: { requested: true, enabled: false, reasons: ["MODE is not live (set MODE=live)"] } }} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    const real = screen.getByTestId("mode-real");
    expect(real).toBeDisabled();
    expect(real.getAttribute("title")).toMatch(/gated off/);
    expect(real.getAttribute("title")).toMatch(/MODE is not live/);
  });

  it("no live request at all: Real is disabled with the set-MODE hint", () => {
    render(<ModeToggle info={{ source: "mock", realAvailable: false }} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-real").getAttribute("title")).toMatch(/MODE=live/);
  });

  it("hosted: Real is disabled saying the hosted build is Mock only", () => {
    render(<ModeToggle info={{ source: "mock", realAvailable: false, hosted: true }} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-real").getAttribute("title")).toBe("The hosted build is Mock only: live mode never runs there.");
  });

  it("gate passed: both buttons switch and the pressed one does nothing", () => {
    const picked = [];
    const { rerender } = render(<ModeToggle info={{ source: "mock", realAvailable: true }} onSelect={(s) => picked.push(s)} />);
    fireEvent.click(screen.getByTestId("mode-mock"));
    expect(picked).toEqual([]);
    fireEvent.click(screen.getByTestId("mode-real"));
    expect(picked).toEqual(["real"]);
    rerender(<ModeToggle info={{ source: "real", realAvailable: true }} onSelect={(s) => picked.push(s)} />);
    fireEvent.click(screen.getByTestId("mode-mock"));
    expect(picked).toEqual(["real", "mock"]);
  });
});
