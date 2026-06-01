/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ciyex Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ciyex Workspace update server (Cloudflare Worker).
 *
 * Implements the update protocol used by VS Code's IUpdateService:
 *   GET /api/update/{platform}/{quality}/{commit}
 *     -> 204 when the running build is already the latest
 *     -> 200 + JSON { url, version, productVersion, sha256hash, timestamp } when a newer build exists
 *
 * Source of truth is GitHub Releases on qiaben/ciyex-workspace. Each release must include a
 * `metadata.json` asset describing the build (commit, version, per-platform download URLs and
 * sha256 hashes). The build-windows workflow publishes this manifest automatically.
 */

export interface Env {
	GITHUB_REPO: string;        // e.g. "qiaben/ciyex-workspace"
	GITHUB_TOKEN?: string;      // optional, raises GitHub API rate limit from 60/hr to 5000/hr
	ALLOWED_QUALITIES?: string; // comma-separated, defaults to "stable"
}

interface PlatformAsset {
	url: string;
	sha256: string;
}

interface UpdateManifest {
	version: string;
	commit: string;
	buildNumber?: number;
	publishedAt: number;
	platforms: Record<string, PlatformAsset>;
}

interface UpdateResponse {
	url: string;
	name: string;
	version: string;
	productVersion: string;
	timestamp: number;
	sha256hash: string;
	supportsFastUpdate: boolean;
}

const MANIFEST_TTL_SECONDS = 300;
const NO_CONTENT = new Response(null, { status: 204 });

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		const url = new URL(request.url);

		if (url.pathname === '/' || url.pathname === '/healthz') {
			return Response.json({ ok: true, service: 'ciyex-workspace-updates' });
		}

		const match = url.pathname.match(/^\/api\/update\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
		if (!match) {
			return new Response('Not Found', { status: 404 });
		}

		const [, platform, quality, currentCommit] = match;

		const allowedQualities = (env.ALLOWED_QUALITIES ?? 'oss,stable').split(',').map(s => s.trim());
		if (!allowedQualities.includes(quality)) {
			return NO_CONTENT;
		}

		let manifest: UpdateManifest | undefined;
		try {
			manifest = await getLatestManifest(env, ctx, quality, platform);
		} catch (err) {
			console.error('Failed to load manifest:', err);
			return NO_CONTENT;
		}

		if (!manifest) {
			return NO_CONTENT;
		}

		// Same commit running locally -> nothing to do.
		if (manifest.commit === currentCommit) {
			return NO_CONTENT;
		}

		const asset = manifest.platforms[platform];
		if (!asset?.url) {
			return NO_CONTENT;
		}

		const body: UpdateResponse = {
			url: asset.url,
			name: manifest.version,
			version: manifest.commit,
			productVersion: manifest.version,
			timestamp: manifest.publishedAt,
			sha256hash: asset.sha256,
			supportsFastUpdate: false,
		};

		return Response.json(body, {
			headers: {
				'Cache-Control': `public, max-age=${MANIFEST_TTL_SECONDS}`,
			},
		});
	},
};

/**
 * Map a platform + quality to the correct GitHub pointer release tag.
 *
 * Each build workflow publishes a metadata.json to a "latest pointer" release:
 *   Windows:  stage-latest                   (single tag, all win32 variants)
 *   Linux:    stage-latest-linux-x64
 *   macOS:    stage-latest-darwin-universal
 */
function platformToPointerTag(quality: string, platform: string): string {
	if (platform.startsWith('win32')) {
		return `${quality}-latest`;
	}
	const suffix = platform.replace(/-archive$/, '').replace(/-zip$/, '');
	return `${quality}-latest-${suffix}`;
}

async function getLatestManifest(env: Env, ctx: ExecutionContext, quality: string, platform: string): Promise<UpdateManifest | undefined> {
	// For dev/stage channels, fetch the per-channel pointer release metadata
	// (e.g. "stage-latest-linux-x64") which is always updated by CI on every build.
	// Prod/stable use the standard non-prerelease release mechanism.
	const isChannelBuild = quality === 'dev' || quality === 'stage';
	const cacheKey = new Request(`https://updates.internal/manifest/${env.GITHUB_REPO}/${isChannelBuild ? platformToPointerTag(quality, platform) : 'stable'}`);
	const cache = caches.default;

	const cached = await cache.match(cacheKey);
	if (cached) {
		return await cached.json<UpdateManifest>();
	}

	const release = await fetchLatestRelease(env, quality, platform);
	if (!release) {
		return undefined;
	}

	const manifestAsset = release.assets.find(a => a.name === 'metadata.json');
	if (!manifestAsset) {
		console.warn(`Release ${release.tag_name} has no metadata.json asset`);
		return undefined;
	}

	const res = await fetch(manifestAsset.browser_download_url, {
		headers: { 'User-Agent': 'ciyex-workspace-update-server' },
	});
	if (!res.ok) {
		console.error(`Failed to download metadata.json: ${res.status}`);
		return undefined;
	}

	const manifest = await res.json<UpdateManifest>();

	const cacheResponse = Response.json(manifest, {
		headers: { 'Cache-Control': `public, max-age=${MANIFEST_TTL_SECONDS}` },
	});
	ctx.waitUntil(cache.put(cacheKey, cacheResponse));

	return manifest;
}

interface GitHubAsset {
	name: string;
	browser_download_url: string;
}

interface GitHubRelease {
	tag_name: string;
	prerelease: boolean;
	draft: boolean;
	published_at: string;
	assets: GitHubAsset[];
}

async function fetchLatestRelease(env: Env, quality: string, platform: string): Promise<GitHubRelease | undefined> {
	const headers: Record<string, string> = {
		'Accept': 'application/vnd.github+json',
		'User-Agent': 'ciyex-workspace-update-server',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	if (env.GITHUB_TOKEN) {
		headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
	}

	// Dev/stage: fetch the channel pointer release directly by tag name.
	// The CI always uploads a fresh metadata.json to e.g. "stage-latest-linux-x64"
	// on every successful build, so this is always up to date.
	if (quality === 'dev' || quality === 'stage') {
		const tag = `${quality}-latest-${platformToPointerTag(quality, platform)}`;
		const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases/tags/${tag}`, { headers });
		if (!res.ok) {
			console.error(`GitHub API error fetching tag ${tag}: ${res.status}`);
			return undefined;
		}
		return await res.json<GitHubRelease>();
	}

	// Prod/stable: use the latest non-prerelease, non-draft release.
	const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases?per_page=10`, { headers });
	if (!res.ok) {
		console.error(`GitHub API error: ${res.status}`);
		return undefined;
	}
	const releases = await res.json<GitHubRelease[]>();
	return releases.find(r => !r.draft && !r.prerelease);
}
