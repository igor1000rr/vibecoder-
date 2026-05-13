/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Глобальные константы и типы Vibecoder.
 * Этот файл импортируется и из browser-, и из electron-main-кода, поэтому
 * не должен зависеть от Electron-API или DOM.
 */

export const VIBECODER_PRODUCT_NAME = 'Vibecoder';
export const VIBECODER_VERSION = '0.1.0';

// Command IDs (используются в командной палитре и меню)
export const VibecoderCommands = {
	Hello: 'vibecoder.hello',
	TestLMStudio: 'vibecoder.testLMStudio',
	OpenChat: 'vibecoder.openChat',
	OpenSettings: 'vibecoder.openSettings',
	OpenComposer: 'vibecoder.openComposer',
	ToggleAutocomplete: 'vibecoder.toggleAutocomplete',
	OpenNit: 'vibecoder.openNit',
	OpenWelcome: 'vibecoder.openWelcome',
} as const;

// Storage keys
export const VibecoderStorageKeys = {
	ProviderConfig: 'vibecoder.providerConfig',
	SelectedModel: 'vibecoder.selectedModel',
	SkillsRegistry: 'vibecoder.skillsRegistry',
	McpServers: 'vibecoder.mcpServers',
	OnboardingComplete: 'vibecoder.onboardingComplete',
} as const;

// Идентификаторы LLM-провайдеров
export type VibecoderProviderId =
	| 'lmstudio'
	| 'anthropic'
	| 'openai'
	| 'gemini'
	| 'openrouter';

export const VIBECODER_DEFAULT_PROVIDER: VibecoderProviderId = 'lmstudio';

// Дефолтные эндпоинты
export const VIBECODER_LMSTUDIO_DEFAULT_URL = 'http://localhost:1234/v1';
export const VIBECODER_PROXY_DEFAULT_URL = 'https://proxy.vibecoder.dev';

// Конфигурационные ключи (workbench.configuration)
export const VibecoderConfigKeys = {
	ProxyMode: 'vibecoder.proxy.mode',                  // 'direct' | 'vibecoder' | 'custom'
	ProxyCustomUrl: 'vibecoder.proxy.customUrl',
	LmStudioEndpoint: 'vibecoder.lmStudio.endpoint',
	LmStudioComposerModel: 'vibecoder.lmStudio.composerModel',
	LmStudioAutocompleteModel: 'vibecoder.lmStudio.autocompleteModel',
	LmStudioEmbeddingModel: 'vibecoder.lmStudio.embeddingModel',
	TelemetryEnabled: 'vibecoder.telemetry.enabled',    // по умолчанию false
	OpenNitOnStartup: 'vibecoder.ui.openNitOnStartup',  // открывать ли NIT-сайдбар при запуске
} as const;
