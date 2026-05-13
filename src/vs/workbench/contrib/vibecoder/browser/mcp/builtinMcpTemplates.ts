/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Каталог встроенных MCP-серверов Vibecoder.
 *
 * 15 шаблонов, портированных из Cursor MCP catalog (2026-05-06).
 * Каждый шаблон описывает: тип (stdio/http), команду или URL, требуемые env-переменные,
 * краткое описание и список тулсов.
 *
 * Шаблоны НЕ запускаются автоматически — юзер сам выбирает в Settings panel
 * какие подключить, заполняет ключи и нажимает "Добавить в .vibecoder/mcp.json".
 *
 * Ограничение MVP: текущий VibecoderMcpService поддерживает только HTTP/SSE серверы.
 * Большинство MCP в каталоге — stdio (запускаются через `npx -y @modelcontextprotocol/...`).
 * Они отмечены type='stdio' и пока не запустятся в Vibecoder — добавление в конфиг
 * подготовит данные на будущее когда stdio-канал через electron-main будет реализован.
 */

export interface VibecoderMcpTemplate {
	/** Уникальный id шаблона (используется как имя сервера в mcp.json) */
	readonly id: string;
	/** Отображаемое имя в UI */
	readonly displayName: string;
	/** Короткое описание для UI */
	readonly description: string;
	/** Тип: stdio (child process) или http (SSE endpoint) */
	readonly type: 'stdio' | 'http';
	/** Эмодзи для UI */
	readonly icon: string;
	/** Для stdio: команда + аргументы */
	readonly command?: string;
	readonly args?: readonly string[];
	/** Для http: URL endpoint */
	readonly url?: string;
	/** Список переменных окружения которые юзер должен заполнить */
	readonly requiredEnv?: readonly { name: string; description: string }[];
	/** Ссылка на документацию */
	readonly docsUrl?: string;
	/** Краткий список главных тулсов (для UI tooltip) */
	readonly tools: readonly string[];
}

