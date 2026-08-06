const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration for an npm-workspaces monorepo.
 *
 * `@aloud/app` lives one directory up (`../app`) and is *symlinked* into
 * `node_modules/@aloud/app` by npm workspaces rather than copied — this is
 * what makes it a real library dependency instead of the hand-pasted copy the
 * demo used before. Three things are needed for that to actually work:
 *
 *   - `watchFolders` must include the workspace root, so Metro's file watcher
 *     sees `../app/src/**` (the symlink's real target) and hot-reloads it.
 *   - `resolver.unstable_enableSymlinks` must be on, so module resolution
 *     follows the symlink instead of treating it as a dead end.
 *   - `resolver.resolveRequest` must FORCE react/react-native to one location.
 *
 * That last one is the subtle part, and worth explaining because the more
 * obvious-looking fix (`resolver.extraNodeModules`) does NOT work here:
 * `extraNodeModules` is only a *fallback* for modules Metro's normal
 * node_modules walk fails to find. It does npm ever install a `react` nested
 * under `app/node_modules` (npm's peerDependency auto-install can do this
 * even inside a workspace, independent of the root's hoisted copy) — Metro's
 * normal walk from a file in `app/src/*` finds THAT one successfully, so the
 * fallback never even runs. The result: two separate React module instances
 * in one bundle. The symptom is exactly "Cannot read property 'useMemo' of
 * null" — `@aloud/app`'s components end up calling hooks against a React
 * copy the app's actual renderer never registered a hook dispatcher on.
 *
 * `resolveRequest` runs on EVERY module request and can override the origin
 * Metro resolves from, which — unlike `extraNodeModules` — always wins. For
 * `react`/`react-native` (and their subpath imports, e.g. `react/jsx-runtime`)
 * we resolve as if the request came from the workspace root instead of from
 * wherever inside `app/` or `example/` it actually originated, so Metro's
 * upward node_modules walk starts above any per-package nested copy and lands
 * on the one true hoisted copy every time.
 *
 * https://reactnative.dev/docs/metro#adding-support-for-monorepos
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

// A file path that doesn't need to exist — only its DIRECTORY (the workspace
// root) matters, since that's what Metro's upward node_modules search uses.
const workspaceRootOrigin = path.join(workspaceRoot, 'metro-resolve-origin.js');

const SINGLETON_PACKAGES = ['react', 'react-native'];

// The reader canvas's script must ship as a FILE next to reader.html, not be
// compiled into the JS bundle. Metro only bundles what is `require`d, and the
// canvas script is referenced from inside the HTML via `<script src>`, which
// Metro cannot see — so in a Release build it was simply absent and the canvas
// rendered blank (#40). Debug hid this because the dev server serves it off
// disk. Giving it a non-JS extension and registering that extension as an asset
// makes Metro copy it verbatim into the app, alongside the HTML.
const READER_CANVAS_EXT = 'canvasjs';

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    assetExts: [...getDefaultConfig(projectRoot).resolver.assetExts, READER_CANVAS_EXT],
    unstable_enableSymlinks: true,
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    resolveRequest: (context, moduleName, platform) => {
      const isSingleton = SINGLETON_PACKAGES.some(
        (pkg) => moduleName === pkg || moduleName.startsWith(`${pkg}/`),
      );
      if (isSingleton) {
        return context.resolveRequest(
          { ...context, originModulePath: workspaceRootOrigin },
          moduleName,
          platform,
        );
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
