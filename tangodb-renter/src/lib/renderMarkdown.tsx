import { Fragment, type ReactNode } from "react";

function inlineFormat(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-b-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={`${keyPrefix}-t-${index}`}>{part}</Fragment>;
  });
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      nodes.push(
        <pre
          key={`code-${index}`}
          className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (trimmed.startsWith("# ")) {
      nodes.push(
        <h1 key={`h1-${index}`} className="text-lg font-bold text-slate-900">
          {inlineFormat(trimmed.slice(2), `h1-${index}`)}
        </h1>
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      nodes.push(
        <h2 key={`h2-${index}`} className="mt-4 text-base font-semibold text-slate-900">
          {inlineFormat(trimmed.slice(3), `h2-${index}`)}
        </h2>
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      nodes.push(
        <h3 key={`h3-${index}`} className="mt-3 text-sm font-semibold text-slate-800">
          {inlineFormat(trimmed.slice(4), `h3-${index}`)}
        </h3>
      );
      index += 1;
      continue;
    }

    if (trimmed === "---") {
      nodes.push(<hr key={`hr-${index}`} className="my-4 border-slate-200" />);
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      nodes.push(
        <blockquote
          key={`quote-${index}`}
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={quoteIndex} className={quoteIndex > 0 ? "mt-1" : undefined}>
              {inlineFormat(quoteLine, `q-${index}-${quoteIndex}`)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (trimmed.startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = parseTableRow(trimmed);
      index += 2;
      const body: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        body.push(parseTableRow(lines[index]));
        index += 1;
      }
      nodes.push(
        <div key={`table-${index}`} className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex} className="px-3 py-2 font-semibold">
                    {inlineFormat(cell, `th-${index}-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-slate-100">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top text-slate-700">
                      {inlineFormat(cell, `td-${index}-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().slice(2));
        index += 1;
      }
      nodes.push(
        <ul key={`ul-${index}`} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inlineFormat(item, `li-${index}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (trimmed.startsWith("*") && trimmed.endsWith("*") && !trimmed.startsWith("**")) {
      nodes.push(
        <p key={`em-${index}`} className="text-xs italic text-slate-500">
          {trimmed.slice(1, -1)}
        </p>
      );
      index += 1;
      continue;
    }

    nodes.push(
      <p key={`p-${index}`} className="text-sm leading-relaxed text-slate-700">
        {inlineFormat(trimmed, `p-${index}`)}
      </p>
    );
    index += 1;
  }

  return nodes;
}
