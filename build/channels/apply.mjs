/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Merges build/channels/<channel>.json on top of product.json in place.
// Run from the repo root: `node build/channels/apply.mjs <channel>`
// Valid channels: dev, stage, prod.

import { readFileSync, writeFileSync } from 'node:fs';
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
const overlayPath = join(here, `${channel}.json`);

const product = JSON.parse(readFileSync(productPath, 'utf8'));
const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));

// _comment is for humans only; never write it into product.json
delete overlay._comment;

const merged = { ...product, ...overlay };

writeFileSync(productPath, JSON.stringify(merged, null, '\t') + '\n', 'utf8');

console.log(`Applied ${channel}.json overlay → product.json`);
console.log(`  nameShort       : ${merged.nameShort}`);
console.log(`  applicationName : ${merged.applicationName}`);
console.log(`  updateUrl       : ${merged.updateUrl}`);
console.log(`  win32x64UserAppId: ${merged.win32x64UserAppId}`);
