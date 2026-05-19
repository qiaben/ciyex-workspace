/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Validates the requested build channel and writes a small marker file
// (.build/channel.txt) for downstream steps (release tag, asset upload).
//
// Identity (applicationName, AppIds, dataFolderName, mutex names, updateUrl)
// is NOT modified per channel anymore — one installer serves all 3 channels
// and the user picks the channel at the login screen. The auto-updater then
// reads product.channels[<selected>].updateUrl at runtime.
//
// Usage: `node build/channels/apply.mjs <dev|stage|prod>`

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_CHANNELS = ['dev', 'stage', 'prod'];

const channel = process.argv[2];
if (!channel) {
	console.error('Usage: node build/channels/apply.mjs <dev|stage|prod>');
	process.exit(1);
}
if (!VALID_CHANNELS.includes(channel)) {
	console.error(`Invalid channel "${channel}". Must be one of: ${VALID_CHANNELS.join(', ')}`);
	process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const productPath = join(repoRoot, 'product.json');
const product = JSON.parse(readFileSync(productPath, 'utf8'));

if (!product.channels?.[channel]?.updateUrl) {
	console.error(`product.json is missing channels.${channel}.updateUrl — login UI will fall back to product.updateUrl.`);
	process.exit(1);
}

const buildDir = join(repoRoot, '.build');
if (!existsSync(buildDir)) {
	mkdirSync(buildDir, { recursive: true });
}
writeFileSync(join(buildDir, 'channel.txt'), channel + '\n', 'utf8');

console.log(`Channel marker written: .build/channel.txt = ${channel}`);
console.log(`  applicationName : ${product.applicationName}`);
console.log(`  manifest        : ${product.channels[channel].updateUrl}`);
console.log(`  (identity is shared across all channels — one install serves all 3)`);
