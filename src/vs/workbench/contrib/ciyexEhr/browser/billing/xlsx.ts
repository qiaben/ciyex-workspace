/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal, dependency-free `.xlsx` (SpreadsheetML) writer.
 *
 * The workbench renderer has no zip library available (`vs/base/node/zip` is a
 * node-layer module), so this builds the OOXML package by hand and stores every
 * part UNCOMPRESSED (zip method 0). Excel, LibreOffice and Google Sheets all
 * accept a stored zip, which keeps the writer to a CRC-32 table plus the four
 * OOXML parts and avoids shipping a deflate implementation.
 *
 * Used by the patient ledger's "Excel" export; keep it generic — it knows
 * nothing about ledgers.
 */

/** How a column's values are formatted in the generated sheet. */
export type XlsxColumnKind = 'text' | 'number' | 'money';

export interface IXlsxColumn {
	header: string;
	/** Column width in characters (Excel units). Defaults to a readable 18. */
	width?: number;
	kind?: XlsxColumnKind;
}

/** One row of values, positionally matched to the column list. */
export type XlsxRow = Array<string | number | null | undefined>;

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
		// Control characters are illegal in XML 1.0 and make Excel reject the file.
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Excel column letter for a 0-based index (0 is A, 26 is AA). */
function columnLetter(index: number): string {
	let n = index + 1;
	let out = '';
	while (n > 0) {
		const rem = (n - 1) % 26;
		out = String.fromCharCode(65 + rem) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

// -- zip primitives ---------------------------------------------------------

let crcTable: Uint32Array | undefined;

function crc32(data: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let i = 0; i < 256; i++) {
			let c = i;
			for (let k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
			crcTable[i] = c >>> 0;
		}
	}
	let crc = 0xFFFFFFFF;
	for (let i = 0; i < data.length; i++) { crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF]; }
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

interface ZipEntry { name: string; data: Uint8Array; crc: number; offset: number }

/** Build a zip archive whose entries are all STORED (no compression). */
function buildStoredZip(files: Array<{ name: string; content: string }>): Uint8Array {
	const encoder = new TextEncoder();
	const entries: ZipEntry[] = [];
	const chunks: Uint8Array[] = [];
	let offset = 0;

	const push = (bytes: Uint8Array): void => { chunks.push(bytes); offset += bytes.length; };
	const u16 = (v: number): number[] => [v & 0xFF, (v >>> 8) & 0xFF];
	const u32 = (v: number): number[] => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

	for (const file of files) {
		const nameBytes = encoder.encode(file.name);
		const data = encoder.encode(file.content);
		const crc = crc32(data);
		entries.push({ name: file.name, data, crc, offset });
		// Local file header. Date/time are fixed (1980-01-01) — the OOXML package
		// carries its own metadata and a stable stamp keeps exports reproducible.
		push(new Uint8Array([
			...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
			...u32(crc), ...u32(data.length), ...u32(data.length),
			...u16(nameBytes.length), ...u16(0),
		]));
		push(nameBytes);
		push(data);
	}

	const centralStart = offset;
	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		push(new Uint8Array([
			...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
			...u32(entry.crc), ...u32(entry.data.length), ...u32(entry.data.length),
			...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
			...u32(0), ...u32(entry.offset),
		]));
		push(nameBytes);
	}
	const centralSize = offset - centralStart;
	push(new Uint8Array([
		...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
		...u32(centralSize), ...u32(centralStart), ...u16(0),
	]));

	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) { out.set(c, at); at += c.length; }
	return out;
}

// -- OOXML parts ------------------------------------------------------------

/** Style ids used by {@link buildXlsx}: 0 default, 1 bold header, 2 currency. */
const STYLES_XML = `${XML_HEADER}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(columns: IXlsxColumn[], rows: XlsxRow[]): string {
	const cols = columns
		.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`)
		.join('');

	const cell = (rowIndex: number, colIndex: number, value: string | number | null | undefined, kind: XlsxColumnKind, header: boolean): string => {
		const ref = `${columnLetter(colIndex)}${rowIndex}`;
		if (header) { return `<c r="${ref}" s="1" t="inlineStr"><is><t>${escapeXml(String(value ?? ''))}</t></is></c>`; }
		if (value === null || value === undefined || value === '') { return ''; }
		if (kind === 'number' || kind === 'money') {
			const n = Number(value);
			if (!Number.isFinite(n)) { return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`; }
			return `<c r="${ref}"${kind === 'money' ? ' s="2"' : ''}><v>${n}</v></c>`;
		}
		return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
	};

	const headerRow = `<row r="1">${columns.map((c, i) => cell(1, i, c.header, 'text', true)).join('')}</row>`;
	const bodyRows = rows.map((row, r) => {
		const cells = columns.map((c, i) => cell(r + 2, i, row[i], c.kind ?? 'text', false)).join('');
		return `<row r="${r + 2}">${cells}</row>`;
	}).join('');

	return `${XML_HEADER}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${cols}</cols>
<sheetData>${headerRow}${bodyRows}</sheetData>
</worksheet>`;
}

/**
 * Build a single-sheet `.xlsx` workbook. Returns the raw file bytes, ready to
 * hand to a file-service write.
 */
export function buildXlsx(sheetName: string, columns: IXlsxColumn[], rows: XlsxRow[]): Uint8Array {
	// Excel sheet names cap at 31 chars and forbid []:*?/\ .
	const safeSheet = escapeXml((sheetName || 'Sheet1').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
	return buildStoredZip([
		{
			name: '[Content_Types].xml', content: `${XML_HEADER}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
		},
		{
			name: '_rels/.rels', content: `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
		},
		{
			name: 'xl/workbook.xml', content: `${XML_HEADER}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
		},
		{
			name: 'xl/_rels/workbook.xml.rels', content: `${XML_HEADER}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
		},
		{ name: 'xl/styles.xml', content: STYLES_XML },
		{ name: 'xl/worksheets/sheet1.xml', content: sheetXml(columns, rows) },
	]);
}