export const BUILTIN_MCP_TEMPLATES: readonly VibecoderMcpTemplate[] = [
	{
		id: 'github',
		displayName: 'GitHub',
		description: 'Репозитории, issues, PRs, коммиты, поиск кода.',
		type: 'stdio',
		icon: '🐙',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		requiredEnv: [
			{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', description: 'GitHub PAT с правами repo/issues/PRs' },
		],
		docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
		tools: [
			'search_repositories', 'create_repository', 'fork_repository',
			'get_file_contents', 'create_or_update_file', 'push_files',
			'create_issue', 'list_issues', 'create_pull_request', 'merge_pull_request',
			'search_code', 'search_issues',
		],
	},

	{
		id: 'perplexity',
		displayName: 'Perplexity',
		description: 'Web search через Sonar (search / reason / deep_research).',
		type: 'stdio',
		icon: '🔍',
		command: 'npx',
		args: ['-y', 'perplexity-mcp'],
		requiredEnv: [
			{ name: 'PERPLEXITY_API_KEY', description: 'API ключ Perplexity (pplx-...)' },
		],
		docsUrl: 'https://docs.perplexity.ai/guides/mcp-server',
		tools: ['search', 'reason', 'deep_research'],
	},

	{
		id: 'sequential-thinking',
		displayName: 'Sequential Thinking',
		description: 'Динамическое пошаговое рассуждение с ревизиями и ветвлениями.',
		type: 'stdio',
		icon: '🧠',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
		docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
		tools: ['sequentialthinking'],
	},

	{
		id: 'supabase',
		displayName: 'Supabase',
		description: 'PostgreSQL, Edge Functions, branches, migrations, advisors.',
		type: 'stdio',
		icon: '🗃️',
		command: 'npx',
		args: ['-y', '@supabase/mcp-server-supabase'],
		requiredEnv: [
			{ name: 'SUPABASE_ACCESS_TOKEN', description: 'Personal access token (settings.supabase.com/tokens)' },
			{ name: 'SUPABASE_PROJECT_REF', description: 'Project ref (URL: xxxxx.supabase.co → xxxxx)' },
		],
		docsUrl: 'https://supabase.com/docs/guides/getting-started/mcp',
		tools: [
			'execute_sql', 'apply_migration', 'list_tables',
			'create_branch', 'merge_branch',
			'deploy_edge_function', 'get_logs', 'get_advisors',
		],
	},

	{
		id: 'lmstudio',
		displayName: 'LM Studio',
		description: 'Локальные модели через LM Studio (chat, completions, embeddings).',
		type: 'http',
		icon: '🤖',
		url: 'http://localhost:1234/mcp',
		docsUrl: 'https://lmstudio.ai/docs/local-server',
		tools: [
			'chat_completion', 'text_completion',
			'create_response', 'start_conversation', 'continue_conversation',
			'generate_embeddings', 'list_models', 'health_check',
		],
	},

	{
		id: 'ollama',
		displayName: 'Ollama',
		description: 'Локальные модели через Ollama (chat, generate, embed, web).',
		type: 'stdio',
		icon: '🦙',
		command: 'npx',
		args: ['-y', 'ollama-mcp'],
		requiredEnv: [
			{ name: 'OLLAMA_HOST', description: 'URL Ollama (по умолчанию http://localhost:11434)' },
		],
		docsUrl: 'https://github.com/ollama/ollama',
		tools: [
			'ollama_chat', 'ollama_generate', 'ollama_embed',
			'ollama_list', 'ollama_pull', 'ollama_delete',
			'ollama_web_fetch', 'ollama_web_search',
		],
	},

	{
		id: 'groq',
		displayName: 'Groq',
		description: 'Быстрые LLM через Groq API + vision + STT/TTS + batch.',
		type: 'stdio',
		icon: '⚡',
		command: 'npx',
		args: ['-y', 'groq-mcp'],
		requiredEnv: [
			{ name: 'GROQ_API_KEY', description: 'API ключ Groq (gsk_...)' },
		],
		docsUrl: 'https://console.groq.com/docs',
		tools: [
			'chat_completion', 'compound_tool',
			'analyze_image', 'analyze_image_json',
			'text_to_speech', 'transcribe_audio', 'translate_audio',
			'batch_process', 'list_chat_models',
		],
	},

	{
		id: 'openrouter',
		displayName: 'OpenRouter',
		description: 'Маршрутизация к 100+ моделям через единый API.',
		type: 'stdio',
		icon: '🌿',
		command: 'npx',
		args: ['-y', 'openrouter-mcp'],
		requiredEnv: [
			{ name: 'OPENROUTER_API_KEY', description: 'API ключ OpenRouter (sk-or-v1-...)' },
		],
		docsUrl: 'https://openrouter.ai/docs',
		tools: ['chat_completion', 'search_models', 'get_model_info', 'validate_model'],
	},

	{
		id: 'appwrite-admin',
		displayName: 'Appwrite Admin',
		description: 'Администрирование Appwrite: БД, коллекции, юзеры, бакеты, API-ключи.',
		type: 'stdio',
		icon: '🗄️',
		command: 'npx',
		args: ['-y', 'appwrite-admin-mcp'],
		requiredEnv: [
			{ name: 'APPWRITE_ENDPOINT', description: 'URL Appwrite (например https://appwrite.vibecoding.by/v1)' },
			{ name: 'APPWRITE_API_KEY', description: 'Admin API key с правами projects.*' },
		],
		docsUrl: 'https://appwrite.io/docs',
		tools: [
			'list_projects', 'create_project',
			'create_database', 'create_collection', 'create_document', 'list_documents',
			'create_user', 'list_users',
			'create_bucket', 'list_buckets', 'create_key',
		],
	},

	{
		id: 'coolify',
		displayName: 'Coolify',
		description: 'Self-hosted PaaS: приложения, БД, deploy, env-vars, private keys.',
		type: 'stdio',
		icon: '🚀',
		command: 'npx',
		args: ['-y', 'coolify-mcp'],
		requiredEnv: [
			{ name: 'COOLIFY_API_URL', description: 'URL Coolify (например https://coolify.example.com:8000)' },
			{ name: 'COOLIFY_API_TOKEN', description: 'API token из Coolify settings' },
		],
		docsUrl: 'https://coolify.io/docs/api-reference',
		tools: [
			'applications', 'databases', 'services', 'servers', 'projects',
			'deployments', 'private-keys', 'ping', 'config-status',
		],
	},

	{
		id: 'netlify',
		displayName: 'Netlify',
		description: 'Deploys, env-vars, extensions, forms, serverless coding rules.',
		type: 'stdio',
		icon: '🌐',
		command: 'npx',
		args: ['-y', '@netlify/mcp'],
		requiredEnv: [
			{ name: 'NETLIFY_AUTH_TOKEN', description: 'Personal access token (app.netlify.com/user/applications)' },
		],
		docsUrl: 'https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/',
		tools: [
			'netlify-coding-rules',
			'netlify-project-services-reader', 'netlify-project-services-updater',
			'netlify-deploy-services-reader', 'netlify-deploy-services-updater',
			'netlify-extension-services-reader', 'netlify-extension-services-updater',
		],
	},

	{
		id: 'render',
		displayName: 'Render',
		description: 'Cloud deploy и управление сервисами Render.',
		type: 'stdio',
		icon: '☁️',
		command: 'npx',
		args: ['-y', 'render-mcp'],
		requiredEnv: [
			{ name: 'RENDER_API_KEY', description: 'API ключ Render (dashboard.render.com/account/api-keys)' },
		],
		docsUrl: 'https://render.com/docs/api',
		tools: [
			'get-services', 'create-service',
			'trigger-deploy', 'cancel-deploy', 'get-deploys',
			'get-logs', 'list-env-var', 'add-update-env-var', 'delete-env-var',
		],
	},

	{
		id: 'pollinations',
		displayName: 'Pollinations',
		description: 'Генерация текста, изображений, видео, аудио через Pollinations AI.',
		type: 'stdio',
		icon: '🌺',
		command: 'npx',
		args: ['-y', 'pollinations-mcp'],
		requiredEnv: [
			{ name: 'POLLINATIONS_TOKEN', description: 'Опциональный токен Pollinations (можно пустой для free tier)' },
		],
		docsUrl: 'https://pollinations.ai/docs',
		tools: [
			'generateText', 'chatCompletion', 'webSearch',
			'generateImage', 'generateImageUrl', 'describeImage',
			'generateVideo', 'generateVideoUrl',
			'sayText', 'respondAudio', 'transcribeAudio',
		],
	},

	{
		id: 'opencode',
		displayName: 'OpenCode',
		description: 'Автономный AI coding agent (~79 инструментов: ask, run, fire, sessions).',
		type: 'stdio',
		icon: '🔧',
		command: 'npx',
		args: ['-y', 'opencode-mcp'],
		requiredEnv: [
			{ name: 'OPENCODE_API_KEY', description: 'API ключ OpenCode' },
		],
		docsUrl: 'https://opencode.ai/docs',
		tools: [
			'opencode_setup', 'opencode_ask', 'opencode_reply', 'opencode_context',
			'opencode_run', 'opencode_fire', 'opencode_check', 'opencode_wait',
			'opencode_review_changes', 'opencode_conversation',
		],
	},

	{
		id: 'mempalace',
		displayName: 'Memory Palace',
		description: 'Персистентная память агента: drawers, diary, knowledge graph.',
		type: 'stdio',
		icon: '🏰',
		command: 'npx',
		args: ['-y', 'mempalace-mcp'],
		requiredEnv: [
			{ name: 'MEMPALACE_STORAGE_PATH', description: 'Локальный путь для хранения (например ~/.mempalace)' },
		],
		docsUrl: 'https://github.com/mempalace/mcp',
		tools: [
			'mempalace_add_drawer', 'mempalace_search', 'mempalace_delete_drawer',
			'mempalace_diary_write', 'mempalace_diary_read',
			'mempalace_kg_add', 'mempalace_kg_query', 'mempalace_kg_timeline',
			'mempalace_traverse', 'mempalace_find_tunnels',
		],
	},
];

/**
 * Преобразует шаблон в конфиг для .vibecoder/mcp.json.
 * envValues — значения env-переменных от юзера (из Settings UI).
 */
export function templateToConfig(
	template: VibecoderMcpTemplate,
	envValues: Record<string, string>,
): { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> } {
	if (template.type === 'stdio') {
		const env: Record<string, string> = {};
		for (const required of template.requiredEnv ?? []) {
			const value = envValues[required.name];
			if (value) { env[required.name] = value; }
		}
		return {
			command: template.command,
			args: template.args ? [...template.args] : undefined,
			...(Object.keys(env).length > 0 ? { env } : {}),
		};
	}
	// HTTP
	return {
		url: template.url!,
		...(Object.keys(envValues).length > 0 ? { headers: envValues } : {}),
	};
}
