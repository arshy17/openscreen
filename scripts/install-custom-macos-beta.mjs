#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const bundleId = "com.arshy17.openscreen.preview";
const productName = "Open Screen";
const installedApp = `/Applications/${productName}.app`;
const signer = process.env.OPENSCREEN_CODESIGN_IDENTITY || "OpenScreen Local Development";
const allowDirty = process.env.OPENSCREEN_ALLOW_DIRTY_CUSTOM_BUILD === "1";
const outputRoot = path.join(root, "release", "custom-beta", packageJson.version);
const currentMacVersion = output("sw_vers", ["-productVersion"]);
const localMinimumMacVersion = currentMacVersion.split(".").slice(0, 2).join(".");
const buildEnvironment = {
	...process.env,
	OPENSCREEN_MACOS_FLOOR: "host",
};

function fail(message) {
	console.error(message);
	process.exit(1);
}

function run(command, args, options = {}) {
	console.log(`\n> ${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} exited with status ${result.status ?? 1}`);
	}
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function reopenInstalledApp(appPath) {
	let lastFailure = null;
	for (let attempt = 1; attempt <= 5; attempt++) {
		console.log(`\n> open -n ${appPath}${attempt > 1 ? ` (attempt ${attempt}/5)` : ""}`);
		const result = spawnSync("open", ["-n", appPath], { cwd: root, stdio: "inherit" });
		if (!result.error && result.status === 0) return;
		lastFailure = result.error ?? new Error(`open exited with status ${result.status ?? 1}`);
		if (attempt < 5) await wait(attempt * 500);
	}
	throw lastFailure ?? new Error("Failed to reopen the installed application.");
}

function output(command, args) {
	return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function findPackagedApp(directory) {
	const stack = [directory];
	const matches = [];
	while (stack.length) {
		const current = stack.pop();
		if (!current || !fs.existsSync(current)) continue;
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory() && entry.name.endsWith(".app")) matches.push(absolute);
			else if (entry.isDirectory()) stack.push(absolute);
		}
	}
	if (matches.length !== 1) {
		fail(`Expected exactly one packaged app under ${directory}; found ${matches.length}.`);
	}
	return matches[0];
}

if (process.platform !== "darwin") fail("The private beta installer can only run on macOS.");
if (packageJson.version !== "1.10.1-beta.1") {
	fail(`Refusing an unexpected private-beta version: ${packageJson.version}`);
}
if (process.version.replace(/^v/, "") !== packageJson.engines.node) {
	fail(`Use the pinned Node.js ${packageJson.engines.node}; received ${process.version}.`);
}
const npmVersion = output("npm", ["--version"]);
if (npmVersion !== packageJson.engines.npm) {
	fail(`Use the pinned npm ${packageJson.engines.npm}; received ${npmVersion}.`);
}
if (!allowDirty && output("git", ["status", "--porcelain"])) {
	fail(
		"The custom beta must be built from a clean commit. Commit reviewed changes first, or set " +
			"OPENSCREEN_ALLOW_DIRTY_CUSTOM_BUILD=1 only for a disposable development build.",
	);
}
if (!output("security", ["find-identity", "-v", "-p", "codesigning"]).includes(signer)) {
	fail(`The required local signing identity is unavailable: ${signer}`);
}

fs.rmSync(outputRoot, { recursive: true, force: true });
run("npm", ["run", "build:native:mac"], { env: buildEnvironment });
run("npm", ["run", "fetch:ffmpeg:mac"], { env: buildEnvironment });
run("npm", ["run", "fetch:onnxruntime"], { env: buildEnvironment });
run("npm", ["run", "build:native:compositor:mac"], { env: buildEnvironment });
run("npm", ["exec", "tsc", "--"], { env: buildEnvironment });
run("npm", ["exec", "vite", "build", "--"], { env: buildEnvironment });
run(
	path.join(root, "node_modules", ".bin", "electron-builder"),
	[
		"--config",
		"electron-builder.json5",
		"--mac",
		"--dir",
		"--arm64",
		"--publish",
		"never",
		`--config.appId=${bundleId}`,
		`--config.productName=${productName}`,
		`--config.directories.output=${path.relative(root, outputRoot)}`,
		`--config.mac.minimumSystemVersion=${localMinimumMacVersion}`,
	],
	{ env: buildEnvironment },
);

