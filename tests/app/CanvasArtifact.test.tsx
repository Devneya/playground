import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { artifactDocument, CanvasArtifact } from "../../src/features/canvas/CanvasArtifact";

it("isolates model code and requires a host gesture before creating a branch", () => {
  const explore = vi.fn();
  const { container, rerender } = render(<CanvasArtifact title="A compass" fallback="Choose a direction." exploredPrompts={[]} artifact={{ html: "<button>North</button>", height: 300 }} onExplore={explore} />);
  const frame = container.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.srcdoc).toContain("connect-src 'none'");
  expect(frame.srcdoc).toContain("form-action 'none'");
  const send = (source: MessageEventSource | null, data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", { source, data })));
  send(window, { type: "devneya:selection", prompt: "Forged" });
  send(frame.contentWindow, { type: "devneya:selection", prompt: "x".repeat(2001) });
  send(frame.contentWindow, { type: "devneya:selection", prompt: " " });
  send(frame.contentWindow, { type: "other", prompt: "Wrong" });
  expect(screen.queryByText("Explore this selection ↗")).toBeNull();
  send(frame.contentWindow, { type: "devneya:selection", prompt: "Explore north with my chosen assumptions." });
  expect(explore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Explore this selection/ }));
  expect(explore).toHaveBeenCalledExactlyOnceWith("Explore north with my chosen assumptions.");
  rerender(<CanvasArtifact title="A compass" fallback="Choose a direction." exploredPrompts={["Explore north with my chosen assumptions."]} artifact={{ html: "<button>North</button>", height: 300 }} onExplore={explore} />);
  expect(screen.getByRole("button", { name: /Opened on canvas/ })).toBeDisabled();
  rerender(<CanvasArtifact title="A compass" fallback="Choose a direction." exploredPrompts={[]} artifact={{ html: "<button>North</button>", height: 300 }} onExplore={explore} />);
  expect(screen.getByRole("button", { name: /Explore this selection/ })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Reset visual" }));
  expect(screen.queryByText("Explore north with my chosen assumptions.")).toBeNull();
  expect(artifactDocument("<p>Fallback</p>").indexOf("Content-Security-Policy")).toBeLessThan(artifactDocument("<p>Fallback</p>").indexOf("<p>Fallback"));
});


it("accepts bounded size messages only from its own frame", () => {
  const { container } = render(<CanvasArtifact title="Stage" fallback="Scene" exploredPrompts={[]} artifact={{ html: "<p>A scene</p>", height: 300 }} onExplore={vi.fn()} />);
  const frame = container.querySelector("iframe")!;
  const size = (source: MessageEventSource | null, height: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", { source, data: { type: "devneya:size", height } })));
  size(window, 800);
  expect(frame.style.height).toBe("300px");
  size(frame.contentWindow, 570);
  expect(frame.style.height).toBe("570px");
  size(frame.contentWindow, 900000);
  expect(frame.style.height).toBe("1200px");
  size(frame.contentWindow, -90);
  expect(frame.style.height).toBe("300px");
  size(frame.contentWindow, NaN);
  size(frame.contentWindow, "800");
  expect(frame.style.height).toBe("300px");
});
