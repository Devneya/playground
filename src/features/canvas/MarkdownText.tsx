import { Fragment, type ReactNode } from "react";

type BlockList = { kind: "unordered" | "ordered"; start: number; items: string[] };

const tokenPatternSource = String.raw`!\[([^\]]*)\]\((<[^>]*>|[^)\s]+)(?:\s+"([^"]*)")?\)|\[([^\]]+)\]\((<[^>]*>|[^)\s]+)(?:\s+"([^"]*)")?\)|(\x60+)([\s\S]*?)\7|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_`;
const capture = (match: RegExpExecArray, index: number) => match[index] ?? "";
const lineAt = (lines: string[], index: number) => lines[index] ?? "";

const safeHref = (value: string) => {
  const href = value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1) : value;
  const hasUnsafeCharacter = [...href].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f || character === "\\" || /\s/u.test(character);
  });
  if (!href || hasUnsafeCharacter || href.startsWith("//")) return undefined;

  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme !== "http" && scheme !== "https") return undefined;
    try {
      const parsed = new URL(href);
      return parsed.protocol === `${scheme}:` && parsed.hostname ? href : undefined;
    } catch {
      return undefined;
    }
  }

  // Path, query, and fragment links are resolved by the current page and cannot select a new scheme.
  return href;
};

const renderInline = (text: string, keyPrefix = "inline"): ReactNode[] => {
  const result: ReactNode[] = [];
  const tokenPattern = new RegExp(tokenPatternSource, "g");
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) result.push(<Fragment key={`${keyPrefix}-${key++}`}>{text.slice(cursor, match.index)}</Fragment>);

    const source = match[0];
    if (match[1] !== undefined) {
      // Markdown images stay visible as text. This renderer never fetches remote content.
      result.push(<Fragment key={`${keyPrefix}-${key++}`}>{source}</Fragment>);
    } else if (match[4] !== undefined) {
      const href = safeHref(capture(match, 5));
      result.push(href
        ? <a key={`${keyPrefix}-${key++}`} href={href} title={match[6]}>{renderInline(capture(match, 4), `${keyPrefix}-${key}`)}</a>
        : <Fragment key={`${keyPrefix}-${key++}`}>{source}</Fragment>);
    } else if (match[7] !== undefined) {
      result.push(<code key={`${keyPrefix}-${key++}`}>{capture(match, 8).replace(/\n/g, " ")}</code>);
    } else if (match[9] !== undefined || match[10] !== undefined) {
      result.push(<strong key={`${keyPrefix}-${key++}`}>{renderInline(capture(match, 9) || capture(match, 10), `${keyPrefix}-${key}`)}</strong>);
    } else if (match[11] !== undefined) {
      result.push(<del key={`${keyPrefix}-${key++}`}>{renderInline(capture(match, 11), `${keyPrefix}-${key}`)}</del>);
    } else {
      result.push(<em key={`${keyPrefix}-${key++}`}>{renderInline(capture(match, 12) || capture(match, 13), `${keyPrefix}-${key}`)}</em>);
    }
    cursor = match.index + source.length;
  }

  if (cursor < text.length) result.push(<Fragment key={`${keyPrefix}-${key}`}>{text.slice(cursor)}</Fragment>);
  return result;
};

const heading = (line: string) => /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
const unorderedItem = (line: string) => /^ {0,3}([-+*])[ \t]+(.*)$/.exec(line);
const orderedItem = (line: string) => /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/.exec(line);
const isRule = (line: string) => /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
const fenceOpening = (line: string) => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);

const tableCells = (line: string) => {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
};

const tableAlignment = (line: string) => {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
    ? cells.map((cell) => cell.startsWith(":") ? (cell.endsWith(":") ? "center" : "left") : (cell.endsWith(":") ? "right" : undefined))
    : undefined;
};

const looksLikeBlockStart = (lines: string[], index: number) => {
  const line = lineAt(lines, index);
  return !line.trim() || heading(line) !== null || fenceOpening(line) !== null || /^ {0,3}>/.test(line)
    || unorderedItem(line) !== null || orderedItem(line) !== null || isRule(line)
    || (index + 1 < lines.length && line.includes("|") && tableAlignment(lineAt(lines, index + 1)) !== undefined);
};

