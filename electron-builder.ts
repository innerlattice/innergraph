// Installers for the desktop app. Build with `npm run dist`; CI builds both platforms on demand.
// Signing turns on by itself when its credentials are in the environment (CONTRIBUTING.md lists
// them); without them, macOS gets an ad-hoc signature so it runs on Apple silicon and Windows
// stays unsigned.
import type { Configuration } from "electron-builder";

type AzureSignOptions = NonNullable<NonNullable<Configuration["win"]>["azureSignOptions"]>;

const env = (name: string): string | undefined => process.env[name] || undefined;

// A Developer ID certificate from CSC_LINK (CI) or the keychain (CSC_NAME). Notarization follows
// when APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER are set too.
const macSigned = Boolean(env("CSC_LINK") || env("CSC_NAME"));

// Azure Artifact Signing, authenticated by AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET.
function azureSignOptions(): { azureSignOptions?: AzureSignOptions } {
  if (!env("AZURE_CLIENT_ID")) return {};
  const names = ["AZURE_SIGNING_ENDPOINT", "AZURE_SIGNING_ACCOUNT", "AZURE_SIGNING_PROFILE", "WIN_PUBLISHER_NAME"];
  const missing = names.filter((name) => !env(name));
  if (missing.length > 0) throw new Error(`Windows signing needs ${missing.join(", ")}`);
  return {
    azureSignOptions: {
      endpoint: env("AZURE_SIGNING_ENDPOINT") as string,
      codeSigningAccountName: env("AZURE_SIGNING_ACCOUNT") as string,
      certificateProfileName: env("AZURE_SIGNING_PROFILE") as string,
      publisherName: env("WIN_PUBLISHER_NAME") as string,
    },
  };
}

const config: Configuration = {
  appId: "com.innerlattice.innergraph",
  productName: "Inner Graph",
  copyright: "Copyright © 2026 Inner Lattice",
  directories: { output: "release", buildResources: "desktop/resources" },
  // Unpacked, so other agents can run build/cli.mjs with the app's own binary.
  asar: false,
  files: [
    "build/**",
    "!build/**/*.map",
    "web/dist/**",
    "schema/**",
    "skill/**",
    "models/**",
    "package.json",
    // Only the Node build of ONNX Runtime and the WebAssembly it runs (~15 MB of its ~140 MB).
    "!node_modules/onnxruntime-web/{lib,docs}/**",
    "!node_modules/onnxruntime-web/dist/*.map",
    "!node_modules/onnxruntime-web/dist/*.{jsep,jspi,asyncify}.*",
    "!node_modules/onnxruntime-web/dist/ort.{js,mjs,min.js,min.mjs}",
    "!node_modules/onnxruntime-web/dist/ort.{all,bundle,jspi,wasm,webgl,webgpu}*",
  ],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills in these macros.
  artifactName: "Inner-Graph-${version}-${os}-${arch}.${ext}",
  mac: {
    target: [{ target: "dmg", arch: ["arm64", "x64"] }],
    category: "public.app-category.productivity",
    // Signed builds use electron-builder's default entitlements, which allow V8's JIT.
    ...(macSigned ? { hardenedRuntime: true } : { identity: "-", hardenedRuntime: false }),
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    ...azureSignOptions(),
  },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  publish: null,
};

export default config;
