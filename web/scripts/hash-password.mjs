#!/usr/bin/env node
// Generate a bcrypt hash for APP_PASSWORD_HASH. Usage:
//   node scripts/hash-password.mjs
// Or pipe in a password:
//   echo -n 'my-password' | node scripts/hash-password.mjs
// Prints the hash to stdout.

import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline';

async function readPassword() {
  if (!process.stdin.isTTY) {
    // Piped input
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8').replace(/\n$/, '');
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    process.stderr.write('Password: ');
    rl.question('', (pw) => {
      rl.close();
      resolve(pw);
    });
  });
}

const pw = await readPassword();
if (!pw) {
  console.error('No password provided.');
  process.exit(1);
}
if (pw.length < 10) {
  console.error('Warning: password is shorter than 10 characters.');
}
const hash = await bcrypt.hash(pw, 12);
console.log(hash);
