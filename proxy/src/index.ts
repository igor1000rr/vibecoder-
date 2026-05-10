/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vibecoder Proxy — Cloudflare Worker.
 *
 * Проксирует запросы от Vibecoder IDE к публичным LLM-провайдерам.
 * Стейтлесс: ничего не хранит, никаких ключей не запоминает. Юзер
 * передаёт свой API-ключ в каждом запросе (BYOK).
 *
 * Маршруты:
 *   /anthropic/...   → https://api.anthropic.com/...
 *   /openai/...      → https://api.openai.com/...
 *   /gemini/...      → https://generativelanguage.googleapis.com/...
 *   /openrouter/...  → https://openrouter.ai/api/...
 *   /health          → 200 OK с метаданными
 */

interface ProviderTarget {
	host: string;
	/** Дополнительные заголовки которые нужно гарантированно передать на upstream */
	preserveHeaders: readonly string[];
}

const PROVIDERS: Record<string, ProviderTarget> = {
	anthropic: {
		host: 'https://api.anthropic.com',
		preserveHeaders: ['x-api-key', 'anthropic-version', 'anthropic-beta', 'anthropic-dangerous-direct-browser-access', 'content-type', 'accept'],
	},
	openai: {
		host: 'https://api.openai.com',
		preserveHeaders: ['authorization', 'openai-organization', 'openai-project', 'content-type', 'accept'],
	},
	gemini: {
		host: 'https://generativelanguage.googleapis.com',
		preserveHeaders: ['content-type', 'accept'],
	},
	openrouter: {
		host: 'https://openrouter.ai',
		// OpenRouter использует /api/v1/... но мы маршрутизируем /openrouter/v1/...,
		// поэтому надо вставить /api между host и path. См. routeRequest.
		preserveHeaders: ['authorization', 'http-referer', 'x-title', 'content-type', 'accept'],
	},
};

/**
 * CORS-заголовки, которые мы возвращаем браузеру (Vibecoder renderer).
 * Allow-Origin намеренно широкий: прокси публичный, без auth, без cookies.
 * Ключи к LLM-провайдерам — это responsibility клиента.
 */
const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': '*',
	'Access-Control-Expose-Headers': '*',
	'Access-Control-Max-Age': '86400',
};

function corsResponse(status: number, body: string | object): Response {
	const isJson = typeof body !== 'string';
	return new Response(isJson ? JSON.stringify(body) : body, {
		status,
		headers: {
			...CORS_HEADERS,
			'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
		},
	});
}

function buildUpstreamHeaders(req: Request, preserveHeaders: readonly string[]): Headers {
	const out = new Headers();
	for (const h of preserveHeaders) {
		const v = req.headers.get(h);
		if (v !== null) {
			out.set(h, v);
		}
	}
	// Cloudflare добавляет cf-* заголовки сама; мы их не трогаем.
	// User-Agent сохраняем чтобы провайдеры могли его видеть.
	const ua = req.headers.get('user-agent');
	if (ua) { out.set('user-agent', ua); }
	return out;
}

/**
 * Скопировать ответ upstream, добавив CORS-заголовки.
 * Стрим тела пробрасывается напрямую: response.body — это уже ReadableStream,
 * который Cloudflare Workers умеют форвардить без буферизации.
 */
function copyResponseWithCors(upstream: Response): Response {
	const headers = new Headers(upstream.headers);
	for (const [k, v] of Object.entries(CORS_HEADERS)) {
		headers.set(k, v);
	}
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers,
	});
}

async function routeRequest(req: Request, providerKey: string, remainingPath: string): Promise<Response> {
	const provider = PROVIDERS[providerKey];
	if (!provider) {
		return corsResponse(404, { error: `Unknown provider: ${providerKey}` });
	}

	// OpenRouter: маппим /openrouter/v1/... → /api/v1/...
	let upstreamPath = remainingPath;
	if (providerKey === 'openrouter' && upstreamPath.startsWith('/v1')) {
		upstreamPath = '/api' + upstreamPath;
	}

	const url = new URL(req.url);
	const upstreamUrl = provider.host + upstreamPath + url.search;

	const upstreamHeaders = buildUpstreamHeaders(req, provider.preserveHeaders);

	let upstream: Response;
	try {
		upstream = await fetch(upstreamUrl, {
			method: req.method,
			headers: upstreamHeaders,
			body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
			// @ts-expect-error duplex required for streaming request bodies in Workers
			duplex: 'half',
			redirect: 'follow',
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return corsResponse(502, { error: 'Upstream fetch failed', provider: providerKey, message });
	}

	return copyResponseWithCors(upstream);
}

export default {
	async fetch(req: Request): Promise<Response> {
		// CORS preflight
		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		const url = new URL(req.url);
		const pathname = url.pathname;

		// Health endpoint
		if (pathname === '/health' || pathname === '/') {
			return corsResponse(200, {
				name: 'vibecoder-proxy',
				version: '0.1.0',
				providers: Object.keys(PROVIDERS),
				timestamp: new Date().toISOString(),
			});
		}

		// /<provider>/<rest...>
		const match = pathname.match(/^\/([a-z]+)(\/.*)?$/);
		if (!match) {
			return corsResponse(404, { error: `Unknown route: ${pathname}` });
		}
		const [, providerKey, rest] = match;
		const remainingPath = rest ?? '/';

		return routeRequest(req, providerKey, remainingPath);
	},
};
