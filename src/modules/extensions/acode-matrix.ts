/**
 * Acode compatibility matrix (prompt §56): a versioned model mapping
 * Acode minVersionCode ranges to the API surface Ajiro emulates. Expanding
 * compatibility over time means editing this table, not scattering
 * version checks through the code.
 *
 * minVersionCode history is derived from Acode's published plugin API
 * guidance (docs: "You can simply use 290, as this option became available
 * in that version"; runner plugin uses 963) [OPEN-SOURCE, MIT].
 */
export type VersionRange = { max: number; min: number };

export type AcodeCompatibilityVersion = {
  acodeVersionCodeRange: VersionRange;
  notes?: string;
  supportedApis: string[];
  unsupportedApis: string[];
};

export const ACODE_COMPATIBILITY_MATRIX: AcodeCompatibilityVersion[] = [
  {
    acodeVersionCodeRange: { max: 289, min: 0 },
    notes: "pre-minVersionCode era",
    supportedApis: [
      "acode.setPluginInit",
      "acode.setPluginUnmount",
      "acode.define",
      "acode.require",
    ],
    unsupportedApis: ["acode.waitForPlugin", "acode.clearBrokenPluginMark"],
  },
  {
    acodeVersionCodeRange: { max: 962, min: 290 },
    notes: "modern plugin API",
    supportedApis: [
      "acode.setPluginInit",
      "acode.setPluginUnmount",
      "acode.define",
      "acode.require",
      "acode.waitForPlugin",
      "acode.clearBrokenPluginMark",
      "acode.installPlugin",
      "acode.unmountPlugin",
      "acode.registerFormatter",
      "acode.unregisterFormatter",
      "acode.format",
      "acode.formatters",
      "acode.getFormatterFor",
    ],
    unsupportedApis: [],
  },
  {
    acodeVersionCodeRange: { max: Number.MAX_SAFE_INTEGER, min: 963 },
    notes: "latest plugin API (runner-era)",
    supportedApis: [
      "acode.setPluginInit",
      "acode.setPluginUnmount",
      "acode.define",
      "acode.require",
      "acode.waitForPlugin",
      "acode.clearBrokenPluginMark",
      "acode.installPlugin",
      "acode.unmountPlugin",
      "acode.registerFormatter",
      "acode.unregisterFormatter",
      "acode.format",
      "acode.formatters",
      "acode.getFormatterFor",
    ],
    unsupportedApis: [],
  },
];