const readList = (lines: string[], startIndex: number): { list: BlockList; nextIndex: number } => {
  const firstLine = lineAt(lines, startIndex);
  const first = unorderedItem(firstLine) ?? orderedItem(firstLine);
  const kind = unorderedItem(firstLine) ? "unordered" : "ordered";
  const ordered = kind === "ordered" ? first as RegExpExecArray : undefined;
  const list: BlockList = {
    kind,
    start: ordered ? Number(ordered[1]) : 1,
    items: [],
  };
  let index = startIndex;

  while (index < lines.length) {
    const item = kind === "unordered" ? unorderedItem(lineAt(lines, index)) : orderedItem(lineAt(lines, index));
    if (item) {
      list.items.push(capture(item, 2));
      index += 1;
      while (index < lines.length && /^ {2,}\S/.test(lineAt(lines, index)) && !unorderedItem(lineAt(lines, index)) && !orderedItem(lineAt(lines, index))) {
        list.items[list.items.length - 1] = `${list.items[list.items.length - 1] ?? ""} ${lineAt(lines, index).trim()}`;
        index += 1;
      }
      continue;
    }
    if (!lineAt(lines, index).trim() && index + 1 < lines.length
      && (kind === "unordered" ? unorderedItem(lineAt(lines, index + 1)) : orderedItem(lineAt(lines, index + 1)))) {
      index += 1;
      continue;
    }
    break;
  }

  return { list, nextIndex: index };
};

const renderBlocks = (lines: string[], keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lineAt(lines, index);
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = fenceOpening(line);
    if (fence) {
      const fenceText = capture(fence, 1);
      const fenceChar = fenceText[0] ?? "`";
      const fenceLength = fenceText.length;
      const close = new RegExp(`^ {0,3}${fenceChar}{${fenceLength},}[ \\t]*$`);
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !close.test(lineAt(lines, index))) {
        codeLines.push(lineAt(lines, index));
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(<pre key={`${keyPrefix}-${key++}`} className="nowheel"><code>{codeLines.join("\n")}</code></pre>);
      continue;
    }

    const headingMatch = heading(line);
    if (headingMatch) {
      const level = capture(headingMatch, 1).length;
      const content = renderInline(capture(headingMatch, 2), `${keyPrefix}-h${key}`);
      const headingKey = `${keyPrefix}-${key++}`;
      const headingNode = level === 1 ? <h1 key={headingKey}>{content}</h1>
        : level === 2 ? <h2 key={headingKey}>{content}</h2>
          : level === 3 ? <h3 key={headingKey}>{content}</h3>
            : level === 4 ? <h4 key={headingKey}>{content}</h4>
              : level === 5 ? <h5 key={headingKey}>{content}</h5>
                : <h6 key={headingKey}>{content}</h6>;
      nodes.push(headingNode);
      index += 1;
      continue;
    }

    if (isRule(line)) {
      nodes.push(<hr key={`${keyPrefix}-${key++}`} />);
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lineAt(lines, index))) {
        quoteLines.push(lineAt(lines, index).replace(/^ {0,3}>[ \t]?/, ""));
        index += 1;
      }
      nodes.push(<blockquote key={`${keyPrefix}-${key++}`}>{renderBlocks(quoteLines, `${keyPrefix}-quote${key}`)}</blockquote>);
      continue;
    }

    if (unorderedItem(line) || orderedItem(line)) {
      const { list, nextIndex } = readList(lines, index);
      const listKey = `${keyPrefix}-${key++}`;
      nodes.push(list.kind === "ordered"
        ? <ol key={listKey} start={list.start}>{list.items.map((item, itemIndex) => <li key={`${listKey}-${itemIndex}`}>{renderInline(item, `${listKey}-${itemIndex}`)}</li>)}</ol>
        : <ul key={listKey}>{list.items.map((item, itemIndex) => <li key={`${listKey}-${itemIndex}`}>{renderInline(item, `${listKey}-${itemIndex}`)}</li>)}</ul>);
      index = nextIndex;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|")) {
      const alignments = tableAlignment(lineAt(lines, index + 1));
      if (alignments) {
        const headers = tableCells(line);
        const body: string[][] = [];
        index += 2;
        while (index < lines.length && lineAt(lines, index).includes("|") && lineAt(lines, index).trim()) {
          body.push(tableCells(lineAt(lines, index)));
          index += 1;
        }
        const tableKey = `${keyPrefix}-${key++}`;
        const alignStyle = (cellIndex: number) => alignments[cellIndex] ? { textAlign: alignments[cellIndex] as "left" | "center" | "right" } : undefined;
        nodes.push(<table key={tableKey} className="markdown-table">
          <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex} style={alignStyle(cellIndex)}>{renderInline(cell, `${tableKey}-h${cellIndex}`)}</th>)}</tr></thead>
          <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex} style={alignStyle(cellIndex)}>{renderInline(row[cellIndex] ?? "", `${tableKey}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
        </table>);
        continue;
      }
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && !looksLikeBlockStart(lines, index)) {
      paragraph.push(lineAt(lines, index));
      index += 1;
    }
    nodes.push(<p key={`${keyPrefix}-${key++}`}>{renderInline(paragraph.join("\n"), `${keyPrefix}-p${key}`)}</p>);
  }

  return nodes;
};

// This intentionally builds React elements from plain text instead of parsing or injecting HTML.
export const MarkdownText = ({ text }: { text: string }) => (
  <div className="markdown-text">{renderBlocks(text.split(/\r?\n/), "markdown")}</div>
);
