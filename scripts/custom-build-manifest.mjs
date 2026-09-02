import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(root, "release", "build-manifests");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const expectedIdentity = {
	productName: "Open Screen",
	bundleId: "com.arshy17.openscreen.preview",
	installChannel: "custom-local",
	version: packageJson.version,
};
const expectedToolchain = {
	node: packageJson.engines.node,
	npm: packageJson.engines.npm,
};

const hashFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function sourceFiles() {
	return git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
		.split("\0")
		.filter(Boolean)
		.filter((file) => !file.startsWith("release/") && !file.startsWith("crates/target/"))
		.sort();
}

function sourceDigest() {
	const digest = createHash("sha256");
	for (const file of sourceFiles()) {
		digest.update(file);
		digest.update("\0");
		digest.update(fs.readFileSync(path.join(root, file)));
		digest.update("\0");
	}
	return digest.digest("hex");
}

function collectFiles(directory, base = directory) {
	if (!fs.existsSync(directory)) return [];
	const files = [];
	const walk = (current) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) walk(absolute);
			else if (entry.isFile()) {
				files.push({
					path: path.relative(base, absolute),
					sizeBytes: fs.statSync(absolute).size,
					sha256: hashFile(absolute),
				});
			}
		}
	};
	walk(directory);
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

function nativePayloads() {
	const nativeRoot = path.join(root, "electron", "native", "bin");
	return collectFiles(nativeRoot).map((payload) => ({
		...payload,
		path: path.join("electron", "native", "bin", payload.path),
	}));
}

function plistValue(infoPlist, key) {
	return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", infoPlist], {
		encoding: "utf8",
	}).trim();
}

function packagedAppFacts(appPath) {
	if (!appPath) return null;
	const absolute = path.resolve(appPath);
	const infoPlist = path.join(absolute, "Contents", "Info.plist");
	const asar = path.join(absolute, "Contents", "Resources", "app.asar");
	const packageType = path.join(absolute, "Contents", "Resources", "package-type");
	if (!fs.existsSync(infoPlist) || !fs.existsSync(asar)) {
		throw new Error(`Packaged app is incomplete: ${absolute}`);
	}
	return {
		bundleId: plistValue(infoPlist, "CFBundleIdentifier"),
		productName: plistValue(infoPlist, "CFBundleName"),
		version: plistValue(infoPlist, "CFBundleShortVersionString"),
		installChannel: fs.existsSync(packageType) ? fs.readFileSync(packageType, "utf8").trim() : null,
		asar: {
			sizeBytes: fs.statSync(asar).size,
			sha256: hashFile(asar),
		},
		nativePayloads: collectFiles(
			path.join(resourcesDirectory(absolute), "electron", "native", "bin"),
		),
	};
}

function resourcesDirectory(appPath) {
	return path.join(appPath, "Contents", "Resources");
}

function assertEqual(label, expected, actual) {
	if (expected !== actual) {
		throw new Error(`${label} changed: expected ${expected}, received ${actual}`);
	}
}

function latestManifest() {
	if (!fs.existsSync(outputRoot)) return null;
	return fs
		.readdirSync(outputRoot)
		.filter((name) => name.startsWith("custom-") && name.endsWith(".json"))
		.sort()
		.at(-1);
}

const verifyIndex = process.argv.indexOf("--verify");
if (verifyIndex >= 0) {
	const requested = process.argv[verifyIndex + 1];
	const manifestName = requested || latestManifest();
	if (!manifestName) throw new Error("No custom build manifest is available to verify.");
	const manifestPath = path.resolve(requested ? requested : path.join(outputRoot, manifestName));
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	assertEqual("Manifest schema", 2, manifest.schemaVersion);
	assertEqual("Source digest", manifest.sourceDigest, sourceDigest());
	assertEqual(
		"Lockfile digest",
		manifest.lockfileSha256,
		hashFile(path.join(root, "package-lock.json")),
	);
	assertEqual("Git commit", manifest.gitCommit, git("rev-parse", "HEAD"));
	assertEqual("Git dirty state", manifest.dirty, git("status", "--porcelain").length > 0);
	assertEqual("Node.js version", expectedToolchain.node, process.version.replace(/^v/, ""));
	assertEqual(
		"npm version",
		expectedToolchain.npm,
		execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
	);
	assertEqual("Manifest Node.js version", manifest.node, process.version);
	assertEqual(
		"Manifest npm version",
		manifest.npm,
		execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
	);
	for (const [key, expected] of Object.entries(expectedIdentity)) {
		assertEqual(`App identity ${key}`, expected, manifest.appIdentity?.[key]);
	}
	const currentNativePayloads = nativePayloads();
	assertEqual(
		"Native payload inventory",
		JSON.stringify((manifest.nativePayloads ?? []).map((payload) => payload.path)),
		JSON.stringify(currentNativePayloads.map((payload) => payload.path)),
	);
	for (const payload of manifest.nativePayloads ?? []) {
		const absolute = path.join(root, payload.path);
		if (!fs.existsSync(absolute)) throw new Error(`Native payload is missing: ${payload.path}`);
		assertEqual(`Native payload ${payload.path}`, payload.sha256, hashFile(absolute));
	}
	const appPath = process.env.OPENSCREEN_PACKAGED_APP_PATH;
	if (manifest.packagedApp) {
		if (!appPath) {
			throw new Error("OPENSCREEN_PACKAGED_APP_PATH is required to verify the packaged app hash.");
		}
		const current = packagedAppFacts(appPath);
		for (const key of ["bundleId", "productName", "version", "installChannel"]) {
			assertEqual(`Packaged app ${key}`, manifest.packagedApp[key], current[key]);
		}
		assertEqual("Packaged app ASAR", manifest.packagedApp.asar.sha256, current.asar.sha256);
		assertEqual(
			"Packaged native payload inventory",
			JSON.stringify(manifest.packagedApp.nativePayloads ?? []),
			JSON.stringify(current.nativePayloads),
		);
	}
	console.log(`Verified custom build manifest ${manifestPath}`);
	process.exit(0);
}

fs.mkdirSync(outputRoot, { recursive: true });
const createdAt = new Date().toISOString();
const manifest = {
	schemaVersion: 2,
	createdAt,
	appIdentity: expectedIdentity,
	gitCommit: git("rev-parse", "HEAD"),
	dirty: git("status", "--porcelain").length > 0,
	sourceDigest: sourceDigest(),
	lockfileSha256: hashFile(path.join(root, "package-lock.json")),
	platform: `${process.platform}-${process.arch}`,
	node: process.version,
	npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
	nativePayloads: nativePayloads(),
	packagedApp: packagedAppFacts(process.env.OPENSCREEN_PACKAGED_APP_PATH),
};
const output = path.join(outputRoot, `custom-${createdAt.replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(output);
