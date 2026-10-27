import { CONTRACT_VERSION, ENGINE_VERSION, type ResultVersions } from "./schemas/common";
import type { Catalog } from "./schemas/catalog";
import type { AcademicRecord } from "./schemas/record";

/** The versions block every result carries: which shapes, rules, data and
 *  record produced it. */
export function resultVersions(catalog: Catalog, record: AcademicRecord): ResultVersions {
  return {
    contractVersion: CONTRACT_VERSION,
    engineVersion: ENGINE_VERSION,
    dataVersion: catalog.dataVersion,
    catalogYear: record.catalogYear,
    recordId: record.recordId,
    recordVersion: record.recordVersion,
  };
}
