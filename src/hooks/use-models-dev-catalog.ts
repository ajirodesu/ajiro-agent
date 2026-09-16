import { useQuery } from "@tanstack/react-query";

import { fetchModelsDevCatalogCached } from "@/modules/config/models-dev-catalog";

/** models.dev catalog (modalities, limits, cost) with the same caching as live. */
export function useModelsDevCatalog() {
  return useQuery({
    queryKey: ["models-dev-catalog"],
    queryFn: () => fetchModelsDevCatalogCached(),
    staleTime: 5 * 60 * 1000,
  });
}
