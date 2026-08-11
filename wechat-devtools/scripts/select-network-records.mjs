#!/usr/bin/env node

import process from 'node:process';

const allowedTypes = new Set(['HTTP_REQUEST', 'HTTP_RESPONSE', 'any']);

function printHelp() {
  process.stdout.write(`Usage:
  node select-network-records.mjs --url-contains <text> [--type HTTP_RESPONSE]

Reads a wechatide JSON envelope or raw network result buffer from stdin and
returns only records whose type and detail.url match the requested values.
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function parseArgs(argv) {
  const options = {
    type: 'HTTP_RESPONSE',
    urlContains: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '--url-contains') {
      options.urlContains = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument.startsWith('--url-contains=')) {
      options.urlContains = argument.slice('--url-contains='.length);
      continue;
    }

    if (argument === '--type') {
      options.type = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument.startsWith('--type=')) {
      options.type = argument.slice('--type='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function getResultBuffer(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const envelope = JSON.parse(trimmed);
    if (
      envelope !== null
      && typeof envelope === 'object'
      && Object.prototype.hasOwnProperty.call(envelope, 'result')
    ) {
      return typeof envelope.result === 'string'
        ? envelope.result
        : JSON.stringify(envelope.result);
    }
  } catch {
    // The input may already be the raw result buffer.
  }

  return rawInput;
}

function selectRecords(buffer, options) {
  const expectedUrl = options.urlContains.toLocaleLowerCase('en-US');
  const matches = [];

  for (const line of buffer.split(/\r?\n/u)) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) {
      continue;
    }

    let record;
    try {
      record = JSON.parse(candidate);
    } catch {
      continue;
    }

    const recordType = typeof record?.type === 'string' ? record.type : '';
    const url = typeof record?.detail?.url === 'string' ? record.detail.url : '';
    const typeMatches = options.type === 'any' || recordType === options.type;
    const urlMatches = url.toLocaleLowerCase('en-US').includes(expectedUrl);

    if (typeMatches && urlMatches) {
      matches.push(record);
    }
  }

  return matches;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}

if (options?.help) {
  printHelp();
} else if (options) {
  if (!options.urlContains) {
    fail('--url-contains is required');
  } else if (!allowedTypes.has(options.type)) {
    fail(`Unsupported --type: ${options.type}`);
  } else {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }

    const rawInput = chunks.join('');
    const buffer = getResultBuffer(rawInput);
    const records = selectRecords(buffer, options);

    process.stdout.write(`${JSON.stringify({
      matched: records.length,
      type: options.type,
      urlContains: options.urlContains,
      records,
    }, null, 2)}\n`);
  }
}
