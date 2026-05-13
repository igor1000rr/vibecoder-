/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { dirs } = require('./dirs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = path.dirname(path.dirname(__dirname));

function log(dir, message) {
	if (process.stdout.isTTY) {
		console.log(`\x1b[34m[${dir}]\x1b[0m`, message);
	} else {
		console.log(`[${dir}]`, message);
	}
}

function run(command, args, opts) {
	log(opts.cwd || '.', '$ ' + command + ' ' + args.join(' '));

	const result = cp.spawnSync(command, args, opts);

	if (result.error) {
		console.error(`ERR Failed to spawn process: ${result.error}`);
		process.exit(1);
	} else if (result.status !== 0) {
		console.error(`ERR Process exited with code: ${result.status}`);
		process.exit(result.status);
	}
}

/**
 * @param {string} dir
 * @param {*} [opts]
 */
function npmInstall(dir, opts) {
	opts = {
		env: { ...process.env },
		...(opts ?? {}),
		cwd: dir,
		stdio: 'inherit',
		shell: true
	};

	const command = process.env['npm_command'] || 'install';

	if (process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'] && /^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		const userinfo = os.userInfo();
		log(dir, `Installing dependencies inside container ${process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME']}...`);

		opts.cwd = root;
		if (process.env['npm_config_arch'] === 'arm64') {
			run('sudo', ['docker', 'run', '--rm', '--privileged', 'multiarch/qemu-user-static', '--reset', '-p', 'yes'], opts);
		}
		run('sudo', ['docker', 'run', '-e', 'GITHUB_TOKEN', '-v', `${process.env['VSCODE_HOST_MOUNT']}:/root/vscode`, '-v', `${process.env['VSCODE_HOST_MOUNT']}/.build/.netrc:/root/.netrc`, '-w', path.resolve('/root/vscode', dir), process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'], 'sh', '-c', `\"chown -R root:root ${path.resolve('/root/vscode', dir)} && npm i -g node-gyp-build && npm ci\"`], opts);
		run('sudo', ['chown', '-R', `${userinfo.uid}:${userinfo.gid}`, `${path.resolve(root, dir)}`], opts);
	} else {
		log(dir, 'Installing dependencies...');
		run(npm, command.split(' '), opts);
	}
	removeParcelWatcherPrebuild(dir);
}

function setNpmrcConfig(dir, env) {
	const npmrcPath = path.join(root, dir, '.npmrc');
	const lines = fs.readFileSync(npmrcPath, 'utf8').split('\n');

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine && !trimmedLine.startsWith('#')) {
			const [key, value] = trimmedLine.split('=');
			env[`npm_config_${key}`] = value.replace(/^"(.*)"$/, '$1');
		}
	}

	// Force node-gyp to use process.config on macOS
	// which defines clang variable as expected. Otherwise we
	// run into compilation errors due to incorrect compiler
	// configuration.
	// NOTE: This means the process.config should contain
	// the correct clang variable. So keep the version check
	// in preinstall sync with this logic.
	// Change was first introduced in https://github.com/nodejs/node/commit/6e0a2bb54c5bbeff0e9e33e1a0c683ed980a8a0f
	if ((dir === 'remote' || dir === 'build') && process.platform === 'darwin') {
		env['npm_config_force_process_config'] = 'true';
	} else {
		delete env['npm_config_force_process_config'];
	}

	if (dir === 'build') {
		env['npm_config_target'] = process.versions.node;
		env['npm_config_arch'] = process.arch;
	}
}

function removeParcelWatcherPrebuild(dir) {
	const parcelModuleFolder = path.join(root, dir, 'node_modules', '@parcel');
	if (!fs.existsSync(parcelModuleFolder)) {
		return;
	}

	const parcelModules = fs.readdirSync(parcelModuleFolder);
	for (const moduleName of parcelModules) {
		if (moduleName.startsWith('watcher-')) {
			const modulePath = path.join(parcelModuleFolder, moduleName);
			fs.rmSync(modulePath, { recursive: true, force: true });
			log(dir, `Removed @parcel/watcher prebuilt module ${modulePath}`);
		}
	}
}

/**
 * Vibecoder patch: убирает variance issue из @types/node на Node 22.
 *
 * В @types/node 22.11+ Buffer и API вроде Buffer.concat ужесточили дженерик до
 * Uint8Array<ArrayBufferLike>. Через SharedArrayBuffer в ArrayBufferLike это
 * ломает variance check на каждом Buffer.concat, .copy(), TextDecoder.decode().
 *
 * Microsoft VS Code OSS extensions (debug-auto-launch, tunnel-forwarding, git,
 * typescript-language-features, emmet, css-language-features и др.) написаны
 * до этого breaking change и не компилируются.
 *
 * Этот патч заменяет в node_modules/@types/node/buffer.d.ts все
 * Uint8Array<ArrayBufferLike> на Uint8Array — возвращает старую семантику.
 * Безопасно: runtime не меняется, только types.
 *
 * Запускается на root и в build/ — там лежат собственные @types/node.
 */
function patchTypesNodeBuffer(rootDir) {
	const candidates = [
		path.join(rootDir, 'node_modules', '@types', 'node', 'buffer.d.ts'),
		path.join(rootDir, 'node_modules', '@types', 'node', 'buffer.buffer.d.ts'),
	];

	for (const file of candidates) {
		if (!fs.existsSync(file)) {
			continue;
		}
		let content;
		try {
			content = fs.readFileSync(file, 'utf8');
		} catch (e) {
			log('patch', `Skip ${file}: ${e.message}`);
			continue;
		}

		// Заменяем дженерик ArrayBufferLike на ничего — Uint8Array без параметра.
		// Это покрывает: Uint8Array<ArrayBufferLike>, Uint8Array<ArrayBufferLike>[],
		// readonly Uint8Array<ArrayBufferLike>[].
		const before = content;
		content = content.replace(/Uint8Array<ArrayBufferLike>/g, 'Uint8Array');

		if (content !== before) {
			fs.writeFileSync(file, content, 'utf8');
			log('patch', `Vibecoder: убран дженерик ArrayBufferLike в ${path.relative(rootDir, file)}`);
		}
	}
}

for (let dir of dirs) {

	if (dir === '') {
		removeParcelWatcherPrebuild(dir);
		// Vibecoder: патчим @types/node после первичной установки на root
		patchTypesNodeBuffer(root);
		continue; // already executed in root
	}

	let opts;

	if (dir === 'build') {
		opts = {
			env: {
				...process.env
			},
		}
		if (process.env['CC']) { opts.env['CC'] = 'gcc'; }
		if (process.env['CXX']) { opts.env['CXX'] = 'g++'; }
		if (process.env['CXXFLAGS']) { opts.env['CXXFLAGS'] = ''; }
		if (process.env['LDFLAGS']) { opts.env['LDFLAGS'] = ''; }

		setNpmrcConfig('build', opts.env);
		npmInstall('build', opts);
		// Vibecoder: патчим @types/node в build/
		patchTypesNodeBuffer(path.join(root, 'build'));
		continue;
	}

	if (/^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		// node modules used by vscode server
		opts = {
			env: {
				...process.env
			},
		}
		if (process.env['VSCODE_REMOTE_CC']) {
			opts.env['CC'] = process.env['VSCODE_REMOTE_CC'];
		} else {
			delete opts.env['CC'];
		}
		if (process.env['VSCODE_REMOTE_CXX']) {
			opts.env['CXX'] = process.env['VSCODE_REMOTE_CXX'];
		} else {
			delete opts.env['CXX'];
		}
		if (process.env['CXXFLAGS']) { delete opts.env['CXXFLAGS']; }
		if (process.env['CFLAGS']) { delete opts.env['CFLAGS']; }
		if (process.env['LDFLAGS']) { delete opts.env['LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_CXXFLAGS']) { opts.env['CXXFLAGS'] = process.env['VSCODE_REMOTE_CXXFLAGS']; }
		if (process.env['VSCODE_REMOTE_LDFLAGS']) { opts.env['LDFLAGS'] = process.env['VSCODE_REMOTE_LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_NODE_GYP']) { opts.env['npm_config_node_gyp'] = process.env['VSCODE_REMOTE_NODE_GYP']; }

		const globalGypPath = path.join(os.homedir(), '.gyp');
		const globalInclude = path.join(globalGypPath, 'include.gypi');
		const tempGlobalInclude = path.join(globalGypPath, 'include.gypi.bak');
		if (process.platform === 'linux' &&
			(process.env['CI'] || process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'])) {
			// Following include file rename should be removed
			// when `Override gnu target for arm64 and arm` step
			// is removed from the product build pipeline.
			if (fs.existsSync(globalInclude)) {
				fs.renameSync(globalInclude, tempGlobalInclude);
			}
		}
		setNpmrcConfig('remote', opts.env);
		npmInstall(dir, opts);
		if (process.platform === 'linux' &&
			(process.env['CI'] || process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'])) {
			if (fs.existsSync(tempGlobalInclude)) {
				fs.renameSync(tempGlobalInclude, globalInclude);
			}
		}
		continue;
	}

	npmInstall(dir, opts);
}

cp.execSync('git config pull.rebase merges');
cp.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
