/**
 * Live plugin command chords for the editor (§45).
 *
 * The editor document must know which chords to claim *before* a key is
 * pressed, and that set changes whenever a plugin enables, disables, or
 * unregisters a command. This hook mirrors the registry's binding table into
 * the editor as a plain list of canonical chord ids, so the WebView never has
 * to parse an Acode `bindKey` map.
 */
import { useEffect, useState } from "react";

import { getPluginRuntimeBridge } from "@/modules/extensions";

export function usePluginCommandChords(): string[] {
  const [chords, setChords] = useState<string[]>([]);

  useEffect(() => {
    const bridge = getPluginRuntimeBridge();
    const sync = (): void => {
      setChords(bridge.chordIds());
    };
    sync();
    return bridge.commands.subscribe(sync);
  }, []);

  return chords;
}
