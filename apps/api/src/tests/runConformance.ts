import { readHarnessRegistry } from "../lib/harnessRegistry.js";
import { runHarnessConformance } from "../lib/conformance.js";

async function main() {
  const harnesses = await readHarnessRegistry();
  const results = await runHarnessConformance(harnesses);

  for (const result of results) {
    const heading = `${result.harnessName} (${result.harnessId}) ${result.score.passed}/${result.score.total}`;
    // eslint-disable-next-line no-console
    console.log(`\n${heading}`);
    for (const check of result.checks) {
      // eslint-disable-next-line no-console
      console.log(`  [${check.passed ? "PASS" : "FAIL"}] ${check.name} -> ${check.details}`);
    }
  }

  const failures = results.flatMap((result) => result.checks.filter((check) => !check.passed));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

void main();