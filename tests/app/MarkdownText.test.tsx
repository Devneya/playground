import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { MarkdownText } from "../../src/features/canvas/MarkdownText";

it("renders common Markdown blocks and inline formatting", () => {
  render(<MarkdownText text={'# Heading\n\nA **bold** and *italic* sentence with [a safe link](https://example.com/docs).\n\n- First\n- Second\n\n3. Third\n4. Fourth\n\n> Quoted text\n\n| Name | Count |\n|:---|---:|\n| Apples | 2 |'} />);

  expect(screen.getByRole("heading", { level: 1, name: "Heading" })).toBeInTheDocument();
  expect(screen.getByText("bold").tagName).toBe("STRONG");
  expect(screen.getByText("italic").tagName).toBe("EM");
  expect(screen.getByRole("link", { name: "a safe link" })).toHaveAttribute("href", "https://example.com/docs");
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["First", "Second", "Third", "Fourth"]);
  expect(screen.getAllByRole("list").map((list) => list.tagName)).toEqual(["UL", "OL"]);
  expect(screen.getAllByRole("list")[1]).toHaveAttribute("start", "3");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("blockquote").textContent).toBe("Quoted text");
  expect(screen.getByRole("cell", { name: "Apples" })).toBeInTheDocument();
});

it("preserves code fence spacing and line breaks", () => {
  const source = "```text\n  first  \n\tsecond\n\n```";
  const { container } = render(<MarkdownText text={source} />);

  expect(container.querySelector("pre.nowheel code")?.textContent).toBe("  first  \n\tsecond\n");
});

it("keeps raw HTML, unsafe links, and Markdown images inert", () => {
  const { container } = render(<MarkdownText text={'<script>window.pwned = true</script>\n\n[run](javascript:alert(1))\n\n![remote](https://example.com/image.png)'} />);

  expect(container.querySelector("script, img")).toBeNull();
  expect(container.querySelector("a[href^='javascript:']")).toBeNull();
  expect(container.textContent).toContain("<script>window.pwned = true</script>");
  expect(container.textContent).toContain("[run](javascript:alert(1))");
  expect(container.textContent).toContain("![remote](https://example.com/image.png)");
  expect(within(container).queryByRole("link", { name: "run" })).toBeNull();
});
