// Each scenario: base = text at last commit C1; human = what the browser user typed since C1
// (applied as minimal splices, i.e. keystrokes); agent = blob the agent pushed on top of C1.
// ideal = what a careful human merger would produce (null when there is no single right answer).
export type Scenario = { name: string; base: string; human: string; agent: string; ideal: string | null };

const doc = `# Red Letter

Red Letter lets humans and agents edit the same markdown file.
Agents use git; humans use the browser.

## Install

Run the installer and sign in with GitHub.

## Usage

- open a link
- edit the file
- leave a comment

## FAQ

Q: Does it change my file?
A: No. Comments live outside the file.
`;

const rep = (s: string, a: string, b: string) => {
  if (!s.includes(a)) throw new Error(`missing: ${a}`);
  return s.replace(a, b);
};

export const scenarios: Scenario[] = [
  {
    name: "disjoint paragraphs",
    base: doc,
    human: rep(doc, "Run the installer", "Run the one-line installer"),
    agent: rep(doc, "- leave a comment", "- leave a comment\n- mention a teammate"),
    ideal: rep(rep(doc, "Run the installer", "Run the one-line installer"), "- leave a comment", "- leave a comment\n- mention a teammate"),
  },
  {
    name: "both append at EOF",
    base: doc,
    human: doc + "\n## Contact\n\nmail us\n",
    agent: doc + "\n## License\n\nMIT\n",
    ideal: null, // either order is fine, but sections must not interleave
  },
  {
    name: "same line, different words",
    base: doc,
    human: rep(doc, "edit the same markdown file", "edit the same Markdown file"),
    agent: rep(doc, "Red Letter lets humans", "Red Letter lets people"),
    ideal: rep(rep(doc, "edit the same markdown file", "edit the same Markdown file"), "Red Letter lets humans", "Red Letter lets people"),
  },
  {
    name: "agent rewrites sentence, human fixes typo in it",
    base: rep(doc, "Agents use git; humans use the browser.", "Agents use git; humans use teh browser."),
    human: doc,
    agent: rep(doc, "Agents use git; humans use the browser.", "Agents commit through git while people work in a web editor."),
    ideal: rep(doc, "Agents use git; humans use the browser.", "Agents commit through git while people work in a web editor."),
  },
  {
    name: "agent rewrites sentence, human appends to it",
    base: doc,
    human: rep(doc, "humans use the browser.", "humans use the browser, no install needed."),
    agent: rep(doc, "Agents use git; humans use the browser.", "Agents commit through git while people work in a web editor."),
    ideal: null, // true conflict
  },
  {
    name: "agent deletes section human is editing",
    base: doc,
    human: rep(doc, "Q: Does it change my file?", "Q: Does it ever change my file?"),
    agent: rep(doc, "## FAQ\n\nQ: Does it change my file?\nA: No. Comments live outside the file.\n", ""),
    ideal: null, // true conflict
  },
  {
    name: "agent moves section, human edits inside it",
    base: doc,
    human: rep(doc, "- edit the file", "- edit the file together"),
    agent: rep(
      rep(doc, "## Usage\n\n- open a link\n- edit the file\n- leave a comment\n\n", ""),
      "## Install",
      "## Usage\n\n- open a link\n- edit the file\n- leave a comment\n\n## Install",
    ),
    ideal: rep(
      rep(doc, "## Usage\n\n- open a link\n- edit the file\n- leave a comment\n\n", ""),
      "## Install",
      "## Usage\n\n- open a link\n- edit the file together\n- leave a comment\n\n## Install",
    ),
  },
  {
    name: "identical fix on both sides",
    base: rep(doc, "sign in with GitHub", "sign in with Github"),
    human: doc,
    agent: doc,
    ideal: doc,
  },
  {
    name: "agent reformats list markers, human edits item",
    base: doc,
    human: rep(doc, "- open a link", "- open a shared link"),
    agent: doc.replaceAll("\n- ", "\n* "),
    ideal: rep(doc.replaceAll("\n- ", "\n* "), "* open a link", "* open a shared link"),
  },
  {
    name: "agent CRLF->LF noop-ish rewrite (whole file churn)",
    base: doc.replaceAll("\n", "\r\n"),
    human: rep(doc, "leave a comment", "leave a margin note").replaceAll("\n", "\r\n"),
    agent: doc,
    ideal: rep(doc, "leave a comment", "leave a margin note"),
  },
  {
    name: "human types in a paragraph the agent extends",
    base: doc,
    human: rep(doc, "Comments live outside the file.", "Comments live outside the file, in git."),
    agent: rep(doc, "A: No. Comments live outside the file.\n", "A: No. Comments live outside the file.\nQ: Can agents read comments?\nA: Yes, via git.\n"),
    ideal: rep(doc, "A: No. Comments live outside the file.\n", "A: No. Comments live outside the file, in git.\nQ: Can agents read comments?\nA: Yes, via git.\n"),
  },
];