const packagedApp = findPackagedApp(outputRoot);
const resources = path.join(packagedApp, "Contents", "Resources");
fs.writeFileSync(path.join(resources, "package-type"), "custom-local\n");
fs.rmSync(path.join(resources, "app-update.yml"), { force: true });

run("codesign", [
	"--force",
	"--deep",
	"--options",
	"runtime",
	"--timestamp=none",
	"--entitlements",
	path.join(root, "macos.entitlements"),
	"--sign",
	signer,
	packagedApp,
]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", packagedApp]);

const plist = path.join(packagedApp, "Contents", "Info.plist");
const actualBundleId = output("plutil", [
	"-extract",
	"CFBundleIdentifier",
	"raw",
	"-o",
	"-",
	plist,
]);
const actualVersion = output("plutil", [
	"-extract",
	"CFBundleShortVersionString",
	"raw",
	"-o",
	"-",
	plist,
]);
if (actualBundleId !== bundleId || actualVersion !== packageJson.version) {
	fail(`Packaged identity mismatch: ${actualBundleId} ${actualVersion}`);
}

const manifestResult = spawnSync("node", ["scripts/custom-build-manifest.mjs"], {
	cwd: root,
	encoding: "utf8",
	env: { ...process.env, OPENSCREEN_PACKAGED_APP_PATH: packagedApp },
});
if (manifestResult.status !== 0) fail(manifestResult.stderr || "Failed to create build manifest.");
process.stdout.write(manifestResult.stdout);
const manifestPath = manifestResult.stdout.trim().split(/\r?\n/).at(-1);
run("node", ["scripts/custom-build-manifest.mjs", "--verify", manifestPath], {
	env: { ...process.env, OPENSCREEN_PACKAGED_APP_PATH: packagedApp },
});

const backupRoot = path.join(
	os.homedir(),
	"Library",
	"Application Support",
	"OpenScreen Local Builds",
	"Installed App Backups",
);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupApp = path.join(backupRoot, timestamp, `${productName}.app`);
fs.mkdirSync(path.dirname(backupApp), { recursive: true });
if (fs.existsSync(installedApp)) run("ditto", [installedApp, backupApp]);

const stagedApp = `/Applications/.${productName}.app.install-${process.pid}`;
const previousApp = `/Applications/.${productName}.app.previous-${process.pid}`;
fs.rmSync(stagedApp, { recursive: true, force: true });
fs.rmSync(previousApp, { recursive: true, force: true });
run("ditto", [packagedApp, stagedApp]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", stagedApp]);

run("osascript", ["-e", `try\ntell application id \"${bundleId}\" to quit\nend try`]);
if (fs.existsSync(installedApp)) fs.renameSync(installedApp, previousApp);
try {
	fs.renameSync(stagedApp, installedApp);
	run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", installedApp]);
	// LaunchServices can keep a stale connection to the just-quit bundle for a
	// moment and answer -609 even though the new app is valid. Launch the exact
	// path as a new instance and retry before deciding the atomic install failed.
	await reopenInstalledApp(installedApp);
	fs.rmSync(previousApp, { recursive: true, force: true });
} catch (error) {
	fs.rmSync(installedApp, { recursive: true, force: true });
	if (fs.existsSync(previousApp)) fs.renameSync(previousApp, installedApp);
	// A failed update should leave the previous application usable, not merely
	// restored on disk. This reopen is best-effort; the original failure remains
	// the one reported to the caller.
	spawnSync("open", ["-n", installedApp], { cwd: root, stdio: "inherit" });
	throw error;
}

console.log(`\nInstalled ${productName} ${packageJson.version} at ${installedApp}`);
console.log(`Previous install backup: ${backupApp}`);
console.log(`Build manifest: ${manifestPath}`);
