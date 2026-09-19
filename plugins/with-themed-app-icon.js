/**
 * with-themed-app-icon: installs one disabled activity-alias per themed
 * launcher icon variant so the app icon can follow the in-app theme at
 * runtime (Android only; iOS keeps the default icon).
 *
 * Alias list mirrors `scripts/themed-icon-specs.mjs` (canonical) — the
 * `contracts:check` gate asserts they stay in sync. Drawable PNGs come
 * from `npm run vendor:themed-icons` (`assets/images/icon-*.png`).
 */
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const ALIASES = [
  { suffix: 'ThemedIconBurnt', drawable: 'ic_launcher_themed_burnt', source: 'icon-burnt.png' },
  { suffix: 'ThemedIconIndigo', drawable: 'ic_launcher_themed_indigo', source: 'icon-indigo.png' },
  { suffix: 'ThemedIconDark', drawable: 'ic_launcher_themed_dark', source: 'icon-dark.png' },
  { suffix: 'ThemedIconLight', drawable: 'ic_launcher_themed_light', source: 'icon-light.png' },
]

function ensureAliases(androidManifest) {
  const appEntry = androidManifest.manifest.application?.[0]
  if (!appEntry) {
    return androidManifest
  }
  const aliases = appEntry['activity-alias'] || []
  for (const { suffix, drawable } of ALIASES) {
    const name = `.${suffix}`
    if (aliases.some((a) => a.$['android:name'] === name)) {
      continue
    }
    aliases.push({
      $: {
        'android:name': name,
        'android:enabled': 'false',
        'android:exported': 'true',
        'android:icon': `@drawable/${drawable}`,
        'android:roundIcon': `@drawable/${drawable}`,
        'android:label': '@string/app_name',
        'android:targetActivity': '.MainActivity',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.LAUNCHER' } },
          ],
        },
      ],
    })
  }
  appEntry['activity-alias'] = aliases
  return androidManifest
}

async function ensureSources(projectRoot) {
  const missing = ALIASES.some(
    ({ source }) =>
      !fs.existsSync(path.join(projectRoot, 'assets', 'images', source)),
  )
  if (!missing) {
    return
  }
  // Self-heal: regenerate from the shipped artwork instead of failing the
  // build (EAS/cloud checkouts may predate the generated files). The
  // generator is deterministic, so this is a no-op when art is unchanged.
  const { pathToFileURL } = require('node:url')
  await import(
    pathToFileURL(path.join(projectRoot, 'scripts', 'make-themed-icons.mjs'))
      .href
  )
}

async function copyDrawables(projectRoot) {
  const destDir = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'res',
    'drawable-xxxhdpi',
  )
  fs.mkdirSync(destDir, { recursive: true })
  await ensureSources(projectRoot)
  for (const { drawable, source } of ALIASES) {
    const src = path.join(projectRoot, 'assets', 'images', source)
    const dest = path.join(destDir, `${drawable}.png`)
    if (!fs.existsSync(src)) {
      throw new Error(
        `themed icon source missing: assets/images/${source} (run npm run vendor:themed-icons)`,
      )
    }
    const next = fs.readFileSync(src)
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(next)) {
      fs.writeFileSync(dest, next)
    }
  }
}

module.exports = function withThemedAppIcon(config) {
  config = withAndroidManifest(config, (config) => {
    config.modResults = ensureAliases(config.modResults)
    return config
  })
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      await copyDrawables(config.modRequest.projectRoot)
      return config
    },
  ])
  return config
}

module.exports.ALIASES = ALIASES
