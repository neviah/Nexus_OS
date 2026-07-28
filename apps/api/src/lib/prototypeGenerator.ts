export type GameSpec = {
  title: string;
  genre: string;
  target: "browser" | "desktop";
  loop: string;
  mechanics: string[];
  mood: string;
};

export type GeneratedProject = {
  files: Array<{ path: string; content: string }>;
  summary: string[];
};

export function buildPrototype(spec: GameSpec): GeneratedProject {
  const safeTitle = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "prototype";

  const files = [
    {
      path: `projects/${safeTitle}/README.md`,
      content: [
        `# ${spec.title}`,
        "",
        `Genre: ${spec.genre}`,
        `Target: ${spec.target}`,
        `Core loop: ${spec.loop}`,
        `Mechanics: ${spec.mechanics.join(", ")}`,
        `Mood: ${spec.mood}`,
        "",
        "This prototype is intentionally compact and deterministic.",
      ].join("\n"),
    },
    {
      path: `projects/${safeTitle}/src/main.js`,
      content: `
const state = {
  score: 0,
  time: 0,
  mode: "intro"
};

function start() {
  state.mode = "play";
  render();
}

function step(delta) {
  state.time += delta;
  if (state.time > 3 && state.mode === "play") {
    state.score += 1;
    state.time = 0;
  }
  render();
}

function render() {
  const output = document.getElementById("output");
  if (!output) return;
  output.innerHTML = \`
    <h1>\${spec.title}</h1>
    <p>Loop: \${spec.loop}</p>
    <p>Score: \${state.score}</p>
    <p>Mode: \${state.mode}</p>
    <p>Mechanics: \${spec.mechanics.join(" • ")}</p>
  \`;
}

document.addEventListener("DOMContentLoaded", () => {
  start();
  setInterval(() => step(1), 1000);
});
      `,
    },
    {
      path: `projects/${safeTitle}/index.html`,
      content: `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${spec.title}</title>
    <style>
      body { font-family: system-ui; padding: 2rem; background: #111; color: #f5f5f5; }
      #output { max-width: 720px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="output"></div>
    <script type="module" src="./src/main.js"></script>
  </body>
</html>
      `,
    },
  ];

  return {
    files,
    summary: [
      `Created a compact prototype scaffold for ${spec.title}`,
      "Included a browser entry point, a simple loop, and a readable summary",
      "Ready for additional mechanics and polish",
    ],
  };
}
