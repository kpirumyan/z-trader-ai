const { readFileSync } = require("node:fs");

const messagePath = process.argv[2];

if (!messagePath) {
  console.error("Usage: check-commit-message <message-file>");
  process.exit(2);
}

const message = readFileSync(messagePath, "utf8");

if (/\p{Script=Cyrillic}/u.test(message)) {
  console.error("Commit messages must be in English; Cyrillic characters are not allowed.");
  process.exit(1);
}
