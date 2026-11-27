type Value = number | string | boolean;
type Expression = (read: (index: number) => Value) => Value;

export function columnReference(name: string) {
  return "[" + name.replaceAll("]", "]]") + "]";
}

const tokenPattern =
  /\s*(?:(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|\[((?:[^\]]|\]\])*)\]|"((?:[^"]|"")*)"|([a-zA-Z]+)|(<=|>=|<>|!=|==|[+*/^(),=<>-]))/y;
const precedence: Record<string, number> = {
  "=": 1,
  "==": 1,
  "<>": 1,
  "!=": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "+": 2,
  "-": 2,
  "*": 3,
  "/": 3,
  "^": 5,
};

function numeric(value: Value): number {
  if (typeof value === "string") throw new Error("Expected a number.");
  return Number(value);
}

function logical(value: Value): boolean {
  return numeric(value) !== 0;
}

function finite(value: number) {
  if (!Number.isFinite(value))
    throw new Error("The calculation produced a non-finite number.");
  return value;
}

function binary(op: string, left: Value, right: Value): Value {
  const a = typeof left === "boolean" ? Number(left) : left;
  const b = typeof right === "boolean" ? Number(right) : right;
  if (op === "=" || op === "==") return a === b;
  if (op === "<>" || op === "!=") return a !== b;
  if (op === "<") return numeric(a) < numeric(b);
  if (op === ">") return numeric(a) > numeric(b);
  if (op === "<=") return numeric(a) <= numeric(b);
  if (op === ">=") return numeric(a) >= numeric(b);
  const x = numeric(a),
    y = numeric(b);
  if (op === "/" && y === 0) throw new Error("Division by zero.");
  return finite(
    op === "+"
      ? x + y
      : op === "-"
        ? x - y
        : op === "*"
          ? x * y
          : op === "/"
            ? x / y
            : x ** y,
  );
}

export function compileFormula(
  source: string,
  headers: string[],
  isNumericColumn: (index: number) => boolean,
  missing: string[],
) {
  const input = source.trim().replace(/^=/, "").trim();
  if (input.length > 2000)
    throw new Error("Use a formula of at most 2,000 characters.");
  const tokens: {
    kind: "number" | "column" | "text" | "word" | "op";
    value: string;
  }[] = [];
  for (let pos = 0; pos < input.length;) {
    tokenPattern.lastIndex = pos;
    const m = tokenPattern.exec(input);
    if (!m)
      throw new Error(
        "Unexpected formula text at character " + (pos + 1) + ".",
      );
    pos = tokenPattern.lastIndex;
    if (m[1]) tokens.push({ kind: "number", value: m[1] + (m[2] ?? "") });
    else if (m[3] !== undefined)
      tokens.push({ kind: "column", value: m[3].replaceAll("]]", "]") });
    else if (m[4] !== undefined)
      tokens.push({ kind: "text", value: m[4].replaceAll('""', '"') });
    else if (m[5]) tokens.push({ kind: "word", value: m[5].toUpperCase() });
    else tokens.push({ kind: "op", value: m[6] });
  }
  let cursor = 0;
  const references = new Map<number, boolean>();
  function peek(value: string) {
    return tokens[cursor]?.kind === "op" && tokens[cursor].value === value;
  }
  function take(value: string) {
    if (!peek(value)) throw new Error("Expected “" + value + "”.");
    cursor++;
  }
  function expression(min: number, depth: number): Expression {
    if (depth > 64) throw new Error("The formula is nested too deeply.");
    const token = tokens[cursor++];
    if (!token) throw new Error("Expected a value or column.");
    let left: Expression;
    if (token.kind === "number") {
      const value = finite(Number(token.value));
      left = () => value;
    } else if (token.kind === "text") left = () => token.value;
    else if (token.kind === "column") {
      const index = headers.indexOf(token.value);
      if (index < 0) throw new Error("Unknown column “" + token.value + "”.");
      if (!references.has(index)) references.set(index, isNumericColumn(index));
      left = (read) => read(index);
    } else if (
      token.kind === "op" &&
      (token.value === "+" || token.value === "-")
    ) {
      const operand = expression(4, depth + 1);
      left = (read) => (token.value === "-" ? -1 : 1) * numeric(operand(read));
    } else if (token.kind === "op" && token.value === "(") {
      left = expression(1, depth + 1);
      take(")");
    } else if (token.kind === "word") {
      const name = token.value;
      if (name === "TRUE" || name === "FALSE") left = () => name === "TRUE";
      else {
        if (!["IF", "AND", "OR", "NOT"].includes(name))
          throw new Error("Unknown function “" + name + "”.");
        take("(");
        const args = [expression(1, depth + 1)];
        while (peek(",")) {
          cursor++;
          args.push(expression(1, depth + 1));
        }
        take(")");
        if (
          (name === "IF" && args.length !== 3) ||
          (name === "NOT" && args.length !== 1)
        )
          throw new Error(
            name +
              (name === "IF"
                ? " needs three arguments."
                : " needs one argument."),
          );
        left = (read) => {
          if (name === "IF")
            return (logical(args[0](read)) ? args[1] : args[2])(read);
          const flags = args.map((arg) => logical(arg(read)));
          if (name === "AND") return flags.every(Boolean);
          if (name === "OR") return flags.some(Boolean);
          return !flags[0];
        };
      }
    } else throw new Error("Expected a value or column.");
    while (tokens[cursor]?.kind === "op") {
      const op = tokens[cursor].value;
      const rank = Object.hasOwn(precedence, op) ? precedence[op] : 0;
      if (rank < min) break;
      cursor++;
      const previous = left;
      const right = expression(rank + (op === "^" ? 0 : 1), depth + 1);
      left = (read) => binary(op, previous(read), right(read));
    }
    return left;
  }
  const evaluate = expression(1, 0);
  if (cursor < tokens.length)
    throw new Error("Unexpected text after the expression.");
  const missingTokens = new Set(["", ...missing]);
  return {
    references: [...references.keys()],
    value: evaluate,
    cell(row: string[]) {
      const value = evaluate((index) => {
        const raw = row[index];
        if (missingTokens.has(raw))
          throw new Error("Missing value in " + headers[index] + ".");
        return references.get(index) ? finite(Number(raw)) : raw;
      });
      return typeof value === "boolean" ? String(Number(value)) : String(value);
    },
  };
}
